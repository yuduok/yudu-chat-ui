import { useEffect, useState } from "react";
import { MessageSquarePlus, MoreHorizontal, Pencil, Settings, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChat } from "@/store/chat";
import { cn } from "@/lib/utils";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const select = useChat((s) => s.selectConversation);
  const create = useChat((s) => s.createConversation);
  const remove = useChat((s) => s.deleteConversation);
  const rename = useChat((s) => s.renameConversation);
  const load = useChat((s) => s.loadConversations);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center gap-2 px-3 py-3">
        <Button
          variant="default"
          className="w-full justify-start gap-2"
          onClick={async () => {
            const c = await create();
            await select(c.id);
          }}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </Button>
      </div>

      <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        History
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-1">
        {conversations.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No conversations yet. Start a new chat.
          </p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
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
            ) : (
              <button
                className="flex-1 truncate text-left"
                onClick={() => void select(c.id)}
              >
                {c.title}
              </button>
            )}
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
                  <Pencil className="mr-2 h-4 w-4" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => void remove(c.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </nav>

      <div className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start gap-2" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" /> Settings
        </Button>
      </div>
    </aside>
  );
}
