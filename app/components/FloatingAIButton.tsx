"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSparkles } from "./Icons";

export default function FloatingAIButton() {
  const pathname = usePathname();

  // 在客户详情页隐藏悬浮球（因为已有固定在底部的 AI Input Dock）
  if (
    pathname.startsWith("/ai-assistant") ||
    (pathname.startsWith("/customers/") && pathname.split("/").length >= 3)
  ) {
    return null;
  }

  let href = "/ai-assistant";
  if (pathname.startsWith("/customers/")) {
    const id = pathname.split("/")[2];
    if (id) {
      href = `/ai-assistant?contextCustomerId=${encodeURIComponent(id)}`;
    }
  }

  return (
    <Link
      href={href}
      className="fixed bottom-20 right-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-accent transition hover:scale-105 md:bottom-8 md:right-10"
      aria-label="打开 AI 助手"
    >
      <IconSparkles className="h-6 w-6" />
    </Link>
  );
}
