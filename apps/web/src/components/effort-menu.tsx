import { useEffect, useMemo, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useChat } from "@/store/chat";
import { useUiDefaults } from "@/store/ui-defaults";
import { useI18n } from "@/i18n";
import type { ReasoningEffort } from "@yudu/shared";
import { cn } from "@/lib/utils";

type EffortKey =
  | "reasoning.effort.none"
  | "reasoning.effort.low"
  | "reasoning.effort.medium"
  | "reasoning.effort.high"
  | "reasoning.effort.xhigh";
const ORDER: Array<{ id: "null" | ReasoningEffort; key: EffortKey }> = [
  { id: "null", key: "reasoning.effort.none" },
  { id: "low", key: "reasoning.effort.low" },
  { id: "medium", key: "reasoning.effort.medium" },
  { id: "high", key: "reasoning.effort.high" },
  { id: "xhigh", key: "reasoning.effort.xhigh" },
];

export function EffortMenu() {
  const { t } = useI18n();
  const activeId = useChat((s) => s.activeId);
  const conversations = useChat((s) => s.conversations);
  const updateConv = useChat((s) => s.updateConversationSettings);
  // Reasoning depth is a global setting — it applies to every
  // tab, so the user picks it once and forgets about it.
  const applyGlobal = useChat((s) => s.applyGlobalSettings);
  const active = conversations.find((c) => c.id === activeId);

  // Mount-time guard so the menu doesn't render before there's a conversation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = useMemo<{ v: "null" | ReasoningEffort; label: EffortKey }>(() => {
    const v = (active?.reasoningEffort ?? null) as "null" | ReasoningEffort;
    const label: EffortKey =
      ORDER.find((o) => o.id === v)?.key ?? "reasoning.effort.none";
    return { v, label };
  }, [active?.reasoningEffort]);

  if (!active || !mounted) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          aria-label={t("reasoning.menu")}
        >
          <Brain className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{t(current.label)}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {ORDER.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() =>
              (() => {
                const next = o.id === "null" ? null : (o.id as ReasoningEffort);
                useUiDefaults.getState().setReasoningEffort(next);
                void applyGlobal({ reasoningEffort: next });
              })()
            }
            className="flex items-center justify-between gap-2"
          >
            <span>{t(o.key)}</span>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                current.v === o.id ? "bg-primary" : "bg-transparent",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
