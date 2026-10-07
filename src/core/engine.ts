import type { Runner, WakePort, Task, Run } from "./types.ts";
import { Store } from "./store.ts";

export class Engine {
  private active = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  private ticking = false;
  private stopped = false;
  private store: Store;
  private runner: Runner;
  private wake: WakePort;
  wakeError: string | null = null;
  constructor(store: Store, runner: Runner, wake: WakePort) {
    this.store = store;
    this.runner = runner;
    this.wake = wake;
  }
  async tick(now = new Date().toISOString()) {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      for (const task of this.store.due(now)) {
        if (this.active.size >= 4) break;
        if (
          [...this.active.keys()].some(
            (id) => this.store.getRun(id)?.taskId === task.id,
          )
        )
          continue;
        const late =
          Date.parse(now) - Date.parse(task.nextAt!) >
          task.toleranceMinutes * 60000;
        const run = this.store.claim(
          task.id,
          task.nextAt!,
          late ? now : task.nextAt!,
        );
        if (!run) continue;
        if (late)
          this.store.finish(
            run.id,
            "missed",
            "A janela permitida passou. Nenhuma ação foi executada. Ocorrências vencidas foram puladas.",
          );
        else this.dispatch(task, run);
      }
      await this.syncWake(now);
    } finally {
      this.ticking = false;
    }
  }
  async syncWake(now = new Date().toISOString()) {
    const next =
      this.store
        .listTasks()
        .filter((t) => t.enabled && t.wake && t.nextAt)
        .map((t) => t.nextAt!)
        .sort()[0] ?? null;
    this.wake.hold(
      this.active.size > 0 ||
        !!(next && Date.parse(next) - Date.parse(now) <= 5 * 60000),
    );
    try {
      await this.wake.sync(next);
      this.wakeError = null;
    } catch (error) {
      this.wakeError = error instanceof Error ? error.message : String(error);
    }
  }
  manual(task: Task) {
    if (this.stopped) throw new Error("Agente encerrando.");
    if (
      [...this.active.keys()].some(
        (id) => this.store.getRun(id)?.taskId === task.id,
      )
    )
      throw new Error("Esse agendamento já está executando.");
    const run = this.store.createManualRun(task);
    this.dispatch(task, run);
    return run;
  }
  private dispatch(task: Task, run: Run) {
    const abort = new AbortController();
    const promise = Promise.resolve().then(async () => {
      this.store.markRunning(run.id);
      this.wake.hold(true);
      const timer = setTimeout(
        () => abort.abort(new Error("Tempo limite atingido.")),
        task.timeoutSeconds * 1000,
      );
      try {
        const result = await this.runner.run(
          { ...task, config: run.config },
          run,
          abort.signal,
          (line, stream = "stdout") => this.store.log(run.id, stream, line),
        );
        this.store.finish(run.id, result.status, result.summary, result.data);
      } catch (error) {
        this.store.finish(
          run.id,
          "unknown",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        clearTimeout(timer);
        this.active.delete(run.id);
        await this.syncWake();
      }
    });
    this.active.set(run.id, { abort, promise });
  }
  cancel(id: string) {
    const active = this.active.get(id);
    if (!active) throw new Error("Execução não está ativa.");
    active.abort.abort(new Error("Cancelamento solicitado."));
  }
  async idle() {
    await Promise.all([...this.active.values()].map((x) => x.promise));
  }
  async stop() {
    this.stopped = true;
    for (const active of this.active.values()) active.abort.abort();
    await this.idle();
    this.wake.hold(false);
  }
}
