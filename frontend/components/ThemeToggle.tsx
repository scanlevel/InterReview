"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "interreview-theme";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      const nextTheme: Theme =
        stored === "light" || stored === "dark"
          ? stored
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      applyTheme(nextTheme);
      setTheme(nextTheme);
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      disabled={!mounted}
      onClick={toggleTheme}
      className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-line bg-surface/95 px-3 py-2 text-sm font-medium text-ink-2 shadow-card backdrop-blur transition hover:bg-surface-soft disabled:cursor-wait disabled:opacity-70"
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <span>{isDark ? "라이트" : "다크"}</span>
    </button>
  );
}
