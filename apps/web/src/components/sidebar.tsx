import { useEffect, useState } from "react";
import {
  Images,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { Logo, Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "yudu-sidebar-collapsed";

interface SidebarProps {
  onOpenSettings: () => void;
  mode?: "chat" | "images";
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export function Sidebar({
  onOpenSettings,
  mode = "chat",
  mobileOpen = false,
  onMobileOpenChange = () => {},
}: SidebarProps) {
  const { t } = useI18n();
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

  function closeMobile() {
    onMobileOpenChange(false);
  }

  async function openConversation(id: string) {
    window.location.hash = "/chat";
    closeMobile();
    await select(id);
  }

  async function createConversation() {
    window.location.hash = "/chat";
    closeMobile();
    const conversation = await create();
    await select(conversation.id);
  }

  function openImageStudio() {
    window.location.hash = "/images";
    closeMobile();
  }

  function openSettings() {
    closeMobile();
    onOpenSettings();
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeDrawerOnDesktop = () => {
      if (desktop.matches && mobileOpen) onMobileOpenChange(false);
    };
    closeDrawerOnDesktop();
    desktop.addEventListener("change", closeDrawerOnDesktop);
    return () => desktop.removeEventListener("change", closeDrawerOnDesktop);
  }, [mobileOpen, onMobileOpenChange]);

  function renderPanel(
    panelCollapsed: boolean,
    className: string,
    showCollapseToggle: boolean,
  ) {
    return (
      <aside
        className={cn(
          "h-full shrink-0 flex-col border-r bg-card/95 transition-[width] duration-200",
          panelCollapsed ? "w-[60px]" : "w-64",
          className,
        )}
        aria-label={t("sidebar.history")}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-3",
            panelCollapsed ? "flex-col" : "justify-between",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              panelCollapsed ? "flex-col gap-1" : "min-w-0",
            )}
          >
            <Logo size={panelCollapsed ? 24 : 22} />
            {!panelCollapsed && <Wordmark size={15} className="truncate" />}
          </div>
          {showCollapseToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={panelCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  {panelCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {panelCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="px-2 pb-2">
          {panelCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="icon"
                  className="w-full"
                  onClick={() => void createConversation()}
                  aria-label={t("sidebar.newChat")}
                >
                  <MessageSquarePlus />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.newChat")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="default"
              className="w-full justify-start"
              onClick={() => void createConversation()}
            >
              <MessageSquarePlus data-icon="inline-start" />
              {t("sidebar.newChat")}
            </Button>
          )}
        </div>

        <div className="px-2 pb-2">
          <Button
            variant={mode === "images" ? "secondary" : "ghost"}
            size={panelCollapsed ? "icon" : "default"}
            className={cn("w-full", !panelCollapsed && "justify-start")}
            onClick={openImageStudio}
            aria-label={t("sidebar.imageStudio")}
          >
            <Images data-icon="inline-start" />
            {!panelCollapsed && t("sidebar.imageStudio")}
          </Button>
        </div>

        {!panelCollapsed && (
          <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("sidebar.history")}
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {conversations.length === 0 && !panelCollapsed && (
            <p className="px-3 py-4 text-xs text-muted-foreground">{t("sidebar.emptyHistory")}</p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-1 rounded-md py-1.5 text-sm hover:bg-accent",
                panelCollapsed ? "justify-center px-1" : "px-2",
                activeId === conversation.id && "bg-accent",
              )}
            >
              {editing === conversation.id ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    if (draft.trim()) void rename(conversation.id, draft.trim());
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      if (draft.trim()) void rename(conversation.id, draft.trim());
                      setEditing(null);
                    }
                    if (event.key === "Escape") setEditing(null);
                  }}
                  className="h-7 text-sm"
                />
              ) : panelCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex size-7 items-center justify-center rounded text-xs font-semibold"
                      onClick={() => void openConversation(conversation.id)}
                      aria-label={conversation.title}
                    >
                      {conversation.title.trim().charAt(0).toUpperCase() || "·"}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{conversation.title}</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
              )}
              {!panelCollapsed && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="rounded p-1 text-muted-foreground opacity-100 hover:bg-foreground/5 focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      aria-label={t("sidebar.actions")}
                    >
                      <MoreHorizontal />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(conversation.title);
                        setEditing(conversation.id);
                      }}
                    >
                      <Pencil data-icon="inline-start" /> {t("sidebar.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void remove(conversation.id)}
                    >
                      <Trash2 data-icon="inline-start" /> {t("sidebar.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </nav>

        <div className="border-t p-2">
          {panelCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-full"
                  onClick={openSettings}
                  aria-label={t("sidebar.settings")}
                >
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("sidebar.settings")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="ghost" className="w-full justify-start" onClick={openSettings}>
              <Settings data-icon="inline-start" /> {t("sidebar.settings")}
            </Button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <>
      {renderPanel(collapsed, "hidden md:flex", true)}
      <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogContent
          className="left-0 top-0 block h-dvh w-[min(20rem,88vw)] max-w-none translate-x-0 translate-y-0 overflow-hidden border-y-0 border-l-0 p-0 sm:rounded-none md:hidden"
          showCloseButton
        >
          <DialogTitle className="sr-only">{t("sidebar.history")}</DialogTitle>
          {renderPanel(false, "flex w-full border-r-0", false)}
        </DialogContent>
      </Dialog>
    </>
  );
}
