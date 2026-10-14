# Mechanism workspace preview

Run Vite from the repository root:

```sh
npx vite --host 127.0.0.1 --port 5186 --strictPort
```

Open <http://127.0.0.1:5186/tools/mechanism-preview/index.html>. This renders the actual AppViews,
Evidence workspace and inspectors with current application styles. Application API calls are
blocked. No provider keys, server or new analysis are required.

Select Interfaces & PPI or RNA splicing, change the fixture and switch themes. SOD1 and SLC12A4
are recorded interface cases; splice signals, missing positions, unresolved strand and the
new-variant scenario are illustrative interaction fixtures, not clinical results.

Review at wide, 800 px and 390 px viewport widths:

1. Select a track, support row or splice mark. Its exact evidence should appear in the inspector.
2. Hide a selected interface layer, then use Show selected reading. The source record receives focus.
3. Search Partners, leave the tab and return. Query and pin persist. Changing the allele resets them.
4. Change the splice window; switch to Source records and back. The window persists.
5. With Missing position, the high unpositioned score prevents the focused score range. With
   Unresolved strand, predicted positions are omitted. Missing scores are not rendered as zero.
6. Check figure and table scrolling, keyboard focus, adjacent annotation labels and both themes.

The automated matrix can be run against the already-running preview:

```sh
node tools/mechanism-preview/check.mjs
```

It uses an existing Playwright installation and browser. Set `PLAYWRIGHT_MODULE` to the absolute
path of `playwright-core/index.mjs` and `BROWSER_PATH` to a Chromium executable if these are not
available through the repository's local test setup. Reports and screenshots go to
`scratch/mechanism-preview/`. This tool does not install dependencies or launch application APIs.
