import React from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Noto_Sans_SC, Noto_Serif_SC, IBM_Plex_Mono } from "next/font/google";
import { Providers } from "./app/providers";

const notoSans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-body"
});

const notoSerif = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-display"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono"
});

const themeColor = [
  { media: "(prefers-color-scheme: light)", color: "#F5F7FB" },
  { media: "(prefers-color-scheme: dark)", color: "#0F0F12" }
];

export const metadata: Metadata = {
  title: "AI for Sales",
  description: "AI for Sales - Mobile-first PWA",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI for Sales"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor
};

const THEME_INIT_SCRIPT = `
(() => {
  const KEY = "dashboard-theme";
  try {
    const stored = localStorage.getItem(KEY);
    const mode = stored === "light" || stored === "dark" ? stored : "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolved = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    const root = document.documentElement;
    root.dataset.themeMode = mode;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  } catch {
    document.documentElement.dataset.themeMode = "system";
  }
})();
`;

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${notoSans.variable} ${notoSerif.variable} ${plexMono.variable} font-body`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
