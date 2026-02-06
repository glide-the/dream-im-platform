"use client";

import { useState, type ReactNode } from "react";
import { IconFolder, IconHistory, IconHome, IconSettings, IconSparkles, IconTool, IconUser } from "../Icons";

type NavItemId = "home" | "folder" | "tool" | "history" | "settings" | "user";

interface VerticalNavProps {
  onToggleSidebar: () => void;
  onNavigate?: (item: NavItemId) => void;
}

const navItems: Array<{ id: NavItemId; label: string; icon: ReactNode; triggersSidebar?: boolean }> = [
  { id: "home", label: "首页", icon: <IconHome className="h-6 w-6" /> },
  { id: "folder", label: "文件夹", icon: <IconFolder className="h-6 w-6" /> },
  { id: "tool", label: "工具", icon: <IconTool className="h-6 w-6" /> },
  { id: "history", label: "历史", icon: <IconHistory className="h-6 w-6" />, triggersSidebar: true },
  { id: "settings", label: "设置", icon: <IconSettings className="h-6 w-6" /> },
];

export default function VerticalNav({ onToggleSidebar, onNavigate }: VerticalNavProps) {
  const [activeItem, setActiveItem] = useState<NavItemId>("home");

  const handleNavigate = (item: NavItemId, triggersSidebar?: boolean) => {
    setActiveItem(item);
    onNavigate?.(item);
    if (triggersSidebar) onToggleSidebar();
  };

  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-[var(--neutral-border)] bg-white/70 py-6 backdrop-blur-sm md:flex">
      <button onClick={onToggleSidebar} className="mb-8 rounded-xl bg-accent-orange p-2 text-white" aria-label="切换对话列表">
        <IconSparkles className="h-4 w-4" />
      </button>
      <div className="flex flex-1 flex-col items-center gap-6 text-text-tertiary">
        {navItems.map((item) => {
          const isActive = activeItem === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              onClick={() => handleNavigate(item.id, item.triggersSidebar)}
              className={`group flex flex-col items-center rounded-xl p-2 transition-colors hover:bg-[#F5F5F5] ${isActive ? "text-accent-orange" : ""}`}
            >
              {item.icon}
              <span className={`mt-1 h-[3px] w-[3px] rounded-full ${isActive ? "bg-accent-orange" : "bg-transparent"}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="用户"
        onClick={() => handleNavigate("user")}
        className={`group flex flex-col items-center rounded-full border border-border p-2 transition-colors hover:bg-[#F5F5F5] ${activeItem === "user" ? "text-accent-orange" : "text-text-tertiary"}`}
      >
        <IconUser className="h-6 w-6" />
        <span className={`mt-1 h-[3px] w-[3px] rounded-full ${activeItem === "user" ? "bg-accent-orange" : "bg-transparent"}`} aria-hidden="true" />
      </button>
    </aside>
  );
}
