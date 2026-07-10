import fs from "node:fs/promises";
import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import path from "node:path";
import { assertWorkspaceToolPath, isSensitivePath, resolveWorkspacePath } from "./workspace.js";

const def: ToolDefinition = {
  name: "list_directory",
  description: "List files and directories inside the configured workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative directory (default '.')." },
    },
  },
};

const handler: ToolHandler = async (args) => {
  const inputPath = (args as { path?: unknown })?.path;
  if (inputPath !== undefined && typeof inputPath !== "string") {
    return { content: "'path' must be a string", isError: true };
  }
  const directory = await resolveWorkspacePath(inputPath || ".");
  assertWorkspaceToolPath(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const lines = entries
    .filter((entry) => !isSensitivePath(path.join(directory, entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 500)
    .map((entry) => `${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"} ${entry.name}`);
  if (entries.length > 500) lines.push(`... ${entries.length - 500} more entries`);
  return { content: lines.join("\n") || "(empty directory)" };
};

export const list_directory = { def, handler };
