import fs from "node:fs/promises";
import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import { assertWorkspaceToolPath, envFlag, resolveWorkspacePath } from "./workspace.js";

const def: ToolDefinition = {
  name: "write_file",
  description: "Write a UTF-8 file inside the workspace. Requires YUDU_ENABLE_WRITE_TOOL=true.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path." },
      content: { type: "string", description: "Complete file content." },
      create_only: { type: "boolean", description: "Fail if the file already exists." },
    },
    required: ["path", "content"],
  },
};

const handler: ToolHandler = async (args) => {
  const input = args as { path?: unknown; content?: unknown; create_only?: unknown };
  if (typeof input?.path !== "string" || !input.path) return { content: "missing 'path' argument", isError: true };
  if (typeof input.content !== "string") return { content: "missing 'content' argument", isError: true };
  if (Buffer.byteLength(input.content, "utf8") > 2_000_000) {
    return { content: "content exceeds the 2 MB write limit", isError: true };
  }
  const filePath = await resolveWorkspacePath(input.path, { mustExist: false });
  assertWorkspaceToolPath(filePath);
  await fs.writeFile(filePath, input.content, {
    encoding: "utf8",
    flag: input.create_only ? "wx" : "w",
  });
  return { content: `wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${input.path}` };
};

export const write_file = {
  def,
  handler,
  isAvailable: () => envFlag("YUDU_ENABLE_WRITE_TOOL"),
};
