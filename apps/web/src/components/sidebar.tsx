import { useEffect, useState } from "react";
import { Images, MessageSquarePlus, MoreHorizontal, Pencil, Settings, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { Logo, Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "yudu-sidebar-collapsed";

export function Sidebar({ onOpenSettings, mode = "chat" }: { onOpenSettings: () => void; mode?: "chat" | "images" }) {
  const { t, locale } = useI18n();
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const select = useChat((s) => s.selectConversation);
  const create = useChat((s) => s.createConversation);
  const remove = useChat((s) => s.deleteConversation);
  const rename = useChat((s) => s.renameConversation);
  const load = useChat((s) => s.loadConversations);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function openConversation(id: string) {
    window.location.hash = "/chat";
    await select(id);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r bg-card/40 transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-64",
      )}
      aria-label="Sidebar"
    >
      {/* Header: brand + collapse toggle */}
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-3",
          collapsed ? "flex-col" : "justify-between",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2",
            collapsed ? "flex-col gap-1" : "min-w-0",
          )}
        >
          <Logo size={collapsed ? 24 : 22} />
          {!collapsed && <Wordmark size={15} className="truncate" />}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* New chat */}
      <div className="px-2 pb-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon"
                className="w-full"
                onClick={async () => {
                  window.location.hash = "/chat";
                  const c = await create();
                  await select(c.id);
                }}
                aria-label={t("sidebar.newChat")}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("sidebar.newChat")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="default"
            className="w-full justify-start gap-2"
            onClick={async () => {
              window.location.hash = "/chat";
              const c = await create();
              await select(c.id);
            }}
          >
            <MessageSquarePlus className="h-4 w-4" />
            {t("sidebar.newChat")}
          </Button>
        )}
      </div>

      <div className="px-2 pb-2">
        <Button
          variant={mode === "images" ? "secondary" : "ghost"}
          size={collapsed ? "icon" : "default"}
          className={cn("w-full", !collapsed && "justify-start gap-2")}
          onClick={() => { window.location.hash = "/images"; }}
          aria-label={t("sidebar.imageStudio")}
        >
          <Images className="h-4 w-4" />
          {!collapsed && t("sidebar.imageStudio")}
        </Button>
      </div>

      {/* History */}
      {!collapsed && (
        <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("sidebar.history")}
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-1">
        {conversations.length === 0 && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("sidebar.emptyHistory")}</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 rounded-md py-1.5 text-sm hover:bg-accent",
              collapsed ? "justify-center px-1" : "px-2",
              activeId === c.id && "bg-accent",
            )}
          >
            {editing === c.id ? (
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft.trim()) void rename(c.id, draft.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (draft.trim()) void rename(c.id, draft.trim());
                    setEditing(null);
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-7 text-sm"
              />
            ) : collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded text-xs font-semibold"
                    onClick={() => void openConversation(c.id)}
                    aria-label={c.title}
                  >
                    {c.title.trim().charAt(0).toUpperCase() || "·"}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{c.title}</TooltipContent>
              </Tooltip>
            ) : (
              <button className="flex-1 truncate text-left" onClick={() => void openConversation(c.id)}>
                {c.title}
              </button>
            )}
            {!collapsed && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded p-1 text-muted-foreground opacity-0 hover:bg-foreground/5 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setDraft(c.title);
                      setEditing(c.id);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" /> {t("sidebar.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => void remove(c.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> {t("sidebar.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </nav>

      {/* Settings */}
      <div className="border-t p-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="w-full" onClick={onOpenSettings} aria-label={t("sidebar.settings")}>
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("sidebar.settings")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" /> {t("sidebar.settings")}
          </Button>
        )}
      </div>
    </aside>
  );
}
