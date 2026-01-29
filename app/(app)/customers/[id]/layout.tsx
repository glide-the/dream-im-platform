"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export default function CustomerDetailLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  useEffect(() => {
    // 隐藏底部导航栏
    const bottomNav = document.querySelector('nav');
    if (bottomNav) {
      (bottomNav as HTMLElement).style.display = 'none';
    }

    // 隐藏悬浮球
    const fab = document.querySelector('a[href*="/ai-assistant"]');
    if (fab) {
      (fab as HTMLElement).style.display = 'none';
    }

    // 清理函数：恢复显示
    return () => {
      if (bottomNav) {
        (bottomNav as HTMLElement).style.display = '';
      }
      if (fab) {
        (fab as HTMLElement).style.display = '';
      }
    };
  }, [pathname]);

  return <>{children}</>;
}
