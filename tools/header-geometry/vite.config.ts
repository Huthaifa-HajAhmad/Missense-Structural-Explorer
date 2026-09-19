import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Build config for the variant-header geometry check (see check.mjs).
 *
 * It bundles the real `VariantHeader` with the real stylesheet and the real webfonts,
 * because every assertion is about measured text and box geometry — a stubbed or
 * font-less render would not catch the defects this exists to catch.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../..") },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    minify: false,
  },
});
