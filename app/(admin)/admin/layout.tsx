import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AdminProviders from "@/components/admin/AdminProviders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "INK / OPS",
  description: "AI 创作平台内部运营控制台",
};

function isAdminShellEnabled(): boolean {
  const configuredValue = process.env.ADMIN_CONSOLE_ENABLED;

  if (configuredValue !== undefined) {
    return configuredValue === "true";
  }

  return process.env.NODE_ENV === "development";
}

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isAdminShellEnabled()) {
    notFound();
  }

  return <AdminProviders>{children}</AdminProviders>;
}
