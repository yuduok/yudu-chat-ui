import { useEffect, useRef, useState } from "react";
import { useChat } from "@/store/chat";
import { MessageBubble } from "@/components/message";
import { Composer } from "@/components/composer";
import { Sidebar } from "@/components/sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { ActivityDrawer } from "@/components/activity-drawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConversationTabs } from "@/components/conversation-tabs";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useI18n, type Locale } from "@/i18n";
import { Logo } from "@/components/logo";
import { Activity, Moon, Sun, MonitorSmartphone, Languages, FileUp } from "lucide-react";
import type { AgentProfile } from "@yudu/shared";

export function ChatPage() {
  const { t, locale, setLocale } = useI18n();
  const messages = useChat((s) => s.messages);
  const activeId = useChat((s) => s.activeId);
  const error = useChat((s) => s.error);
  const convos = useChat((s) => s.conversations);
  const loadConversations = useChat((s) => s.loadConversations);
  const importFromObject = useChat((s) => s.importConversationFromObject);
  const activeToolCalls = useChat((s) => s.activeToolCalls);
  const activeAgentEvents = useChat((s) => s.activeAgentEvents);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
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

  useEffect(() => {
    void api.listProviders().then(setProviders);
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
  }, [active?.provider, active?.model, active]);

  // Autoscroll to bottom when new content arrives
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b bg-background/80 px-4 py-2 backdrop-blur sm:px-6">
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
              className="h-8 gap-1.5 text-xs"
            >
              <FileUp className="h-3.5 w-3.5" />
              {t("import.button")}
            </Button>
            <Button
              variant={activityCount > 0 ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActivityOpen(true)}
              title={t("agent.activity")}
              aria-label={t("agent.activity")}
              className="relative h-8 gap-1.5 text-xs"
            >
              <Activity className="h-3.5 w-3.5" />
              {activityCount > 0 && (
                <span className="rounded bg-primary px-1 text-[10px] text-primary-foreground">
                  {activityCount}
                </span>
              )}
            </Button>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger className="h-8 w-[88px] text-xs" aria-label="Language">
                <Languages className="mr-1 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
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
                <Sun className="h-4 w-4" />
              ) : theme === "light" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <MonitorSmartphone className="h-4 w-4" />
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              {t("sidebar.settings")}
            </Button>
          </div>
        </header>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ActivityDrawer open={activityOpen} onOpenChange={setActivityOpen} />
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("chat.empty.heading")}</h1>
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
