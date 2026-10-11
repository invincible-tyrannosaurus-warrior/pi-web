import type { MetadataRoute } from "next";

// Read per request so PI_WEB_APP_NAME takes effect without a rebuild.
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const iconVersion = process.env.NEXT_PUBLIC_ICON_VERSION ? `?v=${process.env.NEXT_PUBLIC_ICON_VERSION}` : "";
  const appName = process.env.PI_WEB_APP_NAME?.trim() || "Pi Web";

  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#f5f5f5",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: `/icons/icon-192.png${iconVersion}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-512.png${iconVersion}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
