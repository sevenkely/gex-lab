import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Tests unitaires (Vitest).
 *
 * Le calcul GEX, les ratios, Black-Scholes et le formatage sont du TypeScript
 * pur : ils tournent en environnement node. Les tests de composants/ providers
 * qui ont besoin du DOM basculent en jsdom via l'en-tête de fichier
 * `// @vitest-environment jsdom` ou MSW pour les fixtures HTTP.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    environment: "node",
    globals: true,
    reporters: ["default"],
  },
});
