import { useEffect, useRef, useState } from "react";
import { useChat } from "@/store/chat";
import { MessageBubble } from "@/components/message";
import { Composer } from "@/components/composer";
import { Sidebar } from "@/components/sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { useI18n, type Locale } from "@/i18n";
import { Logo, Wordmark } from "@/components/logo";
import { Moon, Sun, MonitorSmartphone, Languages } from "lucide-react";

export function ChatPage() {
  const { t, locale, setLocale } = useI18n();
  const messages = useChat((s) => s.messages);
  const activeId = useChat((s) => s.activeId);
  const streaming = useChat((s) => s.streaming);
  const error = useChat((s) => s.error);
  const convos = useChat((s) => s.conversations);
  const updateConv = useChat((s) => s.updateConversationSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string; models: string[] }[]>([]);
  const [modelList, setModelList] = useState<string[]>([]);
  const { theme, setTheme } = useTheme();

  const active = convos.find((c) => c.id === activeId);

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
      .then((res) => {
        if (cancelled) return;
        // If the conversation's saved model isn't in the list, keep it visible.
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
  }, [messages, streaming]);

  return (
    <div className="flex h-full">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b bg-background/80 px-4 py-2 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {active ? (
              <>
                <div className="truncate text-sm font-medium">{active.title}</div>
                <div className="hidden h-4 w-px bg-border sm:block" />
                <div className="hidden items-center gap-2 sm:flex">
                  <Select
                    value={active.provider}
                    onValueChange={(v) => void updateConv(active.id, { provider: v })}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={active.model}
                    onValueChange={(v) => void updateConv(active.id, { model: v })}
                  >
                    <SelectTrigger className="h-8 w-[200px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelList.length === 0 ? (
                        <SelectItem value={active.model}>{active.model}</SelectItem>
                      ) : (
                        modelList.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Logo size={18} />
                <span>{t("chat.noConversation")}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
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

        {activeId && <Composer />}
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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
