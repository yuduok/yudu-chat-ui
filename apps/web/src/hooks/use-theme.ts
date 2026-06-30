import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "yudu-theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    return stored;
  });

  useEffect(() => {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const cb = () => apply("system");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }
  }, [theme]);

  return { theme, setTheme };
}
