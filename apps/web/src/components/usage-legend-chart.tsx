import { useState } from "react";
import { cn } from "@/lib/utils";
import type { UsageRingSlice } from "@/components/usage-ring-chart";
import { UsageRingChart } from "@/components/usage-ring-chart";

/**
 * Donut + side legend used by both the "By provider" and "By model"
 * sections of the Usage tab. Hovering a legend row or a slice keeps
 * the two in sync via shared hover state, so the focused slice grows
 * outward in the chart while its row in the legend is highlighted.
 *
 * Layout note: the rows are simple blocks rather than flex lines so
 * the focused prompt/completion breakdown can wrap below the label
 * without breaking the alignment of the percentage / total columns.
 */
export function UsageLegendChart({
  slices,
  totalLabel,
  totalValue,
  emptyLabel,
  tokensLabelPrompt,
  tokensLabelCompletion,
  formatTokens,
}: {
  slices: UsageRingSlice[];
  totalLabel: string;
  totalValue: string;
  emptyLabel: string;
  tokensLabelPrompt: string;
  tokensLabelCompletion: string;
  formatTokens: (n: number) => string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const total = slices.reduce((sum, s) => sum + s.totalTokens, 0);
  const focused = hovered ? slices.find((s) => s.key === hovered) : null;
  const centerValue = focused ? formatTokens(focused.totalTokens) : totalValue;
  const centerTitle = focused ? focused.label : totalLabel;

  return (
    <div className="flex items-center gap-4 rounded-md border bg-card px-3 py-3">
      <UsageRingChart
        slices={slices}
        size={140}
        thickness={16}
        centerTitle={centerTitle}
        centerValue={centerValue}
        emptyLabel={emptyLabel}
        className="shrink-0"
      />
      <ul className="min-w-0 flex-1 space-y-1">
        {slices.length === 0 ? (
          <li className="text-[11px] text-muted-foreground">{emptyLabel}</li>
        ) : (
          slices.map((s) => {
            const fraction = total > 0 ? s.totalTokens / total : 0;
            const isFocused = hovered === s.key;
            return (
              <li
                key={s.key}
                className={cn(
                  "rounded px-1.5 py-1 text-[11px] transition-colors",
                  isFocused ? "bg-accent/60" : "hover:bg-muted/60",
                )}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor: s.color,
                      opacity: isFocused || hovered === null ? 1 : 0.4,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{s.label}</span>
                    {s.sublabel && (
                      <span className="ml-1 text-muted-foreground">· {s.sublabel}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {(fraction * 100).toFixed(fraction >= 0.1 ? 1 : 0)}%
                  </span>
                  <span className="shrink-0 w-16 text-right tabular-nums">
                    {formatTokens(s.totalTokens)}
                  </span>
                </div>
                {isFocused && (
                  <div className="mt-0.5 pl-[18px] text-[10px] text-muted-foreground">
                    {tokensLabelPrompt} {formatTokens(s.promptTokens)} · {tokensLabelCompletion} {formatTokens(s.completionTokens)}
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
