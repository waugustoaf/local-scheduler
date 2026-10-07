import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { nextOccurrence, validateSchedule } from "./schedule.ts";
import { integer, object, text } from "./validation.ts";
import type {
  Task,
  TaskInput,
  Run,
  RunStatus,
  Profile,
  Memory,
} from "./types.ts";

export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL, module_id TEXT NOT NULL, config TEXT NOT NULL, schedule TEXT NOT NULL, enabled INTEGER NOT NULL, wake INTEGER NOT NULL, tolerance INTEGER NOT NULL, timeout INTEGER NOT NULL, revision INTEGER NOT NULL, next_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_name TEXT NOT NULL, module_id TEXT NOT NULL, revision INTEGER NOT NULL, scheduled_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, config TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', result TEXT, UNIQUE(task_id,scheduled_at));
      CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL, stream TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, encrypted TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  private task(row: any): Task {
    return {
      id: row.id,
      name: row.name,
      moduleId: row.module_id,
      config: JSON.parse(row.config),
      schedule: JSON.parse(row.schedule),
      enabled: !!row.enabled,
      wake: !!row.wake,
      toleranceMinutes: row.tolerance,
      timeoutSeconds: row.timeout,
      revision: row.revision,
      nextAt: row.next_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  private run(row: any): Run {
    return {
      id: row.id,
      taskId: row.task_id,
      taskName: row.task_name,
      moduleId: row.module_id,
      revision: row.revision,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      config: JSON.parse(row.config),
      status: row.status,
      summary: row.summary,
      result: row.result ? JSON.parse(row.result) : null,
    };
  }
  listTasks(): Task[] {
    return this.db
      .prepare("SELECT * FROM tasks ORDER BY next_at IS NULL,next_at,name")
      .all()
      .map((r) => this.task(r));
  }
  getTask(id: string): Task | null {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    return r ? this.task(r) : null;
  }
  saveTask(input: TaskInput, now = new Date().toISOString()): Task {
    const v = object(input);
    const id = input.id ?? randomUUID();
    const old = this.getTask(id);
    const name = text(v.name, "Nome", 160);
    const moduleId = text(v.moduleId, "Módulo", 80);
    const schedule = validateSchedule(v.schedule);
    const tolerance = integer(v.toleranceMinutes, "Tolerância", 0, 1440);
    const timeout = integer(v.timeoutSeconds, "Limite", 1, 86400);
    if (typeof v.enabled !== "boolean" || typeof v.wake !== "boolean")
      throw new Error("Estado do agendamento inválido.");
    const config = JSON.stringify(input.config);
    if (!config || config.length > 512000)
      throw new Error("Configuração excede o limite.");
    const nextAt = input.enabled ? nextOccurrence(schedule, now) : null;
    if (input.enabled && nextAt === null)
      throw new Error(
        "Escolha uma data futura ou uma recorrência com próxima execução.",
      );
    this.db
      .prepare(
        `INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,module_id=excluded.module_id,config=excluded.config,schedule=excluded.schedule,enabled=excluded.enabled,wake=excluded.wake,tolerance=excluded.tolerance,timeout=excluded.timeout,revision=excluded.revision,next_at=excluded.next_at,updated_at=excluded.updated_at`,
      )
      .run(
        id,
        name,
        moduleId,
        config,
        JSON.stringify(schedule),
        +input.enabled,
        +input.wake,
        tolerance,
        timeout,
        (old?.revision ?? 0) + 1,
        nextAt,
        old?.createdAt ?? now,
        now,
      );
    return this.getTask(id)!;
  }
  setEnabled(id: string, enabled: boolean, now = new Date().toISOString()) {
    const task = this.getTask(id);
    if (!task) throw new Error("Agendamento não encontrado.");
    return this.saveTask({ ...task, enabled }, now);
  }
  deleteTask(id: string) {
    this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  due(now: string): Task[] {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE enabled=1 AND next_at IS NOT NULL AND next_at<=? ORDER BY next_at",
      )
      .all(now)
      .map((r) => this.task(r));
  }
  claim(
    taskId: string,
    scheduledAt: string,
    advanceAfter = scheduledAt,
  ): Run | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(taskId);
      if (!task || !task.enabled || task.nextAt !== scheduledAt) {
        this.db.exec("COMMIT");
        return null;
      }
      const id = randomUUID();
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO runs(id,task_id,task_name,module_id,revision,scheduled_at,config,status) VALUES(?,?,?,?,?,?,?,'preparing')`,
        )
        .run(
          id,
          task.id,
          task.name,
          task.moduleId,
          task.revision,
          scheduledAt,
          JSON.stringify(task.config),
        );
      const next = nextOccurrence(task.schedule, advanceAfter);
      this.db
        .prepare("UPDATE tasks SET next_at=? WHERE id=?")
        .run(next, taskId);
      this.db.exec("COMMIT");
      return inserted.changes ? this.getRun(id) : null;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  createManualRun(task: Task): Run {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs(id,task_id,task_name,module_id,revision,scheduled_at,config,status) VALUES(?,?,?,?,?,?,?,'preparing')`,
      )
      .run(
        id,
        task.id,
        task.name,
        task.moduleId,
        task.revision,
        `${new Date().toISOString()}#${id}`,
        JSON.stringify(task.config),
      );
    return this.getRun(id)!;
  }
  getRun(id: string): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id);
    return row ? this.run(row) : null;
  }
  listRuns(): Run[] {
    return this.db
      .prepare("SELECT * FROM runs ORDER BY rowid DESC LIMIT 250")
      .all()
      .map((r) => this.run(r));
  }
  markRunning(id: string, now = new Date().toISOString()) {
    this.db
      .prepare(
        "UPDATE runs SET status='running',started_at=? WHERE id=? AND status='preparing'",
      )
      .run(now, id);
  }
  finish(
    id: string,
    status: RunStatus,
    summary: string,
    result: unknown = null,
  ) {
    this.db
      .prepare(
        "UPDATE runs SET status=?,summary=?,result=?,ended_at=? WHERE id=?",
      )
      .run(
        status,
        summary.slice(0, 4000),
        JSON.stringify(result),
        new Date().toISOString(),
        id,
      );
  }
  recoverRuns() {
    this.db
      .prepare(
        "UPDATE runs SET status='unknown',summary='O agente foi interrompido. Verifique o destino antes de repetir.',ended_at=? WHERE status='running'",
      )
      .run(new Date().toISOString());
    this.db
      .prepare(
        "UPDATE runs SET status='missed',summary='Preparação interrompida antes da execução.',ended_at=? WHERE status='preparing'",
      )
      .run(new Date().toISOString());
  }
  log(runId: string, stream: string, value: string) {
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM logs WHERE run_id=?")
      .get(runId) as any;
    if (count.n >= 2000) return;
    this.db
      .prepare("INSERT INTO logs(run_id,at,stream,text) VALUES(?,?,?,?)")
      .run(runId, new Date().toISOString(), stream, value.slice(0, 8192));
  }
  logs(runId: string) {
    return this.db
      .prepare("SELECT at,stream,text FROM logs WHERE run_id=? ORDER BY id")
      .all(runId);
  }
  saveProfile(p: Profile) {
    this.db
      .prepare(
        "INSERT INTO profiles VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,value=excluded.value",
      )
      .run(p.id, p.kind, p.name, JSON.stringify(p.value));
    return p;
  }
  listProfiles(): Profile[] {
    return this.db
      .prepare("SELECT * FROM profiles ORDER BY kind,name")
      .all()
      .map((r: any) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        value: JSON.parse(r.value),
      }));
  }
  deleteProfile(id: string) {
    this.db.prepare("DELETE FROM profiles WHERE id=?").run(id);
  }
  saveMemory(m: Memory) {
    this.db
      .prepare(
        "INSERT INTO memories VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET namespace=excluded.namespace,name=excluded.name,version=excluded.version,value=excluded.value",
      )
      .run(m.id, m.namespace, m.name, m.version, JSON.stringify(m.value));
    return m;
  }
  listMemories(): Memory[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY namespace,name")
      .all()
      .map((r: any) => ({ ...r, value: JSON.parse(r.value) }));
  }
  deleteMemory(id: string) {
    this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
  }
  putSecret(id: string, encrypted: string) {
    this.db
      .prepare(
        "INSERT INTO secrets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted",
      )
      .run(id, encrypted);
  }
  getSecret(id: string): string | null {
    return (
      (
        this.db
          .prepare("SELECT encrypted FROM secrets WHERE id=?")
          .get(id) as any
      )?.encrypted ?? null
    );
  }
  secretIds(): string[] {
    return this.db
      .prepare("SELECT id FROM secrets")
      .all()
      .map((r: any) => r.id);
  }
  getSetting(key: string): unknown {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get(key) as any;
    return row ? JSON.parse(row.value) : null;
  }
  setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
}
