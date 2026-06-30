import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "@yudu/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When the server is running, __dirname is .../apps/server/src/agents/, so
// the JSON files live right next to this file.
const agentsDir = __dirname;

const cache = new Map<string, AgentProfile>();

function isProfile(x: unknown): x is AgentProfile {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    typeof p.systemPrompt === "string"
  );
}

export async function loadAgents(): Promise<void> {
  cache.clear();
  let entries: string[];
  try {
    entries = await fs.readdir(agentsDir);
  } catch (err) {
    console.warn("[agents] cannot read dir", agentsDir, err);
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(agentsDir, name);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!isProfile(parsed)) {
        console.warn(`[agents] ${name} does not look like an AgentProfile, skipping`);
        continue;
      }
      cache.set(parsed.id, parsed);
    } catch (err) {
      console.warn(`[agents] failed to load ${name}:`, err);
    }
  }
}

export function getAgent(id: string): AgentProfile | undefined {
  return cache.get(id);
}

export function listAgents(): AgentProfile[] {
  return Array.from(cache.values());
}
