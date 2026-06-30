import type { ToolDefinition } from "@yudu/shared";
import type { ToolHandler } from "./index.js";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Fetch a URL's body. Two safety nets:
//   1. The host must be in the YUDU_HTTP_FETCH_ALLOW env (comma-separated).
//   2. The resolved IP must not be a private/loopback range.
// The allowlist is intentionally strict so the tool can ship by default
// without leaking requests to arbitrary hosts.
const def: ToolDefinition = {
  name: "http_fetch",
  description:
    "Fetch a URL and return its text body. The host must be on the " +
    "YUDU_HTTP_FETCH_ALLOW allowlist. Useful for reading documentation " +
    "or short public pages.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Absolute http:// or https:// URL to fetch.",
      },
      max_bytes: {
        type: "integer",
        description: "Maximum response body size in bytes (default 8192).",
      },
    },
    required: ["url"],
  },
};

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 0) return true;
  // IPv4 ranges that must not be hit.
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
  }
  // IPv6: anything that doesn't look like a public global unicast address.
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
  }
  return false;
}

const handler: ToolHandler = async (args, ctx) => {
  const url = (args as { url?: unknown })?.url;
  const maxBytesRaw = (args as { max_bytes?: unknown })?.max_bytes;
  if (typeof url !== "string" || url.length === 0) {
    return { content: "missing 'url' argument", isError: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { content: `invalid url: ${url}`, isError: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { content: `unsupported protocol: ${parsed.protocol}`, isError: true };
  }

  const allow = (process.env.YUDU_HTTP_FETCH_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0 || !allow.includes(parsed.hostname.toLowerCase())) {
    return {
      content: `host '${parsed.hostname}' not in YUDU_HTTP_FETCH_ALLOW`,
      isError: true,
    };
  }

  let addresses: { address: string; family: number }[];
  try {
    const addrs = await lookup(parsed.hostname, { all: true });
    if (!addrs.length) {
      return { content: `DNS lookup returned no addresses for ${parsed.hostname}`, isError: true };
    }
    addresses = addrs;
  } catch (err: any) {
    return { content: `DNS lookup failed: ${err?.message ?? err}`, isError: true };
  }
  for (const a of addresses) {
    if (isPrivateIp(a.address)) {
      return {
        content: `refused: ${parsed.hostname} resolves to private IP ${a.address}`,
        isError: true,
      };
    }
  }

  const maxBytes =
    typeof maxBytesRaw === "number" && maxBytesRaw > 0
      ? Math.min(maxBytesRaw, 65536)
      : 8192;

  const ac = new AbortController();
  ctx.signal?.addEventListener("abort", () => ac.abort());

  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      return { content: `HTTP ${res.status} ${res.statusText}`, isError: true };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return { content: "no body", isError: true };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        chunks.push(value.subarray(0, Math.max(0, maxBytes - (total - value.byteLength))));
        break;
      }
      chunks.push(value);
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = chunks.map((c) => decoder.decode(c, { stream: true })).join("");
    return { content: text };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { content: "aborted", isError: true };
    }
    return { content: `fetch failed: ${err?.message ?? err}`, isError: true };
  }
};

export const http_fetch = { def, handler };
