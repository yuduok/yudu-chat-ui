import fs from "node:fs/promises";
import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import { assertWorkspaceToolPath, resolveWorkspacePath } from "./workspace.js";

const def: ToolDefinition = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the workspace with line numbers and pagination.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      offset: { type: "integer", description: "First 1-based line to return (default 1)." },
      limit: { type: "integer", description: "Maximum lines to return (default 300, max 1000)." },
    },
    required: ["path"],
  },
};

const handler: ToolHandler = async (args) => {
  const input = args as { path?: unknown; offset?: unknown; limit?: unknown };
  if (typeof input?.path !== "string" || !input.path) {
    return { content: "missing 'path' argument", isError: true };
  }
  const offset = Number.isInteger(input.offset) ? Math.max(1, Number(input.offset)) : 1;
  const limit = Number.isInteger(input.limit) ? Math.min(1000, Math.max(1, Number(input.limit))) : 300;
  const filePath = await resolveWorkspacePath(input.path);
  assertWorkspaceToolPath(filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) return { content: `'${input.path}' is not a file`, isError: true };
  if (stat.size > 5_000_000) return { content: "file exceeds the 5 MB read limit", isError: true };
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) return { content: "binary files are not supported", isError: true };
  const lines = buffer.toString("utf8").split(/\r?\n/);
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  let content = selected.map((line, index) => `${offset + index}|${line}`).join("\n");
  const maxChars = 100_000;
  if (content.length > maxChars) content = `${content.slice(0, maxChars)}\n... output truncated`;
  if (offset - 1 + selected.length < lines.length) {
    content += `\n... next_offset=${offset + selected.length}`;
  }
  return { content };
};

export const read_file = { def, handler };
