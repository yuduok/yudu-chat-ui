import { spawn } from "node:child_process";
import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import { envFlag, resolveWorkspacePath } from "./workspace.js";

const def: ToolDefinition = {
  name: "execute_command",
  description: "Run a non-interactive command in the workspace. Requires YUDU_ENABLE_COMMAND_TOOL=true.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Executable name or absolute path. No shell expansion." },
      args: { type: "array", items: { type: "string" }, description: "Command arguments." },
      cwd: { type: "string", description: "Workspace-relative working directory (default '.')." },
      timeout_ms: { type: "integer", description: "Timeout in milliseconds (default 30000, max 120000)." },
    },
    required: ["command"],
  },
};

function commandEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      !/(api.?key|auth|cookie|credential|password|secret|token)/i.test(name),
    ),
  );
}

const handler: ToolHandler = async (args, ctx) => {
  const input = args as { command?: unknown; args?: unknown; cwd?: unknown; timeout_ms?: unknown };
  if (typeof input?.command !== "string" || !input.command.trim()) {
    return { content: "missing 'command' argument", isError: true };
  }
  if (input.args !== undefined && (!Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string"))) {
    return { content: "'args' must be an array of strings", isError: true };
  }
  const allow = (process.env.YUDU_COMMAND_ALLOW ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allow.length === 0) {
    return { content: "YUDU_COMMAND_ALLOW must list allowed executables (or '*')", isError: true };
  }
  if (!allow.includes("*") && !allow.includes(input.command)) {
    return { content: `command '${input.command}' is not in YUDU_COMMAND_ALLOW`, isError: true };
  }
  const cwd = await resolveWorkspacePath(typeof input.cwd === "string" ? input.cwd : ".");
  const timeoutMs = Number.isInteger(input.timeout_ms)
    ? Math.min(120_000, Math.max(100, Number(input.timeout_ms)))
    : 30_000;

  return await new Promise((resolve) => {
    const child = spawn(input.command as string, (input.args as string[] | undefined) ?? [], {
      cwd,
      shell: false,
      env: commandEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (current: string, chunk: Buffer): string =>
      current.length >= 50_000 ? current : (current + chunk.toString("utf8")).slice(0, 50_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const finish = (content: string, isError?: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", abort);
      resolve({ content, isError });
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish("command aborted", true);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(`command timed out after ${timeoutMs} ms\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ""}`, true);
    }, timeoutMs);
    ctx.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => finish(error.message, true));
    child.on("close", (code, signal) => {
      const content = [
        stdout || "(no stdout)",
        stderr ? `stderr:\n${stderr}` : "",
        `exit_code=${code ?? "null"}${signal ? ` signal=${signal}` : ""}`,
      ].filter(Boolean).join("\n");
      finish(content, code !== 0);
    });
  });
};

export const execute_command = {
  def,
  handler,
  isAvailable: () => envFlag("YUDU_ENABLE_COMMAND_TOOL"),
};
