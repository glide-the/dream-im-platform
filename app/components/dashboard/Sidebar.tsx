"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "system" | "dark";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("dashboard-theme") as ThemeMode | null) ?? "system";
  });
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window === "undefined") return "You are a concise and practical AI sales assistant.";
    return localStorage.getItem("dashboard-system-prompt") ?? "You are a concise and practical AI sales assistant.";
  });
  const [workspaceMode, setWorkspaceMode] = useState(true);
  const [model, setModel] = useState("Auto");

  useEffect(() => {
    localStorage.setItem("dashboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <>
      <div className={`fixed inset-0 z-30 bg-black/30 md:hidden ${open ? "block" : "hidden"}`} onClick={onClose} />
      <aside
        className={`fixed left-0 top-0 z-40 h-full w-[280px] border-r border-[var(--neutral-border)] bg-white p-5 transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-text-tertiary">Workspace</p>
          <h2 className="text-xl font-semibold text-[var(--luxury-charcoal)]">AI Sales Console</h2>
        </div>

        <div className="space-y-6 text-sm">
          <section>
            <p className="mb-2 font-medium">Theme</p>
            <div className="flex gap-2">
              {(["light", "system", "dark"] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={`rounded-full border px-3 py-1 capitalize ${theme === mode ? "border-[var(--luxury-rose)] text-[var(--luxury-rose)]" : "border-border text-text-secondary"}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 font-medium">Model</p>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2">
              <option>Auto</option>
              <option>Claude Sonnet</option>
              <option>GPT-4.1</option>
            </select>
          </section>

          <section>
            <p className="mb-2 font-medium">System Prompt</p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="h-24 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm"
            />
            <div className="mt-2 flex justify-between">
              <button onClick={() => setSystemPrompt("")} className="text-text-tertiary">Reset</button>
              <button
                onClick={() => localStorage.setItem("dashboard-system-prompt", systemPrompt)}
                className="rounded-md bg-[var(--luxury-rose)] px-3 py-1 text-white"
              >
                Save
              </button>
            </div>
          </section>

          <section className="flex items-center justify-between">
            <p className="font-medium">Workspace config</p>
            <button
              onClick={() => setWorkspaceMode((v) => !v)}
              className={`relative h-6 w-11 rounded-full ${workspaceMode ? "bg-[var(--luxury-rose)]" : "bg-gray-300"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${workspaceMode ? "left-5" : "left-0.5"}`} />
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
