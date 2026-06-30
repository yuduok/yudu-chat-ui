import type { FastifyInstance } from "fastify";
import { listAgents, getAgent } from "../agents/index.js";

export async function agentRoutes(app: FastifyInstance) {
  app.get("/api/agents", async () => {
    return listAgents();
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const a = getAgent(req.params.id);
    if (!a) return reply.code(404).send({ error: "Unknown agent" });
    return a;
  });
}
