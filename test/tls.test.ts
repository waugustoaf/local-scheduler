import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { databaseTLS, connectionError } from "../src/services/databaseTLS.ts";
import { validateProfile } from "../src/services/profiles.ts";
test("verify CA accepts the network alias without disabling certificate chain verification", async () => {
  const value = {
    driver: "postgres",
    host: "rds-services.vammo.com",
    database: "services",
    username: "user",
    tls: "verify_ca",
  };
  const saved = validateProfile({ name: "Database", kind: "database", value });
  const config = await databaseTLS(saved.value);
  if (config === false) throw new Error("TLS disabled");
  assert.equal(saved.value.host, "rds-services.vammo.com");
  assert.equal(config.rejectUnauthorized, true);
  assert.equal(
    config.checkServerIdentity!(value.host, {
      subjectaltname: "DNS:services-vammo-prod.cluster.example.com",
    } as any),
    undefined,
  );
  await assert.rejects(
    () => databaseTLS({ ...value, caPath: "/nonexistent/cert.pem" }),
    /certificado CA/,
  );
});
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
test("a network alias can validate the certificate against an explicit TLS identity", async () => {
  const value = {
    host: "alias.example.com",
    tls: "verify",
    tlsServerName: "database.rds.amazonaws.com",
  };
  const config = await databaseTLS(value);
  if (config === false) throw Error("TLS disabled");
  assert.equal(value.host, "alias.example.com");
  assert.equal(config.servername, "database.rds.amazonaws.com");
  assert.equal(config.rejectUnauthorized, true);
  const certificate = {
    subjectaltname: "DNS:database.rds.amazonaws.com",
  } as any;
  assert.equal(
    config.checkServerIdentity!("alias.example.com", certificate),
    undefined,
  );
  assert.ok(
    config.checkServerIdentity!("alias.example.com", {
      subjectaltname: "DNS:other.example.com",
    } as any) instanceof Error,
  );
});
test("database profiles preserve the expected TLS identity when saved", () => {
  const profile = validateProfile({
    name: "Production",
    kind: "database",
    value: {
      driver: "postgres",
      host: "alias.example.com",
      database: "subscriptions",
      username: "subscriptions",
      tlsServerName: "database.rds.amazonaws.com",
    },
  });
  assert.equal(profile.value.host, "alias.example.com");
  assert.equal(profile.value.tlsServerName, "database.rds.amazonaws.com");
});
