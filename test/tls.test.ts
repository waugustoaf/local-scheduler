import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { databaseTLS, connectionError } from "../src/services/databaseTLS.ts";
test("TLS keeps certificate verification and the real database hostname when a CA is supplied", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scheduler_tls_"));
  try {
    const path = join(dir, "ca.pem");
    writeFileSync(path, rootCertificates[0]);
    const config = await databaseTLS({
      host: "database.example.com",
      tls: "verify",
      caPath: path,
    });
    assert.notEqual(config, false);
    if (config === false) throw Error("TLS disabled");
    assert.equal(config.rejectUnauthorized, true);
    assert.equal(config.servername, "database.example.com");
    assert.equal(config.ca, rootCertificates[0]);
    writeFileSync(path, "not a certificate");
    await assert.rejects(
      () => databaseTLS({ host: "database.example.com", caPath: path }),
      /certificado CA/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("certificate chain errors give an actionable message without disabling TLS", () => {
  const error = connectionError(
    Object.assign(new Error("unable to get local issuer certificate"), {
      code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    }),
  );
  assert.match(error.message, /CA/);
  assert.match(error.message, /certificado/);
  const other = new Error("password authentication failed");
  assert.equal(connectionError(other), other);
});
