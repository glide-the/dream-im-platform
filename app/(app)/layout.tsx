"use client";

import React, { useState } from "react";
import Sidebar from "../components/dashboard/Sidebar";
import VerticalNav from "../components/dashboard/VerticalNav";
import type { Conversation } from "../lib/types";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  return (
    <div className="flex min-h-screen bg-bg-primary">
      <VerticalNav onToggleSidebar={() => (window.innerWidth >= 768 ? setDesktopCollapsed((v) => !v) : setSidebarOpen((v) => !v))} />
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
      <main className="flex-1 px-4 pb-8 pt-4 md:px-8">
        <div className="mb-4 md:hidden">
          <button className="rounded-lg border border-border bg-white px-3 py-2 text-sm" onClick={() => setSidebarOpen(true)}>
            ☰ Menu
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
