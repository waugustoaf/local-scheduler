import type { Client } from "ssh2";
import type { Socket } from "node:net";

export function forwardDatabaseSocket(
  ssh: Client,
  socket: Socket,
  host: string,
  port: number,
  onError: (error: Error) => void,
) {
  const fail = (error: Error) => {
    onError(
      new Error(`SSH não conseguiu abrir ${host}:${port}: ${error.message}`),
    );
    socket.destroy();
  };
  try {
    ssh.forwardOut(
      "127.0.0.1",
      socket.remotePort ?? 0,
      host,
      port,
      (error, stream) => {
        if (error) return fail(error);
        if (socket.destroyed) {
          stream.destroy();
          return;
        }
        stream.on("error", fail);
        socket.once("close", () => stream.destroy());
        socket.pipe(stream).pipe(socket);
      },
    );
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
  }
}
