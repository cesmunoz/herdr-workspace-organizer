import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { DEFAULT_PREFIXES } from "./core.js";
import { configSchema } from "./schemas.js";
import type { PluginConfig } from "./schemas.js";
import { normalizeOrder } from "./utils.js";

export type { PluginConfig } from "./schemas.js";

export function configPath(environment: NodeJS.ProcessEnv = process.env): string {
  const directory =
    environment.HERDR_PLUGIN_CONFIG_DIR ??
    join(homedir(), ".config", "herdr", "plugins", "config", "herdr-workspace-organizer");
  return join(directory, "config.json");
}

const defaults = (): PluginConfig => ({ order: [...DEFAULT_PREFIXES] });

export async function loadConfig(path: string): Promise<PluginConfig> {
  // Handle only missing files. Malformed configuration must remain visible to the user.
  const contents = await Effect.runPromise(
    Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchAll((cause) => {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return Effect.succeed(undefined);
        }
        return Effect.fail(cause);
      }),
    ),
  );
  if (contents === undefined) {
    return defaults();
  }
  const parsed: unknown = JSON.parse(contents);
  const config = configSchema.parse(parsed);
  return { order: normalizeOrder(config.order) };
}

export async function saveConfig(
  path: string,
  config: Readonly<{ order: readonly string[] }>,
): Promise<void> {
  const validated = configSchema.parse({ order: normalizeOrder(config.order) });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
