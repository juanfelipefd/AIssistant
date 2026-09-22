import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIssistant",
    short_name: "AIssistant",
    theme_color: "#000000",
    display: "standalone",
  };
}
