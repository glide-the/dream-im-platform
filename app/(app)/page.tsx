"use client";

import { useState, useRef, useEffect } from "react";
import { QUICK_ACTION_CARDS } from "@/components/dashboard/const";
import QuickActionCard from "@/components/dashboard/QuickActionCard";
import { ChatPanel } from "@/components/chat";

export default function DashboardPage() {
  const [inputValue, setInputValue] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [chatThreadId] = useState(
    () => `dashboard-${Date.now().toString(36)}`
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: press 'i' to focus input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "i" &&
        !showChat &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && showChat) {
        setShowChat(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showChat]);

  const handleCardClick = (prompt: string) => {
    setInputValue(prompt);
    inputRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!inputValue.trim()) return;
    setShowChat(true);
  };

  // Chat mode: show full-height ChatPanel
  if (showChat) {
    return (
      <div className="mt-12 lg:mt-0">
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => setShowChat(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-primary"
          >
            ← Back to Dashboard
          </button>
          <span className="text-sm text-text-tertiary">
            Conversation
          </span>
        </div>
        <ChatPanel
          threadId={chatThreadId}
          contextCustomers={[]}
          inputPlaceholder="Ask anything..."
          className="rounded-2xl border border-border bg-bg-surface p-4"
        />
      </div>
    );
  }

  return (
    <div className="mt-12 lg:mt-0">
      {/* Welcome Section */}
      <div className="mb-8 animate-fade-up">
        <h1
          className="font-display text-text-primary"
          style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)" }}
        >
          Howdy, ready to make some magic? ✨
        </h1>
        <p className="mt-2 text-sm text-text-tertiary">
          Your AI-powered productivity dashboard
        </p>
      </div>

      {/* Quick Command Input */}
      <div className="mb-8 animate-fade-up" style={{ animationDelay: "0.1s" }}>
        <div className="rounded-2xl border border-border bg-bg-surface/80 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Press i to chat"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
            />
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* Quick Action Cards Grid */}
      <div
        className="grid grid-cols-1 gap-4 animate-fade-up md:grid-cols-2 lg:grid-cols-3"
        style={{ animationDelay: "0.2s" }}
      >
        {QUICK_ACTION_CARDS.map((card, index) => (
          <QuickActionCard
            key={card.title}
            card={card}
            index={index}
            onClick={handleCardClick}
          />
        ))}
      </div>
    </div>
  );
}
