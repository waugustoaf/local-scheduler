import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import type { ConnectionOptions } from "node:tls";
import { dirname } from "node:path";
import { ensureRdsCA } from "./rdsCA.ts";
export async function databaseTLS(
  value: Record<string, unknown>,
): Promise<false | ConnectionOptions> {
  if (value.tls === "disable") return false;
  if (value.caMode === "aws_rds") {
    if (!value.caPath)
      throw new Error("Salve a conexão para baixar a CA do Amazon RDS.");
    await ensureRdsCA(dirname(String(value.caPath)));
  }
  let ca: string | undefined;
  if (value.caPath) {
    try {
      ca = await readFile(String(value.caPath), "utf8");
      const certificates = ca.match(
        /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      );
      if (!certificates?.length) throw new Error("Formato inválido");
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
      throw new Error(
        "Não foi possível ler o certificado CA do banco. Selecione um arquivo PEM de certificados válido, diferente da chave privada SSH.",
      );
    }
  }
  return { rejectUnauthorized: true, servername: String(value.host), ca };
}
export function connectionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    [
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    ].includes(code) ||
    /unable to get local issuer certificate|unable to verify the first certificate|self.signed certificate/i.test(
      message,
    )
  )
    return new Error(
      "O certificado TLS do banco não pôde ser validado. Em Editar conexão, selecione o certificado CA do banco e salve. Para Amazon RDS, use o bundle oficial de certificados da AWS.",
    );
  return error instanceof Error ? error : new Error(message);
}
