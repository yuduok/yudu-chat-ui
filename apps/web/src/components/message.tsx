import { useState } from "react";
import { Bot, Check, Copy, Pencil, RefreshCw, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/markdown";
import { useChat } from "@/store/chat";
import type { ChatMessage as Msg } from "@yudu/shared";
import { cn } from "@/lib/utils";

export function MessageBubble({ msg, isLast }: { msg: Msg; isLast: boolean }) {
  const send = useChat((s) => s.sendMessage);
  const del = useChat((s) => s.deleteMessage);
  const streaming = useChat((s) => s.streaming);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [copied, setCopied] = useState(false);

  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";

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
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  setEditing(false);
                  await send(draft, { editLastUser: true });
                }}
              >
                Save & Submit
              </Button>
            </div>
          </div>
        ) : isAssistant ? (
          <Markdown>{msg.content}</Markdown>
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
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
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
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Edit & resubmit</TooltipContent>
                </Tooltip>
              )}
              {isAssistant && isLast && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="rounded p-1 hover:bg-foreground/10"
                      onClick={() => send("", { regenerate: true })}
                      disabled={streaming}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Regenerate</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="rounded p-1 hover:bg-foreground/10"
                    onClick={() => del(msg.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
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
