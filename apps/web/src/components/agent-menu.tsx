import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronDown, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useChat } from "@/store/chat";
import { useUiDefaults } from "@/store/ui-defaults";
import { useI18n } from "@/i18n";
import type { AgentProfile } from "@yudu/shared";
import * as api from "@/lib/api";
import { cn } from "@/lib/utils";

export function AgentMenu() {
  const { t } = useI18n();
  const activeId = useChat((s) => s.activeId);
  const conversations = useChat((s) => s.conversations);
  const updateConv = useChat((s) => s.updateConversationSettings);
  // Agent selection is a global chat-environment setting — it
  // applies to every tab so the user doesn't have to re-pick an
  // agent after switching. Title / systemPrompt stay per-row.
  const applyGlobal = useChat((s) => s.applyGlobalSettings);
  const active = conversations.find((c) => c.id === activeId);

  const [agents, setAgents] = useState<AgentProfile[]>([]);

  // Agents rarely change at runtime; fetch once per mount.
  useEffect(() => {
    let cancelled = false;
    api
      .listAgents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch(() => {
        // Non-fatal: the menu will simply be empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentLabel = useMemo(() => {
    if (!active?.agentId) return t("agent.menu.none");
    return agents.find((a) => a.id === active.agentId)?.label ?? active.agentId;
  }, [active?.agentId, agents, t]);

  if (!active) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label={t("agent.menu")}
        >
          <Bot className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Wand2 className="h-3 w-3" />
          {t("agent.menu")}
        </div>
        <DropdownMenuItem
          onSelect={() => {
            useUiDefaults.getState().setAgentId(null);
            void applyGlobal({ agentId: null });
          }}
          className="flex items-start gap-2"
        >
          <Check className={cn("mt-0.5 h-3.5 w-3.5", !active.agentId ? "opacity-100" : "opacity-0")} />
          <div className="min-w-0">
            <div className="font-medium">{t("agent.menu.none")}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {t("agent.menu.noneHint")}
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onSelect={() => {
              useUiDefaults.getState().setAgentId(a.id);
              void applyGlobal({ agentId: a.id });
            }}
            className="flex items-start gap-2"
          >
            <Check
              className={cn(
                "mt-0.5 h-3.5 w-3.5",
                active.agentId === a.id ? "opacity-100" : "opacity-0",
              )}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{a.label}</span>
                {a.tools && a.tools.length > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {a.tools.length}
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{a.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
