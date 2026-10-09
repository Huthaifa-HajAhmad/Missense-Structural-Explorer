# Energetics production-component preview

Run `npx vite --host 127.0.0.1 --port 5183` from the repository root and open
`http://127.0.0.1:5183/tools/energetics-preview/index.html`.

This harness renders the real AppViews, Energetics view, TanStack chart and inspector. The data is
explicitly illustrative; API calls are blocked. The example selector covers disagreement, one
estimate, missing results, an excluded FoldX estimate, and extreme values outside the old ruler.

Check pointer/keyboard pinning, the Engine records round trip, optional local guides, counted-only
filtering, both units, and light/dark themes. At narrow widths, use Inspect [method] to reach the
stacked inspector. The production chart is lazy-loaded, so it may take a moment on the first visit.

Changing examples retains the same query to exercise arriving/replaced data; the integration test
separately verifies that changing query identity clears selection and chart options.
