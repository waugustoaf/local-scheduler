export type Schedule =
  | { kind: "once"; timezone: string; at: string }
  | { kind: "daily"; timezone: string; time: string }
  | { kind: "weekly"; timezone: string; time: string; weekdays: number[] }
  | { kind: "cron"; timezone: string; expression: string };

export interface TaskInput {
  id?: string;
  name: string;
  moduleId: string;
  config: unknown;
  schedule: Schedule;
  enabled: boolean;
  wake: boolean;
  toleranceMinutes: number;
  timeoutSeconds: number;
}
export interface Task extends TaskInput {
  id: string;
  revision: number;
  nextAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type RunStatus =
  | "preparing"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "unknown"
  | "missed";
export interface Run {
  id: string;
  taskId: string;
  taskName: string;
  moduleId: string;
  revision: number;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  config: unknown;
  status: RunStatus;
  summary: string;
  result: unknown;
}
export interface RunResult {
  status: "success" | "failed" | "cancelled" | "unknown";
  summary: string;
  data?: unknown;
}
export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface Memory {
  id: string;
  namespace: string;
  name: string;
  version: number;
  value: unknown;
}
export interface Profile {
  id: string;
  kind: "ssh" | "database";
  name: string;
  value: Record<string, unknown>;
}
export interface ModuleContext {
  runId: string;
  signal: AbortSignal;
  log(text: string, stream?: "stdout" | "stderr" | "system"): void;
  profiles: Profile[];
  secrets: Record<string, string>;
}
export interface TaskModule<C = unknown> {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  validateConfig(input: unknown): C;
  preflight(config: C, context: ModuleContext): Promise<Check[]>;
  execute(config: C, context: ModuleContext): Promise<RunResult>;
}
export interface Runner {
  run(
    task: Task,
    run: Run,
    signal: AbortSignal,
    log: ModuleContext["log"],
  ): Promise<RunResult>;
}
export interface WakePort {
  sync(nextAt: string | null): Promise<void>;
  hold(active: boolean): void;
}
