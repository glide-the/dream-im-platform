import React from "react";
import "./globals.css";
import { Providers } from "./app/providers";

export const metadata = {
  title: "AI for Sales",
  description: "AI for Sales - Mobile-first PWA",
  manifest: "/manifest.webmanifest",
  themeColor: "#2F6FED",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AI for Sales"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2F6FED"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="font-body">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
