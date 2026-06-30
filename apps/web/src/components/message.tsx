import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/markdown";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import type { ChatMessage as Msg, ContentPart } from "@yudu/shared";
import { cn } from "@/lib/utils";

export function MessageBubble({ msg, isLast }: { msg: Msg; isLast: boolean }) {
  const { t } = useI18n();
  const send = useChat((s) => s.sendMessage);
  const del = useChat((s) => s.deleteMessage);
  const streaming = useChat((s) => s.streaming);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [copied, setCopied] = useState(false);

  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  const isTool = msg.role === "tool";

  if (isTool) {
    // Tool messages are persisted alongside the assistant turn that produced
    // them. We render them as a compact attribution strip rather than a
    // chat bubble so they read as "evidence", not a chat participant.
    return (
      <div className="flex justify-start px-4 sm:px-6">
        <div className="ml-11 flex max-w-[80%] items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 font-medium text-foreground/80">{t("tool.result")}</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
              {msg.content}
            </pre>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="rounded p-1 hover:bg-foreground/10"
                onClick={() => del(msg.id)}
                aria-label={t("message.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("message.delete")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group flex gap-3 px-4 py-4 sm:px-6", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "relative max-w-[80%] rounded-2xl border px-4 py-3 shadow-sm",
          isUser
            ? "border-primary/15 bg-primary text-primary-foreground"
            : "border-border bg-card text-card-foreground",
        )}
      >
        {editing ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[80px]" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t("message.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  setEditing(false);
                  await send(draft, { editLastUser: true });
                }}
              >
                {t("message.edit")}
              </Button>
            </div>
          </div>
        ) : isAssistant ? (
          <div className="space-y-2">
            {msg.parts?.some((p) => p.type === "tool_call") && (
              <ToolCallChips parts={msg.parts} />
            )}
            {msg.content ? <Markdown>{msg.content}</Markdown> : null}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{msg.content}</div>
        )}

        {/* Footer: tokens + actions */}
        {(isAssistant || isUser) && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1 text-[11px] opacity-70",
              isUser ? "justify-end" : "justify-start",
            )}
          >
            {isAssistant && msg.promptTokens != null && msg.completionTokens != null && (
              <span>
                {msg.promptTokens}↑ {msg.completionTokens}↓
              </span>
            )}
            <div className="ml-1 flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="rounded p-1 hover:bg-foreground/10"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                    aria-label={t(copied ? "message.copied" : "message.copy")}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("message.copy")}</TooltipContent>
              </Tooltip>
              {isUser && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="rounded p-1 hover:bg-foreground/10"
                      onClick={() => {
                        setDraft(msg.content);
                        setEditing(true);
                      }}
                      aria-label={t("message.edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("message.edit")}</TooltipContent>
                </Tooltip>
              )}
              {isAssistant && isLast && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="rounded p-1 hover:bg-foreground/10"
                      onClick={() => send("", { regenerate: true })}
                      disabled={streaming}
                      aria-label={t("message.regenerate")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t("message.regenerate")}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="rounded p-1 hover:bg-foreground/10"
                    onClick={() => del(msg.id)}
                    aria-label={t("message.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("message.delete")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

// Inline chips shown above the assistant text when the model invoked tools.
// These are visual only — the tool results are stored as separate messages
// and rendered through the `tool` message branch above.
function ToolCallChips({ parts }: { parts: ContentPart[] }) {
  const { t } = useI18n();
  const calls = parts.filter((p) => p.type === "tool_call") as Extract<
    ContentPart,
    { type: "tool_call" }
  >[];
  if (calls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {calls.map((c) => {
        const argsText =
          typeof c.arguments === "string"
            ? c.arguments
            : JSON.stringify(c.arguments ?? {});
        return (
          <Tooltip key={c.id}>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-md border border-blue-300/60 bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-700 dark:text-blue-200">
                <Terminal className="h-3 w-3" />
                {c.name}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <div className="space-y-1">
                <div className="font-semibold">{t("tool.call")}</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                  {argsText}
                </pre>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// Compact attribution chip used in the activity drawer (one row per tool call).
export function ToolCallRow({
  name,
  status,
  args,
  result,
  isError,
}: {
  name: string;
  status: "running" | "ok" | "error";
  args: string;
  result?: string;
  isError?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        ) : isError ? (
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <span className="font-mono">{name}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
          {status}
        </span>
      </div>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
        {args}
      </pre>
      {result != null && (
        <pre
          className={cn(
            "mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-1.5 font-mono text-[11px]",
            isError && "border-rose-300/60 text-rose-700 dark:text-rose-300",
          )}
        >
          {result}
        </pre>
      )}
    </div>
  );
}
