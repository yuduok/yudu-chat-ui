import type { FastifyInstance } from "fastify";
import { listProviders } from "../providers/registry.js";

export async function providerRoutes(app: FastifyInstance) {
  app.get("/api/providers", async () => {
    return listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      models: p.defaultModels,
      baseUrl: p.defaultBaseUrl,
    }));
  });
}
