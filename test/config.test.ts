import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, saveConfig } from "../src/config.js";
import { normalizeOrder } from "../src/utils.js";

test("normalizeOrder trims, lowercases, and removes duplicates", () => {
  assert.deepEqual(normalizeOrder([" feat ", "CHORE", "feat", ""]), ["feat", "chore"]);
});

test("missing config uses default priorities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-workspace-organizer-"));
  assert.deepEqual(await loadConfig(join(directory, "missing.json")), {
    order: [
      "fix",
      "feat",
      "docs",
      "style",
      "refactor",
      "test",
      "build",
      "chore",
      "revert",
      "hotfix",
    ],
  });
});

test("config can be saved and loaded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-workspace-organizer-"));
  const path = join(directory, "nested", "config.json");
  await saveConfig(path, { order: ["bug", "feat"] });
  assert.deepEqual(await loadConfig(path), { order: ["bug", "feat"] });
  assert.match(await readFile(path, "utf8"), /"bug"/);
});
