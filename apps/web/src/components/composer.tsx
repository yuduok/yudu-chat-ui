import { useEffect, useRef, useState } from "react";
import { Brain, FileText, Image, Loader2, Paperclip, Send, Square, Wand2, X } from "lucide-react";
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
import type { ContentPart } from "@yudu/shared";
import { uploadAttachment } from "@/lib/api";

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
  // Provider / model / showThinking are *global* settings — they
  // apply to every tab, not just the active one. We use
  // `applyGlobalSettings` (server round-trip) for the bulk write
  // and `useUiDefaults` (localStorage) for the client-side copy
  // so a fresh tab/refresh restores the last-picked values.
  const applyGlobal = useChat((s) => s.applyGlobalSettings);
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const active = conversations.find((c) => c.id === activeId);
  const showThinking = active?.showThinking !== false;

  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ContentPart[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // useTools is a *global* composer preference (alongside provider /
  // model / showThinking): the user picks it once and every tab /
  // new conversation inherits it. Persisted to localStorage so it
  // survives a reload.
  const useTools = useUiDefaults((s) => s.useTools);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-resize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);

  function submit() {
    const text = value.trim();
    if ((!text && attachments.length === 0) || streaming || uploading) return;
    setValue("");
    const parts: ContentPart[] = [
      ...(text ? [{ type: "text", text } as ContentPart] : []),
      ...attachments,
    ];
    setAttachments([]);
    void send(text, {
      parts,
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

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 6 - attachments.length))) {
        const attachment = await uploadAttachment(file);
        setAttachments((current) => [...current, attachment].slice(0, 6));
      }
    } catch (error: any) {
      setUploadError(error?.message || t("composer.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
              void applyGlobal({ provider: v });
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
              void applyGlobal({ model: v });
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

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => {
              const image = attachment.type === "image_url";
              const name = image
                ? attachment.name
                : attachment.type === "document"
                  ? attachment.name
                  : "attachment";
              return (
                <div key={`${name}-${index}`} className="flex max-w-[220px] items-center gap-2 rounded-lg border bg-muted/50 px-2 py-1.5 text-xs">
                  {image ? <Image className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{name}</span>
                  <button type="button" onClick={() => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("composer.removeAttachment")}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

        {/* Middle row: input + send button (send aligned with input baseline) */}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.txt,.md,.csv,.json,.html,.xml"
            onChange={(event) => void addFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => fileRef.current?.click()}
            disabled={streaming || uploading || attachments.length >= 6}
            title={t("composer.attach")}
            aria-label={t("composer.attach")}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
              if (files.length) {
                event.preventDefault();
                const transfer = new DataTransfer();
                files.forEach((file) => transfer.items.add(file));
                void addFiles(transfer.files);
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void addFiles(event.dataTransfer.files);
            }}
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
              disabled={!value.trim() && attachments.length === 0}
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
              onCheckedChange={(v) => useUiDefaults.getState().setUseTools(v)}
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
                void applyGlobal({ showThinking: v });
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
