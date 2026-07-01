import { create } from "zustand";

/**
 * Global "new conversation" defaults.
 *
 * The chat store keeps `provider / model / agentId / reasoningEffort /
 * showThinking` on each `Conversation` row so an old conversation can
 * keep its own settings. But when the user clicks *New chat* we want
 * the new tab to inherit whatever they last picked, not silently
 * fall back to the mock provider.
 *
 * This store is the single source of truth for those defaults. It is
 * persisted to `localStorage` (matching the pattern used by
 * `useTheme` and the i18n locale) so the user's last choice survives
 * a reload. Each setter mirrors that change into the active
 * conversation as well, so toggling the provider menu in tab A and
 * then creating a new chat in tab B picks up tab A's value.
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface UiDefaults {
  provider: string;
  model: string;
  agentId: string | null;
  reasoningEffort: ReasoningEffort | null;
  showThinking: boolean;
  /**
   * Whether the composer "use tools" switch is on. Like
   * showThinking, this is a global preference: the user picks it
   * once and every tab / new conversation inherits it. Persisted
   * to localStorage so it survives a reload.
   */
  useTools: boolean;
}

const STORAGE_KEY = "yudu-ui-defaults";

const SEED: UiDefaults = {
  provider: "mock",
  model: "mock-1",
  agentId: null,
  reasoningEffort: null,
  showThinking: true,
  useTools: false,
};

function readPersisted(): UiDefaults {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw) as Partial<UiDefaults>;
    return {
      provider: typeof parsed.provider === "string" ? parsed.provider : SEED.provider,
      model: typeof parsed.model === "string" ? parsed.model : SEED.model,
      agentId:
        typeof parsed.agentId === "string" || parsed.agentId === null
          ? (parsed.agentId as string | null)
          : SEED.agentId,
      reasoningEffort:
        parsed.reasoningEffort === "low" ||
        parsed.reasoningEffort === "medium" ||
        parsed.reasoningEffort === "high" ||
        parsed.reasoningEffort === "xhigh" ||
        parsed.reasoningEffort === null
          ? parsed.reasoningEffort
          : SEED.reasoningEffort,
      showThinking:
        typeof parsed.showThinking === "boolean" ? parsed.showThinking : SEED.showThinking,
      useTools:
        typeof parsed.useTools === "boolean" ? parsed.useTools : SEED.useTools,
    };
  } catch {
    return SEED;
  }
}

function writePersisted(s: UiDefaults) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage may be unavailable (private mode, quota); fall through
    // silently — the in-memory store still works for the current session.
  }
}

interface UiDefaultsState extends UiDefaults {
  setProvider: (p: string) => void;
  setModel: (m: string) => void;
  setAgentId: (a: string | null) => void;
  setReasoningEffort: (e: ReasoningEffort | null) => void;
  setShowThinking: (v: boolean) => void;
  setUseTools: (v: boolean) => void;
  /** Bulk-apply from an existing conversation (e.g. on import). */
  hydrate: (next: Partial<UiDefaults>) => void;
}

export const useUiDefaults = create<UiDefaultsState>((set, get) => ({
  ...readPersisted(),
  setProvider(p) {
    set({ provider: p });
    writePersisted(get());
  },
  setModel(m) {
    set({ model: m });
    writePersisted(get());
  },
  setAgentId(a) {
    set({ agentId: a });
    writePersisted(get());
  },
  setReasoningEffort(e) {
    set({ reasoningEffort: e });
    writePersisted(get());
  },
  setShowThinking(v) {
    set({ showThinking: v });
    writePersisted(get());
  },
  setUseTools(v) {
    set({ useTools: v });
    writePersisted(get());
  },
  hydrate(next) {
    set((s) => {
      const merged = { ...s, ...next };
      writePersisted(merged);
      return merged;
    });
  },
}));
