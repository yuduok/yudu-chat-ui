import { useEffect, useRef, useState } from "react";
import { useChat } from "@/store/chat";
import { MessageBubble } from "@/components/message";
import { Composer } from "@/components/composer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sidebar } from "@/components/sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { useTheme } from "@/hooks/use-theme";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";

export function ChatPage() {
  const messages = useChat((s) => s.messages);
  const activeId = useChat((s) => s.activeId);
  const streaming = useChat((s) => s.streaming);
  const error = useChat((s) => s.error);
  const convos = useChat((s) => s.conversations);
  const updateConv = useChat((s) => s.updateConversationSettings);
  const select = useChat((s) => s.selectConversation);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<{ id: string; label: string; models: string[] }[]>([]);
  const { theme, setTheme } = useTheme();

  const active = convos.find((c) => c.id === activeId);

  useEffect(() => {
    void api.listProviders().then(setProviders);
  }, []);

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
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(providers.find((p) => p.id === active.provider)?.models ?? [active.model]).map(
                        (m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No conversation selected</div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={`Theme: ${theme}`}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : theme === "light" ? <Moon className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              Settings
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
                  Send a message to start the conversation.
                </div>
              ) : (
                messages.map((m, i) => (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    isLast={i === messages.length - 1}
                  />
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
  const create = useChat((s) => s.createConversation);
  const select = useChat((s) => s.selectConversation);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">Yudu Chat</div>
      <h1 className="text-2xl font-semibold tracking-tight">Your own AI workspace</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Stream responses, switch models on the fly, and keep every conversation searchable. Start a new
        chat to begin.
      </p>
      <Button
        onClick={async () => {
          const c = await create();
          await select(c.id);
        }}
      >
        New chat
      </Button>
    </div>
  );
}
