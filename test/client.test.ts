import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HerdrClient, HerdrError } from "../src/client.js";

for (const scenario of ["valid", "invalid", "error"] as const) {
  test(`socket protocol: ${scenario} response`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "herdr-socket-"));
    const path = join(directory, "test.sock");
    const server = createServer((socket) => {
      socket.once("data", (chunk) => {
        const request: unknown = JSON.parse(chunk.toString());
        assert.ok(typeof request === "object" && request !== null && "id" in request);
        if (scenario === "invalid") {
          socket.end("invalid JSON\n");
          return;
        }
        const response =
          scenario === "error"
            ? { id: request.id, error: { code: "workspace_move_failed", message: "Move failed" } }
            : {
                id: request.id,
                result: { workspaces: [{ workspace_id: "w1", label: "feat: café" }] },
              };
        const bytes = Buffer.from(`${JSON.stringify(response)}\n`);
        // Split inside a UTF-8 character to check streaming decoding.
        const split = bytes.indexOf(Buffer.from("é")) + 1;
        socket.write(bytes.subarray(0, split));
        setImmediate(() => socket.end(bytes.subarray(split)));
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    context.after(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    });
    const client = new HerdrClient(path);
    if (scenario === "valid") {
      assert.deepEqual(await client.workspaces(), [{ workspaceId: "w1", label: "feat: café" }]);
    } else {
      await assert.rejects(
        client.workspaces(),
        scenario === "invalid" ? /invalid JSON/ : /Move failed/,
      );
    }
  });
}

test("a socket drop after the request is written may have succeeded", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-socket-"));
  const path = join(directory, "test.sock");
  const server = createServer((socket) => {
    socket.once("data", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const client = new HerdrClient(path);
  await assert.rejects(client.workspaces(), (error: unknown) => {
    assert.ok(error instanceof HerdrError);
    assert.equal(error.mayHaveSucceeded, true);
    return true;
  });
});
