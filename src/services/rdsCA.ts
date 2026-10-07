import { readFile, stat, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, X509Certificate } from "node:crypto";
export const RDS_CA_URL =
  "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
function validBundle(pem: string) {
  if (pem.length > 1048576)
    throw new Error("Bundle de certificados excede o limite.");
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  );
  if (!blocks?.length) throw new Error("Bundle de certificados inválido.");
  const certificates = blocks.map((block) => new X509Certificate(block));
  if (
    certificates.some((c) => !c.ca) ||
    !certificates.some(
      (c) =>
        Date.parse(c.validFrom) <= Date.now() &&
        Date.parse(c.validTo) > Date.now(),
    )
  )
    throw new Error("Bundle sem certificado CA válido.");
}
async function download(url: string) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Falha HTTP ${response.status}`);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1048576) throw new Error("Bundle excede o limite.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function ensureRdsCA(
  directory: string,
  load: (url: string) => Promise<string> = download,
): Promise<string> {
  const path = join(directory, "aws-rds-global.pem");
  let cached = false;
  try {
    validBundle(await readFile(path, "utf8"));
    cached = true;
    const info = await stat(path);
    if (Date.now() - info.mtimeMs < 30 * 86400000) return path;
  } catch {}
  let pem: string;
  try {
    pem = await load(RDS_CA_URL);
  } catch {
    if (cached) return path;
    throw new Error(
      "Não foi possível baixar a CA oficial do Amazon RDS. Verifique a internet e salve a conexão novamente.",
    );
  }
  try {
    validBundle(pem);
  } catch {
    if (cached) return path;
    throw new Error(
      "A resposta recebida não contém um bundle de certificados CA válido.",
    );
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, pem, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}
