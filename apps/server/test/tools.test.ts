import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execute_command } from "../src/tools/execute_command.js";
import { list_directory } from "../src/tools/list_directory.js";
import { read_file } from "../src/tools/read_file.js";
import { search_files } from "../src/tools/search_files.js";
import { resolveWorkspacePath } from "../src/tools/workspace.js";
import { write_file } from "../src/tools/write_file.js";
import { dataDir } from "../src/data-dir.js";

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yudu-tools-"));
  const previousRoot = process.env.YUDU_WORKSPACE_ROOT;
  process.env.YUDU_WORKSPACE_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previousRoot === undefined) delete process.env.YUDU_WORKSPACE_ROOT;
    else process.env.YUDU_WORKSPACE_ROOT = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("workspace paths cannot escape the configured root", async () => {
  await withWorkspace(async (root) => {
    await assert.rejects(resolveWorkspacePath("../outside"), /escapes the configured workspace/);
    await fs.symlink(os.tmpdir(), path.join(root, "outside-link"));
    await assert.rejects(resolveWorkspacePath("outside-link"), /outside the configured workspace/);
  });
});

test("read-only tools block common credential paths", async () => {
  await withWorkspace(async (root) => {
    await fs.writeFile(path.join(root, ".env"), "SECRET=value\n", "utf8");
    await assert.rejects(
      read_file.handler({ path: ".env" }, {}),
      /application data, credentials, and internal paths/,
    );

    const searchResult = await search_files.handler({ query: "SECRET" }, {});
    assert.equal(searchResult.content, "no matches");
  });
});

test("workspace tools cannot access the application data directory", async () => {
  const previousRoot = process.env.YUDU_WORKSPACE_ROOT;
  const root = path.dirname(dataDir);
  const relativeDataDir = path.relative(root, dataDir) || ".";
  process.env.YUDU_WORKSPACE_ROOT = root;
  try {
    await assert.rejects(
      read_file.handler({ path: relativeDataDir }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(
      list_directory.handler({ path: relativeDataDir }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(
      search_files.handler({ path: relativeDataDir, query: "apiKey" }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(
      write_file.handler({ path: path.join(relativeDataDir, "blocked.txt"), content: "blocked" }, {}),
      /application data, credentials, and internal paths/,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.YUDU_WORKSPACE_ROOT;
    else process.env.YUDU_WORKSPACE_ROOT = previousRoot;
  }
});

test("write_file blocks new application data files through a symlink parent", async () => {
  const previousRoot = process.env.YUDU_WORKSPACE_ROOT;
  const root = path.dirname(dataDir);
  const unique = `${process.pid}-${Date.now()}`;
  const linkName = `.yudu-data-link-${unique}`;
  const targetName = `.blocked-${unique}.txt`;
  const linkPath = path.join(root, linkName);
  const targetPath = path.join(dataDir, targetName);
  process.env.YUDU_WORKSPACE_ROOT = root;

  try {
    await fs.symlink(dataDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      write_file.handler({ path: path.join(linkName, targetName), content: "blocked" }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(fs.access(targetPath), { code: "ENOENT" });
  } finally {
    await fs.rm(linkPath, { force: true });
    await fs.rm(targetPath, { force: true });
    if (previousRoot === undefined) delete process.env.YUDU_WORKSPACE_ROOT;
    else process.env.YUDU_WORKSPACE_ROOT = previousRoot;
  }
});

test("workspace tools consistently hide .git internals", async () => {
  await withWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(path.join(root, ".git", "config"), "AUDIT_MARKER=secret\n", "utf8");

    await assert.rejects(
      read_file.handler({ path: ".git/config" }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(
      list_directory.handler({ path: ".git" }, {}),
      /application data, credentials, and internal paths/,
    );
    await assert.rejects(
      write_file.handler({ path: ".git/config", content: "changed" }, {}),
      /application data, credentials, and internal paths/,
    );
    const searchResult = await search_files.handler({ query: "AUDIT_MARKER" }, {});
    assert.equal(searchResult.content, "no matches");
  });
});

test("read_file paginates and search_files reports line references", async () => {
  await withWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const readResult = await read_file.handler({ path: "sample.txt", offset: 2, limit: 1 }, {});
    assert.equal(readResult.isError, undefined);
    assert.match(readResult.content, /^2\|beta/);
    assert.match(readResult.content, /next_offset=3/);

    const searchResult = await search_files.handler({ query: "gamma" }, {});
    assert.equal(searchResult.isError, undefined);
    assert.match(searchResult.content, /sample\.txt:3:gamma/);
  });
});

test("write_file availability follows the server capability flag", async () => {
  const previous = process.env.YUDU_ENABLE_WRITE_TOOL;
  delete process.env.YUDU_ENABLE_WRITE_TOOL;
  assert.equal(write_file.isAvailable(), false);
  process.env.YUDU_ENABLE_WRITE_TOOL = "true";
  assert.equal(write_file.isAvailable(), true);
  if (previous === undefined) delete process.env.YUDU_ENABLE_WRITE_TOOL;
  else process.env.YUDU_ENABLE_WRITE_TOOL = previous;
});

test("execute_command enforces its executable allowlist", async () => {
  await withWorkspace(async () => {
    const previous = process.env.YUDU_COMMAND_ALLOW;
    delete process.env.YUDU_COMMAND_ALLOW;
    const unconfigured = await execute_command.handler({ command: "node" }, {});
    assert.equal(unconfigured.isError, true);
    assert.match(unconfigured.content, /must list allowed executables/);

    process.env.YUDU_COMMAND_ALLOW = "node";
    const denied = await execute_command.handler({ command: "printf", args: ["hello"] }, {});
    assert.equal(denied.isError, true);
    assert.match(denied.content, /not in YUDU_COMMAND_ALLOW/);

    const allowed = await execute_command.handler({
      command: "node",
      args: ["-e", "process.stdout.write('hello')"],
    }, {});
    assert.equal(allowed.isError, false);
    assert.match(allowed.content, /hello/);
    assert.match(allowed.content, /exit_code=0/);
    if (previous === undefined) delete process.env.YUDU_COMMAND_ALLOW;
    else process.env.YUDU_COMMAND_ALLOW = previous;
  });
});

test("execute_command does not expose server secrets to child processes", async () => {
  await withWorkspace(async () => {
    const previousAllow = process.env.YUDU_COMMAND_ALLOW;
    const previousSecret = process.env.TEST_API_KEY;
    process.env.YUDU_COMMAND_ALLOW = "node";
    process.env.TEST_API_KEY = "should-not-leak";
    const result = await execute_command.handler({
      command: "node",
      args: ["-e", "process.stdout.write(process.env.TEST_API_KEY || 'redacted')"],
    }, {});
    assert.equal(result.isError, false);
    assert.match(result.content, /^redacted/);
    if (previousAllow === undefined) delete process.env.YUDU_COMMAND_ALLOW;
    else process.env.YUDU_COMMAND_ALLOW = previousAllow;
    if (previousSecret === undefined) delete process.env.TEST_API_KEY;
    else process.env.TEST_API_KEY = previousSecret;
  });
});
