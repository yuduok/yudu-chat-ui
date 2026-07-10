import type { FastifyInstance } from "fastify";
import mammoth from "mammoth";
import pdf from "pdf-parse";
import type { ContentPart } from "@yudu/shared";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
]);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_EXTRACTED_CHARS = 120_000;

function hasImageSignature(mimetype: string, buffer: Buffer): boolean {
  if (mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === "image/gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mimetype === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function normalizeText(text: string): string {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (cleaned.length <= MAX_EXTRACTED_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Document truncated at ${MAX_EXTRACTED_CHARS} characters]`;
}

export async function attachmentFromBuffer(input: {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<ContentPart> {
  const { filename, mimetype, buffer } = input;
  if (IMAGE_TYPES.has(mimetype)) {
    if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("image exceeds the 8 MB limit");
    if (!hasImageSignature(mimetype, buffer)) throw new Error("image content does not match its MIME type");
    return {
      type: "image_url",
      image_url: { url: `data:${mimetype};base64,${buffer.toString("base64")}` },
      name: filename,
      mimeType: mimetype,
      size: buffer.byteLength,
    };
  }

  if (buffer.byteLength > 20 * 1024 * 1024) throw new Error("document exceeds the 20 MB limit");

  let text: string;
  if (mimetype === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    text = (await pdf(buffer)).text;
  } else if (mimetype === DOCX_TYPE || filename.toLowerCase().endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (TEXT_TYPES.has(mimetype) || mimetype.startsWith("text/")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`unsupported attachment type: ${mimetype || filename}`);
  }
  const normalized = normalizeText(text);
  if (!normalized) throw new Error("document contains no extractable text");
  return { type: "document", name: filename, mimeType: mimetype, size: buffer.byteLength, text: normalized };
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/uploads", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.badRequest("missing file");
    try {
      return {
        attachment: await attachmentFromBuffer({
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        }),
      };
    } catch (error: any) {
      return reply.unsupportedMediaType(error?.message ?? String(error));
    }
  });
}
