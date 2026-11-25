import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Build config for the Report tab geometry check (see check.mjs).
 *
 * Same rationale as tools/landscape-geometry: the promises here are measured geometry inside a live
 * layout (titles that share an edge with their card body, a sticky export bar nothing scrolls above,
 * criterion codes that stay on one line). jsdom has no layout engine, so vitest cannot assert them.
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
