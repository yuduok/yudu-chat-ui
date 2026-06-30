import type { FastifyInstance } from "fastify";

// Settings (API keys + base URLs) live in a small JSON file in data/.
// This keeps secrets out of SQLite for easier backup/encryption later.
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const settingsPath = path.join(dataDir, "settings.json");

export interface ProviderSetting {
  apiKey?: string;
  baseUrl?: string;
}

export interface AppSettings {
  // Provider key -> settings. API keys never round-trip back to the client.
  providers: Record<string, ProviderSetting>;
  // UI preferences
  ui: { theme: "light" | "dark" | "system" };
}

const defaults: AppSettings = {
  providers: {},
  ui: { theme: "system" },
};

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      providers: parsed.providers ?? {},
      ui: parsed.ui ?? defaults.ui,
    };
  } catch {
    return defaults;
  }
}

function writeSettings(s: AppSettings) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), "utf-8");
}

function maskKey(k?: string): string | undefined {
  if (!k) return undefined;
  if (k.length <= 8) return "****";
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

export async function settingsRoutes(app: FastifyInstance) {
  // Return settings with keys masked
  app.get("/api/settings", async () => {
    const s = readSettings();
    const masked: Record<string, { apiKeyMasked?: string; baseUrl?: string }> = {};
    for (const [k, v] of Object.entries(s.providers)) {
      masked[k] = { apiKeyMasked: maskKey(v.apiKey), baseUrl: v.baseUrl };
    }
    return { providers: masked, ui: s.ui };
  });

  app.put<{ Body: AppSettings }>("/api/settings", async (req) => {
    const incoming = req.body;
    const current = readSettings();

    // Merge per-provider settings; accept either a real key or a masked
    // placeholder to indicate "keep existing".
    const merged: Record<string, ProviderSetting> = { ...current.providers };
    for (const [k, v] of Object.entries(incoming.providers ?? {})) {
      const prev = merged[k] ?? {};
      const next: ProviderSetting = { ...prev };
      if (typeof v.baseUrl === "string") next.baseUrl = v.baseUrl;
      if (typeof v.apiKey === "string") {
        if (v.apiKey.includes("...") || v.apiKey === "****") {
          // keep previous
        } else {
          next.apiKey = v.apiKey;
        }
      }
      merged[k] = next;
    }
    const next: AppSettings = {
      providers: merged,
      ui: incoming.ui ?? current.ui,
    };
    writeSettings(next);
    return { ok: true };
  });
}

export function getProviderSetting(id: string): ProviderSetting {
  const s = readSettings();
  return s.providers[id] ?? {};
}

export function getAllSettings(): AppSettings {
  return readSettings();
}
