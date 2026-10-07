import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
test("preload exposes its own bridge without replacing native window.scheduler", async () => {
  const browserScheduler = { postTask() {} };
  const window = {};
  Object.defineProperty(window, "scheduler", {
    value: browserScheduler,
    configurable: false,
  });
  const calls = [];
  const script = buildSync({
    entryPoints: ["src/desktop/preload.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    write: false,
  }).outputFiles[0].text;
  runInNewContext(script, {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (name, value) =>
          Object.defineProperty(window, name, { value }),
      },
      ipcRenderer: {
        invoke: async (...args) => {
          calls.push(args);
          return "/tmp/test.pem";
        },
      },
    }),
    module: { exports: {} },
    exports: {},
  });
  assert.equal(window.scheduler, browserScheduler);
  assert.equal(typeof window.localScheduler.call, "function");
  assert.equal(typeof window.localScheduler.chooseFile, "function");
  await window.localScheduler.call("snapshot");
  await window.localScheduler.chooseFile("key");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["scheduler:call", "snapshot", {}],
    ["scheduler:file", "key"],
  ]);
});
