"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminSectionTabs({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; href: string }>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="overflow-x-auto border-b border-border">
      <div className="flex min-w-max gap-6">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative min-h-12 py-3 text-sm ${active ? "font-semibold text-text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
