"use client";

import { IconGrid, IconFolder, IconClock, IconSettings, IconUser } from "../Icons";

interface VerticalNavProps {
  onToggleSidebar: () => void;
  unreadCount?: number;
}

export default function VerticalNav({ onToggleSidebar, unreadCount = 7 }: VerticalNavProps) {
  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-[var(--neutral-border)] bg-white/70 py-6 backdrop-blur-sm md:flex">
      <button onClick={onToggleSidebar} className="mb-8 rounded-lg bg-accent-orange p-2 text-white transition-transform duration-200 hover:rotate-12">
        <IconGrid className="h-4 w-4" />
      </button>
      <div className="flex flex-1 flex-col items-center gap-6 text-text-tertiary">
        <button className="relative text-accent-orange transition-colors">
          <IconFolder className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent-orange text-[10px] font-semibold text-white">{unreadCount}</span>
          )}
        </button>
        <button className="transition-colors hover:text-accent-orange">
          <IconClock className="h-5 w-5" />
        </button>
        <button className="transition-colors hover:text-accent-orange">
          <IconSettings className="h-5 w-5" />
        </button>
      </div>
      <div className="rounded-full border-2 border-white shadow-md overflow-hidden">
        <div className="rounded-full border border-border p-2">
          <IconUser className="h-4 w-4" />
        </div>
      </div>
    </aside>
  );
}
