import type { Store } from "./store.ts";
export interface Alert {
  id: string;
  kind: "run" | "agent" | "wake" | "notification";
  title: string;
  message: string;
  runId: string | null;
  createdAt: string;
  readAt: string | null;
  notifiedAt: string | null;
}
export function collectRunAlerts(store: Store) {
  for (const run of store.listRuns())
    if (["failed", "unknown", "missed", "cancelled"].includes(run.status))
      store.addAlert({
        id: `run:${run.id}`,
        kind: "run",
        title: run.taskName,
        message: run.summary || "A execução precisa de atenção.",
        runId: run.id,
      });
}
