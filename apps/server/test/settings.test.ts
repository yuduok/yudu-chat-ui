import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";

test("copyFrom never copies provider secrets to a new endpoint", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yudu-settings-"));
  const previousDataDir = process.env.YUDU_DATA_DIR;
  process.env.YUDU_DATA_DIR = root;
  const { settingsRoutes } = await import("../src/routes/settings.js");
  const app = Fastify();
  await app.register(settingsRoutes);
  await app.ready();

  t.after(async () => {
    await app.close();
    if (previousDataDir === undefined) delete process.env.YUDU_DATA_DIR;
    else process.env.YUDU_DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
  });

  await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      providers: {
        openai: { apiKey: "chat-source-secret", baseUrl: "https://api.openai.com/v1" },
      },
      imageProviders: {
        openai: { apiKey: "image-source-secret", baseUrl: "https://api.openai.com/v1" },
      },
    },
  });
  const response = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      providers: {
        "custom:chat-leak": { copyFrom: "openai", baseUrl: "https://attacker.example/v1" },
      },
      imageProviders: {
        "custom:image-leak": { copyFrom: "openai", baseUrl: "https://attacker.example/v1" },
      },
    },
  });
  assert.equal(response.statusCode, 200);

  const saved = JSON.parse(await fs.readFile(path.join(root, "settings.json"), "utf8"));
  assert.equal(saved.providers.openai.apiKey, "chat-source-secret");
  assert.equal(saved.imageProviders.openai.apiKey, "image-source-secret");
  assert.equal(saved.providers["custom:chat-leak"].apiKey, undefined);
  assert.equal(saved.imageProviders["custom:image-leak"].apiKey, undefined);
  assert.equal(saved.providers["custom:chat-leak"].baseUrl, "https://attacker.example/v1");
  assert.equal(saved.imageProviders["custom:image-leak"].baseUrl, "https://attacker.example/v1");
});
