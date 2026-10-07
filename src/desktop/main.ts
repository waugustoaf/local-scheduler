import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { request } from "./rpc.ts";
import { installAgent, installWake } from "./system.ts";
import { startAgent } from "./agent.ts";

const agent = process.argv.includes("--agent");
const dist = __dirname;
const dir = join(homedir(), "Library/Application Support/Local Scheduler");
app.setName("Local Scheduler");
app.setPath("userData", agent ? join(dir, "agent_runtime") : dir);
if (agent) app.dock?.hide();
if (!app.requestSingleInstanceLock({ role: agent ? "agent" : "ui" }))
  app.quit();
else {
  let window: BrowserWindow | null = null;
  let cleanup: (() => Promise<void>) | undefined;
  app.on("second-instance", (_, argv) => {
    if (agent && !argv.includes("--agent")) return;
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (agent) {
        cleanup = await startAgent(dir, dist);
        return;
      }
      try {
        await installAgent(dir);
      } catch {
        /* Dashboard remains available to repair the executor. */
      }
      window = new BrowserWindow({
        width: 1260,
        height: 850,
        minWidth: 980,
        minHeight: 700,
        title: "Local Scheduler",
        titleBarStyle: "hiddenInset",
        backgroundColor: "#f7f7f4",
        webPreferences: {
          preload: join(dist, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const url = pathToFileURL(join(dist, "index.html")).href;
      const valid = (event: Electron.IpcMainInvokeEvent) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame?.url !== url
        )
          throw new Error("Origem inválida.");
      };
      ipcMain.handle("scheduler:call", async (event, method, args) => {
        valid(event);
        if (typeof method !== "string") throw new Error("Operação inválida.");
        if (method === "installWake") return installWake(dist);
        if (method === "repairAgent") {
          await installAgent(dir);
          return true;
        }
        return request(dir, method, args);
      });
      ipcMain.handle("scheduler:file", async (event, kind) => {
        valid(event);
        if (!["script", "key", "ca", "folder"].includes(kind))
          throw new Error("Seleção inválida.");
        const result = await dialog.showOpenDialog(window!, {
          properties: [kind === "folder" ? "openDirectory" : "openFile"],
          title: kind === "script" ? "Selecionar script" : "Selecionar arquivo",
        });
        return result.canceled ? null : result.filePaths[0];
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, target) => {
        if (target !== url) event.preventDefault();
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "Editar",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "Janela",
            submenu: [{ role: "minimize" }, { role: "zoom" }],
          },
        ]),
      );
      await window.loadURL(url);
    })
    .catch((error) => {
      dialog.showErrorBox("Local Scheduler", error.message);
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (!agent) app.quit();
  });
  let exiting = false;
  app.on("before-quit", (event) => {
    if (agent && cleanup && !exiting) {
      event.preventDefault();
      exiting = true;
      void cleanup().finally(() => app.exit());
    }
  });
}
