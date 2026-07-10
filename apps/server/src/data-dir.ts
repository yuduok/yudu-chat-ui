import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isDesktop = process.env.YUDU_DESKTOP === "1";
export const dataDir = process.env.YUDU_DATA_DIR ?? (isDesktop
  ? path.join(os.homedir(), ".yudu-chat")
  : path.resolve(process.cwd(), "data"));

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
