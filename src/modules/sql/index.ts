import pg from "pg";
import { createServer, type Server } from "node:net";
import { databaseTLS, connectionError } from "../../services/databaseTLS.ts";
import type { Client as SSH } from "ssh2";
import type { ModuleContext, TaskModule } from "../../core/types.ts";
import { object, text } from "../../core/validation.ts";
import { profile, credential, connectSSH } from "../../services/profiles.ts";

export interface SQLConfig {
  databaseId: string;
  query: string;
  parameters: unknown[];
  transaction: boolean;
}
export function validateSQL(input: unknown): SQLConfig {
  const v = object(input);
  const databaseId = text(v.databaseId, "Banco", 100),
    query = text(v.query, "SQL", 256000);
  const parameters = v.parameters ?? [];
  if (!Array.isArray(parameters) || parameters.length > 1000)
    throw new Error("Parâmetros devem ser uma lista JSON.");
  return { databaseId, query, parameters, transaction: v.transaction === true };
}
export async function openDatabase(databaseId: string, context: ModuleContext) {
  const p = profile(context, databaseId, "database"),
    v = p.value;
  const remotePort = Number(v.port ?? 5432);
  let ssh: SSH | undefined, tunnel: Server | undefined;
  let port = Number(v.port ?? 5432),
    host = String(v.host);
  const sockets = new Set<import("node:net").Socket>();
  const cleanup = () => {
    for (const socket of sockets) socket.destroy();
    tunnel?.close();
    ssh?.end();
  };
  try {
    if (v.sshProfileId) {
      ssh = (
        await connectSSH(
          profile(context, String(v.sshProfileId), "ssh"),
          context,
        )
      ).client;
      tunnel = createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        ssh!.forwardOut(
          "127.0.0.1",
          socket.remotePort ?? 0,
          String(v.host),
          remotePort,
          (error, stream) => {
            if (error) {
              socket.destroy();
              return;
            }
            stream.on("error", () => socket.destroy());
            socket.pipe(stream).pipe(socket);
          },
        );
      });
      await new Promise<void>((resolve, reject) => {
        tunnel!.once("error", reject);
        tunnel!.listen(0, "127.0.0.1", resolve);
      });
      const address = tunnel.address();
      if (!address || typeof address === "string")
        throw new Error("Túnel sem porta.");
      host = "127.0.0.1";
      port = address.port;
    }
    const ssl = await databaseTLS(v);
    const client = new pg.Client({
      host,
      port,
      database: String(v.database),
      user: String(v.username),
      password: credential(context, v.passwordRef),
      connectionTimeoutMillis: 15000,
      ssl,
    });
    client.on("error", () => {});
    const abort = () => {
      void client.end().catch(() => {});
      cleanup();
    };
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      await client.connect();
      if (context.signal.aborted) throw new Error("Conexão cancelada.");
    } catch (error) {
      context.signal.removeEventListener("abort", abort);
      await client.end().catch(() => {});
      throw connectionError(error);
    }
    return {
      client,
      close: async () => {
        context.signal.removeEventListener("abort", abort);
        await client.end().catch(() => {});
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
export const sqlModule: TaskModule<SQLConfig> = {
  id: "sql",
  version: 1,
  label: "SQL",
  validateConfig: validateSQL,
  async preflight(config, context) {
    profile(context, config.databaseId, "database");
    return [{ name: "Perfil do banco", ok: true }];
  },
  async execute(config, context) {
    const db = await openDatabase(config.databaseId, context);
    let dispatched = false;
    try {
      if (config.transaction) await db.client.query("BEGIN");
      dispatched = true;
      const result = await db.client.query(
        config.query,
        config.parameters.length ? config.parameters : undefined,
      );
      if (config.transaction) await db.client.query("COMMIT");
      const results = Array.isArray(result) ? result : [result];
      const data = results.map((r) => ({
        command: r.command,
        rowCount: r.rowCount,
        rows: r.rows.slice(0, 100),
      }));
      context.log(JSON.stringify(data).slice(0, 16000));
      return {
        status: "success",
        summary: results
          .map((r) => `${r.command}: ${r.rowCount ?? 0} linhas`)
          .join("; "),
        data,
      };
    } catch (error) {
      if (config.transaction) await db.client.query("ROLLBACK").catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      const databaseError = !!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        /^[0-9A-Z]{5}$/.test(String(error.code))
      );
      return {
        status: dispatched && !databaseError ? "unknown" : "failed",
        summary: message,
      };
    } finally {
      await db.close();
    }
  },
};
