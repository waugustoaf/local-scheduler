import type { RunResult } from "./types.ts";
export function redact(text: string, secrets: string[]): string {
  let result = text;
  const variants = secrets.flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]);
  for (const secret of [...new Set(variants)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join("[oculto]");
  }
  return result.replace(
    /\b(password|passwd|token|secret|passphrase)\s*([=:])\s*([^\s,;]+)/gi,
    "$1$2[oculto]",
  );
}
export function redactResult(result: RunResult, secrets: string[]): RunResult {
  if (!["success", "failed", "cancelled", "unknown"].includes(result.status))
    return {
      status: "unknown",
      summary: "O módulo retornou um resultado inválido.",
    };
  return {
    status: result.status,
    summary: redact(result.summary, secrets),
    ...(result.data === undefined
      ? {}
      : { data: redactValue(result.data, secrets) }),
  };
}
export function redactValue(value: unknown, secrets: string[]): any {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(password|passwd|token|secret|passphrase)$/i.test(k)
          ? "[oculto]"
          : redactValue(v, secrets),
      ]),
    );
  return value;
}
