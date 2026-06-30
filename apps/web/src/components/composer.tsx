import { useEffect, useRef, useState } from "react";
import { Brain, Send, Square, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";

export function Composer() {
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
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="flex-1 space-y-2">
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
            className="min-h-[44px] resize-none"
            rows={1}
          />
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
        {streaming ? (
          <Button onClick={stop} variant="destructive" size="icon" title={t("composer.stop")} aria-label={t("composer.stop")}>
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            size="icon"
            disabled={!value.trim()}
            title={t("composer.send")}
            aria-label={t("composer.send")}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted-foreground">
        {t("composer.disclaimer")}
      </p>
    </div>
  );
}
