"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatPanel } from "./components/chat";
import QuickActionCard from "./components/dashboard/QuickActionCard";
import Sidebar from "./components/dashboard/Sidebar";
import VerticalNav from "./components/dashboard/VerticalNav";
import { QUICK_ACTION_CARDS } from "./components/dashboard/const";
import { useCustomers } from "./lib/queries";
import type { Conversation } from "./lib/types";

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

export default function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [queuedPromptNonce, setQueuedPromptNonce] = useState(0);
  const openFileDialogSignal = 0;
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
        const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement | null;
        chatInput?.focus();
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleQueuePrompt(nextPrompt: string) {
    if (!nextPrompt.trim()) return;
    setActiveConversation({ id: "new", title: "", status: "pending", created_at: "", updated_at: "", messages: [] });
    setQueuedPrompt(nextPrompt.trim());
    setQueuedPromptNonce((v) => v + 1);
  }

  const hasActiveConversation = Boolean(activeConversation);

  return (
    <div className="flex min-h-screen bg-bg-primary">
      <VerticalNav
        onToggleSidebar={() => (window.innerWidth >= 768 ? setDesktopCollapsed((v) => !v) : setSidebarOpen((v) => !v))}
      />
      <Sidebar
        open={sidebarOpen}
        desktopCollapsed={desktopCollapsed}
        activeConversationId={activeConversation?.id}
        onSelectConversation={(conversation) => {
          setActiveConversation(conversation);
          setSidebarOpen(false);
        }}
        onNewChat={() => {
          setActiveConversation({ id: "new", title: "", status: "pending", created_at: "", updated_at: "", messages: [] });
          setSidebarOpen(false);
        }}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="flex-1 px-4 py-6 md:px-12">
          <button className="mb-4 rounded-lg border border-border bg-white px-3 py-2 text-sm md:hidden" onClick={() => setSidebarOpen(true)}>
            ☰ 历史
          </button>

          {!hasActiveConversation ? (
            <div className="animate-fadeUp">
              <section>
                <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-display font-semibold text-text-primary">
                  欢迎回来，今天想聊点什么？
                </h1>
                <p className="mt-2 text-sm text-text-secondary">选择一个快捷问题或开始新的对话。</p>
              </section>

              <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {QUICK_ACTION_CARDS.map((item) => (
                  <QuickActionCard key={item.title} item={item} onClick={handleQueuePrompt} />
                ))}
              </section>
            </div>
          ) : (
            <section className="flex min-h-0 flex-1 animate-fadeUp">
              <ChatPanel
                threadId={activeConversation?.id ?? "dashboard-thread"}
                contextCustomers={contextCustomers}
                inputPlaceholder="继续提问..."
                className="flex flex-1 min-h-0 flex-col"
                queuedPrompt={queuedPrompt}
                queuedPromptNonce={queuedPromptNonce}
                openFileDialogSignal={openFileDialogSignal}
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
