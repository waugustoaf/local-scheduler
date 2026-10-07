import { safeStorage, Notification } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { Store } from "../core/store.ts";
import { Engine } from "../core/engine.ts";
import { modules } from "../modules/index.ts";
import { validateProfile, connectSSH } from "../services/profiles.ts";
import { openDatabase } from "../modules/sql/index.ts";
import { object, text } from "../core/validation.ts";
import { ProcessRunner, scopedProfiles } from "./runner.ts";
import { MacPower } from "./power.ts";
import { serve } from "./rpc.ts";
import { redact } from "../core/redact.ts";
import type { ModuleContext, TaskInput, Memory } from "../core/types.ts";

export async function startAgent(dir: string, dist: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const store = new Store(join(dir, "scheduler.sqlite"));
  store.recoverRuns();
  const registry = modules(),
    power = new MacPower(dist),
    engine = new Engine(store, new ProcessRunner(store, dist), power);
  let notifyRevision = "";
  const timer = setInterval(
    () =>
      void engine
        .tick()
        .then(() => {
          const latest = store.listRuns()[0];
          if (latest?.endedAt && latest.id !== notifyRevision) {
            notifyRevision = latest.id;
            if (Notification.isSupported())
              new Notification({
                title: latest.taskName,
                body: latest.summary,
              }).show();
          }
        })
        .catch(() => {}),
    1000,
  );
  const context = (config: unknown): ModuleContext => {
    const profiles = scopedProfiles(config, store.listProfiles()),
      secrets: Record<string, string> = {};
    for (const p of profiles)
      for (const [key, value] of Object.entries(p.value))
        if (key.endsWith("Ref") && typeof value === "string") {
          const raw = store.getSecret(value);
          if (raw)
            secrets[value] = safeStorage.decryptString(
              Buffer.from(raw, "base64"),
            );
        }
    return {
      runId: "test",
      signal: AbortSignal.timeout(20000),
      profiles,
      secrets,
      log: () => {},
    };
  };
  const server = serve(dir, async (method, args) => {
    switch (method) {
      case "snapshot":
        return {
          tasks: store.listTasks(),
          runs: store.listRuns(),
          profiles: store.listProfiles(),
          memories: store.listMemories(),
          modules: registry.list(),
          agent: true,
          wakeError: engine.wakeError,
        };
      case "saveTask": {
        const input = object(args) as unknown as TaskInput;
        registry.get(input.moduleId).validateConfig(input.config);
        const task = store.saveTask(input);
        await engine.syncWake();
        return task;
      }
      case "deleteTask":
        store.deleteTask(text(args.id, "ID", 100));
        await engine.syncWake();
        return true;
      case "toggleTask":
        if (typeof args.enabled !== "boolean")
          throw new Error("Estado inválido.");
        {
          const result = store.setEnabled(
            text(args.id, "ID", 100),
            args.enabled,
          );
          await engine.syncWake();
          return result;
        }
      case "runTask": {
        const task = store.getTask(text(args.id, "ID", 100));
        if (!task) throw new Error("Agendamento não encontrado.");
        return engine.manual(task);
      }
      case "cancelRun":
        engine.cancel(text(args.id, "ID", 100));
        return true;
      case "logs":
        return store.logs(text(args.id, "ID", 100));
      case "saveProfile": {
        const input = object(args),
          p = validateProfile(input),
          old = store.listProfiles().find((v) => v.id === p.id);
        for (const key of ["password", "passphrase"]) {
          const value = input[key];
          if (typeof value === "string" && value) {
            if (!safeStorage.isEncryptionAvailable())
              throw new Error("Keychain indisponível.");
            const ref = `${p.id}:${key}`;
            store.putSecret(
              ref,
              safeStorage.encryptString(value).toString("base64"),
            );
            p.value[`${key}Ref`] = ref;
          } else if (old?.value[`${key}Ref`])
            p.value[`${key}Ref`] = old.value[`${key}Ref`];
        }
        return store.saveProfile(p);
      }
      case "deleteProfile": {
        const id = text(args.id, "ID", 100);
        if (
          store
            .listTasks()
            .some((t) =>
              scopedProfiles(t.config, store.listProfiles()).some(
                (p) => p.id === id,
              ),
            ) ||
          store.listProfiles().some((p) => p.value.sshProfileId === id)
        )
          throw new Error("Esta conexão está sendo usada.");
        store.deleteProfile(id);
        return true;
      }
      case "testProfile": {
        const id = text(args.id, "ID", 100),
          p = store.listProfiles().find((v) => v.id === id);
        if (!p) throw new Error("Conexão não encontrada.");
        const ctx = context({ profileId: id });
        try {
          if (p.kind === "ssh") {
            const ssh = await connectSSH(p, ctx, true);
            ssh.client.end();
            return {
              ok: true,
              fingerprint: ssh.fingerprint,
              message: "Conectado. Confirme o fingerprint antes de salvar.",
            };
          }
          const db = await openDatabase(id, ctx);
          try {
            const result = await db.client.query(
              "SELECT current_database() AS database, current_user AS username, 1 AS connection_ok",
            );
            return { ok: true, message: JSON.stringify(result.rows[0]) };
          } finally {
            await db.close();
          }
        } catch (error) {
          throw new Error(
            redact(
              error instanceof Error ? error.message : String(error),
              Object.values(ctx.secrets),
            ),
          );
        }
      }
      case "saveMemory": {
        const v = object(args),
          namespace = text(v.namespace, "Módulo", 100);
        registry.get(namespace).validateConfig(v.value);
        const m: Memory = {
          id: typeof v.id === "string" ? text(v.id, "ID", 100) : randomUUID(),
          namespace,
          name: text(v.name, "Nome", 160),
          version: 1,
          value: v.value,
        };
        return store.saveMemory(m);
      }
      case "deleteMemory":
        store.deleteMemory(text(args.id, "ID", 100));
        return true;
      case "powerStatus":
        return { installed: await power.status(), error: engine.wakeError };
      default:
        throw new Error("Operação não disponível.");
    }
  });
  void engine.tick().catch(() => {});
  return async () => {
    clearInterval(timer);
    server.close();
    await engine.stop();
    store.close();
  };
}
