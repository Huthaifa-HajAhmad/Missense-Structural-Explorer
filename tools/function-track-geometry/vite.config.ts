import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Build config for the Functional Domains sequence-track geometry check (see check.mjs).
 *
 * Same rationale as tools/header-geometry: every assertion here is about *measured*
 * geometry inside a live SVG (stem anchoring, marker/label collisions, focus outlines,
 * filter state). jsdom has no layout engine, so none of it can be asserted in vitest.
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
