"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AIInputDock, { toAttachment, type Attachment as DockAttachment } from "./components/AIInputDock";
import { ChatPanel } from "./components/chat";
import FileSidebar from "./components/dashboard/FileSidebar";
import QuickActionCard from "./components/dashboard/QuickActionCard";
import Sidebar from "./components/dashboard/Sidebar";
import VerticalNav from "./components/dashboard/VerticalNav";
import { IconPlus } from "./components/Icons";
import { QUICK_ACTION_CARDS } from "./components/dashboard/const";
import { useCustomers } from "./lib/queries";
import { createId } from "./lib/id";
import { useWorkspaceSession } from "./app/workspace-context";

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || element.isContentEditable;
}

export default function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(true);
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [threadId, setThreadId] = useState(() => createId("chat"));
  const [queuedPrompt, setQueuedPrompt] = useState("");
  const [queuedAttachments, setQueuedAttachments] = useState<DockAttachment[]>([]);
  const [queuedPromptNonce, setQueuedPromptNonce] = useState(0);
  const { activeSessionId, setActiveSessionId } = useWorkspaceSession();
  const fileSidebarSessionId = activeSessionId ?? threadId;
  const { data } = useCustomers({ pageSize: 6, sort: "updated_at", order: "desc" });

  const contextCustomers = useMemo(
    () => (data?.data ?? []).map((c) => ({ id: c.id, name: c.name, company: c.company })),
    [data?.data],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = typeof event.key === "string" ? event.key : "";

      if (key.toLowerCase() === "i") {
        if (isTypingTarget(document.activeElement) || isTypingTarget(event.target)) return;
        event.preventDefault();
        const chatInput = document.getElementById("chat-input") as HTMLInputElement | null;
        chatInput?.focus();
      }
      if (key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setActiveSessionId(threadId);
  }, [threadId, setActiveSessionId]);

  useEffect(() => {
    return () => {
      setActiveSessionId(null);
    };
  }, [setActiveSessionId]);

  function handleSendFromQuickInput(promptText: string, attachments: DockAttachment[] = []) {
    if (!promptText.trim() && attachments.length === 0) return;
    setChatOpen(true);
    setQueuedPrompt(promptText.trim());
    setQueuedAttachments(attachments);
    setQueuedPromptNonce((v) => v + 1);
  }

  const handleNewChat = useCallback(() => {
    setThreadId(createId("chat"));
    setQueuedPrompt("");
    setQueuedAttachments([]);
    setQueuedPromptNonce(0);
    setChatOpen(false);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setFileSidebarOpen(false);
    if (window.innerWidth >= 768) {
      setDesktopCollapsed((v) => !v);
    } else {
      setSidebarOpen((v) => !v);
    }
  }, []);

  const handleToggleFileSidebar = useCallback(() => {
    const nextOpen = !fileSidebarOpen;
    setFileSidebarOpen(nextOpen);
    if (nextOpen) {
      setSidebarOpen(false);
      if (window.innerWidth >= 768) {
        setDesktopCollapsed(true);
      }
    }
  }, [fileSidebarOpen]);

  return (
    <div className="flex h-[100dvh] min-h-screen overflow-hidden bg-bg-primary">
      <VerticalNav
        onToggleSidebar={handleToggleSidebar}
        onToggleFileSidebar={handleToggleFileSidebar}
      />
      <Sidebar open={sidebarOpen} desktopCollapsed={desktopCollapsed} onClose={() => setSidebarOpen(false)} />
      <FileSidebar
        sessionId={fileSidebarSessionId}
        open={fileSidebarOpen}
        onClose={() => setFileSidebarOpen(false)}
      />

      <main
        className={[
          "flex h-full min-w-0 flex-1 flex-col overflow-hidden px-4 pt-6 md:px-12",
          chatOpen
            ? "pb-[env(safe-area-inset-bottom)]"
            : "pb-[calc(env(safe-area-inset-bottom)+1.5rem)] md:pb-6",
        ].join(" ")}
      >
        <div className="mb-4 flex items-center justify-between">
          <button className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-text-primary md:hidden" onClick={() => setSidebarOpen(true)}>
            ☰ Menu
          </button>
          {chatOpen && (
            <button
              onClick={handleNewChat}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm font-medium text-text-secondary shadow-subtle transition-all duration-200 hover:border-accent-orange hover:text-accent-orange hover:shadow-medium active:scale-95"
            >
              <IconPlus className="h-4 w-4" />
              New Chat
            </button>
          )}
        </div>

        {!chatOpen ? (
          <div className="flex-1 overflow-y-auto">
            <section className="relative animate-fadeUp pt-4 pb-2">
              <div className="pointer-events-none absolute -right-10 top-6 h-32 w-32 rounded-full bg-accent-orange/10 blur-xl" />
              <h1 className="relative z-10 text-[clamp(1.75rem,4vw,2.5rem)] font-display font-bold text-text-primary">
                嗨，准备好<span className="text-accent-orange">开始</span>了吗？
              </h1>
            </section>

            <section className="mx-auto mt-6 w-full max-w-3xl">
              <AIInputDock
                contextCustomers={contextCustomers}
                workspaceSessionId={threadId}
                placeholder="按 i 开始对话"
                onSendMessage={(message, uploadedFiles = []) => {
                  handleSendFromQuickInput(
                    message,
                    uploadedFiles.map(toAttachment),
                  );
                }}
              />
            </section>

            <section className="mx-auto mt-8 w-full max-w-6xl grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {QUICK_ACTION_CARDS.map((item) => (
                <QuickActionCard
                  key={item.title}
                  item={item}
                  onClick={(nextPrompt) => handleSendFromQuickInput(nextPrompt)}
                />
              ))}
            </section>
          </div>
        ) : (
          <section className="flex min-h-0 flex-1 overflow-hidden animate-fadeUp">
            <ChatPanel
              key={threadId}
              threadId={threadId}
              contextCustomers={contextCustomers}
              inputPlaceholder="继续提问..."
              className="flex flex-1 min-h-0 flex-col"
              queuedPrompt={queuedPrompt}
              queuedAttachments={queuedAttachments}
              queuedPromptNonce={queuedPromptNonce}
            />
          </section>
        )}
      </main>
    </div>
  );
}
