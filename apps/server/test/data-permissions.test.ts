import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";

test("application data and secret files use owner-only permissions", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX file modes are not available on Windows");
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yudu-private-data-"));
  const dataDir = path.join(root, "data");
  const previousDataDir = process.env.YUDU_DATA_DIR;
  process.env.YUDU_DATA_DIR = dataDir;

  const [{ settingsRoutes }] = await Promise.all([
    import("../src/routes/settings.js"),
    import("../src/db/index.js"),
  ]);
  const app = Fastify();
  await app.register(settingsRoutes);
  await app.ready();

  t.after(async () => {
    await app.close();
    if (previousDataDir === undefined) delete process.env.YUDU_DATA_DIR;
    else process.env.YUDU_DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { providers: { openai: { apiKey: "test-secret" } } },
  });
  assert.equal(response.statusCode, 200);

  const directoryMode = (await fs.stat(dataDir)).mode & 0o777;
  const settingsMode = (await fs.stat(path.join(dataDir, "settings.json"))).mode & 0o777;
  const databaseMode = (await fs.stat(path.join(dataDir, "yudu-chat.db"))).mode & 0o777;
  assert.equal(directoryMode, 0o700);
  assert.equal(settingsMode, 0o600);
  assert.equal(databaseMode, 0o600);
});
