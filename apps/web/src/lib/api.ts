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

// Resolve API base:在 Tauri 桌面模式下直接走 loopback 端口(与 WebView 不同 origin);
// Web 模式下保留相对路径 /api,由 Vite 代理到 127.0.0.1:8787。
function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) return "http://127.0.0.1:8787/api";
  }
  return "/api";
}
const BASE = resolveApiBase();

export function apiAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (BASE === "/api") return url;
  return `${BASE.replace(/\/api$/, "")}${url}`;
}

export async function listConversations(): Promise<Conversation[]> {
  const r = await fetch(`${BASE}/conversations`);
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
  const r = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("createConversation failed");
  return r.json();
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const r = await fetch(`${BASE}/conversations/${id}`);
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
  const r = await fetch(`${BASE}/conversations/${id}`, {
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
  const r = await fetch(`${BASE}/conversations/all`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("applyGlobalConversationSettings failed");
  const data = (await r.json()) as { conversations: Conversation[] };
  return data.conversations ?? [];
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`${BASE}/conversations/${id}`, { method: "DELETE" });
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  await fetch(`${BASE}/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
}

// Fetch the full exported JSON document for a conversation. Returns the
// raw JSON text so the client can either save it as-is or transform it
// (markdown / png) before download.
export async function exportConversation(id: string): Promise<ExportedConversation> {
  const r = await fetch(`${BASE}/conversations/${id}/export`);
  if (!r.ok) throw new Error("exportConversation failed");
  return r.json();
}

// Send a previously-downloaded JSON export to the server. Returns the
// newly-created conversation row.
export async function importConversation(payload: unknown): Promise<Conversation> {
  const r = await fetch(`${BASE}/conversations/import`, {
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
  const r = await fetch(`${BASE}/providers`);
  if (!r.ok) throw new Error("listProviders failed");
  return r.json();
}

export async function listAgents(): Promise<AgentProfile[]> {
  const r = await fetch(`${BASE}/agents`);
  if (!r.ok) throw new Error("listAgents failed");
  return r.json();
}

export async function uploadAttachment(file: File): Promise<ContentPart> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${BASE}/uploads`, { method: "POST", body: form });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "upload failed");
  const payload = await r.json() as { attachment: ContentPart };
  return payload.attachment;
}

export async function getImageCapabilities(): Promise<Array<{ provider: string; capabilities: ImageGenerationCapabilities }>> {
  const r = await fetch(`${BASE}/images/capabilities`);
  if (!r.ok) throw new Error("getImageCapabilities failed");
  return r.json();
}

export async function listImageGenerations(): Promise<ImageGeneration[]> {
  const r = await fetch(`${BASE}/images/generations`);
  if (!r.ok) throw new Error("listImageGenerations failed");
  return r.json();
}

export async function createImageGeneration(input: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGeneration> {
  const r = await fetch(`${BASE}/images/generations`, {
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
  const r = await fetch(`${BASE}/images/generations/${id}`, { method: "DELETE" });
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
  const r = await fetch(`${BASE}/providers/${encodeURIComponent(id)}/models${qs}`);
  if (!r.ok) throw new Error("getProviderModels failed");
  return r.json();
}

export interface Settings {
  providers: Record<string, { apiKeyMasked?: string; baseUrl?: string; manualModels: string[] }>;
  imageProviders: Record<string, { apiKeyMasked?: string; baseUrl?: string; model?: string }>;
  ui: { theme: "light" | "dark" | "system" };
  skills: { enabled: boolean };
}

export async function getSettings(): Promise<Settings> {
  const r = await fetch(`${BASE}/settings`);
  if (!r.ok) throw new Error("getSettings failed");
  return r.json();
}

export async function saveSettings(input: {
  providers: Record<string, { apiKey?: string | null; baseUrl?: string | null; manualModels?: string[] }>;
  imageProviders?: Record<string, { apiKey?: string | null; baseUrl?: string | null; model?: string | null }>;
  ui?: { theme?: "light" | "dark" | "system" };
  skills?: { enabled?: boolean };
}): Promise<Settings> {
  const r = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("saveSettings failed");
  return r.json();
}

export async function listSkills(): Promise<SkillDefinition[]> {
  const r = await fetch(`${BASE}/skills`);
  if (!r.ok) throw new Error("listSkills failed");
  return r.json();
}

export async function importSkill(input: { name: string; description?: string; content: string }): Promise<SkillDefinition> {
  const r = await fetch(`${BASE}/skills`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || "importSkill failed");
  return r.json();
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<SkillDefinition> {
  const r = await fetch(`${BASE}/skills/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error("setSkillEnabled failed");
  return r.json();
}

export async function deleteSkill(id: string): Promise<void> {
  const r = await fetch(`${BASE}/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error("deleteSkill failed");
}

// Aggregate token usage across every persisted conversation. Token counts
// come from assistant messages only (user / tool / system never carry them).
export async function getUsage(): Promise<UsageReport> {
  const r = await fetch(`${BASE}/usage`);
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
  const r = await fetch(`${BASE}/chat`, {
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
