"use client";

import React, { useCallback, useState } from "react";
import Sidebar from "../components/dashboard/Sidebar";
import VerticalNav from "../components/dashboard/VerticalNav";
import FileSidebar from "../components/dashboard/FileSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [fileSidebarOpen, setFileSidebarOpen] = useState(false);

  // Shared workspace ID for the file sidebar - used for global file browsing.
  // Conversation-specific workspaces are created per-session in the API route.
  const [fileSidebarSessionId] = useState(() => "shared-workspace");

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
    <div className="flex min-h-screen bg-[var(--luxury-ivory)]">
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
