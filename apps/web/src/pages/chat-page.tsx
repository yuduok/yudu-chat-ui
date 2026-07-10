import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useChat } from "@/store/chat";
import { MessageBubble } from "@/components/message";
import { Composer } from "@/components/composer";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConversationTabs } from "@/components/conversation-tabs";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useI18n, type Locale } from "@/i18n";
import { Logo } from "@/components/logo";
import { Activity, FileUp, Languages, Menu, MonitorSmartphone, Moon, Sun } from "lucide-react";
import type { AgentProfile } from "@yudu/shared";

const SettingsDialog = lazy(() =>
  import("@/components/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const ActivityDrawer = lazy(() =>
  import("@/components/activity-drawer").then((module) => ({
    default: module.ActivityDrawer,
  })),
);

export function ChatPage() {
  const { t, locale, setLocale } = useI18n();
  const messages = useChat((s) => s.messages);
  const activeId = useChat((s) => s.activeId);
  const error = useChat((s) => s.error);
  const convos = useChat((s) => s.conversations);
  const importFromObject = useChat((s) => s.importConversationFromObject);
  const activeToolCalls = useChat((s) => s.activeToolCalls);
  const activeAgentEvents = useChat((s) => s.activeAgentEvents);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [providers, setProviders] = useState<api.ProviderModels[] | { id: string; label: string; models: string[] }[]>([]);
  const [modelList, setModelList] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const active = convos.find((c) => c.id === activeId);

  // Agents rarely change at runtime; cache once per page lifecycle.
  useEffect(() => {
    let cancelled = false;
    api
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch(() => {
        // Non-fatal: agent menu + attribution just stay empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshProviders() {
    setProviders(await api.listProviders());
  }

  useEffect(() => {
    void refreshProviders();
  }, []);

  // Whenever the active provider changes, refresh the model list (defaults + manual).
  useEffect(() => {
    if (!active) {
      setModelList([]);
      return;
    }
    let cancelled = false;
    void api
      .getProviderModels(active.provider)
      .then((res: api.ProviderModels) => {
        if (cancelled) return;
        const set = new Set(res.models);
        if (active.model && !set.has(active.model)) set.add(active.model);
        setModelList(Array.from(set));
      })
      .catch(() => {
        if (cancelled) return;
        setModelList([active.model]);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.provider, active?.model]);

  // Follow streaming content only while the reader is already near the
  // bottom. This avoids snapping them away from older messages they are
  // actively reading.
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  useEffect(() => {
    shouldStickToBottom.current = true;
  }, [activeId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldStickToBottom.current) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, activeId]);

  const agentAttribution = active?.agentId
    ? agents.find((a) => a.id === active.agentId)?.label ?? active.agentId
    : null;

  const activityCount =
    activeToolCalls.length + activeAgentEvents.length;

  // Import flow: pick a JSON file, parse it, hand the parsed object to
  // the store which posts it to /api/conversations/import and selects
  // the new conversation.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await importFromObject(payload);
    } catch (err: any) {
      // Surface a visible error in the chat body so the user knows
      // the file was rejected.
      useChat.setState({ error: err?.message ?? "Import failed" });
    }
  }

  return (
    <div className="flex h-full">
      <Sidebar
        mode="chat"
        mobileOpen={sidebarOpen}
        onMobileOpenChange={setSidebarOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-1 border-b bg-background/80 px-2 py-2 backdrop-blur sm:gap-2 sm:px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t("sidebar.expand")}
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 flex-1 items-center">
            <ConversationTabs />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onImportFile}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title={t("import.button")}
              aria-label={t("import.button")}
              className="size-8 px-0 text-xs sm:w-auto sm:px-3"
            >
              <FileUp data-icon="inline-start" />
              <span className="hidden xl:inline">{t("import.button")}</span>
            </Button>
            <Button
              variant={activityCount > 0 ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActivityOpen(true)}
              title={t("agent.activity")}
              aria-label={t("agent.activity")}
              className="relative size-8 px-0 text-xs"
            >
              <Activity />
              {activityCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-4 rounded bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                  {activityCount}
                </span>
              )}
            </Button>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="h-8 w-9 px-2 text-xs sm:w-[88px] sm:px-3" aria-label="Language">
                <Languages />
                <span className="hidden min-w-0 sm:block">
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={t("chat.theme.toggle")}
              aria-label={t("chat.theme.toggle")}
            >
              {theme === "dark" ? (
                <Sun />
              ) : theme === "light" ? (
                <Moon />
              ) : (
                <MonitorSmartphone />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden lg:inline-flex"
              onClick={() => setSettingsOpen(true)}
            >
              {t("sidebar.settings")}
            </Button>
          </div>
        </header>

        {/* Body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={(event) => {
            const el = event.currentTarget;
            shouldStickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 96;
          }}
        >
          {!activeId ? (
            <EmptyState />
          ) : (
            <div className="mx-auto max-w-3xl">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 py-24 text-center text-sm text-muted-foreground">
                  {t("chat.startPrompt")}
                </div>
              ) : (
                messages.map((m, i) => (
                  <MessageBubble key={m.id} msg={m} isLast={i === messages.length - 1} />
                ))
              )}
              {error && (
                <div className="mx-4 my-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:mx-6">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {activeId && (
          <Composer
            providers={providers as { id: string; label: string; models: string[] }[]}
            modelList={modelList}
            agents={agents}
          />
        )}
      </main>

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog open onOpenChange={setSettingsOpen} onSaved={refreshProviders} />
        </Suspense>
      )}
      {activityOpen && (
        <Suspense fallback={null}>
          <ActivityDrawer open onOpenChange={setActivityOpen} />
        </Suspense>
      )}
    </div>
  );
}

function EmptyState() {
  const { t } = useI18n();
  const create = useChat((s) => s.createConversation);
  const select = useChat((s) => s.selectConversation);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">
        <Logo size={14} />
        <span>{t("chat.appName")}</span>
      </div>
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("chat.empty.heading")}</h1>
      </div>
      <p className="max-w-md text-sm text-muted-foreground">{t("chat.empty.subtitle")}</p>
      <Button
        onClick={async () => {
          const c = await create();
          await select(c.id);
        }}
      >
        {t("chat.empty.cta")}
      </Button>
    </div>
  );
}
