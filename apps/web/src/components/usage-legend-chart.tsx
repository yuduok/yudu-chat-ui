import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  UsageRingChart,
  formatPercent,
  formatTokens,
  type UsageRingSlice,
} from "@/components/usage-ring-chart";

/**
 * Donut + side legend used by both the "By provider" and "By model"
 * sections of the Usage tab. Hovering a legend row or a slice keeps
 * the two in sync via shared hover state, so the focused slice grows
 * in the chart while its row in the legend is highlighted.
 *
 * Keyboard parity: legend rows are real focusable buttons so keyboard
 * users can step through buckets the same way mouse users hover them.
 * The SVG slices are aria-hidden because the legend already exposes
 * the same data; announcing both would double up.
 */
export function UsageLegendChart({
  slices,
  totalLabel,
  totalValue,
  emptyLabel,
  tokensLabelPrompt,
  tokensLabelCompletion,
}: {
  slices: UsageRingSlice[];
  totalLabel: string;
  totalValue: string;
  emptyLabel: string;
  tokensLabelPrompt: string;
  tokensLabelCompletion: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const total = slices.reduce((sum, s) => sum + s.totalTokens, 0);
  const focused = hovered ? slices.find((s) => s.key === hovered) : null;
  const centerValue = focused ? formatTokens(focused.totalTokens) : totalValue;
  const centerTitle = focused ? focused.label : totalLabel;

  if (slices.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-md border bg-card px-3 py-3">
      <UsageRingChart
        slices={slices}
        size={140}
        thickness={16}
        centerTitle={centerTitle}
        centerValue={centerValue}
        className="shrink-0"
      />
      <ul className="min-w-0 flex-1 space-y-1" role="list">
        {slices.map((s) => {
          const fraction = total > 0 ? s.totalTokens / total : 0;
          const isFocused = hovered === s.key;
          return (
            <li key={s.key}>
              <button
                type="button"
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.key)}
                onBlur={() => setHovered(null)}
                aria-pressed={isFocused}
                aria-label={`${s.label}${s.sublabel ? ` (${s.sublabel})` : ""}: ${formatPercent(fraction)}, ${formatTokens(s.totalTokens)} tokens`}
                className={cn(
                  "w-full rounded px-1.5 py-1 text-left text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isFocused ? "bg-accent/60" : "hover:bg-muted/60",
                )}
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
                    {formatPercent(fraction)}
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
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
