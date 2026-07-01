import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ChevronDown, Download, FileImage, FileJson, FileText, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as api from "@/lib/api";
import { exportToMarkdown, exportToPng, downloadBlob, safeFilename } from "@/lib/exporter";

/**
 * Tab strip that lives where the conversation title used to be in the
 * header. Tabs are driven by the `openTabs` slice of the chat store
 * — a conversation becomes a tab when the user focuses it (via the
 * sidebar, by creating a new chat, or by importing one), and is
 * dropped from the strip with the in-tab × button. The active tab is
 * highlighted and auto-scrolled into view as new tabs are added or
 * removed. Closing a tab only removes it from the strip; the
 * underlying conversation is **not** deleted from the DB and stays
 * available in the sidebar. To actually delete a conversation, use
 * the sidebar's delete menu.
 *
 * The export affordance for the active tab is a single dropdown
 * menu (PNG / MD / JSON) so the header stays compact. All three
 * formats are derived client-side from the same JSON payload, so
 * keeping them in one place avoids the export shapes drifting apart.
 */
export function ConversationTabs() {
  const { t } = useI18n();
  const conversations = useChat((s) => s.conversations);
  const openTabs = useChat((s) => s.openTabs);
  const activeId = useChat((s) => s.activeId);
  const select = useChat((s) => s.selectConversation);
  const closeTab = useChat((s) => s.closeTab);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Materialize the strip by looking each open-tab id up in the full
  // conversation list. We do this in a memo so a conversation rename
  // (which mutates the row but not openTabs) is reflected without
  // re-rendering the rest of the strip.
  const tabs = useMemo(
    () =>
      openTabs
        .map((id) => conversations.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [openTabs, conversations],
  );

  // Auto-scroll the active tab into view when the active id or the
  // tab set changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  if (tabs.length === 0) {
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
        {tabs.map((c) => {
          const isActive = c.id === activeId;
          return (
            <div
              key={c.id}
              data-tab-id={c.id}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={cn(
                "group flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
              onClick={() => {
                if (!isActive) void select(c.id);
              }}
              onKeyDown={(e) => {
                // Mirror Radix Tabs keyboard semantics: ArrowLeft/Right
                // move focus between tabs, Home/End jump to the ends,
                // Enter / Space activate the focused tab.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!isActive) void select(c.id);
                  return;
                }
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const list = tabs;
                const i = list.findIndex((x) => x.id === c.id);
                const target =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? list.length - 1
                      : (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
                const next = list[target];
                if (next) {
                  const el = scrollRef.current?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`);
                  el?.focus();
                  if (next.id !== activeId) void select(next.id);
                }
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
                title={t("tabs.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  // Closing a tab only removes it from the header
                  // strip; the conversation itself stays in the DB
                  // and remains reachable from the sidebar.
                  closeTab(c.id);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {/* Single dropdown for exporting the active tab. All three
          formats (PNG / MD / JSON) come from the same client-side
          payload, so they're surfaced together instead of as three
          separate header buttons. */}
      {activeId && (
        <div className="flex shrink-0 items-center pl-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("export.menuLabel")}
                aria-label={t("export.menuLabel")}
                className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Download className="h-3 w-3" />
                <span>{t("export.menu")}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem
                onSelect={() => void onExport("png")}
                className="gap-2"
              >
                <FileImage className="h-3.5 w-3.5" />
                <span>PNG</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{t("export.png")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void onExport("md")}
                className="gap-2"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>MD</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{t("export.md")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void onExport("json")}
                className="gap-2"
              >
                <FileJson className="h-3.5 w-3.5" />
                <span>JSON</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{t("export.json")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
