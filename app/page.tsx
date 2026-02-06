"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/chat";
import QuickActionCard from "./components/dashboard/QuickActionCard";
import Sidebar from "./components/dashboard/Sidebar";
import VerticalNav from "./components/dashboard/VerticalNav";
import { QUICK_ACTION_CARDS } from "./components/dashboard/const";
import { useCustomers } from "./lib/queries";

export default function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useCustomers({ pageSize: 6, sort: "updated_at", order: "desc" });

  const contextCustomers = useMemo(
    () => (data?.data ?? []).map((c) => ({ id: c.id, name: c.name, company: c.company })),
    [data?.data],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape") setSidebarOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-screen bg-[var(--luxury-ivory)]">
      <VerticalNav onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 px-4 py-6 md:px-12">
        <button className="mb-4 rounded-lg border border-border bg-white px-3 py-2 md:hidden" onClick={() => setSidebarOpen(true)}>
          ☰ Menu
        </button>

        <section className="animate-fadeUp">
          <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-display font-bold text-[var(--luxury-charcoal)]">
            Howdy <span className="text-[var(--luxury-rose)]">there</span>, ready to make some magic?
          </h1>
        </section>

        <section className="mt-6 rounded-2xl border border-[var(--neutral-border)] bg-white/70 p-5 backdrop-blur-md">
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Press i to chat"
            className="w-full bg-transparent py-2 text-base placeholder:text-text-tertiary"
          />
          <div className="mt-4 flex items-center justify-between">
            <button className="text-sm text-text-secondary">+ Add</button>
            <button onClick={() => setChatOpen(true)} className="rounded-full bg-[var(--luxury-rose)] px-4 py-1 text-sm text-white">
              Send
            </button>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTION_CARDS.map((item) => (
            <QuickActionCard key={item.title} item={item} onClick={(nextPrompt) => setPrompt(nextPrompt)} />
          ))}
        </section>

        {chatOpen && (
          <section className="mt-8">
            <ChatPanel
              threadId="dashboard-thread"
              contextCustomers={contextCustomers}
              inputPlaceholder={prompt || "继续提问..."}
              className="space-y-3"
            />
          </section>
        )}
      </main>
    </div>
  );
}
