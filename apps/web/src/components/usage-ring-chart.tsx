import { useMemo, useState } from "react";
import type { UsageBucket } from "@yudu/shared";
import { cn } from "@/lib/utils";

/**
 * Donut/ring chart for the usage report. Each slice is a bucket
 * (provider or `(provider, model)`). On hover, the focused slice grows
 * slightly outward and dims the others; a tooltip-style overlay renders
 * the bucket name, its share of total tokens, and the prompt/completion
 * breakdown.
 *
 * The component is dependency-free — slices are drawn as SVG `<circle>`
 * strokes so we get clean anti-aliased arcs without pulling in a chart
 * library. We use `stroke-dasharray` + `stroke-dashoffset` to lay each
 * arc around a common circumference and rely on `transform: rotate` to
 * fan them out from the 12 o'clock start.
 */

export interface UsageRingSlice {
  key: string;
  label: string;
  sublabel?: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  color: string;
}

const PALETTE = [
  "#6366f1", // indigo-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#06b6d4", // cyan-500
  "#a855f7", // purple-500
  "#ec4899", // pink-500
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#f97316", // orange-500
  "#14b8a6", // teal-500
  "#eab308", // yellow-500
];

function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function bucketsToSlices(
  buckets: UsageBucket[],
  opts?: { sublabelFromModel?: boolean },
): UsageRingSlice[] {
  return buckets.map((b, i) => ({
    key: opts?.sublabelFromModel ? `${b.provider}/${b.model}` : b.provider,
    label: opts?.sublabelFromModel ? b.model : b.provider,
    sublabel: opts?.sublabelFromModel ? b.provider : undefined,
    totalTokens: b.totalTokens,
    promptTokens: b.promptTokens,
    completionTokens: b.completionTokens,
    color: paletteColor(i),
  }));
}

/** Compact 1.2K / 3.4M formatter shared with the usage drawer. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Whole-number percent with a "<1%" floor so 0% never lies about presence. */
export function formatPercent(f: number): string {
  if (f >= 0.1) return `${(f * 100).toFixed(1)}%`;
  if (f > 0) return `<1%`;
  return "0%";
}

interface RingChartProps {
  slices: UsageRingSlice[];
  size?: number;
  thickness?: number;
  centerTitle?: string;
  centerValue?: string;
  emptyLabel?: string;
  className?: string;
}

export function UsageRingChart({
  slices,
  size = 168,
  thickness = 18,
  centerTitle,
  centerValue,
  emptyLabel,
  className,
}: RingChartProps) {
  const total = useMemo(() => slices.reduce((sum, s) => sum + s.totalTokens, 0), [slices]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Geometry: a square viewBox lets us compute everything in pixel
  // units. Stroke arcs the donut by starting at the top (12 o'clock).
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // Gap between slices (in pixels of arc length). Keeps the donut
  // legible when many buckets are present.
  const gap = slices.length > 1 ? Math.min(2, circumference / slices.length / 4) : 0;

  // Pre-compute each slice's dash length and offset so we can render
  // them with simple SVG circles. We sort by index (the order from
  // the API is already alphabetical) and lay them out consecutively.
  const laid = useMemo(() => {
    if (total <= 0) return [];
    let cursor = 0;
    return slices.map((s) => {
      const fraction = s.totalTokens / total;
      const length = Math.max(0, fraction * circumference - gap);
      const offset = cursor;
      cursor += fraction * circumference;
      return { slice: s, length, offset, fraction };
    });
  }, [slices, total, circumference, gap]);

  if (total <= 0 || laid.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full border text-[11px] text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {emptyLabel}
      </div>
    );
  }

  const hovered = hoveredKey ? laid.find((l) => l.slice.key === hoveredKey) ?? null : null;
  const centerLabel = hovered ? hovered.slice.label : centerTitle;
  const centerSub = hovered ? formatPercent(hovered.fraction) : centerValue;

  // a11y: the SVG announces whatever the visible center label is, so
  // screen readers hear the focused slice name when the user hovers a
  // legend row. Without this, the label only changes visually.
  const a11yLabel = hovered
    ? `${hovered.slice.label}: ${formatPercent(hovered.fraction)}, ${formatTokens(hovered.slice.totalTokens)} tokens`
    : `${centerTitle ?? "Usage ring"}: ${centerValue ?? ""}`.trim();

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Rotate -90deg so the first slice starts at the top.
        style={{ transform: "rotate(-90deg)" }}
        role="img"
        aria-label={a11yLabel}
      >
        {/* Background ring: a single muted circle that shows the empty
            portion of the donut when fewer slices are drawn than 100%. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={thickness}
          opacity={0.4}
        />
        {laid.map(({ slice, length, offset }) => {
          const isHovered = hoveredKey === slice.key;
          const isDimmed = hoveredKey !== null && !isHovered;
          // Thicken the focused slice's stroke — the visible "pop"
          // comes from the wider stroke + unchanged radius.
          const extra = isHovered ? thickness * 0.35 : 0;
          return (
            <circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={thickness + extra * 2}
              strokeLinecap="butt"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              opacity={isDimmed ? 0.35 : 1}
              style={{
                transition: "opacity 120ms ease-out, stroke-width 120ms ease-out",
              }}
              aria-hidden
              focusable={false}
            />
          );
        })}
      </svg>
      {/* Center label sits on top of the SVG so it remains crisp. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="max-w-[70%] truncate text-[10px] uppercase tracking-wide text-muted-foreground">
          {centerLabel}
        </div>
        <div className="mt-0.5 text-sm font-semibold tabular-nums">{centerSub}</div>
        {hovered && (
          <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
            {formatTokens(hovered.slice.promptTokens)} / {formatTokens(hovered.slice.completionTokens)}
          </div>
        )}
      </div>
    </div>
  );
}
