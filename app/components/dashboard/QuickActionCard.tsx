"use client";

import type { QuickActionCardData } from "./const";

interface QuickActionCardProps {
  card: QuickActionCardData;
  index: number;
  onClick: (prompt: string) => void;
}

export default function QuickActionCard({
  card,
  index,
  onClick,
}: QuickActionCardProps) {
  return (
    <button
      onClick={() => onClick(card.prompt)}
      className="group flex flex-col items-start gap-3 rounded-2xl border border-border bg-bg-surface p-5 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-md"
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <span
        className={`grid h-10 w-10 place-items-center rounded-xl text-lg ${card.color} transition-transform duration-200 group-hover:scale-110`}
      >
        {card.icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-text-primary">
          {card.title}
        </h3>
        <p className="mt-1 text-xs text-text-tertiary leading-relaxed">
          {card.description}
        </p>
      </div>
    </button>
  );
}
