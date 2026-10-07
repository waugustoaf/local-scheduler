import { modules } from "../modules/index.ts";
import { redact, redactResult } from "../core/redact.ts";
import type { ModuleContext } from "../core/types.ts";

const port = (process as any).parentPort;
const abort = new AbortController();
port.on("message", async ({ data }: any) => {
  if (data.type === "abort") {
    abort.abort();
    return;
  }
  if (data.type !== "run") return;
  const secrets = data.secrets as Record<string, string>;
  const values = Object.values(secrets);
  let buffer = "";
  const flush = (stream = "stdout", force = false) => {
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      port.postMessage({
        type: "log",
        stream,
        line: redact(buffer.slice(0, index), values),
      });
      buffer = buffer.slice(index + 1);
    }
    if (force && buffer) {
      port.postMessage({ type: "log", stream, line: redact(buffer, values) });
      buffer = "";
    }
  };
  const context: ModuleContext = {
    runId: data.runId,
    signal: abort.signal,
    profiles: data.profiles,
    secrets,
    log: (line, stream = "stdout") => {
      buffer += line;
      flush(stream);
      if (buffer.length > 65536) flush(stream, true);
    },
  };
  try {
    const module = modules().get(data.moduleId),
      config = module.validateConfig(data.config);
    const checks = await module.preflight(config, context);
    if (checks.some((c) => !c.ok))
      throw new Error(
        checks
          .filter((c) => !c.ok)
          .map((c) => c.detail ?? c.name)
          .join("; "),
      );
    const result = await module.execute(config, context);
    flush("stdout", true);
    port.postMessage({ type: "done", result: redactResult(result, values) });
  } catch (error) {
    flush("stderr", true);
    port.postMessage({
      type: "done",
      result: {
        status: "failed",
        summary: redact(
          error instanceof Error ? error.message : String(error),
          values,
        ),
      },
    });
  }
});
