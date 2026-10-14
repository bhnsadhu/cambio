import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION } from "@/lib/site";

/** Home screen install. Icons come from scripts/brand-assets.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cambio",
    short_name: "Cambio",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
