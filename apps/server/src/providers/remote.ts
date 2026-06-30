import type { ChatProvider } from "./types.js";

export interface RemoteModelResult {
  provider: string;
  baseUrl: string;
  models: string[];
  source: "remote" | "fallback";
  error?: string;
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
    const headers: Record<string, string> = {};
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
    const data = (await r.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(data?.data)
      ? data!.data!.map((m) => m.id).filter((x): x is string => typeof x === "string")
      : [];
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
