import type { ChatProvider } from "./types.js";

export interface RemoteModelResult {
  provider: string;
  baseUrl: string;
  models: string[];
  source: "remote" | "fallback";
  error?: string;
}

/**
 * Pick a model identifier from a single list item. OpenAI's spec uses
 * `id`, but a lot of OpenAI-compatible servers we have to talk to
 * (LM Studio, vLLM, llama.cpp, OpenRouter, etc.) name the field
 * differently. We accept any of the common ones.
 */
function pickId(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;
  for (const key of ["id", "name", "model", "model_id", "modelId"]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Normalize a `/models` response into a flat string[]. Real OpenAI
 * returns `{ data: [{ id }] }`. We also accept:
 *   - `{ data: [{ name | model }] }` (LM Studio, llama.cpp, some forks)
 *   - `{ models: [{ id | name }] }` (OpenRouter-style)
 *   - `{ models: ["id1", "id2"] }` (rare plain-string arrays)
 *   - bare arrays: `[{ id }]`
 */
function extractModelIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    // bare array of either strings or {id|name|model|...}
    return payload
      .map((item) => (typeof item === "string" ? item : pickId(item)))
      .filter((x): x is string => typeof x === "string" && x.length > 0);
  }
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "models", "items", "results"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      const ids = v
        .map((item) => (typeof item === "string" ? item : pickId(item)))
        .filter((x): x is string => typeof x === "string" && x.length > 0);
      if (ids.length > 0) return ids;
    }
  }
  return [];
}

// Tries to fetch the model list for an OpenAI-compatible provider. The
// `fetchFn` indirection makes this trivially unit-testable.
export async function fetchOpenAIModels(
  provider: ChatProvider,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<RemoteModelResult> {
  const url = (baseUrl ?? provider.defaultBaseUrl ?? "").replace(/\/$/, "");
  if (!url) {
    return { provider: provider.id, baseUrl: "", models: provider.defaultModels, source: "fallback" };
  }
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetchFn(`${url}/models`, { headers });
    if (!r.ok) {
      return {
        provider: provider.id,
        baseUrl: url,
        models: provider.defaultModels,
        source: "fallback",
        error: `HTTP ${r.status}`,
      };
    }
    // Some servers (e.g. LM Studio in certain modes) return a
    // newline-delimited JSON body instead of a single object. We
    // accept both shapes: try `r.json()` first, and if that fails,
    // split on newlines and parse each line as its own JSON object.
    const text = await r.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const merged: unknown[] = [];
      for (const line of lines) {
        try {
          merged.push(JSON.parse(line));
        } catch {
          // ignore malformed lines
        }
      }
      payload = merged.length === 1 ? merged[0] : merged;
    }
    const models = extractModelIds(payload);
    if (models.length === 0) {
      return {
        provider: provider.id,
        baseUrl: url,
        models: provider.defaultModels,
        source: "fallback",
        error: "empty list",
      };
    }
    return { provider: provider.id, baseUrl: url, models, source: "remote" };
  } catch (err: any) {
    return {
      provider: provider.id,
      baseUrl: url,
      models: provider.defaultModels,
      source: "fallback",
      error: err?.message ?? String(err),
    };
  }
}
