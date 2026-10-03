# Structural perturbation tab — integrity review and redesign (2026-09-29)

Reference variant: **NAE1 p.Asp116Gly** (NM_003905.4, 16-66823281-A-G, Q13564).
Scope: `PerturbationTab` and its panels, the Evidence Lineage rail, and the payload and server code behind them
(`server/services/external-api/{saprot,esm2,esmc,esm3_forge}.ts`, the FoldX runner, `tools/model_server_app/routers/*`).

## Decision taken (owner)

**The 0–100 "Local perturbation score" is removed.** It does not feed the ACMG engine, so no classification
changes. The hero now leads with the one cross-model statement that holds up: the variant's rank *within* each
language model's own residue distribution. That rank doesn't depend on any model's scale.

## Findings

| # | Severity | What was wrong | Evidence | Fix |
|---|---|---|---|---|
| 1 | High | The 0–100 composite averaged three model-native ΔLLRs. `PhysicalPerturbationSection` accepted `poolFamilies` but never passed it to `computeMultiModelLlr`, which then fell back to a 2-nat spread test. NAE1 spans 1.32 nats, so the pool counted as "shared scale" and fed the score, while the rail said "Shared scale: No — mixed". | Screenshot: summary "pooled ΔLLR −6.7 nats" + rail "NO — MIXED". | Composite removed (owner decision). ΔLLR is never pooled. |
| 2 | High | The composite's weights (0.30/0.25/0.20/0.25), its (−ΔLLR−2)/8 transform and its 35/65 bands were all app-defined and unsourced, yet it was headlined as a "Consensus verdict · Moderate disruption". | `perturbationHelpers.ts` | Removed. |
| 3 | High | On FoldX's rigid backbone the Cα-displacement term is 0 by construction, but it still entered the score and pulled it toward "low". | FoldX BuildModel method; `rmsd === 0` check existed but was not applied. | Reported as "Not measured", with the reason. |
| 4 | High | "Neutral stability" was inferred from the VdW clash term alone, and printed as "+0.62 ± 0.00" with the **ΔΔG** run-to-run SD attached to the VdW term. | `parser.ts`: `sd` is computed over total ΔΔG. | The terms are labelled as ΔΔG components; stability links to Energetics. No ± on VdW. Identical runs are stated as "no spread, not a precision claim". |
| 5 | High | The SaProt card took its registry row from the *settings* engine. With remote-hf selected it showed the 650M row ("1280-dim") while the payload said the remote tier had served **SaProt_35M_AF2**. | Screenshot; `resolveModelCalibration(saprotEngine)`. | `resolveServedModel` reads the payload's `provenance`. A row taken from settings is flagged "Model inferred". |
| 6 | High | The SaProt registry note said its scores "sit near zero on this variant" — a sentence written about one variant and printed beside −6.99. | `modelCalibration.ts` | Rewritten as a statement about the model. |
| 7 | High | The rank sentence said "(0 of the other 19 canonical substitutions rank above it)" for rank 20 of 20, which inverts the meaning. | Screenshot; `20 - rank`. | Corrected to `rank - 1`; test added. |
| 8 | High | ESM3 "Refinement drift · de novo backbone realignment" is actually the maximum cosine distance between wild-type and mutant **sequence embeddings**, and the sidecar is called with `refine: false`. The rail called it "template-conditioned structure generation". | `esm3.py`, `esm3_forge.ts` | Renamed "ESM3 embedding drift — a representation change, not a structure prediction". The server bands moved to `THRESHOLDS.esm3Drift` and are drawn dashed as local marks. |
| 9 | High | ESM3 "Confidence HIGH (94.5)" is the input template's per-residue B-factor/pLDDT, not ESM3's confidence. | `esm3_forge.ts` reads `wtPdbText` B-factors | Labelled "input structure's per-residue value". |
| 10 | High | "Putative structural impact: Minor sidechain rotamer realignment without major backbone shift" was a fallback line the server pushed whenever no residue-class rule matched. It asserted a finding from the absence of a rule. | `esm3_forge.ts` | Server fallback line removed; the list is no longer shown. |
| 11 | High | The model servers defaulted a missing `mutRank` to **1** (the strongest preference), a missing entropy to 0 bits, missing probabilities to 0, and ESMC's shift to 0. | `esmc.ts`, `esm2.ts`, `saprot.ts` | These now stay `undefined`. The model also validates rank to 1–20. |
| 12 | Medium | ESMC's embedding shift was labelled "Cosine Distance". The sidecar computes `torch.norm(p=2)` (Euclidean) for ESMC and VESM alike. | `vesm.py` | Every shift is labelled Euclidean. |
| 13 | Medium | Embedding widths were wrong: SaProt 35M was recorded as 768 (config.json says 480) and VESM-150M as 768 (it is built on ESM-2 150M, which is 640). | HF configs | Corrected. |
| 14 | Medium | "State: p" was a Foldseek 3Di letter presented as a conformation state. A "#" (no structure token, so a sequence-only SaProt score) was not disclosed. | `saprot.py` | Now shown as "3Di structure state · Foldseek letter", with a "No structure token" caveat and callout. |
| 15 | Medium | Sidechain RMSD (tinted green/amber/red at 0.8/1.5 Å), VdW and ESM3 levels were tinted against unsourced local cuts. | Components | No red or green on this tab. Local marks are dashed and named. |
| 16 | Medium | A failed FoldX RMSD became a measured 0.00 Å, and missing contact counts printed as 0. | `runner.ts`, `?? 0` | Stays null; absence is stated in words. |
| 17 | Medium | "Local sidechain displacement" was actually the RMSD of **neighbour** side chains within ±5 residues. ΔSASA was absolute residue area but read as burial ("more buried"). | `contacts.ts`, `aligner.ts` | Relabelled. |
| 18 | Medium | "ESM-2 3B" in the concordance, pipeline labels and fetcher messages, when the server serves `esm2_t33_650M_UR50D`. "SaProt 650M" was used when 35M may have served. | `esm2.ts` | Concordance names are now unsized ("ESM-2", "SaProt"); the pipeline says "ESM-2 650M". |
| 19 | Medium | The SaProt loading banner guessed its stage from elapsed seconds and drew a fake progress bar. | `SaProtLoadingProgressBanner` | Replaced by the canonical "Running" state and the 35M/re-run actions. |
| 20 | Low | The Structure inspector said rigid-backbone "displacement values are physically interpretable". | `StructureInspector.tsx` | States that they are zero by construction. |
| 21 | Low | Legacy status words ("Standby", "N/A"); a `useMemo` after an early return; Tailwind palette colours and inline theme styles; the typo "116cannot". | Components | New tab and model are listed in `energeticsLabels.guard.test.ts`. Tokens only. |
| 22 | Medium | The ESM-1b registry row was labelled "calibrated" with Brandes 2023's own operating point (−7.5) and an unsourced −5.0, while the PP3/BP4 evaluator used ClinGen's ESM1b bands (Bergquist 2025). One score could get two verdicts. `THRESHOLDS.esm` (−5.0/−2.0) and `THRESHOLDS.esm1b` (−7.5/−5.0) were dead copies of the same numbers. | `modelCalibration.ts`, `constants.ts`; nothing read the two constants. | Registry cut-points are read from `PP3_BP4_CALIBRATION.esm1b` (PP3 Supporting ≤ −10.7, BP4 Supporting ≥ −6.3); both dead constants deleted; tests pin agreement with `calibratedCall`. Bands taken from the repo's recorded Bergquist Table 1 values — the paper page could not be re-fetched (HTTP 429). |

## What the screen shows now (NAE1)

- **Finding:** "3 of 3 — All 3 models place Gly among the three least-preferred residues at this position. Each scores it below native Asp (ΔLLR −7.2 to −5.8 nats, each on its own model's scale); FoldX finds no clash above the local mark (VdW +0.62 kcal/mol). Neither is calibrated pathogenicity evidence." Chip: **Informational**. Engine record: *not counted in PP3/BP4* (read from the rule's own tool list).
- **Readings:** language models (ΔLLR, rank ruler, band), FoldX components (VdW with the dashed 2.0 local mark, electrostatics, neighbour RMSD, clashes, Cα not measured on a rigid backbone, contacts, SASA), ESM3 drift and site context.
- **Residue detail:** one model at a time (distribution, embedding-shift trace, entropy, 3Di state).
- **Rail:** reading trace (models → scale check → rank → FoldX → engine record), app-defined marks with this variant marked, the selected model's registry row, method notes, payload sources and DOIs.

## Architecture

`src/shared/perturbationEvidence.ts` (pure model) → `PerturbationTab.tsx` + `perturbation/{Rulers,ResidueDetail}.tsx`
and `inspector/PerturbationRail.tsx` (which replaces `PerturbationInspector`). The styles are in `src/styles/perturbation.css` (`ptb-*`).
`perturbationHelpers.ts` (composite and text helpers) and the seven card components were deleted. The registry tests moved to
`shared/__tests__/modelCalibration.test.ts`.

## Follow-ups not done

- `calculateLocalSidechainRmsd` still returns 0.0 when the window has too few atoms. The runner now keeps a failure as null,
  but the function's own empty case should return null too (it has two callers).
- The header strip's LOEUF 0.94 reads "Moderate constraint". That is outside this tab; review it with the gene-constraint header.
- The FoldX parser's comment calls identical runs "failed minimisation". For a glycine they are expected; the flag deserves a softer name.
- VESM's citation in the registry ("Ntranos Lab 2024") should be updated to the published preprint.

## Second audit (2026-10-02) — SLC12A4 p.Gln867His

Reference variant: **SLC12A4 p.Gln867His** (NM_005072.5, 16-67946177-C-G, Q9UP95). The engine is unchanged
(the language models stay informational, and no FoldX or ESM3 output reaches it), so no decision was needed from the owner.

| # | Severity | What was wrong | Evidence | Fix |
|---|---|---|---|---|
| 1 | High | The hero read the substitution the wrong way round. It led with "**0 of 3** models rank His in the dispreferred half", and its cards said "Upper half" and "Most preferred". ESM-2 (ΔLLR −5.95) and ESMC (−6.98) give native Gln ~384× and ~1,075× the probability of His. A rank orders what is left after the native residue, so it says nothing about how strongly the model expects the native. | Screenshot: ESMC "3 / 20 · most preferred" beside ΔLLR −6.98. | The cross-model statement is now the **direction** each model reads: the sign of its own ΔLLR, beyond an even-odds mark of ln 2 (2×). Magnitudes are given per model as odds ("Gln 384× as likely as His in ESM-2"), which restates that model's ΔLLR and pools nothing. The hero now reads "2 of 3 models favour native Gln over His". |
| 2 | High | A near-uniform distribution was read like any other. SaProt (sequence-only, 4.23 of 4.32 bits, every residue within a point of the amino-acid background) contributed "rank 10 · Upper half" to the headline count. | Residue detail: P(Gln) 4.93 %, P(His) 4.96 %, L 9.31 % top. | New `flat` reading (entropy ≥ 95 % of log₂20 = 4.10 bits, an app-defined mark listed in the rail). A flat model is named as having no preference and is left out of the direction count and the band agreement. Its rank is drawn faded with "not read". |
| 3 | Medium | "The models disagree" fired whenever two models fell in different rank bands. Here all three put His above the dispreferred half. | Hero sentence. | "Split" is now said only when the models' directions differ. |
| 4 | Medium | The ranks were shown without the native's rank, so "3 / 20" had nothing to be read against. The band labels made preference claims ("Most preferred", "Dispreferred"). | Cards and ruler. | Every rank reads "His 3rd of 20 · Gln 1st". The ruler draws the native as a hollow ink ring and the variant in clay. Bands are positional: Top 3 / Upper middle / Lower middle / Bottom 3. When the native holds ≥ 50 % of the probability, the rank sentence says so. |
| 5 | Medium | A failed FoldX run read "No FoldX mutant model was built". The tab and rail never received `foldingStatus` or `foldingError`. | Fact strip and FoldX row. | Reasons now resolve in the Energetics engine's order (running → binary missing → repair failed → failed with its error → not configured). The rail gets the same props, and the FoldX row links to Energetics. |
| 6 | Medium | ESM3 printed "at sequence index 4" for a variant at residue 867, with no drift at the variant itself and no distance to the peak. | Readings row. | The row now gives the drift at the variant and how far the peak is from it, and flags "Peak away from the variant" when the gap is more than 10 residues. The VESM fallback's −1 sentinels are excluded from the max. |
| 7 | Low | The site-context pLDDT (87.4) had no reading, and the drift chip said "None · local band". | Readings row. | It now carries AlphaFold DB's published band ("Confident"). The drift chip names the marks it sits between ("Below 0.08 mark"). |
| 8 | Low | The engine status appeared four times in the hero (subtitle, eyebrow, chip, fact strip), and "Not counted" was repeated on every row. | Hero, table. | The chip and the fact strip keep it. A row says "Counted in PP3/BP4" only when that is true. |
| 9 | Low | Dead zone: with no embedding window (every remote engine), half the residue panel held a lone "No shift window" note. | Residue detail. | The absence is one line under the facts, and the distribution uses the full width. "101% of native" became the model's own odds. |
| 10 | Low | Rail step 1 printed full provenance strings in a right-aligned mono column that wrapped mid-name. ΔLLR used 3 decimals in the rail and 2 in the tab. | Rail. | The rail uses the short served name (the full string is in the title) and 2 decimals. Step 3 traces direction and odds per model. The flat and even-odds marks are listed with the other marks. |
| 11 | Low | A reader new to the field had no way in: ΔLLR, nats, rank bands and 3Di with no explanation on the page. | Whole tab. | Added a collapsed "How to read this tab" primer and plain one-line model descriptions in the table. The registry notes stay in the rail. |

### What the screen shows now (SLC12A4)

"**2 of 3** models favour native Gln over His at residue 867 — **ESM-2 and ESMC favour native Gln over His** — Gln 384× as
likely as His in ESM-2, Gln 1,075× as likely as His in ESMC — each on its own model's scale; SaProt spreads its probability
almost evenly here, so it has no preference to read. None of this is calibrated pathogenicity evidence." One callout covers
SaProt's caveats (no structure token, flat). The engine record is unchanged: informational.

### Follow-ups not done (server side; out of this tab's code)

- **SaProt's near-background output.** The structure token was "#" at a residue the input model calls confident (pLDDT 87.4),
  so 3Di encoding either did not run or did not align (`encode_pdb_to_3di` matches by `difflib` on the 510-residue crop). Check
  whether `wtPdb` reached the remote call for this variant. Separately, the remote parser takes the **max** score per residue
  across 3Di pair tokens when the `targets` call falls back to `top_k`. The marginal is the **sum**.
- **ESM3 drift peaking 863 residues from the variant at 0.004.** A substitution normally changes its own embedding most. Check
  that the Forge `logits(...).embeddings` array has no BOS/EOS offset, and that the sequence sent matches the PDB numbering.
  The route's length check only runs when a PDB is supplied.
- The floating action button in the shell overlaps the rail's right-hand values (seen on the "ESM3 drift" mark). That is a
  shell-level layout issue, not part of this tab.
- The flat (95 % of max entropy) and even-odds (ln 2) marks are app-defined. A ProteinGym check of how often flat
  sites occur per model would show whether 95 % is the right mark.

### Verification

`npm run lint` (boundaries, focus indicators, verify parity, tsc) is clean. Full `vitest run`: 260 files and 3,322 tests pass
(5 skipped). New fixture `src/shared/__tests__/fixtures/slc12a4Perturbation.ts` pins the model contract and the screen. Rendered in light,
dark and an 820 px column.

## Sources

- Meier J, et al. Language models enable zero-shot prediction of the effects of mutations on protein function. NeurIPS 2021. doi:10.1101/2021.07.09.450648
- Lin Z, et al. Evolutionary-scale prediction of atomic-level protein structure with a language model. Science 2023. doi:10.1126/science.ade2574
- Su J, et al. SaProt: protein language modeling with structure-aware vocabulary. ICLR 2024. doi:10.1101/2023.10.01.560349
- van Kempen M, et al. Fast and accurate protein structure search with Foldseek. Nat Biotechnol 2024. doi:10.1038/s41587-023-01773-0
- Hayes T, et al. Simulating 500 million years of evolution with a language model. Science 2025. doi:10.1126/science.ads0018
- Schymkowitz J, et al. The FoldX web server: an online force field. Nucleic Acids Res 2005. doi:10.1093/nar/gki387
- Model configs: huggingface.co/westlake-repl/SaProt_35M_AF2 (hidden_size 480); huggingface.co/ntranoslab/vesm (VESM_150M ← esm2_t30_150M_UR50D); ESM C 6B hidden size 2560.
