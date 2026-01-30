"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { IconChevronDown, IconChevronUp } from "./Icons";

interface CollapsibleSectionProps {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  className?: string;
  rightElement?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function CollapsibleSection({
  title,
  defaultCollapsed = false,
  children,
  className = "",
  rightElement,
  collapsed = undefined,
  onToggleCollapse
}: CollapsibleSectionProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  // Use derived state
  const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed;

  // Update internal state when collapsed prop changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (collapsed !== undefined) {
      setInternalCollapsed(collapsed);
    }
  }, [collapsed]);

  const handleToggle = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed(!isCollapsed);
    }
  }, [onToggleCollapse, isCollapsed]);

  return (
    <div className={`transition-all duration-300 ${className}`}>
      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          <button
            onClick={handleToggle}
            className="flex items-center gap-2"
          >
            <span className="text-sm font-semibold text-text-primary">{title}</span>
          </button>
        </div>
        <div className="flex items-center gap-4">
          {rightElement && (
            <div className="flex items-center">
              {rightElement}
            </div>
          )}
          <button
            onClick={handleToggle}
            className="flex items-center"
          >
            {!isCollapsed ? (
              <IconChevronUp className="h-4 w-4 text-text-secondary" />
            ) : (
              <IconChevronDown className="h-4 w-4 text-text-secondary" />
            )}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-4 transition-all duration-300">
          {children}
        </div>
      )}
    </div>
  );
}
