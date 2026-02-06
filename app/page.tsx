"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./components/chat";
import QuickActionCard from "./components/dashboard/QuickActionCard";
import Sidebar from "./components/dashboard/Sidebar";
import VerticalNav from "./components/dashboard/VerticalNav";
import { IconArrowUp, IconPlus } from "./components/Icons";
import { QUICK_ACTION_CARDS } from "./components/dashboard/const";
import { useCustomers } from "./lib/queries";
import { createId } from "./lib/id";

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

export default function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [threadId, setThreadId] = useState(() => createId("chat"));
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [queuedPromptNonce, setQueuedPromptNonce] = useState(0);
  const [openFileDialogSignal, setOpenFileDialogSignal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useCustomers({ pageSize: 6, sort: "updated_at", order: "desc" });

  const contextCustomers = useMemo(
    () => (data?.data ?? []).map((c) => ({ id: c.id, name: c.name, company: c.company })),
    [data?.data],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "i") {
        if (isTypingTarget(document.activeElement) || isTypingTarget(event.target)) return;
        event.preventDefault();
        if (chatOpen) {
          const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement | null;
          chatInput?.focus();
        } else {
          inputRef.current?.focus();
        }
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen]);

  function handleSendFromQuickInput() {
    if (!prompt.trim()) return;
    setChatOpen(true);
    setQueuedPrompt(prompt.trim());
    setQueuedPromptNonce((v) => v + 1);
    setPrompt("");
  }

  function handleAddFile() {
    setChatOpen(true);
    setOpenFileDialogSignal((v) => v + 1);
  }

  const handleNewChat = useCallback(() => {
    setThreadId(createId("chat"));
    setQueuedPrompt("");
    setQueuedPromptNonce(0);
    setOpenFileDialogSignal(0);
    setChatOpen(false);
  }, []);

  return (
    <div className="flex min-h-screen bg-[var(--luxury-ivory)]">
      <VerticalNav onToggleSidebar={() => (window.innerWidth >= 768 ? setDesktopCollapsed((v) => !v) : setSidebarOpen((v) => !v))} />
      <Sidebar open={sidebarOpen} desktopCollapsed={desktopCollapsed} onClose={() => setSidebarOpen(false)} />

      <main className="flex min-h-screen min-w-0 flex-1 flex-col px-4 py-6 md:px-12">
        <div className="mb-4 flex items-center justify-between">
          <button className="rounded-lg border border-border bg-white px-3 py-2 md:hidden" onClick={() => setSidebarOpen(true)}>
            ☰ Menu
          </button>
          {chatOpen && (
            <button
              onClick={handleNewChat}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--neutral-border)] bg-white px-3 py-2 text-sm font-medium text-text-secondary shadow-sm transition-all duration-200 hover:border-accent-orange hover:text-accent-orange hover:shadow-md active:scale-95"
            >
              <IconPlus className="h-4 w-4" />
              New Chat
            </button>
          )}
        </div>

        {!chatOpen ? (
          <>
            <section className="relative animate-fadeUp pt-4 pb-2">
              <div className="pointer-events-none absolute -right-10 top-6 h-32 w-32 rounded-full bg-accent-orange/10 blur-xl" />
              <h1 className="relative z-10 text-[clamp(1.75rem,4vw,2.5rem)] font-display font-bold text-[var(--luxury-charcoal)]">
                Howdy <span className="text-accent-orange">there</span>, ready to make some magic?
              </h1>
            </section>

            <section className="mx-auto mt-6 w-full max-w-3xl">
              <div className="rounded-2xl border border-[var(--neutral-border)] bg-white/80 p-5 shadow-sm backdrop-blur-md transition-all duration-300 hover:shadow-md">
                <input
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Press i to chat"
                  className="w-full bg-transparent py-2 text-base text-[var(--luxury-charcoal)] placeholder:text-text-tertiary focus:outline-none"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSendFromQuickInput();
                    }
                  }}
                />
                <div className="mt-4 flex items-center justify-between">
                  <button className="text-sm font-medium text-text-secondary transition-colors hover:text-accent-orange" onClick={handleAddFile}>
                    + Add
                  </button>
                  <button
                    onClick={handleSendFromQuickInput}
                    className="grid h-9 w-9 place-items-center rounded-full bg-accent-orange text-white shadow-md transition-all duration-200 hover:scale-105 hover:bg-orange-600 active:scale-95"
                  >
                    <IconArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </section>

            <section className="mx-auto mt-8 w-full max-w-6xl grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {QUICK_ACTION_CARDS.map((item) => (
                <QuickActionCard key={item.title} item={item} onClick={(nextPrompt) => setPrompt(nextPrompt)} />
              ))}
            </section>
          </>
        ) : (
          <section className="flex min-h-0 flex-1 animate-fadeUp">
            <ChatPanel
              key={threadId}
              threadId={threadId}
              contextCustomers={contextCustomers}
              inputPlaceholder="继续提问..."
              className="flex flex-1 min-h-0 flex-col"
              queuedPrompt={queuedPrompt}
              queuedPromptNonce={queuedPromptNonce}
              openFileDialogSignal={openFileDialogSignal}
            />
          </section>
        )}
      </main>
    </div>
  );
}
