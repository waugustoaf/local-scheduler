import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { Engine } from "../src/core/engine.ts";

test("late actions are skipped and concurrent ticks dispatch only once", async () => {
  const root = mkdtempSync(join(tmpdir(), "scheduler_engine_"));
  const store = new Store(join(root, "db"));
  const input = {
    name: "Test",
    moduleId: "custom",
    config: {},
    schedule: {
      kind: "once" as const,
      timezone: "UTC",
      at: "2026-10-08T08:00",
    },
    enabled: true,
    wake: true,
    toleranceMinutes: 5,
    timeoutSeconds: 60,
  };
  let calls = 0;
  const wake = { sync: async () => {}, hold: () => {} };
  const runner = {
    run: async () => {
      calls++;
      return { status: "success" as const, summary: "ok" };
    },
  };
  const engine = new Engine(store, runner, wake);
  try {
    store.saveTask(input, "2026-10-07T00:00:00Z");
    await engine.tick("2026-10-08T08:06:00.000Z");
    assert.equal(calls, 0);
    assert.equal(store.listRuns()[0].status, "missed");
    store.saveTask({ ...input, name: "Second" }, "2026-10-07T00:00:00Z");
    await Promise.all([
      engine.tick("2026-10-08T08:00:00.000Z"),
      engine.tick("2026-10-08T08:00:00.000Z"),
    ]);
    await engine.idle();
    assert.equal(calls, 1);
    assert.equal(store.listRuns()[0].status, "success");
  } finally {
    await engine.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("missed recurring actions advance directly to the next future occurrence", async () => {
  const root = mkdtempSync(join(tmpdir(), "scheduler_backlog_")),
    store = new Store(join(root, "db"));
  const engine = new Engine(
    store,
    {
      run: async () => {
        throw new Error("Should not execute");
      },
    },
    { sync: async () => {}, hold: () => {} },
  );
  try {
    const task = store.saveTask(
      {
        name: "Cron",
        moduleId: "custom",
        config: {},
        schedule: { kind: "cron", timezone: "UTC", expression: "* * * * *" },
        enabled: true,
        wake: true,
        toleranceMinutes: 5,
        timeoutSeconds: 60,
      },
      "2026-09-01T00:00:00Z",
    );
    await engine.tick("2026-10-08T08:00:30.000Z");
    assert.equal(store.getTask(task.id)?.nextAt, "2026-10-08T08:01:00.000Z");
    assert.equal(store.listRuns()[0].status, "missed");
  } finally {
    await engine.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
