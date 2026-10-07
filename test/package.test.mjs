import test from "node:test";
import assert from "node:assert/strict";
import { resolvePackage } from "../scripts/dependencies.mjs";
test("packaging resolves dependencies whose exports hide package.json", async () => {
  const seen = new Set();
  async function visit(name, from) {
    const { root, meta } = await resolvePackage(name, from);
    assert.equal(meta.name, name);
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of Object.keys(meta.dependencies ?? {}))
      await visit(dep, root);
  }
  await visit("pg", process.cwd());
  await visit("ssh2", process.cwd());
  assert.ok(seen.has("pg-connection-string"));
  assert.ok(seen.has("pg-protocol"));
});
