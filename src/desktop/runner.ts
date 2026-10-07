import { utilityProcess, safeStorage } from "electron";
import { join } from "node:path";
import type {
  Runner,
  Task,
  Run,
  ModuleContext,
  RunResult,
  Profile,
} from "../core/types.ts";
import { Store } from "../core/store.ts";

export function scopedProfiles(
  config: unknown,
  profiles: Profile[],
): Profile[] {
  const strings = new Set<string>();
  const scan = (value: unknown) => {
    if (typeof value === "string") strings.add(value);
    else if (Array.isArray(value)) value.forEach(scan);
    else if (value && typeof value === "object")
      Object.values(value).forEach(scan);
  };
  scan(config);
  const found: Profile[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of profiles)
      if (strings.has(p.id) && !found.some((v) => v.id === p.id)) {
        found.push(p);
        scan(p.value);
        changed = true;
      }
  }
  return found;
}
export class ProcessRunner implements Runner {
  private store: Store;
  private dist: string;
  constructor(store: Store, dist: string) {
    this.store = store;
    this.dist = dist;
  }
  async run(
    task: Task,
    run: Run,
    signal: AbortSignal,
    log: ModuleContext["log"],
  ): Promise<RunResult> {
    const profiles = scopedProfiles(task.config, this.store.listProfiles());
    const secrets: Record<string, string> = {};
    for (const p of profiles)
      for (const [key, ref] of Object.entries(p.value))
        if (key.endsWith("Ref") && typeof ref === "string") {
          const encrypted = this.store.getSecret(ref);
          if (!encrypted) throw new Error("Credencial não encontrada.");
          secrets[ref] = safeStorage.decryptString(
            Buffer.from(encrypted, "base64"),
          );
        }
    return new Promise((resolve) => {
      const worker = utilityProcess.fork(join(this.dist, "worker.cjs"), [], {
        serviceName: "Local Scheduler Execution",
        stdio: "pipe",
      });
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: RunResult) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(result);
        worker.kill();
      };
      const abort = () => {
        worker.postMessage({ type: "abort" });
        timer = setTimeout(
          () =>
            finish({
              status: "unknown",
              summary:
                "Execução interrompida. Confirme o destino antes de repetir.",
            }),
          3000,
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      worker.on("message", (message: any) => {
        if (message.type === "log") log(message.line, message.stream);
        if (message.type === "done") finish(message.result);
      });
      worker.on("exit", () =>
        finish({
          status: "unknown",
          summary: "Executor encerrado sem confirmação do resultado.",
        }),
      );
      worker.once("spawn", () => {
        worker.postMessage({
          type: "run",
          moduleId: task.moduleId,
          config: task.config,
          runId: run.id,
          profiles,
          secrets,
        });
        if (signal.aborted) abort();
      });
    });
  }
}
