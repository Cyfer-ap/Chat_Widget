'use client';

import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'chat_widget_theme';

type Theme = 'dark' | 'light';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    const nextTheme = stored ?? 'dark';
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-1 text-xs font-medium text-[color:var(--foreground)] shadow-sm transition hover:bg-[color:var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
