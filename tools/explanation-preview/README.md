# Contextual explanation preview

Run `npx vite --host 127.0.0.1 --port 5188 --strictPort`, then open
`http://127.0.0.1:5188/tools/explanation-preview/index.html`.

The harness exercises the production model, metric and 3D notice entry points and their
subject-specific teaching content. It uses no live services or variant scores.

Run `node tools/explanation-preview/check.mjs` for browser checks and screenshots under
ignored `scratch/explanation-preview/`. Checks include focus containment/restoration,
Escape, backdrop, scroll, responsive geometry, light/dark and reduced motion.
