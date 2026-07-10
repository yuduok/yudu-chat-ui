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
import { uploadRoutes } from "./routes/uploads.js";
import { imageRoutes } from "./routes/images.js";
import { skillRoutes } from "./routes/skills.js";
import { loadAgents } from "./agents/index.js";
import { registerBuiltinTools } from "./tools/builtin.js";

export async function start(): Promise<void> {
  const app = Fastify({
    bodyLimit: 64 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https?:\/\/tauri\.localhost|tauri:\/\/localhost)$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"), false);
    },
  });
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
  await app.register(uploadRoutes);
  await app.register(imageRoutes);
  await app.register(skillRoutes);

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
    app.log.info(`Server listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// ESM (tsx / vite) 下顶层 await 可用,直接启动;
// CJS (pkg 打包) 下 esbuild 会把 start() 调用编译为 promise,执行端包一层 IIFE。
start().catch((err) => { console.error(err); process.exit(1); });
