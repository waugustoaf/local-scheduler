import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.ts";
import { collectRunAlerts } from "../src/core/alerts.ts";
test("all failed runs create durable unread alerts once even when newest run is active", () => {
  const dir = mkdtempSync(join(tmpdir(), "scheduler_alerts_"));
  let store = new Store(join(dir, "db"));
  try {
    const task = store.saveTask({
      name: "Test",
      moduleId: "custom",
      config: {},
      schedule: { kind: "once", timezone: "UTC", at: "2027-01-01T08:00" },
      enabled: false,
      wake: false,
      toleranceMinutes: 5,
      timeoutSeconds: 60,
    });
    const first = store.createManualRun(task),
      second = store.createManualRun(task);
    store.finish(first.id, "failed", "Error one");
    store.finish(second.id, "unknown", "Interrupted");
    store.createManualRun(task);
    collectRunAlerts(store);
    collectRunAlerts(store);
    assert.equal(store.listAlerts().length, 2);
    assert.equal(store.pendingNotifications().length, 2);
    for (const alert of store.pendingNotifications())
      store.markNotified(alert.id);
    const id = store.listAlerts()[0].id;
    store.ackAlert(id);
    store.close();
    store = new Store(join(dir, "db"));
    collectRunAlerts(store);
    assert.equal(store.pendingNotifications().length, 0);
    assert.equal(store.listAlerts().filter((a) => !a.readAt).length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
