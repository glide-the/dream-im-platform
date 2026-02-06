"use client";

import { useState, useEffect } from "react";

type Theme = "light" | "system" | "dark";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [theme, setTheme] = useState<Theme>("system");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("auto");

  // Load theme from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("theme") as Theme | null;
    if (saved) setTheme(saved);
  }, []);

  // Apply theme
  useEffect(() => {
    localStorage.setItem("theme", theme);
    const root = document.documentElement;
    root.removeAttribute("data-theme");
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      root.setAttribute("data-theme", "light");
    }
  }, [theme]);

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-16 top-0 z-50 h-full w-[280px] border-r border-border bg-bg-surface transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-[calc(100%+64px)] lg:translate-x-0"
        }`}
      >
        <div className="flex h-full flex-col p-5">
          {/* Brand */}
          <div className="mb-6">
            <h2 className="font-display text-lg font-semibold text-text-primary">
              AI for Sales
            </h2>
            <p className="text-xs text-text-tertiary">Productivity Dashboard</p>
          </div>

          {/* Theme Switcher */}
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold text-text-secondary">
              Theme
            </label>
            <div className="flex gap-1 rounded-lg border border-border bg-bg-primary p-1">
              {(["light", "system", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    theme === t
                      ? "bg-bg-surface text-text-primary shadow-sm"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {t === "light" ? "☀️" : t === "dark" ? "🌙" : "💻"} {t}
                </button>
              ))}
            </div>
          </div>

          {/* Model Selection */}
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold text-text-secondary">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary"
            >
              <option value="auto">Auto</option>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
            </select>
          </div>

          {/* System Prompt */}
          <div className="mb-6 flex-1">
            <label className="mb-2 block text-xs font-semibold text-text-secondary">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="h-32 w-full resize-none rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary"
              placeholder="Enter custom system prompt..."
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setSystemPrompt("")}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-primary"
              >
                Reset
              </button>
              <button
                onClick={() => {
                  localStorage.setItem("systemPrompt", systemPrompt);
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
