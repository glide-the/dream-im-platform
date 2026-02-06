"use client";

import React, { useState } from "react";
import VerticalNav from "../components/dashboard/VerticalNav";
import Sidebar from "../components/dashboard/Sidebar";

export default function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Desktop Vertical Nav */}
      <VerticalNav onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div className="min-h-screen lg:pl-16">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-10">
          {children}
        </div>
      </div>

      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-border bg-bg-surface/95 px-4 py-3 backdrop-blur-sm lg:hidden">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="grid h-8 w-8 place-items-center rounded-lg text-text-secondary hover:bg-bg-primary"
        >
          ☰
        </button>
        <span className="text-sm font-semibold text-text-primary">AI for Sales</span>
        <div className="grid h-8 w-8 place-items-center rounded-full bg-bg-secondary text-xs font-medium text-text-secondary">
          U
        </div>
      </div>
    </div>
  );
}
