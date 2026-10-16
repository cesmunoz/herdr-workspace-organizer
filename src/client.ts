import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { Workspace, WorkspaceClient } from "./types.js";
import { responseSchema, workspaceListSchema } from "./schemas.js";
import { isRecord } from "./utils.js";

export class HerdrError extends Error {
  readonly mayHaveSucceeded: boolean;

  constructor(message: string, mayHaveSucceeded = false) {
    super(message);
    this.mayHaveSucceeded = mayHaveSucceeded;
  }
}

function errorMessage(value: unknown): string {
  if (!isRecord(value)) {
    return String(value);
  }
  const message = value.message ?? value.code;
  return typeof message === "string" ? message : JSON.stringify(value);
}

export class HerdrClient implements WorkspaceClient {
  constructor(private readonly socketPath: string) {}

  async request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const id = randomUUID();
    const payload = `${JSON.stringify({ id, method, params })}\n`;

    return await new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let buffer = "";
      let settled = false;
      let wrote = false;

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(5_000, () => fail(new HerdrError("Herdr socket timed out", wrote)));
      socket.on("error", (error) => {
        fail(
          new HerdrError(
            `cannot connect to Herdr socket ${this.socketPath}: ${error.message}`,
            wrote,
          ),
        );
      });
      socket.on("connect", () => {
        wrote = true;
        socket.write(payload);
      });
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1 || settled) {
          return;
        }

        let response: unknown;
        try {
          response = JSON.parse(buffer.slice(0, newline));
        } catch {
          fail(new HerdrError("Herdr returned invalid JSON"));
          return;
        }
        const validated = responseSchema.safeParse(response);
        if (!validated.success || validated.data.id !== id) {
          fail(new HerdrError("Herdr returned an unexpected response"));
          return;
        }
        if (validated.data.error !== undefined) {
          fail(new HerdrError(errorMessage(validated.data.error)));
          return;
        }
        if (validated.data.result === undefined) {
          fail(new HerdrError("Herdr response has no result object"));
          return;
        }

        settled = true;
        socket.destroy();
        resolve(validated.data.result);
      });
      socket.on("end", () => {
        if (!settled) {
          fail(new HerdrError("Herdr closed the socket without a response", wrote));
        }
      });
    });
  }

  async workspaces(): Promise<readonly Workspace[]> {
    const result = await this.request("workspace.list", {});
    return workspaceListSchema.parse(result).workspaces;
  }
}
