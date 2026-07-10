import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../data-dir.js";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".playwright-cli",
  ".turbo",
  ".vite",
  "dist",
  "node_modules",
  "target",
]);

const SENSITIVE_DIRECTORIES = new Set([".aws", ".git", ".gnupg", ".ssh"]);
const SENSITIVE_FILENAMES = new Set([
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_ecdsa",
  "id_rsa",
  "service-account.json",
]);

const applicationDataRoot = (() => {
  try {
    return realpathSync(dataDir);
  } catch {
    return path.resolve(dataDir);
  }
})();

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.YUDU_WORKSPACE_ROOT || process.cwd());
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveWorkspacePath(
  inputPath: string,
  opts: { mustExist?: boolean } = {},
): Promise<string> {
  const root = await fs.realpath(getWorkspaceRoot());
  const candidate = path.resolve(root, inputPath || ".");
  if (!isInside(root, candidate)) throw new Error("path escapes the configured workspace");

  try {
    const real = await fs.realpath(candidate);
    if (!isInside(root, real)) throw new Error("path resolves outside the configured workspace");
    return real;
  } catch (error: any) {
    if (error?.code !== "ENOENT" || opts.mustExist !== false) throw error;
    const parent = await fs.realpath(path.dirname(candidate));
    if (!isInside(root, parent)) throw new Error("path parent resolves outside the configured workspace");
    return path.join(parent, path.basename(candidate));
  }
}

export function workspaceRelative(absolutePath: string): string {
  const relative = path.relative(getWorkspaceRoot(), absolutePath);
  return relative || ".";
}

export function shouldIgnore(name: string): boolean {
  return DEFAULT_IGNORES.has(name);
}

export function isSensitivePath(absolutePath: string): boolean {
  const candidate = path.resolve(absolutePath);
  if (isInside(applicationDataRoot, candidate)) return true;
  const relative = path.relative(getWorkspaceRoot(), absolutePath);
  const parts = relative.split(path.sep).filter(Boolean).map((part) => part.toLowerCase());
  if (parts.some((part) => SENSITIVE_DIRECTORIES.has(part))) return true;
  const filename = parts.at(-1) ?? "";
  if (filename === ".env" || (filename.startsWith(".env.") && filename !== ".env.example")) return true;
  if (SENSITIVE_FILENAMES.has(filename)) return true;
  return [".key", ".p12", ".pem", ".pfx"].some((extension) => filename.endsWith(extension));
}

export function assertWorkspaceToolPath(absolutePath: string): void {
  if (isSensitivePath(absolutePath)) {
    throw new Error("access to application data, credentials, and internal paths is blocked");
  }
}

export function envFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
}
