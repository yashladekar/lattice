import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lattice — Knowledge OS",
    short_name: "Lattice",
    description:
      "A local-first knowledge OS for writing, visual thinking, connected notes, and learning.",
    start_url: "/app",
    display: "standalone",
    orientation: "any",
    background_color: "#f8f5ee",
    theme_color: "#1d1d1a",
    categories: ["productivity", "education", "utilities"],
    icons: [
      {
        src: "/brand/lattice-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/brand/lattice-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/app",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  };
}
