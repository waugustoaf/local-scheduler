import { contextBridge, ipcRenderer } from "electron";
const allowed = new Set([
  "snapshot",
  "saveTask",
  "deleteTask",
  "toggleTask",
  "runTask",
  "cancelRun",
  "saveProfile",
  "deleteProfile",
  "testProfile",
  "saveMemory",
  "deleteMemory",
  "logs",
  "powerStatus",
  "installWake",
]);
contextBridge.exposeInMainWorld(
  "scheduler",
  Object.freeze({
    call: (method: string, args: unknown = {}) => {
      if (!allowed.has(method))
        return Promise.reject(new Error("Operação inválida."));
      return ipcRenderer.invoke("scheduler:call", method, args);
    },
    chooseFile: (kind: string) => ipcRenderer.invoke("scheduler:file", kind),
  }),
);
