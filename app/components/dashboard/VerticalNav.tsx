"use client";

import { IconChecklist, IconSearch, IconSettings, IconSparkles, IconUser } from "../Icons";

interface VerticalNavProps {
  onToggleSidebar: () => void;
}

export default function VerticalNav({ onToggleSidebar }: VerticalNavProps) {
  return (
    <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-[var(--neutral-border)] bg-white/70 py-6 backdrop-blur-sm md:flex">
      <button onClick={onToggleSidebar} className="mb-8 rounded-xl bg-[var(--luxury-rose)] p-2 text-white">
        <IconSparkles className="h-4 w-4" />
      </button>
      <div className="flex flex-1 flex-col items-center gap-5 text-text-tertiary">
        <IconSearch className="h-5 w-5" />
        <IconChecklist className="h-5 w-5" />
        <IconSettings className="h-5 w-5" />
      </div>
      <div className="rounded-full border border-border p-2">
        <IconUser className="h-4 w-4" />
      </div>
    </aside>
  );
}
