import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChat } from "@/store/chat";
import { useI18n } from "@/i18n";
import { ToolCallRow } from "@/components/message";
import { formatTokens as formatTokensShared, bucketsToSlices } from "@/components/usage-ring-chart";
import { UsageLegendChart } from "@/components/usage-legend-chart";
import * as api from "@/lib/api";
import type { UsageReport } from "@yudu/shared";
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

  // Lazy-load the usage report the first time the drawer opens (or after a
  // refresh click). We re-fetch every time the drawer re-opens so the
  // numbers stay current with whatever the user just streamed.
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUsageLoading(true);
    setUsageError(null);
    api
      .getUsage()
      .then((r) => {
        if (!cancelled) setUsage(r);
      })
      .catch((err) => {
        if (!cancelled) setUsageError(err?.message ?? "Failed to load usage");
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const running = toolCalls.some((c) => c.status === "running");

  const formatTokens = formatTokensShared;

  const totalRow = useMemo(() => {
    if (!usage) return null;
    return {
      promptTokens: usage.total.promptTokens,
      completionTokens: usage.total.completionTokens,
      totalTokens: usage.total.totalTokens,
      messageCount: usage.total.messageCount,
    };
  }, [usage]);

  // Convert the API buckets into the slice shape the ring chart
  // expects. Memoizing keeps unrelated re-renders (tab clicks, tool
  // call streaming) from re-walking these arrays.
  const providerSlices = useMemo(
    () => bucketsToSlices(usage ? usage.byProvider : []),
    [usage],
  );
  const modelSlices = useMemo(
    () => bucketsToSlices(usage ? usage.byModel : [], { sublabelFromModel: true }),
    [usage],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Override default centered dialog styles to behave like a Sheet
        // without pulling in a new shadcn primitive.
        showCloseButton={false}
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

        <Tabs defaultValue="activity" className="flex flex-1 flex-col min-h-0">
          <div className="border-b px-4 pt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="activity" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {t("agent.activityTab")}
              </TabsTrigger>
              <TabsTrigger value="usage" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                {t("usage.tab")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="activity" className="mt-0 flex-1 overflow-y-auto">
            <div className="space-y-4 px-4 py-4">
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
          </TabsContent>

          <TabsContent value="usage" className="mt-0 flex-1 overflow-y-auto">
            <div className="space-y-4 px-4 py-4">
              {usageLoading && !usage && (
                <div className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("usage.loading")}
                </div>
              )}
              {usageError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {usageError}
                </div>
              )}
              {totalRow && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("usage.total")}
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border bg-card px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("usage.prompt")}
                      </div>
                      <div className="mt-1 text-base font-semibold">{formatTokens(totalRow.promptTokens)}</div>
                    </div>
                    <div className="rounded-md border bg-card px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("usage.completion")}
                      </div>
                      <div className="mt-1 text-base font-semibold">{formatTokens(totalRow.completionTokens)}</div>
                    </div>
                    <div className="rounded-md border bg-card px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("usage.totalTokens")}
                      </div>
                      <div className="mt-1 text-base font-semibold">{formatTokens(totalRow.totalTokens)}</div>
                    </div>
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("usage.byProvider")}
                </h3>
                <UsageLegendChart
                  slices={providerSlices}
                  totalLabel={t("usage.total")}
                  totalValue={formatTokens(usage ? usage.total.totalTokens : 0)}
                  emptyLabel={t("usage.empty")}
                  tokensLabelPrompt={t("usage.prompt")}
                  tokensLabelCompletion={t("usage.completion")}
                />
              </section>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("usage.byModel")}
                </h3>
                <UsageLegendChart
                  slices={modelSlices}
                  totalLabel={t("usage.model")}
                  totalValue={formatTokens(usage ? usage.total.totalTokens : 0)}
                  emptyLabel={t("usage.byModelEmpty")}
                  tokensLabelPrompt={t("usage.prompt")}
                  tokensLabelCompletion={t("usage.completion")}
                />
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
