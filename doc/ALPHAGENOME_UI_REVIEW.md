# AlphaGenome presentation corrections

## What changed

**The rank.** The big number reads "Top 0.23%". Under it: "of all possible single-letter DNA changes in the
human genome (GRCh38), ranked by AVI score. About 1 in 437 changes scores this high."
`topPercentile` is a percentage from 0 to 100, the share of all possible changes that score at least this high.

- Below 0.001% it shows "<0.001%" (the server keeps four decimals and the ruler stops there). It never shows
  exponent form.
- Past the top half the headline is "Below the middle", and the "1 in N" line is dropped because it rounds to
  "1 in 2" or "1 in 1". The label then says "63% of possible single-letter DNA changes score at least this high".
- The rank guide and the ruler's screen-reader text use that same sentence (`rankSentence`), so no surface says
  the flipped "higher than 99.77%" any more. The Predictors tab still uses `fmtPercentAbove`; its owner
  decides when to move it.

**The finding.** "Largest input: AlphaMissense." (one group) or "Largest inputs: conservation, AlphaMissense and
variant type." (several). The percentage is the sum of the groups the sentence names, so it matches the list
beside it. One note, said once: percentages compare the absolute size of each contribution and are not
disease-risk percentages. The caveat reads "This is a rank, not the chance that the variant causes disease."

**The graph.** The toolbar groups the count with the sorting note, uses an "Input type" label ("All inputs"),
and separates the controls from the drawing with a line. The axis guide shows "Lowers score ←", a centred 0
and "→ Raises score". The guide is hidden from screen readers because the chart's own text alternative already
says which way is which.

**The tracks.** AlphaGenome and Expression use equal margins on both sides, so the zero line is in the middle
of the card. Before, Expression reserved 245px on the left and 132px on the right. It now fits the longest
tissue name within 175 to 245px (an estimate of 6.4px per character plus 28px; capital letters run wider, so the
cap decides for very long names). Each canvas keeps at least 260px for the scale between the labels
(`evidence-workspace.css`), so the guide labels stay on one line at narrow widths and the canvas scrolls
instead. Flat line ends (`lineCap: 'butt'`) meet the zero line without crossing it. The setting sits in the
shared gate for AlphaGenome, Perturbation and Expression bars, so all three get it.

The "0" in the guide is centred by CSS. It sits on the zero line only because the contribution domain is
symmetric (`[-bound, bound]`); a comment in `alphagenome.css` says so.

## Verification

- Focused tests (rank formatting, `aviFinding`, tab, workspace, integration, model): 68 passed.
- `tsc --noEmit`, the boundary, focus-indicator and verify-parity checks passed.
- Browser (headless Chromium on the evidence preview, illustrative data), at 1500, 800 and 520px: the guide's 0
  sits on the zero line to the pixel (574, 400, 310), guide labels stay on one line, the headline stays on one
  line, and neither tab causes page overflow. Expression keeps its 720px minimum and 175px margins on both sides.
- The full suite was last run before the rank and finding changes (6,054 passed, 15 failed, in areas other
  agents changed). It has not been rerun on this branch.
