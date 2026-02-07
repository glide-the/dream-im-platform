"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { IconSun, IconMonitor, IconMoon } from "../Icons";

type ThemeMode = "light" | "system" | "dark";

const THEME_OPTIONS: { mode: ThemeMode; Icon: typeof IconSun; label: string }[] = [
  { mode: "light", Icon: IconSun, label: "浅色" },
  { mode: "system", Icon: IconMonitor, label: "系统" },
  { mode: "dark", Icon: IconMoon, label: "深色" },
];

interface SidebarProps {
  open: boolean;
  desktopCollapsed?: boolean;
  onClose: () => void;
}

const DEFAULT_SYSTEM_PROMPT = "You are a concise and practical AI sales assistant.";
const THEME_STORAGE_KEY = "dashboard-theme";
const PROMPT_STORAGE_KEY = "dashboard-system-prompt";
const subscribeHydration = () => () => {};

function resolveTheme(mode: ThemeMode, prefersDark: boolean): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export default function Sidebar({ open, desktopCollapsed = false, onClose }: SidebarProps) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(savedTheme) ? savedTheme : "system";
  });
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SYSTEM_PROMPT;
    return localStorage.getItem(PROMPT_STORAGE_KEY) ?? DEFAULT_SYSTEM_PROMPT;
  });
  const [workspaceMode, setWorkspaceMode] = useState(true);
  const [model, setModel] = useState("Auto");
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const displayTheme: ThemeMode = hydrated ? theme : "system";
  const displayPrompt = hydrated ? systemPrompt : DEFAULT_SYSTEM_PROMPT;

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolvedTheme = resolveTheme(theme, media.matches);
      root.dataset.themeMode = theme;
      root.dataset.theme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    };

    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme();

    if (theme !== "system") return;

    const handleSystemThemeChange = () => {
      applyTheme();
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleSystemThemeChange);
      return () => media.removeEventListener("change", handleSystemThemeChange);
    }

    media.addListener(handleSystemThemeChange);
    return () => media.removeListener(handleSystemThemeChange);
  }, [theme]);

  return (
    <>
      <div className={`fixed inset-0 z-30 bg-[var(--color-overlay)] md:hidden ${open ? "block" : "hidden"}`} onClick={onClose} />
      <aside
        className={`fixed left-0 top-0 z-40 h-full w-[280px] border-r border-border bg-[var(--color-glass-surface)] p-5 backdrop-blur-xl transition-all duration-300 md:static md:z-auto ${open ? "translate-x-0" : "-translate-x-full"} ${desktopCollapsed ? "md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0 md:p-0" : "md:w-[280px] md:translate-x-0"}`}
      >
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-text-tertiary">Workspace</p>
          <h2 className="text-xl font-semibold text-text-primary">AI Sales Console</h2>
        </div>

        <div className="space-y-6 text-sm">
          <section>
            <p className="mb-1 font-medium">Theme</p>
            <p className="mb-3 text-xs text-text-tertiary">Switch between light, dark, and system themes</p>
            <div className="flex gap-3">
              {THEME_OPTIONS.map(({ mode, Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${displayTheme === mode ? "border-accent-orange bg-accent-orange-light" : "border-border hover:bg-bg-secondary"}`}
                  aria-label={label}
                  title={label}
                >
                  <Icon className={`h-4 w-4 ${displayTheme === mode ? "text-text-primary" : "text-text-tertiary"}`} />
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 font-medium">Model</p>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
              <option>Auto</option>
              <option>Claude Sonnet</option>
              <option>GPT-4.1</option>
            </select>
          </section>

          <section>
            <p className="mb-2 font-medium">System Prompt</p>
            <textarea
              value={displayPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="h-24 w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent-orange focus:ring-1 focus:ring-accent-orange"
            />
            <div className="mt-2 flex justify-between">
              <button onClick={() => setSystemPrompt("")} className="text-text-tertiary">Reset</button>
              <button
                onClick={() => localStorage.setItem(PROMPT_STORAGE_KEY, systemPrompt)}
                className="rounded-md bg-accent-orange px-3 py-1 text-white"
              >
                Save
              </button>
            </div>
          </section>

          <section className="flex items-center justify-between">
            <div>
              <p className="font-medium">Workspace config</p>
              <p className="text-xs text-text-tertiary">Enable workspace file access</p>
            </div>
            <button
              onClick={() => setWorkspaceMode((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${workspaceMode ? "bg-accent-orange" : "bg-bg-elevated"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-bg-surface transition-all duration-200 ${workspaceMode ? "left-5" : "left-0.5"}`} />
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
