# Landscape tab: audit and redesign proposal

Reviewed against NAE1 p.Asp116Gly (NM_003905.4, 16-66823281-T-C, GRCh38, minus strand) on
29 September 2026, from the screenshot and the code on `claude/trusting-davinci-t85u0y`.

Files in scope:

| Surface | File |
|---|---|
| Page shell, score getters, footer | `src/components/SequenceVisualizer.tsx` |
| Residue grid, 1D track, threshold legend | `src/components/sequence/SequenceRowGrid.tsx` |
| Shared line track | `src/components/sequence/DensityTrack.tsx` |
| AlphaGenome nucleotide grid | `src/components/sequence/GenomicSaturationHeatmap.tsx` |
| Inspector rail | `src/components/inspector/LandscapeInspector.tsx` |
| REVEL × AM scatter ("minimap") | `src/components/LandscapeMinimap.tsx` |
| Aggregation (remote) | `server/services/prediction/landscape.ts` |
| Aggregation (local) | `server/services/prediction/dbnsfp_local.ts` → `queryLocalDbnsfpLandscape` |
| Local ingest | `tools/ingest_dbnsfp.ts` |
| Endpoint | `server/routes/variant/analysis.ts` → `POST /analyze-variant/landscape` (±25 residues) |

## Verdict

The tab looks uneven because it is three separate instruments put side by side. They share no
coordinate system, no colour meaning and no single question. Beneath that, the per-position numbers
are not reliable. Positions from different transcripts are pooled together. The same position mixes
per-variant scores with per-position aggregates. The legends call thresholds "Pathogenic" and
"Supporting" when the app's own `calibration.ts` says otherwise. Two headline labels ("Whole-protein
minimap", "Smoothing window") describe features that don't exist.

The finding that matters most is **S1**. The screenshot's inspector reports **48 evaluated variants**
at residue 116. One codon allows at most 9 single-nucleotide substitutions, so at most 9 missense
variants. The other ~39 scores belong to other residues, most likely the same numeric position on
other isoforms. Every mean, max, line and scatter dot on the tab inherits that error.

---

## 1. Scientific integrity

| # | Severity | Finding | Where | Fix |
|---|---|---|---|---|
| S1 | Critical | **Scores from different transcripts are pooled into one position.** Remote path: each myvariant hit's `aapos` list covers every transcript (`"116;98;116"`), and the hit's single REVEL/AM value is pushed into *every* listed position (`posList.forEach`), so a variant at isoform-2 residue 98 is counted as residue 98 of the canonical protein. Local path: ingest keeps `aapos.split(/[;,]/)[0]`, the *first-listed* transcript, which is not necessarily MANE, and falls back to `pos(1-based)`, a **genomic** coordinate, when no aapos column is found. Nothing filters on the MANE transcript the header shows. Evidence: "48 evaluated variants" at D116 (max possible is 9). | `landscape.ts:291-331`, `ingest_dbnsfp.ts:68,129`, `dbnsfp_local.ts:246-251` | Key every landscape row to one transcript (MANE Select ENST/ENSP, else UniProt canonical) using dbNSFP's per-transcript `Ensembl_transcriptid`/`aapos` pairing; pick the aapos at the same index as the transcript. Drop the genomic fallback. Assert `count ≤ 9` per position in tests and surface a data-quality flag when it fails. |
| S2 | Critical | **The track mixes two kinds of quantity.** At the target position the getters return the variant's own score (`conservationData.revel`, `predictorData.amPathogenicity`). At every other position they return a position mean or max. The line joins them, so the target's point is a different kind of number from its neighbours, and a spike or dip there may just reflect that switch. The same happens for GERP/phyloP. The footer admits it in 9.5 px text. | `SequenceVisualizer.tsx:191-245` | Plot the position aggregate everywhere. Show the variant's own score as a separate mark, such as a tick within the position's min–max range. Never put the two kinds of number on one line. |
| S3 | High | **Legends present uncalibrated breaks as evidence strength.** REVEL legend: "Pathogenic (≥0.75)", "Supporting (0.50–0.75)", "Benign (<0.15)". The published Pejaver 2022 bands, already in `calibration.ts`, are PP3 Supporting ≥ 0.644, Moderate ≥ 0.773, Strong ≥ 0.932 and BP4 Supporting ≤ 0.290. So a REVEL of 0.70, which ClinGen calls PP3 Supporting, is shown here in the same colour as 0.51. The track's aria-label calls 0.75 the "pathogenic-supporting boundary", while the legend calls it "Pathogenic". `constants.ts` itself says these are "heatmap colour breaks only". | `SequenceRowGrid.tsx:60-75, 236-244, 424-468` | Either colour on the `calibration.ts` bands and label them with their ClinGen names and citation, or use a neutral sequential ramp with no evidence words. The Predictors tab went the first way, and this tab should match it. |
| S4 | High | **"VUS" is used as a score band.** A VUS is a variant classification, not a range of a predictor score. For AlphaMissense the authors' middle class is "ambiguous" (0.34–0.564), and the legend's "Pathogenic ≥ 0.564" is the authors' *likely pathogenic* class. ClinGen's AM PP3 band starts at 0.792 (Bergquist 2025). | `SequenceRowGrid.tsx:441,460`; `LandscapeMinimap.tsx:88-98` | Use the authors' own words ("likely benign / ambiguous / likely pathogenic, authors' classes") or the calibrated bands. Never say "VUS". |
| S5 | High | **The scatter says "ClinGen calibrated thresholds" and draws uncalibrated ones.** Its title and `<desc>` claim ClinGen boundaries but draw 0.15/0.50/0.75 and 0.34/0.564. The dot colour uses an OR rule (AM ≥ 0.564 *or* REVEL ≥ 0.75 → red), so any disagreement between the two is painted as pathogenic. | `LandscapeMinimap.tsx:88-126` | Draw the `calibration.ts` bands or none. Colour dots by the agreement cell (both PP3 / both BP4 / discordant / neither), not by an OR. |
| S6 | High | **The "1:1 concordance" diagonal means nothing.** REVEL and AlphaMissense are calibrated differently (REVEL PP3 at 0.644, AM at 0.792), so equal raw values don't mean the two agree. | `LandscapeMinimap.tsx:174-194` | Remove the diagonal. If agreement matters, show it as the calibrated-band grid from S5. |
| S7 | High | **Conservation is coloured green, and green means benign two rows above.** Green is `cs-good` on the pathogenicity rows. On the GERP++/phyloP rows, high conservation (the *more* damaging context) is also green, so the screenshot's all-green GERP row reads as "safe". The footer then says "High GERP++ & PhyloP = High Vulnerability". The WT residue is also forced green and the mutant red, which implies the reference is good and the change is bad. | `SequenceRowGrid.tsx:132-133,182-183,336-390`; `LandscapeInspector.tsx:289-292` | Give conservation its own sequential ramp (not red/green, not the pathogenicity hue). Mark the target with an outline or ring, never with a verdict colour. |
| S8 | High | **The AlphaGenome grid shows forward-strand bases in transcript order on minus-strand genes.** For `strand === "-"` the columns are reversed but the bases aren't complemented, and the A/C/G/T rows are forward-strand alts. On NAE1 the query cell sits in row **C** (genomic T>C), while the coding change is A>G (GAY→GGY, Asp→Gly). Read left to right, the REF row is the complement of the coding sequence: neither strand a reader would recognise. Nothing labels the strand. | `GenomicSaturationHeatmap.tsx:303-313, 670-723` | When showing transcript orientation, complement both the REF row and the row labels (render the coding strand), and put a "coding strand (−)" chip on the axis. Otherwise keep genomic order and say "+ strand". |
| S9 | High | **The AlphaGenome panel describes things it doesn't show.** The subtitle says it predicts "splicing disruption, chromatin accessibility, and missense constraint", and the title says "1D Intolerance". The Phred is the AVI's genome-wide *rank*, a composite whose largest feature is often AlphaMissense (see `PREDICTORS_TAB_REVIEW.md` S2). It's neither an intolerance nor a constraint measure, and a Phred averaged over 3 alts (the track's "MEAN") is a mean of log-ranks. | `GenomicSaturationHeatmap.tsx:482,507,433-440` | Title it "AlphaGenome AVI rank, per substitution". Put the "contains AlphaMissense" caveat on the panel, name the track "max rank per position", and drop mean-of-Phred or label it as such. |
| S10 | Medium | **"Mean over substitutions" is not a published per-residue mean.** dbNSFP holds only SNV-reachable missense (≈5–7 per codon, depending on codon), while AlphaMissense's own per-residue average is over all 19. The two aren't comparable, and positions with different codons average over different sets. The server's own comment says REVEL/AM use **max** "for conservative clinical utility", but the UI default is **mean**. | `landscape.ts:395-403`; inspector "Mean (Default)" | Say "mean over *n* SNV-reachable substitutions" and show *n*. Offer the AM 19-substitution mean as a separate, correctly named series if the AM substitution table is ingested. Resolve the default in one place. |
| S11 | Medium | **GERP/phyloP are averaged over variants, not nucleotides.** Each variant row carries its nucleotide's score, so a nucleotide with 3 missense alts counts three times as much as one with 1. | `landscape.ts:420-421`; `dbnsfp_local.ts:293-294` | Deduplicate by genomic position first, then average the codon's 3 nucleotides (or show the max). |
| S12 | Medium | **Residue identity isn't checked against the scores.** The WT row comes from the UniProt canonical sequence, and the scores come from dbNSFP's transcript. When the UniProt canonical isoform and MANE differ, the grid puts one protein's scores under another's residues without saying so. | `SequenceVisualizer.tsx:48,153-173` | Carry `aaref` in the landscape rows and flag any position where it disagrees with the displayed residue. |
| S13 | Medium | **Provenance is hard-coded.** The footer says "dbNSFP v4.4a" whether data came from local dbNSFP v5 SQLite, myvariant.info (its own version) or a 30-day SQLite cache. The payload carries no source, version or transcript. | `SequenceVisualizer.tsx:333`; `LandscapePositionData` | Add `{source, dbnsfpVersion, transcript, fetchedAt}` to the landscape response and render it. Bump the cache schema key when S1 is fixed. |
| S14 | Low | GERP 2/4 and phyloP 1.5/4 breaks are app-defined, and ClinGen's phyloP bands (PP3 ≥ 7.367, BP4 ≤ 1.879) are nowhere on this tab. | `constants.ts:126-140` | Label them as local display breaks, or use the Pejaver bands where they exist. |

---

## 2. Broken or dead code

| # | Finding | Where |
|---|---|---|
| D1 | **The loading spinner can never render.** `useProteinSequence` returns `""` while loading, so `!sequence` catches first and the tab shows "Pathogenicity Landscape Ready … press **Analyze Mutation Effect**" during every load and after a failed fetch. The hook's `error` is ignored, and no button with that label exists anywhere in `src`. | `SequenceVisualizer.tsx:271-285` |
| D2 | **"Spatial Neighbors (≤5Å)" never renders.** `getNearestResidues` is a stub returning `[]`. | `src/shared/nearestResidues.ts:3-5`; `LandscapeInspector.tsx:132-135,298-317` |
| D3 | **"Smoothing window" doesn't smooth.** It only sets how many residues are sliced for display (15/21/31/41). No rolling statistic is computed anywhere. | `LandscapeInspector.tsx:362-384`; `SequenceVisualizer.tsx:153-173` |
| D4 | **"Whole-protein minimap" is neither.** It receives the ±25-residue payload (≤ 51 positions), isn't positional and can't be navigated. | `LandscapeInspector.tsx:388-405`; `analysis.ts:139-143` |
| D5 | **Domain Index jumps land nowhere visible.** They set `selectedResidueIndex`, but the grid window stays centred on the parsed variant position and landscape data covers only ±25. A jump to a domain 200 residues away changes nothing on screen. | `LandscapeInspector.tsx:423`; `SequenceVisualizer.tsx:148-160` |
| D6 | "Hydrophobic" colour scheme: non-hydrophobic residues fall through to the *chemical* palette, so the scheme is chemical + green. | `SequenceVisualizer.tsx:68-74` |
| D7 | Dead props and fields: `seqColorScheme` and `onSelectGenomicVariant` are never passed by `AppViews`; `wtCode3/mutCode3` are computed but unused; `HoveredResidueInfo.type` is set but never read; `revelMedian/revelMin/amMedian/amMin` are computed server-side and never displayed. | `SequenceVisualizer.tsx:14-15,115-133`; `types.ts` |
| D8 | Hover isn't shared across panels. Residue-grid hover lives in local state and never reaches the store, so the AlphaGenome codon bracket doesn't follow it. Nucleotide-grid hover doesn't highlight the residue column. | `SequenceVisualizer.tsx:49`; `GenomicSaturationHeatmap.tsx:355-369` |
| D9 | The claim "Three saturation columns of 10 px each, so the two heatmaps stay codon-aligned" is false. The residue grid is a 31-residue window centred on the target, while the nucleotide grid is exon ± 15 bp, with intron columns, a different first column and reversed order on − strand. In the screenshot the D116 column and the query nucleotide sit ~60 px apart. | `SequenceRowGrid.tsx:11-12` |
| D10 | `isExonic` defaults to `true` when neither the provider nor the request gives exon bounds, so flank bases are labelled exonic. | `alphagenome-bridge.ts:550` |
| D11 | Tooltips say "window mean REVEL" for what is a *position* mean. | `SequenceRowGrid.tsx:261-262,312-313` |
| D12 | Off-token colours (`slate-*`, `indigo-500`, `rose-500`, `amber-400`) in the empty, error and query-ring states. `py-0.2` is not a Tailwind v4 spacing step and generates no rule. | `SequenceVisualizer.tsx:272-282`; `GenomicSaturationHeatmap.tsx:112,485,543` |
| D13 | Server hygiene: one `console.log` **per myvariant hit and per position** (hundreds of lines per request), and a `DELETE … WHERE expires_at < ?` on *every* cache read. | `landscape.ts:227-232,285,408,56` |
| D14 | `fetchLocalPopulationFrequencies` lives in the landscape module and reports `maxAF = groupMaxAF = genomeAF = exomeAF` with `exomeAC = exomeAN = 0`. This belongs to Population Data, but it's wrong wherever it's used. | `landscape.ts:122-150` |

## 3. Incomplete implementation

- **No tests** for `SequenceRowGrid`, `GenomicSaturationHeatmap`, `LandscapeMinimap`,
  `LandscapeInspector` or the aggregation's per-position contract (only `densityTrack.test.ts` and
  a server `landscape.test.ts`).
- The header strip shows **Regional O/E: "No gnomAD blocks"**, but the tab never uses regional
  constraint, which is the most relevant per-region signal for a *landscape*.
- No **ClinVar** or **gnomAD** variant positions, although both are already fetched elsewhere in the
  pipeline. Without them the tab can't answer the clinical question a landscape exists for (PM1:
  hotspot or critical domain without benign variation).
- UniProt domains appear only as a jump list in the rail, never on the residue axis.
- Substitution-level data (which alt, which score) is thrown away by aggregation. The tab can't
  show the one thing a saturation *landscape* normally shows: residue × substitution.
- The landscape isn't used by Insights or Report, so nothing on this tab reaches the written
  output.

---

## 4. UI / UX evaluation

**Why it feels uneven**

1. **Three instruments, three coordinate systems.** A 31-residue window, an exon-sized nucleotide
   window (≈ 110–5,000 bp, reversed on − strand) and a scatter with no position axis at all. The
   eye can't carry a column from one to the next.
2. **Colour means different things in each panel.** Red is acidic residue, mutant, REVEL
   pathogenic and AM likely-pathogenic. Green is WT, benign and highly conserved. Clay is polar
   residue, the AM line, the rank ramp, the target ring and the query dot. Seven semantic uses
   share four hues.
3. **Numbers used as pictures.** 150 cells of 8 px numerals (`0.23`, `4.8`) make a table you
   can't read at a glance and can't read precisely either. A heatmap should be read by colour,
   with the number on hover or in the inspector.
4. **The line chart repeats the table.** The line above the rows plots the same REVEL/AM values
   the next two rows print. On a 0–1 axis in 64 px they are nearly flat, so the chart takes
   space and adds little.
5. **No headline.** Other tabs (Population, Predictors) now open with a finding card that states
   the result. This one opens with a title in 12 px monospace capitals and leaves the conclusion
   to the reader.
6. **Density and type.** 7.5–9.5 px monospace capitals everywhere, four pulsing elements
   (WT, mutant, REVEL, AM target cells), the 1D line label "1D DENSITY" (it's a profile, not a
   density) and "ALPHA_MS" (a variable name).
7. **The rail does work the canvas should do.** Controls sit in the rail, but the canvas carries
   its own legend block. Legends, selection details and controls are spread over three places.
8. **Wasted width.** The right-hand "Threshold legends" card uses about 25% of the canvas for
   static text, while the nucleotide grid needs horizontal scrolling.

---

## 5. Redesign proposal

### The question the tab should answer

> *Is residue 116 in a part of the protein where missense change is not tolerated, and how does
> this particular substitution compare with the others possible here?*

Everything on the page should serve that question, on **one shared residue axis**.

### Layout

Values in the finding card below are illustrative, not computed.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ FINDING  D116 sits in a 21-aa stretch where 14/21 positions have median AM ≥ 0.564      │
│          (authors' LP class). D116G: REVEL 0.231 (BP4 band) · AM 0.362 (ambiguous);      │
│          7th of 7 SNV-reachable substitutions here. Not in a UniProt domain.            │
│          No ClinVar P/LP within ±10 aa; 3 gnomAD missense.         [MANE NM_003905.4]   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ OVERVIEW (whole protein, 1…534, brush to set the focus window)                           │
│  domains  ▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭▭      ▭▭▭▭▭▭▭▭▭▭▭▭                                           │
│  AM med   ▁▂▃▅▇▇▅▃▂▁▁▂▅▇█▇▅▂▁▁▁▂▃▅▇▇▆▃▂▁   (one sparkline, calibrated-band shading)      │
│  ClinVar  │ │    ││ │        ●P/LP  ○B/LB  (lollipops)                                   │
│  gnomAD   ·· ·  ·   · ··  ·                                                              │
│  O/E      ████████▒▒▒▒▒▒█████   (regional missense constraint, when available)           │
│                    [====focus====]                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ FOCUS (focus window, one column per residue, 30 px)                                      │
│  residue   S G S F V E E S P E N L L D N [D] P S F F C R F T V V V A T Q L               │
│  substitution heatmap: 20 rows (A…Y), AM per substitution; SNV-reachable cells solid,    │
│  others hatched; query cell outlined; REVEL as a dot inside SNV-reachable cells          │
│  conservation  ▂▃▅▇▅▃▅▇█▇▅▃ (phyloP bar, own blue ramp; GERP on hover)                   │
│  codons    |GAT|CCT|…  ← AlphaGenome lane, CODING strand, 3×10 px under each residue    │
│            A/C/G/T rows complemented on − strand; intron flank collapsed to a stub       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
 Rail: Selection (residue or substitution) · Controls · Sources & methods · Citations
```

### Design rules

1. **One axis.** Overview, focus heatmap, conservation and the AlphaGenome lane all share residue
   coordinates. The nucleotide lane is laid out as 3 × 10 px per codon *under its residue*, on the
   coding strand, with intronic flank shown as collapsed stubs at the exon edges. This makes the
   alignment claim in D9 true.
2. **Show substitutions, not only position summaries.** The core view is the residue × amino-acid
   heatmap that AlphaMissense itself popularised. Aggregates (median / max over SNV-reachable
   substitutions, with *n*) become one derived row, labelled as such.
3. **Colour budget.**
   - Pathogenicity predictors: one sequential ramp, with the calibrated PP3/BP4 band edges as
     tick marks on the legend (the `ScoreRuler` pattern from Predictors).
   - Conservation: a separate single-hue ramp (e.g. blue).
   - AVI rank: its existing clay decade ramp, labelled "rank, not ACMG".
   - Residue letters: neutral text. The query is marked by outline only.
   - No red/green anywhere a meaning could be inverted.
4. **Headline first.** A finding card built by a pure, tested `landscapeSummary()` function, like
   `predictorSummary`. Every clause comes from data and cites its source. It proposes **no ACMG
   code**: PM1 needs expert judgement and regional data this tab only partly has, so the card
   says "PM1 context", not "PM1 met".
5. **Numbers on demand.** Cells carry no printed numbers. Hover shows a compact tooltip, and click
   pins the full reading in the rail: all substitutions at the position as a strip plot with the
   query marked, *n*, transcript and source.
6. **Honest controls.**
   - "Summary: median · max (over *n* SNV-reachable substitutions)"
   - "Focus width: 15 / 21 / 31 / 41 aa" (or drag the brush)
   - An optional, separately labelled "Smooth ± k aa" rolling median for the overview only
7. **Linked selection.** Hover and select go through the store for every lane and for the 3D
   viewer, so hovering a codon highlights its residue column and vice versa.
8. **States.** Separate, token-coloured states for sequence loading, sequence failed, landscape
   empty, AlphaGenome unconfigured and AlphaGenome failed, each saying what was and wasn't queried.

### Data changes the redesign needs

- `GET landscape` returns **substitution rows** (`residx, aaref, aaalt, revel, am, snvReachable`)
  for one named transcript, plus per-nucleotide conservation (deduplicated by genomic position)
  and a provenance block. Position aggregates are derived on the client or in a shared pure
  function, and tested.
- A **whole-protein** summary (one row per residue: median/max AM, phyloP) for the overview, cached
  per transcript. The server already supports an unbounded request, so this only needs to be
  exposed.
- ClinVar and gnomAD missense positions reused from the evidence payload (no new fetch).
- The optional AlphaMissense 19-substitution table (`AlphaMissense_aa_substitutions.tsv`) for
  non-SNV cells. Without it those cells render hatched as "not SNV-reachable, not scored".

---

## 6. Other gaps

- **Tests to add.** S1 (≤ 9 per position; no cross-transcript positions), S2 (target point is the
  same kind of number as its neighbours), S8 (− strand complement), `landscapeSummary` states,
  loading/error states (D1).
- **Performance.** The nucleotide grid can render 20,000 `<button>`s. Draw the cells to a canvas
  (or one SVG with a single hit-test layer) and keep the roving-focus model the grid already has.
- **Accessibility.** Remove the four pulse animations. Text is currently 7.5–9.5 px; keep it
  ≥ 10 px. Give colour-coded cells a pattern or glyph for the calibrated bands.
- **Report integration.** Once the finding card exists, feed its sentence (and the
  PM1-context facts) to Insights and Report, so the tab's result reaches the written output.
- **Consistency with Predictors.** Both tabs should read thresholds from `calibration.ts` through
  the same `ScoreRuler` / band helpers, so the numbers match wherever REVEL appears.
- **Cache.** Key on `gene + transcript + source + schema` and bump the schema after S1. The
  current 30-day SQLite cache keeps pooled data for a month after any fix.

## 7. Suggested order of work

1. **Data integrity (S1, S2, S10, S11, S13, D13, cache bump).** Nothing else is worth styling
   until the numbers are per-transcript and like-for-like.
2. **Truthful labels (S3–S7, S9, S14, D3, D4, D11).** These are small and mostly copy/colour
   changes that can ship on the current layout.
3. **Strand and alignment (S8, D9, D10).** Coding-strand rendering and a codon-aligned lane.
4. **Redesign (§5).** Finding card, whole-protein overview, substitution heatmap, rail
   restructure, linked hover.
5. **Clean-up (D1, D2, D5–D8, D12, D14)** and the tests in §6.

---

## 8. Resolution (29 September 2026)

Everything in §1 and §2 is fixed on this branch. The §5 redesign is prototyped as a clickable
mockup, not built into the app yet. What each finding became:

| # | Resolution | Where |
|---|---|---|
| S1 | New pure module reads every SNV on **one** transcript (MANE flag → Ensembl canonical flag → agreement with the UniProt sequence → most covered), takes the residue number and REVEL/AM at that transcript's index, counts each genomic SNV once and drops synonymous/stop. The local ingest now stores the MANE/canonical transcript's `aapos` and scores, and never falls back to `pos(1-based)`. A residue reporting > 9 SNVs raises `overcount:<pos>`. | `server/services/prediction/landscape-aggregate.ts`, `landscape.ts`, `dbnsfp_local.ts`, `tools/ingest_dbnsfp.ts` |
| S2 | REVEL/AM/GERP/phyloP rows hold residue summaries everywhere. The variant's own scores appear as diamonds on the profile (`DensityTrack` `markers`), in the target cell's label, in the finding and in the rail's range strip. | `SequenceRowGrid.tsx`, `DensityTrack.tsx` |
| S3, S4 | Cells are coloured on the `calibration.ts` bands (seven-step diverging scale, BP4 indigo ↔ PP3 red). The legend is generated from the same table, says the bands are for single variants, and never uses "VUS". Profile guides sit at the PP3 Supporting edges (0.644 / 0.792). | `landscapeEvidence.ts`, `LandscapeLegend.tsx`, `landscape.css` |
| S5, S6 | The scatter is replaced by `LandscapeAgreementPlot`: calibrated PP3/BP4 edges on both axes, shaded agreement corners, dots coloured both-PP3 / both-BP4 / discordant / other, no diagonal, the variant drawn as a diamond, dots clickable. | `LandscapeAgreementPlot.tsx` |
| S7 | Conservation has its own ink ramp. Residues are coloured letters on neutral cells, and the target is marked by an outline. Green is gone from the tab. | `landscape.css` |
| S8 | On − strand genes the grid shows the coding strand: the REF row and the A/C/G/T rows are complemented, the chip says so, and tooltips, the HUD and the rail name both the genomic and the coding change. | `GenomicSaturationHeatmap.tsx`, `landscapeEvidence.ts` |
| S9 | Retitled "AlphaGenome variant-effect rank". The subtitle defines the Phred as a rank and says AlphaMissense is an input. The track is max rank per position; the mean-of-Phred option is removed. | `GenomicSaturationHeatmap.tsx` |
| S10 | Labels read "mean / max over the SNV-reachable missense substitutions (≤ 9 per codon)", with *n* shown in every cell label and in the rail. The server comment that claimed max was the default is gone. | `LandscapeInspector.tsx`, `SequenceRowGrid.tsx` |
| S11 | Conservation is keyed by nucleotide, then averaged over the codon's distinct nucleotides (`nucleotideCount`). | `landscape-aggregate.ts` |
| S12 | Rows carry `aaref`. A disagreement with the displayed residue sets `refMismatch`, puts a dot on the cell, adds a caution to the finding and a note in the rail. | `landscape-aggregate.ts`, `SequenceRowGrid.tsx` |
| S13 | The endpoint returns `landscapeMeta` (source, dbNSFP version from myvariant metadata or the local `build_meta`, transcript and basis, window, flags, cached, time). It is shown in the finding header and the rail. The cache key is `schema:v4`. | `analysis.ts`, `contracts.ts`, `biophysicalService.ts` |
| S14 | The conservation legend labels the breaks as display steps, and the phyloP darkest step starts at the ClinGen PP3 edge (7.367). | `landscapeEvidence.ts` |
| D1 | Separate loading, failed and not-analysed states, with no flash on the first frame. The dead "Analyze Mutation Effect" text is gone. | `SequenceVisualizer.tsx` |
| D2 | `getNearestResidues` stub and the neighbour section removed, along with its unused import in `ClinicalInsightsCard` and the test that guarded the stub. | — |
| D3, D4 | "Window width"; the scatter is titled with the residue range it actually shows. | `LandscapeInspector.tsx` |
| D5 | The grid window re-centres when a selection falls outside it (domain jump, codon click), fetches that window through `landscapeWindow` (≤ 121 aa), and offers "Back to residue N". Loaded rows live in the store (keyed by gene/variant) so the rail sees them too. | `SequenceVisualizer.tsx`, `analysis.ts`, `searchSlice.ts` |
| D6, D7 | Residue classes rewritten; the hydrophobic scheme highlights hydrophobics only. Dead props, `wtCode3/mutCode3`, `HoveredResidueInfo` and the unused median fields removed. | — |
| D8 | Hover goes through the store both ways: residue grid ↔ codon brackets. | `SequenceVisualizer.tsx`, `GenomicSaturationHeatmap.tsx` |
| D9 | The false "codon-aligned" comment is removed. The panel says its columns are nucleotides and links by hover. True alignment is in the redesign. | — |
| D10 | `isExonic` falls back to "has a codon index", not `true`. | `alphagenome-bridge.ts` |
| D11 | Tooltips say "residue", not "window". | `SequenceRowGrid.tsx` |
| D12 | Raw palette classes replaced by tokens; `py-0.2` fixed; pulse animations removed; text ≥ 9 px outside SVG. | — |
| D13 | Logging reduced to one line per request; the expired-row sweep runs at most hourly. | `landscape.ts` |
| D14 | Moved to `local-population.ts`. It reports only the combined AF (as `maxAF`, and as `groupMaxAF` flagged `groupMaxAFIsFallback`) and leaves exome/genome fields null. | `local-population.ts` |

§3 and §6: the tab now has tests (`landscape.test.ts`, `landscapeEvidence.test.ts`,
`landscapeTab.test.tsx`, route tests for the window parameter). Domains are drawn on the residue
axis, and the finding card exists.

**Still open:**
- A whole-protein overview.
- ClinVar/gnomAD lanes.
- The residue × substitution heatmap.
- Canvas rendering of the nucleotide grid.
- Feeding the finding to Insights and Report.

These make up the §5 redesign. Clickable mockup (illustrative data): https://claude.ai/artifact/Ej3Dv7jYDYY4tRL4hhFAfb

## 9. Redesign built (29 September 2026)

The §5 redesign is now the tab. It follows the approved mockup, with real data paths in place of
the mockup's illustrative numbers.

| Part | What it does | Where |
|---|---|---|
| Finding card | Adds a gene-context sentence: domain, regional O/E, nearest ClinVar P/LP, gnomAD missense within ±5. The variant is ranked among the scored substitutions at its residue. | `landscapeEvidence.ts` (`landscapeFinding`) |
| Toolbar | Colour by (AlphaMissense / REVEL), residue summary, focus width, lane toggles, back to the variant. Controls moved here from the rail. | `LandscapeToolbar.tsx` |
| Overview | Whole protein on one strip: domains, AlphaMissense residue summaries, ClinVar lollipops, gnomAD dots, regional O/E, the focus window as a box. Click or use arrow/Page keys to move the window. | `LandscapeOverview.tsx`, `POST /analyze-variant/landscape-overview`, `landscape-context.ts` |
| Focus heatmap | 20 rows × residues, one cell per substitution, on the calibrated bands. Substitutions one SNV cannot reach are hatched, using the codon from the nucleotide lane. The queried cell is outlined. A summary row sits beneath. | `LandscapeFocus.tsx`; server adds `substitutions` per residue |
| Nucleotide lane | The AlphaGenome AVI rank of every SNV, three cells under each residue on the coding strand, with the codon row. It shares one region request with the exon panel, which now starts collapsed. | `LandscapeFocus.tsx`, `useAlphaGenomeRegion.ts` |
| Rail | Selection by kind: residue (scored substitutions as clickable letters over the bands, plus ClinVar, gnomAD and O/E at the residue); substitution (own scores, bands, rank); nucleotide (genomic and coding change, AVI rank). | `LandscapeInspector.tsx` |

**Caveats:**
- The ClinVar and gnomAD lanes come from gnomAD's GraphQL API (GRCh38, gnomAD's canonical
  transcript). The field names follow its public schema but could not be exercised from the
  development sandbox. A failed source shows as "not loaded", never as "none".
- Regional constraint: superseded on 7 October (PR #72) — the regional lane now derives its basis
  string from the pinned gnomAD release and carries an explicit status
  (`available | none | withheld-mapping | unavailable`); a withheld mapping is named, never read
  as a missing value.
- Substitutions that need two or more nucleotide changes have no dbNSFP score. They are drawn
  hatched rather than filled from another source.

## 10. Self-review before merge (30 September 2026)

A full re-read of the branch found and fixed these:

| # | Defect | Fix |
|---|---|---|
| R1 | **Population tab regression:** `local-population.ts` renamed the local dataset and nulled `genomeAC/AN`, so `frequencyEvidence.ts` no longer recognised the local ingest (`gnomad_r4_local`) and lost its counts. It also set `groupMaxAFIsFallback`, whose ACMG note blames low ancestry counts. | Dataset name and the combined values in `genomeAF/AC/AN` restored (the consumer's contract). Exome fields are null, and the fallback flag is removed. |
| R2 | The myvariant `fields` list was sent unencoded, so `dbnsfp.gerp++` arrived as `dbnsfp.gerp  ` and GERP++ was never requested. | `encodeURIComponent`, with a test. |
| R3 | Residue summaries counted SNVs, so an amino acid reachable by two SNVs had its AlphaMissense score weighed twice. | Summaries run over distinct substitutions (REVEL: the higher of the SNVs). The ≤ 9 over-count check still counts SNVs. |
| R4 | The server checked residues against the gene symbol's UniProt entry, not the accession the tab draws. | The request's `uniprotId` is passed through and is part of the cache key. |
| R5 | For genomic notation the target fell back to the *selected* residue, so the "queried residue", its outline and the finding followed clicks. | The target comes from the pipeline's `metadata.residueIndex/wildType/mutant` (`resolveTarget`), which also carries any numbering remap. |
| R6 | Store state (navigated rows, overview, selection) was keyed by gene and variant only, so it was reused for a different accession. | `landscapeKey(gene, variant, uniprotId)`. |
| R7 | AlphaGenome codons were drawn under residues without checking that they encode them. | `alignCodonsToSequence` drops mismatches, and the lane says how many. |
| R8 | The AlphaGenome region was memoised on `spliceProximity`'s identity, so every pipeline update re-issued the region query. This bug was inherited from the old heatmap. | Keyed on the interval's values. |
| R9 | Overview arrow keys selected a residue on every step. A failed overview had no retry. | The strip and keys move the window only (ClinVar markers select), and a Retry button was added. |
| R10 | Minor: an aborted window request could clear the loading flag of the next one; heatmap cells read "no score" while loading; the rail showed a stale nucleotide beside a newer selection; the ingest could not add its new columns to an existing database and counted single-transcript rows as arbitrary picks; `aa_change` was not read at the chosen transcript; the overview route skipped the audit log; the context cache was unbounded. | Each fixed. |

## 11. Presentation audit on SOD1 p.Ala5Val (4 October 2026)

Reviewed on the densest real case (SOD1, 154 aa, 191 ClinVar missense records, 89 gnomAD residues),
from two screenshots of the shipped tab. Tests: `landscape.test.ts` (window query),
`landscapeEvidence.test.ts`, `landscapePresentation.test.tsx`, `LandscapeInspector.test.tsx`.

| # | Severity | Finding | Fix | Pinned by |
|---|---|---|---|---|
| P1 | Critical | **The window query dropped residues.** `dbnsfp.aa.pos:[1 TO 31]` is a range on a field myvariant.info indexes as text, so it compares strings: residues 4–9 sort after "31" and were never returned, while 100–199 were. On SOD1 p.Ala5Val the queried residue itself had no scores (the rail said "0 substitutions · no score" beside "this variant 0.853"). Any window whose start and end differ in digit count was affected. | One exact `aa.pos:N` term per residue, in chunks of 40 (`fetchMyVariantWindowHits`). Live check: 31 of 31 residues returned, A5V AlphaMissense 0.8401 and REVEL 0.853, matching the pipeline. | `landscape.test.ts` "asks for each residue by exact term" |
| P2 | High | The finding counted the queried variant's own ClinVar record as "3 ClinVar P/LP missense at this residue", which makes the context circular. | Says "the queried variant is itself in ClinVar (Pathogenic) · 2 other ClinVar P/LP missense variants at this residue"; the rail marks "(queried)". | `landscapeEvidence.test.ts` |
| P3 | High | A residue dbNSFP does not score (SOD1 V6, whose codon spans the exon 1/2 boundary in the live data) looked the same as "SNV-reachable, no score". | Own state "no dbNSFP record at this residue": grey column, finding sentence, rail sentence ("absence of data, not a benign reading"), legend entry. | `landscapePresentation.test.tsx`, `LandscapeInspector.test.tsx` |
| P4 | High | Dead space. The heatmap used fixed 27 px columns and left a quarter of the card empty; empty `DOMAIN` and `MISSENSE O/E` rows, an AlphaGenome lane of four empty bars, and three legend blocks (~330 px of static text) filled the page. | Columns fit the measured width (18–48 px, cell height follows); rows that only say "none" are not drawn and the fact is one caption; an AlphaGenome lane with no codon in view is one sentence; the legend shows only the active tool's seven bands and the cell glyphs, the rest sits in one disclosure; the O/E toggle is disabled when the gene has no call. | `landscapePresentation.test.tsx` |
| P5 | Medium | Interaction. Reading a cell meant a native tooltip; the grids were ~700 tab stops; the overview moved only by click. | A header readout shows both predictors for the hovered or focused cell; each grid is one tab stop with arrow keys (`useRovingGrid`); the overview drags (the window moves once, on release). | `landscapePresentation.test.tsx` |
| P6 | Medium | 191 ClinVar records at 99 residues were drawn as overlapping lollipops. | One marker per residue in its most severe class; the tooltip lists every record. | `landscapePresentation.test.tsx` |
| P7 | Low | Rail: the scatter title gave a residue range that disagreed with "scores loaded for residues"; method text and seven citations were always open. | Title says "scored residues a–b"; method and citations behind one disclosure. | `LandscapeInspector.test.tsx` |

**Not done.** Hover-to-3D linking for the heatmap (the store already carries the hovered residue; the
viewer does not read it from this tab). `?focus=` URL state for the window. A residue-dense overview
(whole protein ClinVar per-class counts) beyond one marker per residue. The V6 gap is stated from the
data as returned; the cause (split codon) is inferred, not confirmed against dbNSFP's documentation.
---

## 12. Integrity audit + first-sight rebuild (7 October 2026)

Audited and rebuilt against **SOD1 p.Ala5Val (P00441)**, GRCh38 21:31659783 C>T, dbNSFP 4.8a via
myvariant.info, transcript ENST00000270142 (Ensembl canonical). Workflow:
`.agents/skills/evidence-tab-refactor` (integrity checklist + data-presentation reference).
Order of priorities kept: true → traceable → legible → beautiful. Engine rules untouched: PM1
(hot-spot) remains unimplemented and is presented as context only; density is context, not evidence.

Surfaces in scope: `src/components/SequenceVisualizer.tsx` (tab host), `sequence/LandscapeOverview.tsx`,
`sequence/LandscapeFocus.tsx`, `sequence/LandscapeLegend.tsx`, `sequence/LandscapeToolbar.tsx`,
`LandscapeAgreementPlot.tsx`, `inspector/LandscapeInspector.tsx`, shared model
`src/shared/landscapeEvidence.ts`, server `server/services/prediction/landscape-aggregate.ts`.

Severity: **Critical** changes a classification · **High** asserts something false to a curator ·
**Medium** misleads without changing a call · **Low** drift/wording.

### Integrity findings

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| I1 | **High** | Conservation "codon mean" was wrong for every myvariant-sourced window: `candidateFromMyVariantHit` required `chr…:g.<pos><ref>><alt>`, but myvariant ids are `chr21:31659783C>T` — so `nucleotideKey` was always null and in `aggregateLandscape` the same nucleotide's three alt SNVs were counted as **three nucleotides** in the GERP++/phyloP mean and in `nucleotideCount` ("2 nt" on the tab could never be trusted). This completes §1 S11, whose earlier fix only covered candidates that already carried a parsed nucleotide key. | `landscape-aggregate.ts` regex; three alt rows at one position map to one nucleotide key | `parseNucleotideKey()` accepts `chr…:<pos>` with any allele suffix; aggregate falls back to it, and to the per-SNV key only when no nucleotide can be parsed (local rows without genomic columns) — the fallback can over-count by alts but can never merge two different nucleotides. Test: `landscape.test.ts › nucleotide identity`. |
| I2 | **High** | The rank/at-residue wording "ranks 4 of 6 **SNV-reachable** substitutions" claimed codon coverage the data does not have: the denominator is dbNSFP's *scored* set (a codon can admit up to 9 SNV-reachable missense substitutions; only the scored subset is ranked). Same overclaim in the overview header and the summary-row aria-label. | SOD1 residue 5: GCT admits 6, which happen to be all scored — but the wording generalised wrongly for every other residue | The UI now says "ranks N of the M **substitutions with an AlphaMissense score**"; overview header now "residue mean over its **scored missense substitutions**"; the server field doc corrected so the claim cannot be re-introduced. |
| I3 | **Medium** | The finding counted PP3 and BP4 residues but never the remainder, so "of 29 scored … 3 in the PP3 range and 11 in the BP4 range" left 15 residues unaccounted for. | `landscapeFinding` window sentence | The sentence now states "and 15 remain indeterminate" (singular/plural handled); counts reconcile. |
| I4 | **Medium** | Gap wording was false for one gap kind: a residue with a REVEL record but no AlphaMissense score was reported as "No dbNSFP missense record", which is not what happened. Extends §11 P3. | `landscapeFinding` | Two distinct gaps are named: "No dbNSFP missense record for residue X." and "No AlphaMissense score for residue Y (dbNSFP has a REVEL record there)." |
| I5 | **Medium** | The rail's substitution strip re-parsed **formatted legend range strings** ("0.644–0.773", "≥ 0.932") back into geometry via `stepSpan()` — an inverse of a display string that breaks silently when a range is reworded. | old `LandscapeInspector.SubstitutionStrip` | `bandSpans(tool)` reads `calibration.ts` directly; the formats stay in `legendSteps`. Unit-tested against the published edges (REVEL Pejaver 2022 Table 2; AlphaMissense Bergquist 2025 Table 1, as verified in the Predictors review). |
| I6 | **Low** | The rail's scatter heading said "scored residues 1–35" — a first/last span that implied contiguity over the pipeline's ±25 window plus fetched extra windows, next to the tab's stated 1–31 window. | rail heading | Now "residues a–b loaded, N scored · residue means" — the loaded range and the plotted count, and the statistic named. |

Verified true and left as-is: the ClinGen band thresholds (one source, `calibration.ts`, no retyped
copies — `grep` clean); the "PM1 context only: no ACMG code is proposed here" disclaimer; the AVI
lane's "not an ACMG band · contains AlphaMissense" non-independence caveat; the queried variant
excluded from its own residue's P/LP count (§11 P2); the variant's own scores drawn as a diamond,
apart from the residue-summary dots; indeterminate as a named middle band, not 0; absence of a
dbNSFP record never rendered as 0 or benign (§11 P3).

### UI findings (the rail was "difficult to comprehend from first sight")

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| U1 | High | **The verdict was not first.** The reader met two gradient strips with overlapping letter chips; the actual call (score + band per tool) was a second line of small text. | A verdict block leads the Selection card: per tool, a mono score (13px) beside an `ev-tier` chip coloured by the band (PP3 red / BP4 good / middle neutral / none muted), then one line naming **what it is read on** — "The queried variant … a variant-level score, so its band applies to the variant" / "Selected substitution …" / a plain residue pick → "Residue mean over its scored substitutions — orientation only; a band here is not variant-level evidence." Decided in one shared function, `landscapeVerdict()`, so the rail can never present a residue summary as a variant-level call. |
| U2 | High | **Letter chips overlapped.** Chips sat at their raw score with no collision pass — S (0.88) and V (0.95) drew on top of each other on the audited case. | `placeStripChips()`: sorted left→right, min chip+4px gap, right-edge crowd walked back inside with a 0 floor; a moved chip carries a stem to an anchor dot at its true position, so a letter can never read as sitting on the wrong band. Chips 24×24px (WCAG 2.5.8; they were 18×20). Verified at real widths by the geometry harness, light and dark. |
| U3 | Medium | ClinVar/gnomAD/regional context was three 10px mono blobs. | Key/value rows: 78px muted label column, mono value, `overflow-wrap: anywhere` — a long ClinVar list wraps instead of truncating mid-record. |
| U4 | Medium | The scatter's ticks were 8px, its axis labels 9px, and the mode word ("residue means") lived only in a screen-reader summary. | Tick/axis fonts raised, axis titles carry the mode ("REVEL (mean)"), and a 10px mono line above the plot states "residues a–b loaded, N scored · residue means". |
| U5 | Low | The per-tool block repeated the summary score the verdict already carried (kind=variant). | The block now carries the strip + range + count; the score/band once, in the verdict; "◆ this variant …" only when the verdict row does not already hold it. |

### UX / a11y findings

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| X1 | Medium | The phyloP track was mouse-only (`role="img"` spans with `onMouseEnter`): keyboard users could never read conservation. | PhyloP cells are buttons in their own roving grid (one tab stop, arrows inside), same hover/keyboard readout; clicking selects the residue. Geometry case `tab` pins one stop over its 31 cells. |
| X2 | Medium | Scatter dots (r≈2.4) had no keyboard access and no usable hit target. | Each plotted residue is a focusable circle (`tabIndex`, Enter/Space selects, aria-label with values + band class) over a transparent 24px hit circle. |

## 13. Pill-tab inspector, ≥24px cells, ClinVar token (7 October 2026 — follow-up decisions)

Adopted from the approved pattern (Lioran.ai automation editor): pill tabs at the top of the
inspector, a tinted lead box stating the verdict, pill groups on the toolbar, small-caps section
labels with key/value rows. No libraries, no colour/glow/animation additions; the protein schematic
stays custom SVG.

| Item | What changed | Where |
|---|---|---|
| Pill tabs | The rail is now four pills — **Summary / Substitutions / Agreement / Sources** — dark-filled active, outlined inactive, one row, ≥24px targets. Proper tablist semantics: `role=tablist/tab/tabpanel`, `aria-selected`/`aria-controls`, roving tabindex, Arrow/Home/End (selection follows focus). The choice persists for the session in the store (`landscapeRailTab`). | `inspector/LandscapeInspector.tsx`, `stores/slices/searchSlice.ts` |
| Summary tab | A tinted lead box "**Reads as** · …" states the verdict as one plain sentence, built in the shared model (`readsAsSentence(verdict)`), before the per-tool score+band rows and the key/value context rows. "Go to domain" keeps its nav section here. Sources of truth unchanged — no new aggregation. | `landscapeEvidence.ts`, `LandscapeInspector.tsx` |
| Substitutions tab | The two per-tool strips and chips, plus the conservation row; the no-record state is one sentence, not a box. | `LandscapeInspector.tsx` |
| Agreement tab | The REVEL × AlphaMissense scatter with labelled axes/bands, focusable points. | `LandscapeAgreementPlot.tsx` |
| Sources tab | Provenance line, load window, method and citations behind one disclosure, collapsed by default. | `LandscapeInspector.tsx` |
| Toolbar pills | "Colour by / Residue summary / Focus width" segmented radios and the "Lanes" toggles now use the same pill group style (`.ls-pill`), so the tab and its inspector speak one visual language. Radiogroup semantics kept; finding-block wording untouched. | `sequence/LandscapeToolbar.tsx`, `landscape.css` |
| Cell height (route A) | Every interactive focus-grid cell is now ≥24px tall for **all** pointers (heatmap rows, nucleotide lanes, summary row, phyloP row; floor 24, cap 26). Route A chosen over the `pointer: coarse` fallback because the whole-window overview lives on the horizontal axis — columns still fit the measured width — and the taller stack (~650–750px) is absorbed by the tab's vertical scroll without losing the window. The geometry harness asserts 814 cells ≥24px and the grid staying ≤ ~800px at 1010px. | `LandscapeFocus.tsx`, `landscape.css` |
| ClinVar token | The overview's P/LP markers get their own token `--ls-clinvar-plp` (magenta, 90% mix) — kept apart from the PP3 band red so the ClinVar lane cannot be read as a predictor band; filled-circle shape unchanged. Legend relabelled "ClinVar P/LP (assertion, not a score band)". Harness: contrast 3.43:1 (light) / ≥3:1 (dark), RGB distance to PP3 red ≥ 81. | `landscape.css`, `LandscapeOverview.tsx` |
| Doc merge | This audit (§11) and the 7 October review are one document again; the standalone `doc/LANDSCAPE_TAB_REVIEW.md` was deleted. The geometry harness stays wired through one `package.json` line (`test:geometry:landscape`, part of `verify:geometry`). | `doc/` |

### Effect on SOD1 p.Ala5Val

- Finding: "… 3 … in the PP3 range, 11 in the BP4 range and **15 remain indeterminate**"; residues 1
  and 6 keep their named gaps.
- Variant sentence: "it ranks 4 of **the 6 substitutions with an AlphaMissense score** at residue 5 (1 = highest)".
- Rail: "Reads as · The queried substitution A5V reads in the PP3 range for REVEL (0.853 · PP3
  Moderate) and in the PP3 range for AlphaMissense (0.840 · PP3)." — then evidence and context.
- Overview ClinVar lane: magenta markers + relabelled legend, unmistakable next to the AM bars.

### Verification (this round)

- `npx tsc --noEmit` (direct) — clean.
- `npm run lint` — boundaries 0 violations; focus indicators pass; verify parity pass.
- `npx vitest run` — full suite green (4173 passed at the 7 October first pass; re-run for this round below).
- Geometry harnesses: header 116/116, function-track 241/241, landscape 35/35 (screenshot eyeballed,
  light + dark).

### Rank cross-check (added in the same round, after review)

The rank clause in the headline ("it ranks 4 of the 6 …") is read **within one table only** — the
dbNSFP per-transcript substitution list — never by ranking the pipeline's score against dbNSFP
rows. Because the headline shows the pipeline's variant-level score, the two readings are now
**cross-checked** before the rank is stated:

- Agree at printed precision (3dp) → the rank is stated normally.
- Disagree → the rank is **withheld**; the sentence falls back to the source-honest range reading
  ("among the N scored substitutions … it is within the range"), and a caution names both readings
  and both sources ("the predictors pipeline … vs … in dbNSFP"), shown with the warn glyph in the
  finding block. The same cross-check covers a REVEL mismatch beside the "◆ this variant" marker.

Every number stays reproducible from one source; a disagreement is surfaced as data quality, never
averaged away. Pinned by `landscapeEvidence.test.ts › the pipeline's variant score is cross-checked
against the dbNSFP table` (agree / disagree / REVEL-only cases).

### Provenance plumbing and the consolidation decision (same round)

There is no single "the dbNSFP table" behind the predictors service to consolidate onto: the
variant-level AlphaMissense is read through a tiered ladder (VEP AlphaMissense plugin → local dbNSFP
sqlite → myvariant.info, twice), each tier capable of carrying a **different release**, and the
landscape reads dbNSFP through its own two paths (myvariant window, local sqlite). Consolidating the
sourcing would couple the engine's number (`predictorData.amPathogenicity` feeds PP3/BP4 in
`criteria.ts`) to the tab's cache and latency, can flip band-edge classifications, and needs the
engine's own test suite as its acceptance gate — an owner decision, not a tab change.

So the recommendation, implemented in stages:

1. **Provenance, not sourcing (done).** `predictorData.amProvenance` / `revelProvenance` (and
   `conservationData.revelProvenance`) now name the tier that produced the score and its release
   where known — "VEP AlphaMissense plugin", "local dbNSFP 5.0", "myvariant.info dbNSFP (release not
   stated)", "query.dbnsfp.org (release not stated)", "Genos Web Query". Additive only: no score
   changes. The rank cross-check reads it: when the two sides name different dbNSFP releases, the
   caution says that is the likely cause; same release, disagreeing numbers → "numbering or a stale
   cache"; releases unknown → re-run advice.
2. **Single-reader consolidation (deferred, owner decision).** Worth doing only if the cross-check
   ever fires on real data (it has not: on SOD1 p.Ala5Val the pipeline and dbNSFP readings agree at
   printed precision). If pursued: one dbNSFP reader module (the landscape's transcript-policy
   reading) reused as the predictors' later tier, VEP kept first; acceptance = the acmg criteria
   suite re-run green plus a stated position on marginal band-edge calls.

Pinned: `vep-orchestrator.test.ts` asserts the tier provenance on the VEP and coordinate-fallback
paths; `landscapeEvidence.test.ts` pins the release-gap / same-release / unknown-release caution
wording.

### Whole-protein overview decoupled loading & sequence resilience

1. **Decoupled overview endpoints (`/landscape-overview` vs `/landscape-context`):**
   Previously, `/analyze-variant/landscape-overview` evaluated both full-protein dbNSFP AlphaMissense scores
   and multi-query gnomAD/ClinVar/regional constraint serially before returning any data. This forced
   the Whole Protein AlphaMissense score bars to wait >20s on external APIs (and occasionally timeout).
   The routes are now split:
   - `POST /analyze-variant/landscape-overview` returns whole-protein AlphaMissense & REVEL scores and
     transcript metadata immediately (~9s on large proteins like CNOT1 without local dbNSFP).
   - `POST /analyze-variant/landscape-context` loads gene-wide ClinVar, gnomAD, and regional constraint in
     the background, displaying explicit pending states ("ClinVar context pending", "gnomAD context pending",
     "Regional constraint pending") in their respective lanes without blocking residue score visualization.
2. **Pipeline rail honesty:**
   `getWorkflowStageStatus` now inspects `landscapeOverviewStatus`. If the ±25 focus window has finished but
   the whole-protein overview is still loading, it reports `"progress"` (`"${count} residues ready · Loading whole protein..."`)
   instead of prematurely claiming "complete" while the user observes spinners on the Whole protein overview.
3. **Protein sequence fetch resilience:**
   `useProteinSequence` now reuses pre-cached protein sequence from `useVariantAnalysisStore` on initial render
   via lazy initialization, enforces an `AbortController` signal and strict 10s timeout on `/api/v1/sequence/:id`
   with clean abort on unmount, and provides fallback error messaging, verified by unit tests in
   `src/hooks/__tests__/useProteinSequence.test.ts`.
4. **Context state persistence & honest finding presentation:**
   `contextStatus` is stored in the persistent `landscapeOverview` slice of `useVariantAnalysisStore` rather
   than ephemeral local component state, preserving context loading and completion across tab switches.
   `landscapeFinding` distinguishes loading from failure: passing `undefined` while context is fetching displays
   the informative loading message rather than prematurely printing failure text.
5. **Cross-transcript isolation & key-guarded rail status:**
   The server `landscapeContextCache` is keyed by `${gene}::${axisTx}` with sanitized `transcript` inputs,
   preventing cache collisions between different transcript axes. `MasterSidebar` and `VariantSearchPanel`
   strictly match `landscapeOverview.key === currentKey` before passing the status to `getWorkflowStageStatus`.

### Sources

- Pejaver V, et al. Am J Hum Genet 2022;109:2163–2177. doi:10.1016/j.ajhg.2022.10.013 (REVEL Table 2).
- Bergquist T, et al. Genet Med 2025;27:101402. doi:10.1016/j.gim.2025.101402 (AlphaMissense Table 1).
- Cheng J, et al. Science 2023;381:eadg7492. doi:10.1126/science.adg7492.
- Ioannidis NM, et al. Am J Hum Genet 2016. doi:10.1016/j.ajhg.2016.08.016 (REVEL).
- Davydov EV, et al. PLoS Comput Biol 2010. doi:10.1371/journal.pcbi.1001025 (GERP++).
- Pollard KS, et al. Genome Res 2010. doi:10.1101/gr.097857.109 (phyloP).
- Liu X, et al. Genome Med 2020. doi:10.1186/s13073-020-00803-9 (dbNSFP).
- AlphaGenome AVI: DeepMind AlphaGenome (preprints cited in `src/shared/alphagenomeEvidence.ts`);
  composite score contains AlphaMissense — shown as non-independent on the tab.
