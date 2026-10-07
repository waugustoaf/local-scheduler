import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { localToInstant, nextOccurrence } from "../src/core/schedule.ts";
import { Store } from "../src/core/store.ts";
import { Registry } from "../src/core/registry.ts";
import { redact, redactValue, redactResult } from "../src/core/redact.ts";

test("interprets a one time date in Sao Paulo independently of the system timezone", () => {
  assert.equal(
    localToInstant("2026-10-12T08:00", "America/Sao_Paulo"),
    "2026-10-12T11:00:00.000Z",
  );
});
test("rejects nonexistent DST dates rather than changing the requested hour", () => {
  assert.throws(
    () => localToInstant("2026-03-08T02:30", "America/New_York"),
    /não existe/,
  );
});
test("weekly occurrence preserves the local hour across DST", () => {
  const rule = {
    kind: "weekly" as const,
    timezone: "America/New_York",
    time: "08:00",
    weekdays: [0],
  };
  assert.equal(
    nextOccurrence(rule, "2026-03-07T12:00:00Z"),
    "2026-03-08T12:00:00.000Z",
  );
});
test("one time schedules never execute again the following year", () => {
  assert.equal(
    nextOccurrence(
      { kind: "once", timezone: "America/Sao_Paulo", at: "2026-10-08T08:00" },
      "2026-10-08T12:00:00Z",
    ),
    null,
  );
});
test("redacts credentials from streamed output", () => {
  assert.equal(
    redact("password=abcdef token=abcdef abcdef", ["abcdef"]),
    "password=[oculto] token=[oculto] [oculto]",
  );
});
test("redacts JSON escaped credentials without changing numbers in execution results", () => {
  const secret = 'a"b\\c\nd';
  assert.ok(
    !redact(JSON.stringify({ value: secret }), [secret]).includes(
      JSON.stringify(secret).slice(1, -1),
    ),
  );
  assert.deepEqual(
    redactValue({ rowCount: 30, rows: [{ value: "30", password: secret }] }, [
      "30",
      secret,
    ]),
    { rowCount: 30, rows: [{ value: "[oculto]", password: "[oculto]" }] },
  );
});
test("redaction preserves protocol status even when it matches a credential", () => {
  assert.deepEqual(
    redactResult(
      {
        status: "success",
        summary: "success",
        data: { rowCount: 30, value: "30" },
      },
      ["success", "30"],
    ),
    {
      status: "success",
      summary: "[oculto]",
      data: { rowCount: 30, value: "[oculto]" },
    },
  );
});
test("a new module registers without changing the scheduler and duplicate ids fail", () => {
  const registry = new Registry();
  const module = {
    id: "custom",
    version: 1,
    label: "Custom",
    validateConfig: (x: unknown) => x,
    preflight: async () => [],
    execute: async () => ({ status: "success" as const, summary: "ok" }),
  };
  registry.register(module);
  assert.equal(registry.get("custom"), module);
  assert.throws(() => registry.register(module), /registrado/);
});
test("durable claims prevent duplicate dispatch and interrupted runs become uncertain", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduler_store_"));
  let store: Store | undefined;
  try {
    store = new Store(join(root, "app.sqlite"));
    const task = store.saveTask(
      {
        name: "Activate",
        moduleId: "custom",
        config: { text: "first" },
        schedule: {
          kind: "once",
          timezone: "America/Sao_Paulo",
          at: "2026-10-08T08:00",
        },
        enabled: true,
        wake: true,
        toleranceMinutes: 5,
        timeoutSeconds: 60,
      },
      "2026-10-07T12:00:00Z",
    );
    const run = store.claim(task.id, task.nextAt!);
    assert.ok(run);
    assert.equal(store.claim(task.id, task.nextAt!), null);
    store.saveTask(
      { ...task, config: { text: "changed" } },
      "2026-10-07T12:00:00Z",
    );
    assert.deepEqual(store.getRun(run!.id)!.config, { text: "first" });
    store.markRunning(run!.id);
    store.recoverRuns();
    assert.equal(store.getRun(run!.id)!.status, "unknown");
    assert.equal(store.claim(task.id, task.nextAt!), null);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
