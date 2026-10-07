import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import type { ModuleContext, TaskModule, RunResult } from "../../core/types.ts";
import { object, text, strings } from "../../core/validation.ts";
import { profile, connectSSH, shellQuote } from "../../services/profiles.ts";

export interface ScriptConfig {
  target: "local" | "ssh";
  sshProfileId?: string;
  source: "inline" | "file";
  script: string;
  filePath: string;
  interpreter: string;
  arguments: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
}
export function validateScript(input: unknown): ScriptConfig {
  const v = object(input);
  if (
    !["local", "ssh"].includes(String(v.target)) ||
    !["inline", "file"].includes(String(v.source))
  )
    throw new Error("Destino ou origem do script inválido.");
  const script = v.source === "inline" ? text(v.script, "Script", 256000) : "";
  const filePath = v.source === "file" ? text(v.filePath, "Arquivo", 4096) : "";
  const env = object(v.env ?? {});
  if (
    Object.entries(env).some(
      ([k, val]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ||
        typeof val !== "string" ||
        val.includes("\0"),
    )
  )
    throw new Error("Variáveis de ambiente inválidas.");
  return {
    target: v.target as ScriptConfig["target"],
    source: v.source as ScriptConfig["source"],
    script,
    filePath,
    sshProfileId:
      v.target === "ssh" ? text(v.sshProfileId, "SSH", 100) : undefined,
    interpreter: text(v.interpreter ?? "/bin/bash", "Interpretador", 4096),
    arguments: strings(v.arguments ?? [], "Argumentos"),
    cwd: typeof v.cwd === "string" ? v.cwd : "",
    env: env as Record<string, string>,
    stdin: typeof v.stdin === "string" ? v.stdin : "",
  };
}
export const scriptModule: TaskModule<ScriptConfig> = {
  id: "scripts",
  version: 1,
  label: "Scripts",
  validateConfig: validateScript,
  async preflight(c, context) {
    if (c.target === "ssh") profile(context, c.sshProfileId!, "ssh");
    else {
      await access(c.interpreter);
      if (c.source === "file") await access(c.filePath);
    }
    return [{ name: "Destino e interpretador", ok: true }];
  },
  async execute(c, context) {
    if (c.target === "local") return runLocal(c, context);
    const { client } = await connectSSH(
      profile(context, c.sshProfileId!, "ssh"),
      context,
    );
    try {
      const env = Object.entries(c.env)
        .map(([k, v]) => `${k}=${shellQuote(v)}`)
        .join(" ");
      const args = c.arguments.map(shellQuote).join(" ");
      const script =
        c.source === "inline"
          ? `${shellQuote(c.interpreter)} -c ${shellQuote(c.script)} scheduler ${args}`
          : `${shellQuote(c.interpreter)} ${shellQuote(c.filePath)} ${args}`;
      const command = `${c.cwd ? `cd ${shellQuote(c.cwd)} && ` : ""}exec env ${env} ${script}`;
      return await new Promise<RunResult>((resolve, reject) => {
        client.exec(command, (error, channel) => {
          if (error) {
            reject(error);
            return;
          }
          const abort = () => {
            channel.signal("TERM");
            channel.close();
            client.destroy();
            resolve({
              status: "unknown",
              summary:
                "SSH interrompido. Verifique o servidor antes de repetir.",
            });
          };
          context.signal.addEventListener("abort", abort, { once: true });
          channel.on("data", (b: Buffer) => context.log(b.toString()));
          channel.stderr.on("data", (b: Buffer) =>
            context.log(b.toString(), "stderr"),
          );
          channel.once("error", reject);
          channel.once("close", (code: number | null) => {
            context.signal.removeEventListener("abort", abort);
            resolve({
              status:
                code === 0 ? "success" : code === null ? "unknown" : "failed",
              summary: `Script remoto encerrado: ${code ?? "sem confirmação"}`,
            });
          });
          channel.end(c.stdin);
          if (context.signal.aborted) abort();
        });
      });
    } finally {
      client.end();
    }
  },
};
export async function runLocal(
  c: ScriptConfig,
  context: ModuleContext,
): Promise<RunResult> {
  if (context.signal.aborted)
    return { status: "cancelled", summary: "Cancelado antes de iniciar." };
  const args =
    c.source === "inline"
      ? ["-c", c.script, "scheduler", ...c.arguments]
      : [c.filePath, ...c.arguments];
  return new Promise((resolve, reject) => {
    const child = spawn(c.interpreter, args, {
      cwd: c.cwd || undefined,
      env: { ...process.env, ...c.env },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let cancelled = false;
    let killer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid)
        try {
          process.kill(-child.pid, signal);
        } catch {}
    };
    const abort = () => {
      cancelled = true;
      kill("SIGTERM");
      killer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    context.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (b: Buffer) => context.log(b.toString()));
    child.stderr.on("data", (b: Buffer) => context.log(b.toString(), "stderr"));
    child.stdin.on("error", () => {});
    child.stdin.end(c.stdin);
    child.once("error", (error) => {
      context.signal.removeEventListener("abort", abort);
      if (killer) clearTimeout(killer);
      reject(error);
    });
    child.once("close", (code) => {
      context.signal.removeEventListener("abort", abort);
      if (killer) clearTimeout(killer);
      resolve({
        status: cancelled ? "unknown" : code === 0 ? "success" : "failed",
        summary: cancelled
          ? "Processo interrompido. Verifique efeitos antes de repetir."
          : `Script encerrado: ${code}`,
      });
    });
    if (context.signal.aborted) abort();
  });
}
