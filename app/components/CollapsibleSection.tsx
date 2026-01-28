"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronUp } from "./Icons";

interface CollapsibleSectionProps {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  className?: string;
}

export default function CollapsibleSection({
  title,
  defaultCollapsed = false,
  children,
  className = ""
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`transition-all duration-300 ${className}`}>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-bg-secondary"
      >
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        {isCollapsed ? (
          <IconChevronDown className="h-4 w-4 text-text-secondary" />
        ) : (
          <IconChevronUp className="h-4 w-4 text-text-secondary" />
        )}
      </button>

      {!isCollapsed && (
        <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-4 transition-all duration-300">
          {children}
        </div>
      )}
    </div>
  );
}
