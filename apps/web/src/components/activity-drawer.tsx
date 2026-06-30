import { useEffect, useState } from "react";
import { Activity, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { ToolCallRow } from "@/components/message";
import { cn } from "@/lib/utils";

export function ActivityDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const toolCalls = useChat((s) => s.activeToolCalls);
  const agentEvents = useChat((s) => s.activeAgentEvents);
  const [mounted, setMounted] = useState(false);
  // Avoid SSR/hydration mismatches: only render tool rows after the first
  // open so the initial markup stays stable.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const running = toolCalls.some((c) => c.status === "running");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Override default centered dialog styles to behave like a Sheet
        // without pulling in a new shadcn primitive.
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 border-l bg-background p-0 shadow-xl sm:rounded-none"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4" />
            {t("agent.activity")}
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {agentEvents.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("agent.events")}
              </h3>
              <ol className="space-y-1.5">
                {agentEvents.map((ev, i) => (
                  <li
                    key={`${ev.agentId}-${ev.ts}-${i}`}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs"
                  >
                    {ev.kind === "finished" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                    )}
                    <span className="font-medium">{ev.label}</span>
                    <span
                      className={cn(
                        "ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                        ev.kind === "started"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
                          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                      )}
                    >
                      {t(ev.kind === "started" ? "agent.started" : "agent.finished")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("agent.tools")}
            </h3>
            {mounted && toolCalls.length > 0 ? (
              <div className="space-y-2">
                {toolCalls.map((c) => {
                  const argsText =
                    typeof c.arguments === "string"
                      ? c.arguments
                      : JSON.stringify(c.arguments ?? {});
                  return (
                    <ToolCallRow
                      key={c.id}
                      name={c.name}
                      status={c.status}
                      args={argsText}
                      result={c.result}
                      isError={c.isError}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
                {t("agent.empty")}
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
