import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Build config for the Landscape tab geometry check (see check.mjs).
 *
 * Same rationale as tools/function-track-geometry: the assertions here are *measured*
 * geometry inside a live layout — letter chips that must not overlap, the verdict that must
 * precede the evidence, hit targets, focus outlines. jsdom has no layout engine, so none of
 * it can be asserted in vitest.
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
