import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const settingsPath = path.join(dataDir, "settings.json");

export interface ProviderSetting {
  apiKey?: string;
  baseUrl?: string;
  manualModels?: string[];
}

export interface AppSettings {
  providers: Record<string, ProviderSetting>;
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
  // GET: returns masked keys, never the raw secret
  app.get("/api/settings", async () => {
    const s = readSettings();
    const masked: Record<string, { apiKeyMasked?: string; baseUrl?: string; manualModels: string[] }> = {};
    for (const [k, v] of Object.entries(s.providers)) {
      masked[k] = {
        apiKeyMasked: maskKey(v.apiKey),
        baseUrl: v.baseUrl,
        manualModels: v.manualModels ?? [],
      };
    }
    return { providers: masked, ui: s.ui };
  });

  // PUT: partial merge; masked placeholders for apiKey keep the existing secret
  app.put<{
    Body: {
      providers?: Record<string, { apiKey?: string; baseUrl?: string; manualModels?: string[] }>;
      ui?: { theme?: "light" | "dark" | "system" };
    };
  }>("/api/settings", async (req) => {
    const incoming = req.body ?? {};
    const current = readSettings();

    const merged: Record<string, ProviderSetting> = { ...current.providers };
    for (const [k, v] of Object.entries(incoming.providers ?? {})) {
      const prev = merged[k] ?? {};
      const next: ProviderSetting = { ...prev };
      if (typeof v.baseUrl === "string") next.baseUrl = v.baseUrl;
      if (typeof v.apiKey === "string") {
        // Placeholder pattern => keep the existing key
        if (v.apiKey.includes("...") || v.apiKey === "****") {
          // keep prev.apiKey
        } else {
          next.apiKey = v.apiKey;
        }
      }
      if (Array.isArray(v.manualModels)) {
        next.manualModels = Array.from(
          new Set(v.manualModels.filter((s) => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())),
        );
      }
      merged[k] = next;
    }
    const next: AppSettings = {
      providers: merged,
      ui: incoming.ui?.theme ? { ...current.ui, theme: incoming.ui.theme } : current.ui,
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
