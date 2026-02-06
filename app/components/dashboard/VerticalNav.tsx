"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface VerticalNavProps {
  onToggleSidebar: () => void;
}

export default function VerticalNav({ onToggleSidebar }: VerticalNavProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", icon: "💬", label: "Chat", active: pathname === "/" },
    {
      href: "/customers",
      icon: "👥",
      label: "Customers",
      active: pathname.startsWith("/customers"),
    },
    {
      href: "#",
      icon: "⚙️",
      label: "Settings",
      active: false,
      onClick: onToggleSidebar,
    },
  ];

  return (
    <nav className="fixed left-0 top-0 z-50 hidden h-full w-16 flex-col items-center border-r border-border bg-bg-surface py-4 lg:flex">
      {/* Logo */}
      <div className="mb-8 grid h-10 w-10 place-items-center rounded-xl bg-accent text-white text-sm font-bold">
        AI
      </div>

      {/* Navigation Items */}
      <div className="flex flex-1 flex-col items-center gap-2">
        {navItems.map((item) =>
          item.onClick ? (
            <button
              key={item.label}
              onClick={item.onClick}
              className={`grid h-10 w-10 place-items-center rounded-xl text-lg transition-colors ${
                item.active
                  ? "bg-accent-light text-accent"
                  : "text-text-tertiary hover:bg-bg-primary hover:text-text-secondary"
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ) : (
            <Link
              key={item.label}
              href={item.href}
              className={`grid h-10 w-10 place-items-center rounded-xl text-lg transition-colors ${
                item.active
                  ? "bg-accent-light text-accent"
                  : "text-text-tertiary hover:bg-bg-primary hover:text-text-secondary"
              }`}
              title={item.label}
            >
              {item.icon}
            </Link>
          )
        )}
      </div>

      {/* User Avatar */}
      <div className="mt-auto">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-bg-secondary text-sm font-medium text-text-secondary">
          U
        </div>
      </div>
    </nav>
  );
}
