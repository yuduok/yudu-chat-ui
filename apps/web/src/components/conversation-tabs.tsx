import { useEffect, useRef } from "react";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import * as api from "@/lib/api";
import { exportToMarkdown, exportToPng, downloadBlob, safeFilename } from "@/lib/exporter";

/**
 * Tab strip that lives where the conversation title used to be in the
 * header. Each tab represents one conversation; the active tab drives
 * the chat view via the store. Tabs are horizontally scrollable when
 * they overflow, and each one has a close button that removes the
 * conversation via the existing `deleteConversation` action.
 */
export function ConversationTabs() {
  const { t } = useI18n();
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const select = useChat((s) => s.selectConversation);
  const remove = useChat((s) => s.deleteConversation);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active tab into view when conversations change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeId, conversations.length]);

  if (conversations.length === 0) {
    return (
      <div className="flex h-9 items-center text-xs text-muted-foreground">
        {t("tabs.empty")}
      </div>
    );
  }

  async function onExport(format: "json" | "md" | "png") {
    if (!activeId) return;
    try {
      const payload = await api.exportConversation(activeId);
      const filenameBase = safeFilename(payload.title, "conversation");
      if (format === "json") {
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        downloadBlob(blob, `${filenameBase}.json`);
        return;
      }
      if (format === "md") {
        const md = exportToMarkdown(payload);
        const blob = new Blob([md], { type: "text/markdown" });
        downloadBlob(blob, `${filenameBase}.md`);
        return;
      }
      const png = await exportToPng(payload);
      downloadBlob(png, `${filenameBase}.png`);
    } catch (err: any) {
      useChat.setState({ error: err?.message ?? "Export failed" });
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label={t("tabs.list")}
      >
        {conversations.map((c) => {
          const isActive = c.id === activeId;
          return (
            <div
              key={c.id}
              data-tab-id={c.id}
              role="tab"
              aria-selected={isActive}
              className={cn(
                "group flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs",
                isActive
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
              onClick={() => {
                if (!isActive) void select(c.id);
              }}
            >
              <span className="max-w-[180px] truncate">{c.title || "New Chat"}</span>
              <button
                type="button"
                className={cn(
                  "ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-label={t("tabs.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(c.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {/* Inline export buttons for the active tab. Each button drives
          a different serializer on the client (json → blob, md →
          string, png → canvas). The buttons live next to the tabs so
          "what you see is what you export". */}
      {activeId && (
        <div className="flex shrink-0 items-center gap-1 pl-2">
          <button
            type="button"
            onClick={() => void onExport("json")}
            title={t("export.json")}
            aria-label={t("export.json")}
            className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => void onExport("md")}
            title={t("export.md")}
            aria-label={t("export.md")}
            className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            MD
          </button>
          <button
            type="button"
            onClick={() => void onExport("png")}
            title={t("export.png")}
            aria-label={t("export.png")}
            className="inline-flex h-7 items-center rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            PNG
          </button>
        </div>
      )}
    </div>
  );
}
