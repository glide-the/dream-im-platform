"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChecklist, IconUsers, IconUser } from "./Icons";

const items = [
  { href: "/todo", label: "待办", icon: IconChecklist },
  { href: "/customers", label: "客户", icon: IconUsers },
  { href: "/me", label: "我的", icon: IconUser }
];

export default function BottomNav() {
  const pathname = usePathname();
  const hideNav =
    pathname.startsWith("/ai-assistant") ||
    (pathname.startsWith("/customers/") && pathname.split("/").length >= 3);

  if (hideNav) {
    return null;
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg-surface/95 backdrop-blur-sm md:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-around px-6 py-3">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1 text-xs font-medium"
            >
              <span
                className={`grid h-9 w-9 place-items-center rounded-full ${
                  active ? "bg-accent-light text-accent" : "text-text-tertiary"
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className={active ? "text-accent" : "text-text-tertiary"}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
