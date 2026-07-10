import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import {
  assertWorkspaceToolPath,
  isSensitivePath,
  resolveWorkspacePath,
  shouldIgnore,
  workspaceRelative,
} from "./workspace.js";

const def: ToolDefinition = {
  name: "search_files",
  description: "Search UTF-8 workspace files for literal text or a regular expression.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text or JavaScript regular expression to find." },
      path: { type: "string", description: "Workspace-relative directory or file (default '.')." },
      regex: { type: "boolean", description: "Interpret query as a regular expression." },
      max_results: { type: "integer", description: "Maximum matching lines (default 100, max 500)." },
    },
    required: ["query"],
  },
};

const handler: ToolHandler = async (args) => {
  const input = args as { query?: unknown; path?: unknown; regex?: unknown; max_results?: unknown };
  if (typeof input?.query !== "string" || !input.query) {
    return { content: "missing 'query' argument", isError: true };
  }
  if (input.path !== undefined && typeof input.path !== "string") {
    return { content: "'path' must be a string", isError: true };
  }
  const maxResults = Number.isInteger(input.max_results)
    ? Math.min(500, Math.max(1, Number(input.max_results)))
    : 100;
  let matcher: RegExp;
  try {
    matcher = input.regex
      ? new RegExp(input.query, "i")
      : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (error: any) {
    return { content: `invalid regular expression: ${error?.message ?? error}`, isError: true };
  }

  const start = await resolveWorkspacePath(input.path || ".");
  assertWorkspaceToolPath(start);
  const matches: string[] = [];
  let visitedFiles = 0;

  const visit = async (candidate: string): Promise<void> => {
    if (matches.length >= maxResults || visitedFiles >= 10_000) return;
    if (isSensitivePath(candidate)) return;
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      const entries = await fs.readdir(candidate, { withFileTypes: true });
      for (const entry of entries) {
        if (shouldIgnore(entry.name)) continue;
        await visit(path.join(candidate, entry.name));
        if (matches.length >= maxResults) break;
      }
      return;
    }
    if (!stat.isFile() || stat.size > 2_000_000) return;
    visitedFiles += 1;
    const buffer = await fs.readFile(candidate);
    if (buffer.includes(0)) return;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matcher.test(lines[index])) {
        matches.push(`${workspaceRelative(candidate)}:${index + 1}:${lines[index].slice(0, 500)}`);
        if (matches.length >= maxResults) break;
      }
      matcher.lastIndex = 0;
    }
  };

  await visit(start);
  return { content: matches.join("\n") || "no matches" };
};

export const search_files = { def, handler };
