import type { ImageGenerationCapabilities, ImageGenerationRequest } from "@yudu/shared";

export interface ImageProviderOutput {
  images: Array<{ bytes: Buffer; mimeType: string; revisedPrompt?: string }>;
}

export interface ImageProvider {
  id: string;
  capabilities: ImageGenerationCapabilities;
  generate(input: ImageGenerationRequest, config: { apiKey?: string; baseUrl?: string; signal?: AbortSignal }): Promise<ImageProviderOutput>;
}

export const openAIImageCapabilities: ImageGenerationCapabilities = {
  models: ["gpt-image-2"],
  sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
  qualities: ["auto", "low", "medium", "high", "standard", "hd"],
  styles: [],
  outputFormats: ["png", "jpeg", "webp"],
  backgrounds: ["auto", "transparent", "opaque"],
  moderations: ["auto", "low"],
  supportsOutputCompression: true,
  maxImages: 4,
  maxReferenceImages: 4,
  supportsReferenceImages: true,
};

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("invalid reference image data URL");
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

async function responseImages(response: Response, outputFormat: string): Promise<ImageProviderOutput> {
  const text = await response.text();
  if (!response.ok) throw new Error(`Image API ${response.status}: ${text || response.statusText}`);
  const payload = JSON.parse(text) as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> };
  const images = await Promise.all((payload.data ?? []).map(async (item) => {
    if (item.b64_json) return {
      bytes: Buffer.from(item.b64_json, "base64"),
      mimeType: outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png",
      revisedPrompt: item.revised_prompt,
    };
    if (item.url) {
      const imageResponse = await fetch(item.url);
      if (!imageResponse.ok) throw new Error(`Generated image download failed (${imageResponse.status})`);
      return {
        bytes: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType: imageResponse.headers.get("content-type")?.split(";")[0] || "image/png",
        revisedPrompt: item.revised_prompt,
      };
    }
    throw new Error("Image API returned an empty image item");
  }));
  if (!images.length) throw new Error("Image API returned no images");
  return { images };
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(public id: string) {}
  capabilities = openAIImageCapabilities;

  async generate(input: ImageGenerationRequest, config: { apiKey?: string; baseUrl?: string; signal?: AbortSignal }): Promise<ImageProviderOutput> {
    if (!config.apiKey) throw new Error(`No API key configured for provider "${this.id}".`);
    const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const references = input.referenceImages ?? [];
    if (references.length) {
      const form = new FormData();
      form.append("model", input.model);
      form.append("prompt", input.prompt);
      form.append("n", String(input.count));
      if (input.size !== "auto") form.append("size", input.size);
      if (input.quality !== "auto") form.append("quality", input.quality);
      if (input.outputFormat) form.append("output_format", input.outputFormat);
      if (input.background && input.background !== "auto") form.append("background", input.background);
      if (input.moderation && input.moderation !== "auto") form.append("moderation", input.moderation);
      if (input.outputFormat !== "png" && input.outputCompression !== undefined) form.append("output_compression", String(input.outputCompression));
      references.forEach((reference) => {
        const parsed = parseDataUrl(reference.dataUrl);
        form.append("image[]", new Blob([Uint8Array.from(parsed.bytes)], { type: parsed.mimeType }), reference.name);
      });
      return responseImages(await fetch(`${baseUrl}/images/edits`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: config.signal,
      }), input.outputFormat);
    }
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      n: input.count,
      response_format: "b64_json",
    };
    if (input.size !== "auto") body.size = input.size;
    if (input.quality !== "auto") body.quality = input.quality;
    if (input.style && input.style !== "auto") body.style = input.style;
    if (input.outputFormat) body.output_format = input.outputFormat;
    if (input.background && input.background !== "auto") body.background = input.background;
    if (input.moderation && input.moderation !== "auto") body.moderation = input.moderation;
    if (input.outputFormat !== "png" && input.outputCompression !== undefined) body.output_compression = input.outputCompression;
    return responseImages(await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: config.signal,
    }), input.outputFormat);
  }
}

export class MockImageProvider implements ImageProvider {
  id = "mock";
  capabilities: ImageGenerationCapabilities = {
    ...openAIImageCapabilities,
    models: ["mock-image-1"],
    styles: ["auto", "natural", "vivid"],
  };
  async generate(input: ImageGenerationRequest): Promise<ImageProviderOutput> {
    const color = input.referenceImages?.length ? "7c3aed" : "2563eb";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#${color}"/><text x="50%" y="46%" text-anchor="middle" fill="white" font-family="sans-serif" font-size="42">Yudu Image Studio</text><text x="50%" y="53%" text-anchor="middle" fill="white" font-family="sans-serif" font-size="22">${input.prompt.replace(/[<>&]/g, "").slice(0, 80)}</text></svg>`;
    return { images: Array.from({ length: input.count }, () => ({ bytes: Buffer.from(svg), mimeType: "image/svg+xml" })) };
  }
}

const imageProviders: Record<string, ImageProvider> = {
  openai: new OpenAIImageProvider("openai"),
  custom: new OpenAIImageProvider("custom"),
  mock: new MockImageProvider(),
};

export function getImageProvider(id: string): ImageProvider | undefined { return imageProviders[id]; }
export function listImageProviders(): ImageProvider[] { return Object.values(imageProviders); }
