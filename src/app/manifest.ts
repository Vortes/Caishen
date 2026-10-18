import { type MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Caishen",
    short_name: "Caishen",
    description:
      "Your personal budget, shared expenses, and daily money review, in one calm place.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0d1f",
    theme_color: "#0c0d1f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
