import React from "react";
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
      <body
        className={`${notoSans.variable} ${notoSerif.variable} ${plexMono.variable} font-body`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
