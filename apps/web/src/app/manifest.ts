import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PreciosUY",
    short_name: "PreciosUY",
    description: "Compará precios de supermercados de Uruguay",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#0f7b5f",
    lang: "es-UY",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
