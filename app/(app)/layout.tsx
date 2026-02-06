"use client";

import React, { useState } from "react";
import Sidebar from "../components/dashboard/Sidebar";
import VerticalNav from "../components/dashboard/VerticalNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--luxury-ivory)]">
      <VerticalNav onToggleSidebar={() => (window.innerWidth >= 768 ? setDesktopCollapsed((v) => !v) : setSidebarOpen((v) => !v))} />
      <Sidebar open={sidebarOpen} desktopCollapsed={desktopCollapsed} onClose={() => setSidebarOpen(false)} />
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
