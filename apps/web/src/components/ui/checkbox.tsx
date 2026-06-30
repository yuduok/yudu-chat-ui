import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Minimal shadcn-style checkbox built on the native input so we don't pull
// in @radix-ui/react-checkbox just for this single control. Keeps the same
// visual + API surface (checked / disabled / onCheckedChange / aria-label).
export const Checkbox = React.forwardRef<
  HTMLButtonElement,
  {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (next: boolean) => void;
    className?: string;
    "aria-label"?: string;
  }
>(({ checked, disabled, onCheckedChange, className, ...rest }, ref) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      ref={ref}
      className={cn(
        "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary shadow transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary text-primary-foreground" : "bg-background",
        className,
      )}
      {...rest}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
});
Checkbox.displayName = "Checkbox";
