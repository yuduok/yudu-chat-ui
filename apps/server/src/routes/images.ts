import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { GeneratedImageAsset, ImageGeneration, ImageGenerationRequest } from "@yudu/shared";
import { dataDir, db } from "../db/index.js";
import { imageGenerations } from "../db/schema.js";
import { getImageProvider, listImageProviders } from "../providers/images.js";
import { getImageProviderSetting } from "./settings.js";

const imagesDir = path.join(dataDir, "generated-images");
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function rowToGeneration(row: typeof imageGenerations.$inferSelect): ImageGeneration {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    options: JSON.parse(row.options),
    referenceImages: JSON.parse(row.referenceImages),
    status: row.status as ImageGeneration["status"],
    images: JSON.parse(row.images),
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function validateRequest(input: ImageGenerationRequest): string | null {
  const provider = getImageProvider(input.provider);
  if (!provider) return "provider does not support image generation";
  const c = provider.capabilities;
  if (!input.prompt?.trim()) return "prompt is required";
  if (!input.model?.trim() || (input.provider !== "custom" && !c.models.includes(input.model))) return "unsupported image model";
  if (!c.sizes.includes(input.size)) return "unsupported image size";
  if (!c.qualities.includes(input.quality)) return "unsupported image quality";
  if (input.style && !c.styles.includes(input.style)) return "unsupported image style";
  if (!c.outputFormats.includes(input.outputFormat)) return "unsupported output format";
  if (input.background && !c.backgrounds.includes(input.background)) return "unsupported background";
  if (input.moderation && !c.moderations.includes(input.moderation)) return "unsupported moderation level";
  if (input.outputCompression !== undefined && (!c.supportsOutputCompression || !Number.isInteger(input.outputCompression) || input.outputCompression < 0 || input.outputCompression > 100)) return "output compression must be between 0 and 100";
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > c.maxImages) return `count must be between 1 and ${c.maxImages}`;
  if ((input.referenceImages?.length ?? 0) > c.maxReferenceImages) return `too many reference images (max ${c.maxReferenceImages})`;
  if (input.referenceImages?.length && !c.supportsReferenceImages) return "reference images are not supported";
  for (const reference of input.referenceImages ?? []) {
    const match = reference.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) return "reference images must be PNG, JPEG, or WebP data URLs";
    if (Buffer.byteLength(match[2], "base64") > 8 * 1024 * 1024) return "reference image exceeds the 8 MB limit";
  }
  return null;
}

export async function imageRoutes(app: FastifyInstance) {
  await fs.mkdir(imagesDir, { recursive: true });

  app.get("/api/images/capabilities", async () => listImageProviders().map((provider) => ({
    provider: provider.id,
    capabilities: provider.capabilities,
  })));

  app.get("/api/images/generations", async () => {
    const rows = await db.select().from(imageGenerations).orderBy(desc(imageGenerations.createdAt)).limit(100);
    return rows.map(rowToGeneration);
  });

  app.post<{ Body: ImageGenerationRequest }>("/api/images/generations", async (req, reply) => {
    const input = req.body;
    const validationError = validateRequest(input);
    if (validationError) return reply.badRequest(validationError);
    const provider = getImageProvider(input.provider)!;
    const setting = getImageProviderSetting(input.provider);
    if (input.provider === "custom" && (!setting.apiKey || !setting.baseUrl)) {
      return reply.badRequest("custom image provider requires its own API key and base URL");
    }
    const id = nanoid();
    const createdAt = Date.now();
    const options = {
      size: input.size,
      quality: input.quality,
      style: input.style,
      count: input.count,
      outputFormat: input.outputFormat,
      background: input.background,
      moderation: input.moderation,
      outputCompression: input.outputCompression,
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.raw.once("aborted", abort);
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    try {
      const output = await provider.generate(input, { apiKey: setting.apiKey, baseUrl: setting.baseUrl, signal: controller.signal });
      const assets: GeneratedImageAsset[] = [];
      for (const [index, image] of output.images.entries()) {
        const assetId = nanoid();
        const extension = MIME_EXTENSIONS[image.mimeType] ?? input.outputFormat;
        const filename = `${assetId}.${extension}`;
        await fs.writeFile(path.join(imagesDir, filename), image.bytes);
        assets.push({
          id: assetId,
          url: `/api/images/assets/${filename}`,
          mimeType: image.mimeType,
          filename: `yudu-${id}-${index + 1}.${extension}`,
          revisedPrompt: image.revisedPrompt,
        });
      }
      const completedAt = Date.now();
      await db.insert(imageGenerations).values({
        id, provider: input.provider, model: input.model, prompt: input.prompt.trim(),
        options: JSON.stringify(options), referenceImages: JSON.stringify(input.referenceImages ?? []),
        status: "completed", images: JSON.stringify(assets), createdAt, completedAt,
      });
      return rowToGeneration((await db.select().from(imageGenerations).where(eq(imageGenerations.id, id)))[0]);
    } catch (error: any) {
      const completedAt = Date.now();
      const message = error?.message ?? String(error);
      await db.insert(imageGenerations).values({
        id, provider: input.provider, model: input.model, prompt: input.prompt.trim(),
        options: JSON.stringify(options), referenceImages: JSON.stringify(input.referenceImages ?? []),
        status: "failed", images: "[]", error: message, createdAt, completedAt,
      });
      return reply.code(502).send({ error: message, id });
    } finally {
      req.raw.removeListener("aborted", abort);
    }
  });

  app.get<{ Params: { filename: string } }>("/api/images/assets/:filename", async (req, reply) => {
    if (!/^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(req.params.filename)) return reply.notFound();
    const filePath = path.join(imagesDir, req.params.filename);
    try {
      const bytes = await fs.readFile(filePath);
      const ext = path.extname(filePath).slice(1);
      const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
      return reply.type(type).send(bytes);
    } catch {
      return reply.notFound();
    }
  });

  app.delete<{ Params: { id: string } }>("/api/images/generations/:id", async (req, reply) => {
    const row = (await db.select().from(imageGenerations).where(eq(imageGenerations.id, req.params.id)))[0];
    if (!row) return reply.notFound();
    const generation = rowToGeneration(row);
    await Promise.all(generation.images.map((image) => fs.rm(path.join(imagesDir, path.basename(image.url)), { force: true })));
    await db.delete(imageGenerations).where(eq(imageGenerations.id, req.params.id));
    return { ok: true };
  });
}
