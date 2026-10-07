import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client as SSH } from "ssh2";
import type { Profile, ModuleContext } from "../core/types.ts";
import { object, text, integer } from "../core/validation.ts";

export function validateProfile(input: unknown): Profile {
  const p = object(input);
  const value = object(p.value);
  const name = text(p.name, "Nome", 160);
  if (p.kind === "ssh") {
    const auth = value.auth ?? "key";
    if (!["key", "password", "agent"].includes(String(auth)))
      throw new Error("Autenticação SSH inválida.");
    text(value.host, "Host", 255);
    text(value.username, "Usuário", 100);
    integer(value.port ?? 22, "Porta", 1, 65535);
    if (auth === "key") text(value.keyPath, "Arquivo de chave", 4096);
    if (
      value.fingerprint &&
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(String(value.fingerprint))
    )
      throw new Error("Fingerprint SSH inválido.");
  } else if (p.kind === "database") {
    if (value.driver !== "postgres")
      throw new Error("Nesta versão o banco suportado é PostgreSQL.");
    text(value.host, "Host", 255);
    text(value.database, "Banco", 255);
    text(value.username, "Usuário", 255);
    integer(value.port ?? 5432, "Porta", 1, 65535);
    if (!["verify", "disable"].includes(String(value.tls ?? "verify")))
      throw new Error("Configuração TLS inválida.");
    if (value.caMode && !["manual", "aws_rds"].includes(String(value.caMode)))
      throw new Error("Origem do certificado inválida.");
  } else throw new Error("Tipo de conexão inválido.");
  const allowed =
    p.kind === "ssh"
      ? [
          "host",
          "port",
          "username",
          "auth",
          "keyPath",
          "fingerprint",
          "passwordRef",
          "passphraseRef",
        ]
      : [
          "driver",
          "host",
          "port",
          "database",
          "username",
          "tls",
          "caPath",
          "caMode",
          "sshProfileId",
          "passwordRef",
        ];
  const safe = Object.fromEntries(
    Object.entries(value).filter(([key]) => allowed.includes(key)),
  );
  return {
    id: typeof p.id === "string" ? text(p.id, "ID", 100) : randomUUID(),
    kind: p.kind,
    name,
    value: safe,
  };
}
export function profile(
  context: ModuleContext,
  id: string,
  kind: Profile["kind"],
): Profile {
  const p = context.profiles.find((p) => p.id === id && p.kind === kind);
  if (!p) throw new Error("Perfil de conexão não encontrado.");
  return validateProfile(p);
}
export function credential(
  context: ModuleContext,
  ref: unknown,
): string | undefined {
  if (!ref) return undefined;
  const secret = context.secrets[String(ref)];
  if (secret === undefined) throw new Error("Credencial salva não disponível.");
  return secret;
}
export function fingerprint(key: Buffer) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}
export async function connectSSH(
  p: Profile,
  context: ModuleContext,
  inspect = false,
): Promise<{ client: SSH; fingerprint: string }> {
  const v = p.value;
  if (!inspect && !v.fingerprint)
    throw new Error("Teste e confirme o fingerprint SSH antes de agendar.");
  const probe = inspect && !v.fingerprint;
  const privateKey =
    !probe && v.auth === "key" ? await readFile(String(v.keyPath)) : undefined;
  if (context.signal.aborted) throw new Error("Conexão cancelada.");
  return new Promise((resolve, reject) => {
    const client = new SSH();
    let observed = "";
    let settled = false;
    const aborted = () => {
      client.destroy();
      if (!settled) reject(new Error("Conexão cancelada."));
    };
    context.signal.addEventListener("abort", aborted, { once: true });
    client.once("close", () =>
      context.signal.removeEventListener("abort", aborted),
    );
    client.once("error", (error) => {
      if (!settled) {
        settled = true;
        if (probe && observed) {
          client.destroy();
          resolve({ client, fingerprint: observed });
        } else reject(error);
      }
    });
    client.once("ready", () => {
      settled = true;
      resolve({ client, fingerprint: observed });
    });
    client.connect({
      host: String(v.host),
      port: Number(v.port ?? 22),
      username: String(v.username),
      privateKey,
      password: probe ? undefined : credential(context, v.passwordRef),
      passphrase: probe ? undefined : credential(context, v.passphraseRef),
      agent:
        !probe && v.auth === "agent" ? process.env.SSH_AUTH_SOCK : undefined,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        observed = fingerprint(key);
        return !probe && observed === v.fingerprint;
      },
    });
  });
}
export function shellQuote(value: string) {
  if (value.includes("\0"))
    throw new Error("Argumento contém caractere inválido.");
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
