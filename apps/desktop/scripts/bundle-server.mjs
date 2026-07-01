#!/usr/bin/env node
/**
 * 把 apps/server 打包成 Tauri sidecar 可执行文件。
 *
 * 1) esbuild bundle --platform=node --format=cjs 打包 apps/server 入口。
 * 2) better-sqlite3 native binding 复制到 dist-server/native/。
 * 3) @yao-pkg/pkg 把单文件 + node runtime 封成单一可执行,遵循 Tauri
 *    externalBin 命名约定 yudu-server-<triple>[.exe]。
 *
 * 顶层 await 已在 server/src/index.ts 中改写为 start().catch(...);
 * esbuild 生成的 CJS bundle 顶部注入的 banner 会把 better-sqlite3 native
 * binding 路径通过 YUDU_SQLITE_BIN 环境变量 + Module._resolveFilename
 * patch 注入运行时,避免 pkg 内部 vfs 找不到 .node 文件。
 */
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..", "..");
const SERVER_DIR = resolve(ROOT, "apps/server");
const DESKTOP_DIR = resolve(ROOT, "apps/desktop");
const DIST_DIR = resolve(SERVER_DIR, "dist-server");
const BUNDLE_OUT = resolve(DIST_DIR, "index.cjs");
const NATIVE_DIR = resolve(DIST_DIR, "native");
const BIN_DIR = resolve(DESKTOP_DIR, "src-tauri/binaries");
const PKG_VERSION = "6.21.0"; // @yao-pkg/pkg 版本,匹配宿主 node ABI

const log = (...a) => console.log("[bundle-server]", ...a);
const run = (cmd) => {
  log("$", cmd);
  execSync(cmd, { stdio: "inherit" });
};

const TRIPLE = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};

const PKG_TARGET = {
  "aarch64-apple-darwin": "node22-macos-arm64",
  "x86_64-apple-darwin": "node22-macos-x64",
  "x86_64-unknown-linux-gnu": "node22-linux-x64",
  "aarch64-unknown-linux-gnu": "node22-linux-arm64",
  "x86_64-pc-windows-msvc": "node22-win-x64",
  "aarch64-pc-windows-msvc": "node22-win-arm64",
};

function triple() {
  const k = `${process.platform}-${process.arch}`;
  if (!TRIPLE[k]) throw new Error(`unsupported platform/arch: ${k}`);
  return TRIPLE[k];
}

function ensureClean(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// 顶层 banner:monkey-patch Module._resolveFilename,让 better-sqlite3 的
// `require('bindings')('better_sqlite3.node')` 指向 YUDU_SQLITE_BIN
// (在 Tauri sidecar 启动时通过 env 注入到绝对路径)。
const BANNER_JS = [
  "'use strict';",
  "var Module = require('module');",
  "var Fs = require('fs');",
  "var NATIVE_BINDING = process.env.YUDU_SQLITE_BIN;",
  "if (!NATIVE_BINDING && typeof process.pkg !== 'undefined') {",
  "  var os = require('os'), path = require('path');",
  "  var tmpPath = path.join(os.tmpdir(), 'yudu-' + process.pkg.packageName + '-' + process.pid + '-better_sqlite3.node');",
  "  try {",
  "    var payload = require('fs').readFileSync(path.join(__dirname, 'native', 'better_sqlite3.node'));",
  "    require('fs').writeFileSync(tmpPath, payload);",
  "    NATIVE_BINDING = tmpPath;",
  "  } catch (e) { /* ignore */ }",
  "}",
  "if (NATIVE_BINDING) {",
  "  var _origResolve = Module._resolveFilename;",
  "  Module._resolveFilename = function (req, parent, isMain, opts) {",
  "    try {",
  "      return _origResolve.call(this, req, parent, isMain, opts);",
  "    } catch (e) {",
  "      if (req === 'bindings' || /better_sqlite3\\.node$/.test(String(req))) {",
  "        return NATIVE_BINDING;",
  "      }",
  "      throw e;",
  "    }",
  "  };",
  "  var _origStat = Fs.statSync;",
  "  Fs.statSync = function (p, opts) {",
  "    if (NATIVE_BINDING && typeof p === 'string' && /better_sqlite3\\.node$/.test(p)) {",
  "      return _origStat.call(Fs, NATIVE_BINDING, opts);",
  "    }",
  "    return _origStat.call(Fs, p, opts);",
  "  };",
  "}",

  "var __importMetaUrl = require('url').pathToFileURL(__filename).href;",
].join("\n");

async function main() {
  ensureClean(DIST_DIR);

  // 1) esbuild CJS bundle
  log("esbuild bundle ->", BUNDLE_OUT);
  await build({
    entryPoints: [path.join(SERVER_DIR, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["better-sqlite3"],
    banner: { js: BANNER_JS },
    outfile: BUNDLE_OUT,
    legalComments: "none",
    logLevel: "warning",
    supported: { "import-meta": true },
    define: { "import.meta.url": "__importMetaUrl" },
  });

  // 2) 拷贝 better-sqlite3 native binding
  const nativeSrc = resolve(SERVER_DIR, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  if (!existsSync(nativeSrc)) {
    console.warn(
      `[bundle-server] WARNING: ${nativeSrc} not found.\n` +
        `  Run \`pnpm install && pnpm rebuild better-sqlite3 --filter @yudu/server\`.`
    );
  } else {
    ensureClean(NATIVE_DIR);
    copyFileSync(nativeSrc, resolve(NATIVE_DIR, "better_sqlite3.node"));
  }

  // 3) 写一个 pkg 配置文件,让 binding 一起被包含
  const pkgConfig = resolve(DESKTOP_DIR, "pkg.config.cjs");
  const t = triple();
  const target = PKG_TARGET[t];
  if (!target) throw new Error(`no pkg target for triple ${t}`);
  writeFileSync(
    pkgConfig,
    `/** Auto-generated by bundle-server.mjs. */\n` +
      `module.exports = {\n` +
      `  scripts: ["${path.relative(DESKTOP_DIR, BUNDLE_OUT).split(path.sep).join("/")}"],\n` +
      `  assets: ["${path.relative(DESKTOP_DIR, NATIVE_DIR).split(path.sep).join("/")}/**"],\n` +
      `  targets: ["${target}"],\n` +
      `};\n`
  );

  // 4) pkg 打包
  const outBin = resolve(
    BIN_DIR,
    `yudu-server-${t}${process.platform === "win32" ? ".exe" : ""}`
  );
  ensureClean(BIN_DIR);
  if (existsSync(outBin)) rmSync(outBin);

  run(
    `npx --yes @yao-pkg/pkg@${PKG_VERSION} ` +
      `-c ${pkgConfig} ` +
      `${BUNDLE_OUT} ` +
      `--output ${outBin}`
  );

  log("sidecar ready:", outBin);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
