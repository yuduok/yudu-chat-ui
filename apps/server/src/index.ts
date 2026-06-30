import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { conversationRoutes } from "./routes/conversations.js";
import { chatRoutes } from "./routes/chat.js";
import { providerRoutes } from "./routes/providers.js";
import { settingsRoutes } from "./routes/settings.js";
import { agentRoutes } from "./routes/agents.js";
import { usageRoutes } from "./routes/usage.js";
import { loadAgents } from "./agents/index.js";
import { registerBuiltinTools } from "./tools/builtin.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

await app.register(cors, { origin: true, credentials: true });
await app.register(sensible);
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

// Bootstrap side-effects: load agent profiles and register built-in tools.
registerBuiltinTools();
await loadAgents();

await app.register(conversationRoutes);
await app.register(chatRoutes);
await app.register(providerRoutes);
await app.register(settingsRoutes);
await app.register(agentRoutes);
await app.register(usageRoutes);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
