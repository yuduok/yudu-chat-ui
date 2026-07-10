import path from "node:path";
import { unzipSync, type UnzipFileInfo } from "fflate";
import { parseDocument } from "yaml";

export interface ParsedSkillFile {
  name: string;
  description?: string;
  content: string;
}

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_ARCHIVE_EXPANDED_BYTES = 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_COMPRESSION_RATIO = 100;

function fileStem(filename: string): string {
  return path.basename(filename).replace(/\.(json|md|markdown|zip)$/i, "") || "Imported skill";
}

function decodeUtf8(input: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(input).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function stringField(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function parseJson(input: Uint8Array, fallbackName: string): ParsedSkillFile {
  const parsed = JSON.parse(decodeUtf8(input)) as Record<string, unknown>;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("skill JSON must be an object");
  const name = stringField(parsed.name, "name") ?? fallbackName;
  const description = stringField(parsed.description, "description");
  const content = stringField(parsed.content, "content") ?? stringField(parsed.instructions, "instructions") ?? "";
  return { name, description, content };
}

function parseMarkdown(input: Uint8Array, fallbackName: string): ParsedSkillFile {
  const markdown = decodeUtf8(input);
  if (!markdown.startsWith("---\n")) return { name: fallbackName, content: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("skill frontmatter is not closed");
  const document = parseDocument(markdown.slice(4, end), { schema: "core", uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`invalid skill frontmatter: ${document.errors[0].message}`);
  const metadata = document.toJS() as Record<string, unknown> | null;
  if (metadata !== null && (Array.isArray(metadata) || typeof metadata !== "object")) throw new Error("skill frontmatter must be an object");
  const name = stringField(metadata?.name, "name") ?? fallbackName;
  const description = stringField(metadata?.description, "description");
  return { name, description, content: markdown.slice(end + 5) };
}

function validateArchivePath(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("ZIP contains an unsafe path");
  }
  if (normalized.split("/").some((segment) => segment === "..")) throw new Error("ZIP contains an unsafe path");
}

function parseZip(input: Uint8Array, fallbackName: string): ParsedSkillFile {
  if (input.byteLength > MAX_ARCHIVE_BYTES) throw new Error("skill ZIP exceeds the 2 MB limit");
  let entries = 0;
  let expandedBytes = 0;
  let skillEntries = 0;
  const seen = new Set<string>();
  const files = unzipSync(input, {
    filter(info: UnzipFileInfo) {
      entries += 1;
      if (entries > MAX_ARCHIVE_ENTRIES) throw new Error("skill ZIP contains too many entries");
      validateArchivePath(info.name);
      const foldedName = info.name.replace(/\\/g, "/").toLocaleLowerCase();
      if (seen.has(foldedName)) throw new Error("skill ZIP contains duplicate paths");
      seen.add(foldedName);
      expandedBytes += info.originalSize;
      if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error("skill ZIP expands beyond the 1 MB limit");
      if (info.size > 0 && info.originalSize / info.size > MAX_COMPRESSION_RATIO) throw new Error("skill ZIP compression ratio is too high");
      const isSkill = foldedName === "skill.md" || foldedName.endsWith("/skill.md");
      if (!isSkill) return false;
      skillEntries += 1;
      if (skillEntries > 1) throw new Error("skill ZIP must contain exactly one SKILL.md");
      if (info.originalSize > MAX_SKILL_FILE_BYTES) throw new Error("SKILL.md exceeds the 256 KB limit");
      return true;
    },
  });
  const skillFile = Object.entries(files).find(([name]) => name.toLocaleLowerCase() === "skill.md" || name.toLocaleLowerCase().endsWith("/skill.md"));
  if (!skillFile || skillEntries !== 1) throw new Error("skill ZIP must contain exactly one SKILL.md");
  return parseMarkdown(skillFile[1], fallbackName);
}

export function parseSkillFile(filename: string, input: Uint8Array): ParsedSkillFile {
  const extension = path.extname(filename).toLocaleLowerCase();
  const fallbackName = fileStem(filename);
  if (extension === ".json") return parseJson(input, fallbackName);
  if (extension === ".md" || extension === ".markdown") return parseMarkdown(input, fallbackName);
  if (extension === ".zip") {
    if (input[0] !== 0x50 || input[1] !== 0x4b) throw new Error("invalid skill ZIP signature");
    return parseZip(input, fallbackName);
  }
  throw new Error("unsupported skill file type");
}
