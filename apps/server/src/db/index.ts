import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import * as schema from "./schema.js";

// Desktop (Tauri sidecar) 模式下,把数据写到系统标准目录(由 sidecar 注入
// YUDU_DATA_DIR);Web 模式下保留原行为:写到 cwd/data,方便本地开发。
const isDesktop = process.env.YUDU_DESKTOP === "1";
const dataDir = isDesktop
  ? (process.env.YUDU_DATA_DIR ?? path.join(os.homedir(), ".yudu-chat"))
  : path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "yudu-chat.db");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export { schema };

// Bootstrap tables (small project, no migrations needed yet).
// The ALTER statements are idempotent: SQLite returns an error if the
// column already exists, which we swallow.
function safeAlter(sql: string) {
  try {
    sqlite.exec(sql);
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!/duplicate column name/i.test(msg)) {
      console.warn("[db] migration step failed:", msg);
    }
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT,
    temperature REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    parts TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
`);

// v3 columns
safeAlter("ALTER TABLE conversations ADD COLUMN agent_id TEXT");
safeAlter("ALTER TABLE messages ADD COLUMN tool_call_ids TEXT");

// v4 columns: per-conversation reasoning controls
safeAlter("ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT");
safeAlter("ALTER TABLE conversations ADD COLUMN show_thinking INTEGER");
