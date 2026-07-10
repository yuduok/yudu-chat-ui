import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../data-dir.js";

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const settingsPath = path.join(dataDir, "settings.json");

export interface ProviderSetting {
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  manualModels?: string[];
}

export interface ImageProviderSetting {
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface AppSettings {
  providers: Record<string, ProviderSetting>;
  imageProviders: Record<string, ImageProviderSetting>;
  ui: { theme: "light" | "dark" | "system" };
  skills: { enabled: boolean };
}

const defaults: AppSettings = {
  providers: {},
  imageProviders: {},
  ui: { theme: "system" },
  skills: { enabled: false },
};

function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      providers: parsed.providers ?? {},
      imageProviders: parsed.imageProviders ?? {},
      ui: parsed.ui ?? defaults.ui,
      skills: parsed.skills ?? defaults.skills,
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
    const masked: Record<string, { name?: string; apiKeyMasked?: string; baseUrl?: string; manualModels: string[] }> = {};
    const maskedImages: Record<string, { name?: string; apiKeyMasked?: string; baseUrl?: string; model?: string }> = {};
    for (const [k, v] of Object.entries(s.providers)) {
      masked[k] = {
        name: v.name,
        apiKeyMasked: maskKey(v.apiKey),
        baseUrl: v.baseUrl,
        manualModels: v.manualModels ?? [],
      };
    }
    for (const [k, v] of Object.entries(s.imageProviders)) {
      maskedImages[k] = { name: v.name, apiKeyMasked: maskKey(v.apiKey), baseUrl: v.baseUrl, model: v.model };
    }
    return { providers: masked, imageProviders: maskedImages, ui: s.ui, skills: s.skills };
  });

  // PUT: partial merge; masked placeholders for apiKey keep the existing secret
  app.put<{
    Body: {
      providers?: Record<string, { name?: string; apiKey?: string; baseUrl?: string; manualModels?: string[]; copyFrom?: string } | null>;
      imageProviders?: Record<string, { name?: string; apiKey?: string; baseUrl?: string; model?: string; copyFrom?: string } | null>;
      ui?: { theme?: "light" | "dark" | "system" };
      skills?: { enabled?: boolean };
    };
  }>("/api/settings", async (req) => {
    const incoming = req.body ?? {};
    const current = readSettings();

    const merged: Record<string, ProviderSetting> = { ...current.providers };
    for (const [k, v] of Object.entries(incoming.providers ?? {})) {
      if (v === null) {
        delete merged[k];
        continue;
      }
      const copied = typeof v.copyFrom === "string" ? current.providers[v.copyFrom] : undefined;
      const prev = merged[k] ?? {};
      const next: ProviderSetting = { ...(copied ?? prev) };
      if (typeof v.name === "string") next.name = v.name.trim();
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
    const mergedImages: Record<string, ImageProviderSetting> = { ...current.imageProviders };
    for (const [k, v] of Object.entries(incoming.imageProviders ?? {})) {
      if (v === null) {
        delete mergedImages[k];
        continue;
      }
      const copied = typeof v.copyFrom === "string" ? current.imageProviders[v.copyFrom] : undefined;
      const next: ImageProviderSetting = { ...(copied ?? mergedImages[k] ?? {}) };
      if (typeof v.name === "string") next.name = v.name.trim();
      if (typeof v.baseUrl === "string") next.baseUrl = v.baseUrl.trim();
      if (typeof v.model === "string") next.model = v.model.trim();
      if (typeof v.apiKey === "string" && !v.apiKey.includes("...") && v.apiKey !== "****") next.apiKey = v.apiKey;
      mergedImages[k] = next;
    }
    const next: AppSettings = {
      providers: merged,
      imageProviders: mergedImages,
      ui: incoming.ui?.theme ? { ...current.ui, theme: incoming.ui.theme } : current.ui,
      skills: typeof incoming.skills?.enabled === "boolean" ? { enabled: incoming.skills.enabled } : current.skills,
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

export function getImageProviderSetting(id: string): ImageProviderSetting {
  const settings = readSettings();
  const image = settings.imageProviders[id] ?? {};
  if (id !== "openai") return image;
  const chat = settings.providers.openai ?? {};
  return {
    apiKey: image.apiKey || chat.apiKey,
    baseUrl: image.baseUrl || chat.baseUrl,
    model: image.model,
  };
}
