import type { ExportedConversation } from "@yudu/shared";

// ---------- Markdown ----------

/** Best-effort plain-text rendering of one content part. */
function partToText(part: any): string {
  if (!part) return "";
  switch (part.type) {
    case "text":
      return String(part.text ?? "");
    case "reasoning":
      return `> _Thinking:_ ${part.text ?? ""}\n`;
    case "image_url":
      return `[image](${part.image_url?.url ?? ""})`;
    case "document":
      return `[document: ${part.name}]`;
    case "tool_call":
      return `> _Tool call:_ **${part.name}** (\`${JSON.stringify(part.arguments)}\`)`;
    case "tool_result":
      return `> _Tool result (${part.isError ? "error" : "ok"}):_ ${part.content}`;
    default:
      return "";
  }
}

function messageBody(m: any): string {
  if (Array.isArray(m.parts) && m.parts.length) {
    return m.parts.map(partToText).join("\n\n").trim();
  }
  return String(m.content ?? "").trim();
}

/**
 * Render an exported conversation as a readable Markdown transcript. The
 * layout is "### ROLE (timestamp)" + body, matching the structure of a
 * typical chat log; reasoning parts and tool calls are quoted so they
 * read as auxiliary material rather than primary content.
 */
export function exportToMarkdown(conv: ExportedConversation): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title || "Conversation"}`);
  lines.push("");
  lines.push(`*Provider:* ${conv.provider}  `);
  lines.push(`*Model:* ${conv.model}  `);
  if (conv.agentId) lines.push(`*Agent:* ${conv.agentId}  `);
  lines.push(`*Exported at:* ${conv.exportedAt}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of conv.messages ?? []) {
    const ts = new Date(m.createdAt).toISOString();
    lines.push(`### ${m.role.toUpperCase()} — ${ts}`);
    lines.push("");
    lines.push(messageBody(m) || "(empty)");
    if (m.promptTokens != null || m.completionTokens != null) {
      const p = m.promptTokens ?? 0;
      const c = m.completionTokens ?? 0;
      lines.push("");
      lines.push(`*Tokens:* ${p}↑ ${c}↓`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- PNG ----------

/**
 * Render a conversation to a PNG by drawing the transcript into a
 * fixed-width canvas. The canvas is sized for the message list and
 * returns a Blob the caller can save to disk. We use a width of 880
 * and a per-message padded box, so the resulting image is legible at
 * default zoom and small enough to attach to an issue / share.
 */
export async function exportToPng(
  conv: ExportedConversation,
  opts: { scale?: number; background?: string } = {},
): Promise<Blob> {
  const scale = Math.max(1, Math.min(opts.scale ?? 2, 4));
  const bg = opts.background ?? "#ffffff";
  const W = 880;
  const PAD = 24;
  const ROLE_W = 90;
  const BODY_W = W - PAD * 2 - ROLE_W - 8;
  const fontBody = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
  const fontMeta = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
  const fontTitle = "20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

  // Measure and lay out messages.
  type Block =
    | { kind: "title"; text: string; meta: string }
    | { kind: "message"; role: string; ts: string; body: string; meta?: string };
  const blocks: Block[] = [];
  blocks.push({
    kind: "title",
    text: conv.title || "Conversation",
    meta: `${conv.provider} / ${conv.model}  •  exported ${new Date(conv.exportedAt).toLocaleString()}`,
  });
  for (const m of conv.messages ?? []) {
    const body = messageBody(m) || "(empty)";
    const meta =
      m.promptTokens != null || m.completionTokens != null
        ? `${m.promptTokens ?? 0}↑ ${m.completionTokens ?? 0}↓`
        : undefined;
    blocks.push({
      kind: "message",
      role: m.role,
      ts: new Date(m.createdAt).toLocaleString(),
      body,
      meta,
    });
  }

  // Pre-create a measuring canvas for line wrap.
  const measure = document.createElement("canvas");
  const mctx = measure.getContext("2d")!;

  function wrap(text: string, font: string, maxW: number): string[] {
    mctx.font = font;
    const out: string[] = [];
    for (const paragraph of text.split(/\n/)) {
      if (!paragraph) {
        out.push("");
        continue;
      }
      const words = paragraph.split(/(\s+)/);
      let line = "";
      for (const w of words) {
        const trial = line + w;
        if (mctx.measureText(trial).width > maxW && line) {
          out.push(line);
          line = w.trimStart();
        } else {
          line = trial;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  const lineH = 18;
  let totalH = PAD;
  for (const b of blocks) {
    if (b.kind === "title") {
      mctx.font = fontTitle;
      const titleLines = wrap(b.text, fontTitle, W - PAD * 2);
      totalH += titleLines.length * 26 + 6;
      mctx.font = fontMeta;
      const metaLines = wrap(b.meta, fontMeta, W - PAD * 2);
      totalH += metaLines.length * 14 + 24;
    } else {
      mctx.font = fontBody;
      const roleLines = wrap(b.role.toUpperCase(), fontBody, ROLE_W);
      const tsLines = wrap(b.ts, fontMeta, ROLE_W);
      const bodyLines = wrap(b.body, fontBody, BODY_W);
      const metaLines = b.meta ? wrap(b.meta, fontMeta, BODY_W) : [];
      const innerH =
        Math.max(roleLines.length + tsLines.length, bodyLines.length + (metaLines.length || 0)) * lineH;
      totalH += innerH + 16;
    }
  }
  totalH += PAD;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  // Background.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, totalH);
  // Body styles.
  ctx.textBaseline = "top";
  ctx.fillStyle = "#0f172a";
  let y = PAD;
  for (const b of blocks) {
    if (b.kind === "title") {
      ctx.font = fontTitle;
      const titleLines = wrap(b.text, fontTitle, W - PAD * 2);
      ctx.fillStyle = "#0f172a";
      for (const l of titleLines) {
        ctx.fillText(l, PAD, y);
        y += 26;
      }
      y += 6;
      ctx.font = fontMeta;
      ctx.fillStyle = "#64748b";
      const metaLines = wrap(b.meta, fontMeta, W - PAD * 2);
      for (const l of metaLines) {
        ctx.fillText(l, PAD, y);
        y += 14;
      }
      y += 24;
    } else {
      // Role + timestamp column.
      ctx.font = fontBody;
      ctx.fillStyle = "#334155";
      const roleLines = wrap(b.role.toUpperCase(), fontBody, ROLE_W);
      let ry = y;
      for (const l of roleLines) {
        ctx.fillText(l, PAD, ry);
        ry += lineH;
      }
      ctx.font = fontMeta;
      ctx.fillStyle = "#94a3b8";
      const tsLines = wrap(b.ts, fontMeta, ROLE_W);
      for (const l of tsLines) {
        ctx.fillText(l, PAD, ry);
        ry += lineH;
      }
      // Body column.
      ctx.font = fontBody;
      ctx.fillStyle = "#0f172a";
      const bodyLines = wrap(b.body, fontBody, BODY_W);
      let by = y;
      for (const l of bodyLines) {
        ctx.fillText(l, PAD + ROLE_W + 8, by);
        by += lineH;
      }
      if (b.meta) {
        ctx.font = fontMeta;
        ctx.fillStyle = "#94a3b8";
        const metaLines = wrap(b.meta, fontMeta, BODY_W);
        for (const l of metaLines) {
          ctx.fillText(l, PAD + ROLE_W + 8, by);
          by += lineH;
        }
      }
      const innerH = Math.max(
        roleLines.length + tsLines.length,
        bodyLines.length + (b.meta ? wrap(b.meta, fontMeta, BODY_W).length : 0),
      ) * lineH;
      y += innerH + 16;
    }
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

// ---------- Generic helpers ----------

/** Trigger a browser download for the given Blob with the suggested name. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function safeFilename(input: string, fallback: string): string {
  const cleaned = (input || fallback).replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60);
  return cleaned || fallback;
}
