# Report workspace review

Run `npx vite --host 127.0.0.1 --port 5183`, then open
`http://127.0.0.1:5183/tools/report-preview/index.html`.

This mounts the production `AppViews` on the Report tab with the NAE1 example values from
`src/shared/__tests__/fixtures/nae1Result.ts` plus a labelled example summary. No live analysis is run
and the values are test inputs, not scientific evidence. The header switches theme, jumps to Landscape
for comparison, and clears the result to show the empty state.

Check: each view pill, a rail "Go to" link for a block in another view, Edit/Save/Revert, leaving a
block out, light/dark, and 1600/760/390px widths.
