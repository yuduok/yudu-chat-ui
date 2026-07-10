import assert from "node:assert/strict";
import test from "node:test";
import { MockImageProvider, OpenAIImageProvider } from "../src/providers/images.js";

const baseRequest = {
  provider: "openai",
  model: "gpt-image-1",
  prompt: "a blue fox",
  size: "1024x1024",
  quality: "high",
  style: "auto",
  count: 1,
  outputFormat: "png",
  background: "auto",
};

test("mock image provider returns deterministic image bytes", async () => {
  const output = await new MockImageProvider().generate({ ...baseRequest, provider: "mock", model: "mock-image-1" });
  assert.equal(output.images.length, 1);
  assert.equal(output.images[0].mimeType, "image/svg+xml");
  assert.match(output.images[0].bytes.toString("utf8"), /a blue fox/);
});

test("OpenAI image provider sends generation options", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
  };
  try {
    const output = await new OpenAIImageProvider("openai").generate(baseRequest, { apiKey: "test" });
    assert.equal(requestBody.model, "gpt-image-1");
    assert.equal(requestBody.size, "1024x1024");
    assert.equal(requestBody.quality, "high");
    assert.equal(requestBody.output_format, "png");
    assert.equal(output.images[0].bytes.toString(), "image");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("OpenAI image provider preserves requested base64 output MIME", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
  try {
    const output = await new OpenAIImageProvider("openai").generate({ ...baseRequest, outputFormat: "webp" }, { apiKey: "test" });
    assert.equal(output.images[0].mimeType, "image/webp");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("OpenAI image provider uses edits endpoint for references", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: unknown;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestBody = init?.body;
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("edited").toString("base64") }] }), { status: 200 });
  };
  try {
    await new OpenAIImageProvider("openai").generate({
      ...baseRequest,
      referenceImages: [{ name: "ref.png", dataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}` }],
    }, { apiKey: "test" });
    assert.match(requestedUrl, /\/images\/edits$/);
    assert.ok(requestBody instanceof FormData);
    assert.equal(requestBody.get("prompt"), "a blue fox");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("OpenAI image provider forwards abort signals", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => {
    receivedSignal = init?.signal;
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }), { status: 200 });
  };
  try {
    await new OpenAIImageProvider("openai").generate(baseRequest, { apiKey: "test", signal: controller.signal });
    assert.equal(receivedSignal, controller.signal);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
