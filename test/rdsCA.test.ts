import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rootCertificates } from "node:tls";
import { ensureRdsCA, RDS_CA_URL } from "../src/services/rdsCA.ts";
test("RDS CA downloads from the official URL once and reuses a valid cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rds_ca_"));
  let calls = 0;
  try {
    const load = async (url: string) => {
      assert.equal(url, RDS_CA_URL);
      calls++;
      return rootCertificates[0];
    };
    const path = await ensureRdsCA(dir, load);
    assert.equal(readFileSync(path, "utf8"), rootCertificates[0]);
    assert.equal(await ensureRdsCA(dir, load), path);
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid or unavailable downloads fail explicitly instead of trusting arbitrary text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rds_ca_"));
  try {
    await assert.rejects(
      () => ensureRdsCA(dir, async () => "invalid"),
      /certificado/,
    );
    await assert.rejects(
      () =>
        ensureRdsCA(dir, async () => {
          throw new Error("offline");
        }),
      /baixar/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('valid cached certificates remain usable if a refresh is unavailable or invalid',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rds_refresh_'));
 try{const path=await ensureRdsCA(dir,async()=>rootCertificates[0]);const old=new Date(Date.now()-31*86400000);utimesSync(path,old,old);
 assert.equal(await ensureRdsCA(dir,async()=>{throw new Error('offline');}),path);
 assert.equal(await ensureRdsCA(dir,async()=>'<html>error</html>'),path);
 assert.equal(readFileSync(path,'utf8'),rootCertificates[0]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
