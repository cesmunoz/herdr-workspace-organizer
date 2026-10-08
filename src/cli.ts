#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { HerdrClient } from "./client.js";
import { configPath, loadConfig } from "./config.js";
import { moveFocused, sortAll } from "./core.js";
import { runPanel } from "./panel.js";
import { normalizeOrder } from "./utils.js";

const client = new HerdrClient(
  process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock"),
);
const program = new Command()
  .name("herdr-workspace-organizer")
  .description("Organize Herdr workspaces without changing their contents")
  .version("0.1.0");

for (const direction of ["up", "down"] as const) {
  program
    .command(direction)
    .description(`Move the invoking workspace ${direction}`)
    .action(async () => {
      const workspaceId = process.env.HERDR_WORKSPACE_ID;
      if (!workspaceId) {
        throw new Error("HERDR_WORKSPACE_ID is not set; invoke this from a Herdr pane");
      }
      if (!(await moveFocused(client, workspaceId, direction === "up" ? -1 : 1))) {
        console.log("Already at the boundary.");
      }
    });
}

program
  .command("sort")
  .description("Apply the configured priority order")
  .option("--prefixes <prefixes>", "Override priorities, e.g. fix,feat,docs")
  .action(async (options: { prefixes?: string }) => {
    const prefixes =
      options.prefixes === undefined
        ? (await loadConfig(configPath())).order
        : normalizeOrder(options.prefixes.split(","));
    if (prefixes.length === 0) {
      throw new Error("--prefixes must contain at least one prefix");
    }
    if (!(await sortAll(client, prefixes))) {
      console.log("Already in the requested order.");
    }
  });

program
  .command("panel")
  .description("Open the interactive organizer in this terminal")
  .action(async () => runPanel(client, process.env.HERDR_WORKSPACE_ID));

program.parseAsync().catch((error: unknown) => {
  console.error(
    `herdr-workspace-organizer: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
