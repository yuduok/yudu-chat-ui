import { useEffect, useRef, useState } from "react";
import { Brain, Send, Square, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChat } from "@/store/chat";
import { useUiDefaults } from "@/store/ui-defaults";
import { useI18n } from "@/i18n";
import { AgentMenu } from "@/components/agent-menu";
import { EffortMenu } from "@/components/effort-menu";
import type { AgentProfile } from "@yudu/shared";

interface ComposerProps {
  providers: { id: string; label: string; models: string[] }[];
  modelList: string[];
  agents: AgentProfile[];
}

export function Composer({ providers, modelList, agents: _agents }: ComposerProps) {
  const { t } = useI18n();
  const send = useChat((s) => s.sendMessage);
  const stop = useChat((s) => s.stop);
  const streaming = useChat((s) => s.streaming);
  const updateConv = useChat((s) => s.updateConversationSettings);
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const active = conversations.find((c) => c.id === activeId);
  const showThinking = active?.showThinking !== false;

  const [value, setValue] = useState("");
  const [useTools, setUseTools] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    setValue("");
    void send(text, {
      useTools,
      reasoningEffort: (active?.reasoningEffort as
        | "low"
        | "medium"
        | "high"
        | "xhigh"
        | null
        | undefined) ?? undefined,
      showThinking: active?.showThinking ?? true,
    });
  }

  return (
    <div className="border-t bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {/* Top row: agent / reasoning / provider / model (conversation-level controls) */}
        <div className="flex flex-wrap items-center gap-2">
          <AgentMenu />
          <EffortMenu />
          <Select
            value={active?.provider ?? undefined}
            onValueChange={(v) => {
              useUiDefaults.getState().setProvider(v);
              if (activeId) void updateConv(activeId, { provider: v });
            }}
            disabled={!active}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={t("settings.provider")}>
              <SelectValue placeholder={t("settings.provider")} />
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
            value={active?.model ?? undefined}
            onValueChange={(v) => {
              useUiDefaults.getState().setModel(v);
              if (activeId) void updateConv(activeId, { model: v });
            }}
            disabled={!active}
          >
            <SelectTrigger className="h-8 min-w-[160px] flex-1 text-xs sm:w-[200px] sm:flex-none">
              <SelectValue placeholder={active?.model} />
            </SelectTrigger>
            <SelectContent>
              {modelList.length === 0 ? (
                <SelectItem value={active?.model ?? ""}>{active?.model}</SelectItem>
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

        {/* Middle row: input + send button (send aligned with input baseline) */}
        <div className="flex items-center gap-2">
          <Textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("composer.placeholder")}
            className="min-h-10 flex-1 resize-none"
            rows={1}
          />
          {streaming ? (
            <Button
              onClick={stop}
              variant="destructive"
              size="icon"
              className="h-10 w-10 shrink-0"
              title={t("composer.stop")}
              aria-label={t("composer.stop")}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={!value.trim()}
              title={t("composer.send")}
              aria-label={t("composer.send")}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Bottom row: toggles (use tools / show thinking) */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Switch
              id="composer-use-tools"
              checked={useTools}
              onCheckedChange={setUseTools}
              disabled={streaming}
              aria-label={t("composer.runWithTools")}
            />
            <Label
              htmlFor="composer-use-tools"
              className="flex cursor-pointer items-center gap-1 select-none"
            >
              <Wand2 className="h-3 w-3" />
              {t("composer.runWithTools")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="composer-show-thinking"
              checked={showThinking}
              onCheckedChange={(v) => {
                useUiDefaults.getState().setShowThinking(v);
                if (activeId) void updateConv(activeId, { showThinking: v });
              }}
              disabled={!activeId}
              aria-label={t("reasoning.showThinking")}
            />
            <Label
              htmlFor="composer-show-thinking"
              className="flex cursor-pointer items-center gap-1 select-none"
            >
              <Brain className="h-3 w-3" />
              {t("reasoning.showThinking")}
            </Label>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted-foreground">
        {t("composer.disclaimer")}
      </p>
    </div>
  );
}
