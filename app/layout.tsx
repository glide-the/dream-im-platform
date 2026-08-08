import React from "react";
import Script from "next/script";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import localFont from "next/font/local";
import { Providers } from "./app/providers";

const notoSans = localFont({
  src: [
    { path: "./fonts/NotoSansSC-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/NotoSansSC-500.ttf", weight: "500", style: "normal" }
  ],
  variable: "--font-body",
  display: "swap"
});

const notoSerif = localFont({
  src: [{ path: "./fonts/NotoSerifSC-600.ttf", weight: "600", style: "normal" }],
  variable: "--font-display",
  display: "swap"
});

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500.ttf", weight: "500", style: "normal" }
  ],
  variable: "--font-mono",
  display: "swap"
});

const themeColor = [
  { media: "(prefers-color-scheme: light)", color: "#F5F7FB" },
  { media: "(prefers-color-scheme: dark)", color: "#0F0F12" }
];

export const metadata: Metadata = {
  title: {
    default: "Ink Memory Admin",
    template: "%s · Ink Memory Admin",
  },
  description: "Ink Memory AI 创作平台运营、模型、计费与代理网关控制台",
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
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
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
