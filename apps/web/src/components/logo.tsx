import { cn } from "@/lib/utils";

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      {/* Rounded square mark in currentColor */}
      <path
        d="M6 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3h-8.6l-4.7 3.7A1 1 0 0 1 8 24.95V22H9a3 3 0 0 1-3-3V6Z"
        fill="currentColor"
        opacity="0.12"
      />
      <path
        d="M6 6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3h-8.6l-4.7 3.7A1 1 0 0 1 8 24.95V22a3 3 0 0 1-3-3V6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Stylized Y */}
      <path
        d="M11.5 11.5l3.5 4.2a1 1 0 0 0 1.5 0l3.5-4.2M16 15.5V19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("select-none font-semibold tracking-tight", className)}
      style={{ fontSize: size }}
    >
      Yudu Chat
    </span>
  );
}
