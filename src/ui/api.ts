import type { Task, Run, Profile, Memory } from "../core/types.ts";
import type { Alert } from "../core/alerts.ts";
export interface Snapshot {
  tasks: Task[];
  runs: Run[];
  profiles: Profile[];
  memories: Memory[];
  modules: { id: string; label: string; version: number }[];
  agent: boolean;
  wakeError: string | null;
  alerts: Alert[];
  startedAt?: string;
}
declare global {
  interface Window {
    localScheduler?: {
      call(method: string, args?: unknown): Promise<any>;
      chooseFile(kind: string): Promise<string | null>;
    };
  }
}
const empty: Snapshot = {
  tasks: [],
  runs: [],
  profiles: [],
  memories: [],
  modules: [
    { id: "sql", label: "SQL", version: 1 },
    { id: "scripts", label: "Scripts", version: 1 },
  ],
  agent: false,
  wakeError: null,
  alerts: [],
};
let demo: Snapshot = JSON.parse(
  localStorage.getItem("scheduler_preview") ?? JSON.stringify(empty),
);
function bridge() {
  const value = window.localScheduler;
  return value &&
    typeof value.call === "function" &&
    typeof value.chooseFile === "function"
    ? value
    : null;
}
export const preview = !bridge() && !navigator.userAgent.includes("Electron/");
export async function call(method: string, args: any = {}): Promise<any> {
  const api = bridge();
  if (api) return api.call(method, args);
  if (!preview)
    throw new Error(
      "A ponte do Electron não carregou. Recompile e reabra o aplicativo.",
    );
  let result: any = true;
  const save = (key: "tasks" | "profiles" | "memories", value: any) => {
    const item = { ...value, id: value.id ?? crypto.randomUUID() };
    demo[key] = [item, ...demo[key].filter((v) => v.id !== item.id)] as any;
    return item;
  };
  switch (method) {
    case "snapshot":
      return structuredClone(demo);
    case "saveTask":
      result = save("tasks", {
        ...args,
        revision: 1,
        nextAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      break;
    case "toggleTask":
      demo.tasks = demo.tasks.map((t) =>
        t.id === args.id ? { ...t, enabled: args.enabled } : t,
      );
      break;
    case "saveProfile": {
      const { password, passphrase, ...safe } = args;
      result = save("profiles", safe);
      break;
    }
    case "saveMemory":
      result = save("memories", args);
      break;
    case "deleteTask":
      demo.tasks = demo.tasks.filter((t) => t.id !== args.id);
      break;
    case "deleteProfile":
      demo.profiles = demo.profiles.filter((t) => t.id !== args.id);
      break;
    case "deleteMemory":
      demo.memories = demo.memories.filter((t) => t.id !== args.id);
      break;
    case "powerStatus":
      return { installed: false, error: "Prévia visual" };
    case "logs":
      return [];
    default:
      throw new Error(
        "Esta é uma prévia visual. Abra o aplicativo Electron para executar ações.",
      );
  }
  localStorage.setItem("scheduler_preview", JSON.stringify(demo));
  return result;
}
export async function chooseFile(kind: string) {
  const api = bridge();
  if (!api)
    throw new Error("A seleção de arquivos está disponível no aplicativo.");
  return api.chooseFile(kind);
}
