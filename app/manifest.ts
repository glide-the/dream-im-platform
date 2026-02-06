import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI for Sales",
    short_name: "AI Sales",
    description: "AI for Sales - Mobile-first PWA",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F7FB",
    theme_color: "#2F6FED",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
