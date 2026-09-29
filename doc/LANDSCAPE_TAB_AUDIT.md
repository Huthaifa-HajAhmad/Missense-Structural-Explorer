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
