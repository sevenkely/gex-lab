import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Les snapshots GEX sont calculés et mis en cache par l'application
   * (src/server/cache.ts) : on garde donc le modèle de rendu classique et
   * `dynamic = "force-dynamic"` sur les pages de données, pour que chaque
   * requête serve le snapshot le plus frais sans prérendu figé au build.
   */
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
