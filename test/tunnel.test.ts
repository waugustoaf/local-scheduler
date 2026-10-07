import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { forwardDatabaseSocket } from "../src/services/tunnel.ts";
test("SSH forwarding preserves the remote destination and reports its original failure", () => {
  const socket = new PassThrough();
  const errors: Error[] = [];
  const calls: any[] = [];
  const ssh = {
    forwardOut: (...args: any[]) => {
      calls.push(args.slice(0, 4));
      args[4](new Error("connect failed: Connection refused"));
    },
  };
  forwardDatabaseSocket(
    ssh as any,
    socket as any,
    "alias.example.com",
    5432,
    (e) => errors.push(e),
  );
  assert.deepEqual(calls, [["127.0.0.1", 0, "alias.example.com", 5432]]);
  assert.equal(socket.destroyed, true);
  assert.match(errors[0].message, /alias.example.com:5432/);
  assert.match(errors[0].message, /Connection refused/);
});
test("a remote channel failure closes the local connection and keeps the cause", () => {
  const socket = new PassThrough();
  const stream = new PassThrough();
  const errors: Error[] = [];
  const ssh = { forwardOut: (...args: any[]) => args[4](null, stream) };
  forwardDatabaseSocket(
    ssh as any,
    socket as any,
    "alias.example.com",
    5432,
    (e) => errors.push(e),
  );
  stream.emit("error", new Error("channel closed by server"));
  assert.equal(socket.destroyed, true);
  assert.match(errors[0].message, /channel closed by server/);
  stream.destroy();
});
