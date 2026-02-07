"use client";

import { ReactNode } from "react";

export default function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] px-4">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-bg-surface p-5 shadow-medium">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text-primary">
            {title}
          </h2>
          <button
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg-secondary text-text-secondary"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
