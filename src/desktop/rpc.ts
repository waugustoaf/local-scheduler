import { createConnection, createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  lstatSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
export function token(dir: string) {
  const path = join(dir, "agent.token");
  if (!existsSync(path))
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(path, "utf8");
}
export function serve(
  dir: string,
  handle: (method: string, args: any) => Promise<any>,
) {
  const path = join(dir, "agent.sock"),
    secret = token(dir);
  if (existsSync(path)) {
    if (lstatSync(path).uid !== process.getuid?.())
      throw new Error("Socket pertence a outro usuário.");
    unlinkSync(path);
  }
  const server = createServer((socket) => {
    socket.setTimeout(70000, () => socket.destroy());
    let buffer = "";
    let handled = false;
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer += chunk.toString();
      if (buffer.length > 1048576) {
        socket.destroy();
        return;
      }
      if (!buffer.includes("\n")) return;
      handled = true;
      void (async () => {
        try {
          const request = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
          if (request.token !== secret) throw new Error("Acesso negado.");
          const result = await handle(request.method, request.args);
          socket.end(JSON.stringify({ ok: true, result }) + "\n");
        } catch (error) {
          socket.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }) + "\n",
          );
        }
      })();
    });
  });
  server.listen(path, () => chmodSync(path, 0o600));
  return server;
}
export function request(
  dir: string,
  method: string,
  args: unknown = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(dir, "agent.sock"));
    let buffer = "";
    socket.setTimeout(65000, () =>
      socket.destroy(new Error("O agente não respondeu.")),
    );
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.write(JSON.stringify({ token: token(dir), method, args }) + "\n"),
    );
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) {
        socket.destroy(new Error("Resposta excede o limite."));
        return;
      }
      if (buffer.includes("\n")) {
        socket.end();
        try {
          const result = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
          result.ok ? resolve(result.result) : reject(new Error(result.error));
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.once("end", () => {
      if (!buffer.includes("\n")) reject(new Error("Agente desconectado."));
    });
  });
}
