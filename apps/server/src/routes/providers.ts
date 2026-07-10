import type { FastifyInstance } from "fastify";
import { listProviders, getProvider } from "../providers/registry.js";
import { fetchOpenAIModels } from "../providers/remote.js";
import { getAllSettings, getProviderSetting } from "./settings.js";
import { getImageProvider } from "../providers/images.js";

export async function providerRoutes(app: FastifyInstance) {
  app.get("/api/providers", async () => {
    const settings = getAllSettings();
    const builtIns = listProviders().map((p) => ({
      id: p.id,
      label: p.id === "custom" ? settings.providers.custom?.name || p.label : p.label,
      models: p.defaultModels,
      baseUrl: p.defaultBaseUrl,
      supportsTools: p.supportsTools === true,
      imageGeneration: getImageProvider(p.id)?.capabilities,
    }));
    const custom = Object.entries(settings.providers)
      .filter(([id]) => id.startsWith("custom:"))
      .map(([id, setting]) => {
        const provider = getProvider(id)!;
        return {
          id,
          label: setting.name || provider.label,
          models: provider.defaultModels,
          baseUrl: provider.defaultBaseUrl,
          supportsTools: provider.supportsTools === true,
          imageGeneration: undefined,
        };
      });
    return [...builtIns, ...custom];
  });

  // Returns the merged model list for a provider: defaults + manual + (optionally) remote.
  // `?remote=1` triggers an upstream fetch. We never throw on upstream failure.
  app.get<{ Params: { id: string }; Querystring: { remote?: string } }>(
    "/api/providers/:id/models",
    async (req, reply) => {
      const provider = getProvider(req.params.id);
      if (!provider) return reply.code(404).send({ error: "Unknown provider" });
      const setting = getProviderSetting(req.params.id);
      const manual = (setting.manualModels ?? []).slice();
      const defaults = provider.defaultModels.slice();

      const wantsRemote = req.query.remote === "1" || req.query.remote === "true";
      if (!wantsRemote) {
        return {
          provider: provider.id,
          baseUrl: setting.baseUrl ?? provider.defaultBaseUrl ?? null,
          defaults,
          manual,
          models: dedupe([...defaults, ...manual]),
          source: "fallback" as const,
        };
      }

      const result = await fetchOpenAIModels(
        provider,
        setting.apiKey,
        setting.baseUrl,
      );
      return {
        provider: provider.id,
        baseUrl: result.baseUrl,
        defaults,
        manual,
        models: dedupe([...defaults, ...manual, ...result.models]),
        source: result.source,
        error: result.error,
      };
    },
  );
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((s) => typeof s === "string" && s.length > 0)));
}
