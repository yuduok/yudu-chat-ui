import type {
  AgentProfile,
  ChatMessage,
  Conversation,
  ConversationWithMessages,
  ExportedConversation,
  ProviderConfig,
  StreamEvent,
  ChatRequest,
  ContentPart,
  ImageGeneration,
  ImageGenerationCapabilities,
  ImageGenerationRequest,
  SkillDefinition,
  UsageReport,
} from "@yudu/shared";

// Web uses the same-origin Vite proxy. The desktop build asks the Tauri shell
// which loopback port its sidecar actually owns, then waits for the health
// endpoint before releasing the first API request.
let cachedBase = "/api";
let basePromise: Promise<string> | null = null;

interface DesktopServerStatus {
  running: boolean;
  port: number;
  healthToken: string;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const runtime = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(runtime.__TAURI_INTERNALS__ || runtime.__TAURI__);
}

async function resolveApiBase(): Promise<string> {
  if (!isTauriRuntime()) return cachedBase;
  if (basePromise) return basePromise;
  basePromise = (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    let lastError: unknown;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const status = await invoke<DesktopServerStatus>("server_status");
        if (!status.running) {
          lastError = new Error("desktop sidecar is not running yet");
          await new Promise((resolve) => window.setTimeout(resolve, 100));
          continue;
        }
        if (!Number.isInteger(status.port) || status.port < 1 || status.port > 65535) {
          throw new Error(`Desktop sidecar returned an invalid port: ${status.port}`);
        }
        const base = `http://127.0.0.1:${status.port}/api`;
        const healthController = new AbortController();
        const healthTimeout = window.setTimeout(() => healthController.abort(), 750);
        let response: Response;
        let payload: { ok?: boolean; token?: string } | null;
        try {
          response = await fetch(`${base}/health`, {
            cache: "no-store",
            headers: status.healthToken
              ? { "x-yudu-health-token": status.healthToken }
              : undefined,
            signal: healthController.signal,
          });
          payload = await response.json().catch(() => null) as {
            ok?: boolean;
            token?: string;
          } | null;
        } finally {
          window.clearTimeout(healthTimeout);
        }
        const tokenMatches = !status.healthToken || payload?.token === status.healthToken;
        if (response.ok && payload?.ok === true && tokenMatches) {
          cachedBase = base;
          return base;
        }
        lastError = new Error(`health check failed or identity mismatched: ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw new Error(`Desktop sidecar did not become ready: ${String(lastError)}`);
  })().catch((error) => {
    basePromise = null;
    throw error;
  });
  return basePromise;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await resolveApiBase();
  try {
    return await fetch(`${base}${path}`, init);
  } catch (error) {
    if (!isTauriRuntime() || init?.signal?.aborted) throw error;
    // A release sidecar may reselect its port after an early bind failure.
    // Refresh status instead of pinning later requests to stale state. Only
    // replay read-only requests: a failed POST may already have committed and
    // retrying it could duplicate conversations, messages, or image jobs.
    cachedBase = "/api";
    basePromise = null;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw error;
    const retryBase = await resolveApiBase();
    return fetch(`${retryBase}${path}`, init);
  }
}

export function apiAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (cachedBase === "/api") return url;
  return `${cachedBase.replace(/\/api$/, "")}${url}`;
}

export async function listConversations(): Promise<Conversation[]> {
  const r = await apiFetch("/conversations");
  if (!r.ok) throw new Error("listConversations failed");
  return r.json();
}

export async function createConversation(input: {
  title?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  agentId?: string | null;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | null;
  showThinking?: boolean | null;
}): Promise<Conversation> {
  const r = await apiFetch("/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("createConversation failed");
  return r.json();
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const r = await apiFetch(`/conversations/${id}`);
  if (!r.ok) throw new Error("getConversation failed");
  return r.json();
}

export async function updateConversation(
  id: string,
  patch: Partial<
    Pick<
      Conversation,
      | "title"
      | "provider"
      | "model"
      | "systemPrompt"
      | "temperature"
      | "agentId"
      | "reasoningEffort"
      | "showThinking"
    >
  >,
): Promise<Conversation> {
  const r = await apiFetch(`/conversations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("updateConversation failed");
  return r.json();
}

// Apply a settings patch to every conversation row in one round
// trip. Used by the global "settings are global" flow: a single
// provider / model / agent / reasoning-depth / show-thinking
// change in any tab is propagated to every existing chat so the
// user never has to re-pick the same model when they switch tabs.
export async function applyGlobalConversationSettings(
  patch: Partial<
    Pick<
      Conversation,
      "provider" | "model" | "agentId" | "reasoningEffort" | "showThinking"
    >
  >,
): Promise<Conversation[]> {
  const r = await apiFetch("/conversations/all", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("applyGlobalConversationSettings failed");
  const data = (await r.json()) as { conversations: Conversation[] };
  return data.conversations ?? [];
}

export async function deleteConversation(id: string): Promise<void> {
  const r = await apiFetch(`/conversations/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("deleteConversation failed");
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<string[]> {
  const r = await apiFetch(`/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("deleteMessage failed");
  const payload = await r.json() as { deletedIds?: string[] };
  return payload.deletedIds ?? [messageId];
}

export async function cancelChat(requestId: string): Promise<void> {
  const r = await apiFetch("/chat/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  if (!r.ok) throw new Error("cancelChat failed");
}

// Fetch the full exported JSON document for a conversation. Returns the
// raw JSON text so the client can either save it as-is or transform it
// (markdown / png) before download.
export async function exportConversation(id: string): Promise<ExportedConversation> {
  const r = await apiFetch(`/conversations/${id}/export`);
  if (!r.ok) throw new Error("exportConversation failed");
  return r.json();
}

// Send a previously-downloaded JSON export to the server. Returns the
// newly-created conversation row.
export async function importConversation(payload: unknown): Promise<Conversation> {
  const r = await apiFetch("/conversations/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await r.json());
    } catch {
      detail = await r.text();
    }
    throw new Error(`importConversation failed: ${detail}`);
  }
  return r.json();
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const r = await apiFetch("/providers");
  if (!r.ok) throw new Error("listProviders failed");
  return r.json();
}

export async function listAgents(): Promise<AgentProfile[]> {
  const r = await apiFetch("/agents");
  if (!r.ok) throw new Error("listAgents failed");
  return r.json();
}

export async function uploadAttachment(file: File): Promise<ContentPart> {
  const form = new FormData();
  form.append("file", file);
  const r = await apiFetch("/uploads", { method: "POST", body: form });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "upload failed");
  const payload = await r.json() as { attachment: ContentPart };
  return payload.attachment;
}

export async function getImageCapabilities(): Promise<Array<{ provider: string; label?: string; capabilities: ImageGenerationCapabilities }>> {
  const r = await apiFetch("/images/capabilities");
  if (!r.ok) throw new Error("getImageCapabilities failed");
  return r.json();
}

export async function listImageGenerations(): Promise<ImageGeneration[]> {
  const r = await apiFetch("/images/generations");
  if (!r.ok) throw new Error("listImageGenerations failed");
  return r.json();
}

export async function createImageGeneration(input: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGeneration> {
  const r = await apiFetch("/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!r.ok) {
    const payload = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `image generation failed (${r.status})`);
  }
  return r.json();
}

export async function deleteImageGeneration(id: string): Promise<void> {
  const r = await apiFetch(`/images/generations/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("deleteImageGeneration failed");
}

export interface ProviderModels {
  provider: string;
  baseUrl: string | null;
  defaults: string[];
  manual: string[];
  models: string[];
  source: "remote" | "fallback";
  error?: string;
}

export async function getProviderModels(
  id: string,
  opts: { remote?: boolean } = {},
): Promise<ProviderModels> {
  const qs = opts.remote ? "?remote=1" : "";
  const r = await apiFetch(`/providers/${encodeURIComponent(id)}/models${qs}`);
  if (!r.ok) throw new Error("getProviderModels failed");
  return r.json();
}

export interface Settings {
  providers: Record<string, { name?: string; apiKeyMasked?: string; baseUrl?: string; manualModels: string[] }>;
  imageProviders: Record<string, { name?: string; apiKeyMasked?: string; baseUrl?: string; model?: string }>;
  ui: { theme: "light" | "dark" | "system" };
  skills: { enabled: boolean };
}

export async function getSettings(): Promise<Settings> {
  const r = await apiFetch("/settings");
  if (!r.ok) throw new Error("getSettings failed");
  return r.json();
}

export async function saveSettings(input: {
  providers: Record<string, { name?: string | null; apiKey?: string | null; baseUrl?: string | null; manualModels?: string[]; copyFrom?: string } | null>;
  imageProviders?: Record<string, { name?: string | null; apiKey?: string | null; baseUrl?: string | null; model?: string | null; copyFrom?: string } | null>;
  ui?: { theme?: "light" | "dark" | "system" };
  skills?: { enabled?: boolean };
}): Promise<Settings> {
  const r = await apiFetch("/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("saveSettings failed");
  return r.json();
}

export async function listSkills(): Promise<SkillDefinition[]> {
  const r = await apiFetch("/skills");
  if (!r.ok) throw new Error("listSkills failed");
  return r.json();
}

export async function importSkill(input: { name: string; description?: string; content: string }): Promise<SkillDefinition> {
  const r = await apiFetch("/skills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "importSkill failed");
  return r.json();
}

export async function importSkillFile(file: File): Promise<SkillDefinition> {
  const body = new FormData();
  body.append("file", file);
  const r = await apiFetch("/skills/import", { method: "POST", body });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "importSkillFile failed");
  return r.json();
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillDefinition> {
  const r = await apiFetch(`/skills/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error("setSkillEnabled failed");
  return r.json();
}

export async function deleteSkill(id: string): Promise<void> {
  const r = await apiFetch(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error("deleteSkill failed");
}

// Aggregate token usage across every persisted conversation. Token counts
// come from assistant messages only (user / tool / system never carry them).
export async function getUsage(): Promise<UsageReport> {
  const r = await apiFetch("/usage");
  if (!r.ok) throw new Error("getUsage failed");
  return r.json();
}

export type { ChatMessage };

export interface StreamCallbacks {
  onToolCall?: (call: {
    id: string;
    name: string;
    arguments: Record<string, unknown> | string;
  }) => void;
  onToolResult?: (result: {
    toolCallId: string;
    agentId?: string;
    content: string;
    isError?: boolean;
  }) => void;
  onAgentEvent?: (event: {
    kind: "started" | "finished";
    agentId: string;
    label: string;
  }) => void;
}

export async function* streamChat(
  req: ChatRequest,
  signal: AbortSignal,
  callbacks: StreamCallbacks = {},
): AsyncGenerator<StreamEvent, void, void> {
  const r = await apiFetch("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    throw new Error(`Chat failed: ${r.status} ${text || r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload) as StreamEvent;
          // Dispatch side-channel callbacks alongside the streamed event so
          // callers can update tool/agent UI without re-matching types.
          if (ev.type === "tool_call") callbacks.onToolCall?.(ev.call);
          else if (ev.type === "tool_result") callbacks.onToolResult?.(ev);
          else if (ev.type === "agent_started") callbacks.onAgentEvent?.({ kind: "started", ...ev });
          else if (ev.type === "agent_finished") callbacks.onAgentEvent?.({ kind: "finished", ...ev });
          yield ev;
          if (ev.type === "done" || ev.type === "error") return;
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
}
