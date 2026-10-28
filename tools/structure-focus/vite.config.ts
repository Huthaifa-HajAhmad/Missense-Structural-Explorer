import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Build config for the 3D residue-focus check (see check.mjs).
 *
 * Same rationale as the other harnesses under tools/: the claim being checked is that Mol* turns a companion
 * residue set into drawn atoms in a real WebGL context. jsdom has no WebGL, no canvas and no Mol* plugin, so a
 * vitest assertion can only ever prove that a prop was passed.
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../..") },
  },
  assetsInclude: ["**/*.pdb"],
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    // The fixture is inlined so the built page works from file:// with no fetches.
    assetsInlineLimit: 2_000_000,
    minify: false,
  },
});
