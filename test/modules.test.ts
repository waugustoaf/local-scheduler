import test from "node:test";
import assert from "node:assert/strict";
import { validateScript, runLocal } from "../src/modules/scripts/index.ts";
import {
  validateProfile,
  shellQuote,
  connectSSH,
  fingerprint,
} from "../src/services/profiles.ts";
import { Client as SSH } from "ssh2";
import { validateSQL } from "../src/modules/sql/index.ts";
import type { ModuleContext } from "../src/core/types.ts";
test("local scripts preserve argument boundaries and return exit status", async () => {
  const config = validateScript({
    target: "local",
    source: "inline",
    script: 'printf "%s\\n" "$1"; printf "%s" "$LABEL"',
    arguments: ["hello; echo injected"],
    env: { LABEL: "ok" },
    interpreter: "/bin/bash",
  });
  const lines: string[] = [];
  const context: ModuleContext = {
    runId: "test",
    signal: AbortSignal.timeout(3000),
    log: (s) => lines.push(s),
    profiles: [],
    secrets: {},
  };
  const result = await runLocal(config, context);
  assert.equal(result.status, "success");
  assert.equal(lines.join(""), "hello; echo injected\nok");
});
test("script validation rejects unsafe environment names and quote handles single quotes", () => {
  assert.throws(
    () =>
      validateScript({
        target: "local",
        source: "inline",
        script: "true",
        env: { "X;echo": "x" },
      }),
    /ambiente/,
  );
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
  assert.throws(() => shellQuote("x\0y"));
});
test("profiles omit plaintext credentials and enforce supported database type", () => {
  const p = validateProfile({
    kind: "database",
    name: "Test",
    value: {
      driver: "postgres",
      host: "localhost",
      database: "db",
      username: "u",
      password: "secret",
      port: 5432,
      tls: "verify",
    },
  });
  assert.equal(p.value.password, undefined);
  assert.throws(
    () => validateProfile({ ...p, value: { ...p.value, driver: "mysql" } }),
    /PostgreSQL/,
  );
});
test("SQL parameters must be a JSON list", () => {
  assert.throws(
    () =>
      validateSQL({ databaseId: "x", query: "SELECT 1", parameters: { a: 1 } }),
    /lista/,
  );
  assert.deepEqual(
    validateSQL({ databaseId: "x", query: "SELECT $1", parameters: [30] })
      .parameters,
    [30],
  );
});
test("SSH fingerprint discovery never sends credentials and saved fingerprints are strict", async (t) => {
  const key = Buffer.from("test_host_key"),
    seen: any[] = [];
  t.mock.method(SSH.prototype, "connect", function (this: SSH, config: any) {
    seen.push(config);
    const accepted = config.hostVerifier(key);
    if (accepted) this.emit("ready");
    else this.emit("error", new Error("Host verification failed"));
    return this;
  });
  const p = validateProfile({
    kind: "ssh",
    name: "Test",
    value: {
      host: "example.test",
      port: 22,
      username: "u",
      auth: "password",
      passwordRef: "secret",
    },
  });
  const ctx: ModuleContext = {
    runId: "test",
    signal: AbortSignal.timeout(1000),
    profiles: [p],
    secrets: { secret: "password" },
    log: () => {},
  };
  const probed = await connectSSH(p, ctx, true);
  assert.equal(probed.fingerprint, fingerprint(key));
  assert.equal(seen[0].password, undefined);
  assert.equal(seen[0].passphrase, undefined);
  assert.equal(seen[0].privateKey, undefined);
  await assert.rejects(
    () =>
      connectSSH(
        {
          ...p,
          value: {
            ...p.value,
            fingerprint: fingerprint(Buffer.from("another_key")),
          },
        },
        ctx,
        true,
      ),
    /verification/,
  );
  const verified = await connectSSH(
    { ...p, value: { ...p.value, fingerprint: fingerprint(key) } },
    ctx,
    true,
  );
  assert.equal(verified.fingerprint, fingerprint(key));
  assert.equal(seen[2].password, "password");
});
