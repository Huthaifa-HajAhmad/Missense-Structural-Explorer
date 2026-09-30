# 3D structure view — scientific-integrity, code and UI review

Reviewed against **NAE1 p.Asp116Gly** (NM_003905.4, 16-66823281-T-C, GRCh38; UniProt Q13564, 534 aa),
the variant on the four screenshots that prompted the audit, 29 September 2026. Covers the AlphaFold2
and ESMFold views, the Mol* viewer, its toolbar and overlays, the inspector rail, and the server code
that produces what they draw (structure resolution, FoldX template, superposition, ESMFold, ESM3,
homolog search, the disruption step's pLDDT). Done with the `evidence-tab-refactor` skill.

## Decision taken

None was needed from the owner. No ACMG criterion reads the 3D view (`server/services/prediction/acmg/
criteria.ts` has no structure input), so nothing here changes a classification. One fix moves a number
outside the tab and is disclosed below: the Energetics consensus no longer down-weights FoldX,
ThermoMPNN and StabilityOracle on a crystal structure's temperature factor (S5). Round 2 adds one
more (R6): the SIFTS tier no longer maps a chain through another protein's UniProt entry, so a FoldX
template accepted that way now resolves differently and its ΔΔG can change. Neither reaches ACMG.

## What the screenshots showed, and why

| Screenshot | What it said | What was true |
|---|---|---|
| 1 — WT | Chip "RCSB PDB: 1YOV"; inspector "AlphaFold Inspector · Full-Length 3D Model", "pLDDT Confidence 94.5 (Very High)", "PDB B-Factor" | The canvas showed the AlphaFold DB model. The FoldX run (built on 1YOV chain A) had overwritten the store's only provenance field. 94.5 was 1YOV's crystallographic B-factor at Cα 116. The B-factor metadata the inspector read was never passed to it. |
| 2 — Mutant | "FOLDX MUTANT MODEL" coloured by "ESMFold-2 / ESM3 Allosteric Heatmap" | An ESM3 embedding distance, banded at 0.05/0.15/0.35 while the engine uses 0.08/0.22/0.38, offered in the FoldX view and called "allosteric". |
| 3 — Superposition | Two copies far apart, one all red ("≥ 2.5 Å"), "Global" alignment selected, no metrics | The alignment effect never ran, so the raw FoldX variant (1YOV's crystal frame) was overlaid on the AlphaFold model (AFDB frame). Its B column (1YOV temperature factors copied by FoldX) was painted as Å of displacement. No alignment had been computed at all. |
| 4 — ESMFold | "Predicting 3D mutant structure via ESMFold-2…"; "ESMFold-2 … (Lin et al. 2023)"; pLDDT 94.5 / PDB 1YOV in the ESMFold inspector | Both WT and variant were being folded; Lin 2023 is ESMFold v1; the site context was the AlphaFold view's (and 1YOV's B-factor). |

## Scientific findings

Severity per the skill: Critical changes a classification (none here); High asserts something false to
a curator; Medium misleads without changing a call; Low is drift or wording.

| # | Sev. | Finding | Evidence | Fix |
|---|---|---|---|---|
| S1 | High | The superposition compared the FoldX variant with a structure it was not built on. `/generate-mutant` builds on `resolveStructure` (1YOV chain A for NAE1) while the viewer's WT is the AlphaFold model; the only effect that aligned them never ran (see D1), so the RAW variant was overlaid. When the scope toggle did align them, every RMSD, contact, H-bond, SASA and χ1 difference measured AlphaFold-versus-crystal and was presented as the substitution's effect. | `useBiophysicalModeling` watched local state nothing wrote and a `pdbText` argument no caller passed; `AppViews` fell back to `compareMutantPdb \|\| mutantPdb`. | `useFoldxSuperposition` fetches the template FoldX used (same resolver), checks entry and chain against FoldX's reported template, then diffs and superposes against it. If they differ, the pair is unavailable with the reason. |
| S2 | High | The displacement heatmap coloured the raw variant's B column — crystal temperature factors — as Å of Cα displacement. For FoldX (rigid backbone) the true displacement is zero everywhere. | `backbone-displacement` theme on `mutantPdb`; FoldX `injectBFactorsFromWtPdb`. | Displacement is offered only on an aligned pair whose B column the aligner rewrote, and never for FoldX ("zero by construction"). |
| S3 | High | The toolbar named the canvas from `structureProvenance`, a last-writer-wins store field written by both the WT fetch and the FoldX run. | `foldxService.applyEnergetics` → `setStructureProvenance(template)`. | WT provenance lives in a new `pdbTextProvenance`; the pipeline's structure sink writes it; FoldX's template is read from `foldingEnergetics.structureProvenance`. The cached-run path no longer copies the template into the WT slot. |
| S4 | High | "pLDDT Confidence 94.5 (Very High)" was 1YOV's B-factor. `disruption.ts` returned any site Cα B-factor as `plddt` whenever a PDB mapping existed. For a 2.6 Å structure, 94.5 Å² means high mobility — the inverse of the claim. | `core-data-fetcher` passes the RCSB chain; `predictStructuralDisruption` reads B at CA. | The step now takes the structure's source; `plddt` is null for experimental entries and the raw value travels as `bFactor` + `bFactorKind`. The inspector reads site pLDDT from the displayed AlphaFold model. |
| S5 | High | The same mislabelled `plddt` fed the client Energetics consensus (`computeCalibratedConsensus`), which down-weights structure-based ΔΔG engines when pLDDT < 70 (×0.5) or < 50 (×0.1). For crystal templates it damped FoldX on temperature factors — typical B-factors are below 70 — and the client verdict diverged from the server's, which passes no pLDDT. | `EnergeticsView.tsx:462`, `ClinicalInsightsCard`. | Fixed at the source (S4): for experimental templates `plddt` is null, so the client consensus matches the server's. **Effect:** Energetics/Insights consensus probabilities change for variants whose template is a crystal structure. |
| S6 | High | pLDDT colours and the pLDDT filter were applied to experimental and FoldX-on-crystal coordinates. The "pLDDT ≥ 70" filter on temperature factors keeps the MOST mobile atoms. | `useMolstarStructure`: `currentSource = customPdbUrl \|\| activePdbId ? "experimental" : "alphafold"` for any supplied text. | The colour plan comes from provenance. Crystal B-factors are coloured by quartile within their own entry; the filter exists only for a pLDDT column. |
| S7 | High | B-factor meaning was guessed from values (max B in 50–100 ⇒ AlphaFold; any "AF-" substring ⇒ AlphaFold). Crystal B-factors routinely fall in 50–100. | `useMolstarStructure` (unused result), `foldx/pdb-utils.ts`. | `coordinateText.ts` never infers meaning from values; AlphaFold is identified only from header records, as a fallback to provenance. |
| S8 | High | Homolog "identity" was RCSB's relevance score: the search omitted `results_verbosity: "verbose"`, so no match context came back and the parser fell back to the score; "coverage" was a hard-coded 80% of the query; "In Range" was assumed without a range. 9QN5 showed "5% ID · In Range" under a search whose identity cut-off is 22%. Tier 3 of the resolver filtered on this fake identity and never checked coverage. | `fetchRawHomologCandidates`; RCSB Search API: compact (default) results carry no metadata. | Verbose search; identity, coverage and range read from the alignment (`query_beg`/`query_end`), null when absent; caches versioned; Tier 3 requires identity ≥ 30 AND coverage of the position. The client's 80% fallback is gone. |
| S9 | High | ESMFold citation and naming. The Tier-1 engine is JapanFold's `esmfold2-fast` (ESMFold2-Fast, Candido et al. 2026); the sidecar calls Forge `esmfold2-fast-2026-05`; the keyless fallback is ESMFold v1 via the ESM Atlas. The UI named every structure "ESMFold-2 (Lin et al. 2023)", and the server never said which engine answered — so a WT and a variant from different engines could be compared as a mutation effect. | `structure/esmfold.ts`, `routers/esmfold.py`. | `/esmfold` returns `engines: { wildType, variant }`; the view names each, cites the matching paper, and warns when they differ. |
| S10 | Medium | The ESM Atlas writes pLDDT on 0–1; the theme's 50/70/90 bands made every Atlas fold "very low" and the filter removed everything. | ESM Atlas fold API writes pLDDT on 0–1 (facebookresearch/esm discussion #608); AlphaFold DB and ESMFold2 write 0–100. | The pLDDT theme takes a scale; the model reads it from the file for de novo structures. |
| S11 | High | "Allosteric heatmap" / "Severe Allosteric Hub" for ESM3's per-residue cosine distance between WT and variant embeddings. Its bands (0.05/0.15/0.35) were a second copy of the engine's 0.08/0.22/0.38. `doc/FEATURES.md` also called it an L2-norm "allosteric structural drift". | `routers/esm3.py` computes `1 − cosine`; `THRESHOLDS.esm3Drift`. | "ESM3 embedding shift", engine bands from `THRESHOLDS.esm3Drift`, legend "a language-model distance, not allostery"; offered only on UniProt-numbered structures. FEATURES.md corrected. |
| S12 | Medium | "Local Window RMSD (Cα) ±15 residue active-site": the local RMSD covers `LOCAL_STRUCTURAL_WINDOW` = ±5; ±15 is the local Kabsch fit window, and it is a sequence window, not an active site. Under a local fit the ±5 RMSD sits inside the fitted atoms, so it is small by construction; "Global Cα RMSD" was then shown in the local frame. | `aligner.ts`, `thresholds/constants.ts`. | `LOCAL_ALIGNMENT_FIT_WINDOW` (15) shared by aligner, toolbar and model; readings name their window and frame and carry the local-fit caveat. |
| S13 | Medium | χ1 printed "0.0°" when null. The reference variant's mutant is Gly, which has no χ1. | `StructureInspector` fallback `: "0.0°"`. | "Not applicable — Gly has no χ1". |
| S14 | Medium | "N/A" ×4 and legacy-status wording; H-bond and contact deltas always rose. The "H-bond" count is any N/O/S pair ≤ 3.5 Å with no angle test. | `contacts.ts` `calculateHBonds`. | "Polar contacts … a proxy for hydrogen bonds", neutral ink; absent values are states. |
| S15 | Medium | ESMFold tip: "local pocket alignment snaps structured domains (<1.0 Å RMSD) to isolate active-site perturbations" (unsourced, circular — see S12) and "stochastic conformational sampling of flexible linkers". | Inspector copy. | Replaced by the true caveat: WT and variant are two independent predictions, so part of any difference is the predictions' own. |
| S16 | Medium | When `/esmfold` returned one structure, the client copied it into WT, variant and aligned slots and enabled Mutant/Superposition over identical coordinates. | `useStructuralFolding`. | Single structure → wild type only, variant modes disabled with the reason. |
| S17 | Medium | Pocket panel: "Affinity Prob. N%" (P2Rank's value is not always a probability, and ligandability is not affinity), "Likely Target Co-Factor" (removed from the Residue shifts tab as unfounded), volume "Å³" when only surface points were measured, "Server Calculation Error", a pointer to the wrong tab. | `MolstarInfoOverlay`. | Rebuilt from `derivePocketNarrative` — the Residue shifts tab's own model. |
| S18 | Medium | The ESM3 evaluation reads its site "pLDDT" from the mapped structure (1YOV for NAE1); the Perturbation tab shows it as "input confidence (pLDDT for an AlphaFold model)". Second copy of S4. | `structural-model-fetcher.ts`, `esm3_forge.ts`. | The fetcher passes the structure's source; `confidence.plddt` is null for experimental input. |
| S19 | Medium | Clicking any residue in the variant view rewrote `foldedResidueIndex` (the position FoldX mutated), moving the superposition's "site" and every site measurement to the clicked residue; the label then read "Mutated Residue N". | `AppViews.handleResidueClickMemo`. | A click only selects; the toolbar shows "Selected N" with a way back; the variant site keeps its label. |
| S20 | Medium | ESMFold "mutant" view drew the aligned file, whose B column the aligner overwrites with displacement, and coloured it as pLDDT. | `AppViews.resolvedStructureProps`. | The variant view draws the unaligned fold; only the superposition draws the aligned one. |
| S21 | Medium | A loaded PDB entry keeps its own numbering and all chains, but the view highlighted "residue 116" by author number and called it the variant. | `/pdb/entry/:id` returns the whole entry. | The model reads the residue at the variant's position and warns ("Highlighted residue is not the variant's") on a mismatch. |
| S22 | Low | Kabsch reflection fix flips column 3, but one-sided Jacobi SVD does not sort singular values. | `geometry.ts`. | Singular values sorted descending (U, V permuted); test added. |
| S23 | Low | `isValidPdbUrl` accepted protocol-relative `//host/…`, which `fetchWithAuth` would send off-site with credentials. | `molstarThemes.ts`. | Rejected. |
| S24 | Low | De novo notice copy said "ESMFold-2"; `LIMITATIONS.md` gave Tier-1 as 768 aa (it is 1,024; 768 is the stability path's engine). | `foldingLimits.ts`, `LIMITATIONS.md`. | Reader copy names ESMFold2-Fast; limits corrected. Server messages (parsed by the client) unchanged. |

## Dead, broken and incomplete code

| # | What | Outcome |
|---|---|---|
| D1 | `useBiophysicalModeling` primary diff/align effect: dependencies never change, so only its "else" ran — clearing the store's `foldxMetrics`, `compareMutantPdb` and `structuralDiff` whenever `apiClient` changed identity (every settings change). | Removed; replaced by `useFoldxSuperposition` (S1). The Perturbation tab's `structuralDiff` now gets a producer. |
| D2 | `MolstarViewer`: a draggable "Biophysical Insight Alert" no caller fed; ΔΔG formatter and energy unit read but never shown; `metrics`, `mutantDdG`, `compareVariant` props accepted and ignored. | Removed. |
| D3 | `bFactorMetadata`: computed by the viewer and never used; `ViewInspector` prop never passed by `AppViews`, so the inspector always said "PDB B-Factor". | Removed; replaced by the model's channel. |
| D4 | `StructuralLegendModal`: no control ever opened it. `App.tsx` subscribed to `viewMode` and `foldingStatus` only to feed it, re-rendering the app shell on every change. | Deleted, with the subscriptions. Replaced by the on-canvas legend. |
| D5 | `MolstarToolbar`, `MolstarInfoOverlay`, `useMolstarPocket`, `molstar/types.ts`, and the theme re-exports from `MolstarViewer`. | Deleted; replaced by `StructureToolbar`, `StructureLegend`, `StructurePocketPanel`, `StructureStatusOverlay`. |
| D6 | The canvas background was fixed when the plugin was created, so switching theme left a light canvas in a dark card. | Follows the app theme. |
| D7 | Polar contacts added an `interactions` representation to a one-residue component — it has no partners to show. | The site's 5 Å environment is drawn (grey sticks) with Mol*'s contacts. |
| D8 | Pocket residues were highlighted one component per residue; highlight clean-up handed ref strings to `hierarchy.remove` inside a catch-all. | One set component; clean-up deletes state cells by ref. |
| D9 | The capture menu never closed on an outside click; "Copy image" failed silently. | Closes on click-away/Escape; the button says "Copied" or "Copy failed". |
| D10 | ESMFold view with no fold fetched the resolver's structure (a crystal entry) and drew it under the ESMFold label. | An empty canvas with the fold state instead. |
| I1 | No colour key on the canvas for any theme. | `StructureLegend`, with band provenance (published / relative / app-defined, dashed). |
| I2 | The model switch lived only in the inspector; collapsing it removed the control. | Segmented control in the toolbar, keyboard operable (radiogroup, arrow keys). |
| I3 | Pocket residues could not be reached from 3D. | Lining residues nearest first; click frames one. |
| I4 | 3D Guide said "Analyze residue #408" when nothing was selected (a preset's default), gave wrong mouse controls. | Rewritten for this view. |

## The redesign

**Model** — `src/shared/structure3dEvidence.ts` (`buildStructure3dEvidence`), with
`src/shared/coordinateText.ts` for the few facts read from PDB text. The store adapter
`src/lib/useStructure3dEvidence.ts` is called by `AppViews` (to choose the canvas coordinates), the
viewer (toolbar, legend, overlays) and the rail, so all three render one model. Header comments list
the invariants and the defects replaced.

**Canvas chrome** (`s3d-*`, `src/styles/structure3d.css`, tokens only):
1. Identity row — what is drawn, from provenance ("AF-Q13564-F1 v6 · AlphaFold DB predicted model"),
   the variant chip ("Asp116Gly", frames the site), a "Selected N" chip when a click moved the focus.
2. Controls — Wild type / Variant / Superposition (disabled modes carry their reason), Colour (only
   valid colourings enabled), pLDDT filter (only for pLDDT), Fit (ESMFold only), Pocket, Image.
3. Warning banner for warnings only (numbering mismatch, mixed engines); information lives in the rail.
4. Canvas legend with band provenance; status overlays as sentences on a card.

**Rail** — On the canvas (each structure: name, kind, detail, what its B column holds) and notices →
five-step trace (wild-type coordinates → variant model with ΔΔG called a stability estimate →
superposition → colour → engine record: "Informational — no ACMG criterion") → wild type against
variant readings with windows, frames and caveats → variant site (residue check, pLDDT or B-factor
by kind, accessibility and the structure it was measured on) → experimental structures (identity and
range only when reported; load/unload) → method notes and sources with DOIs.

## Effect on NAE1 p.Asp116Gly

| Surface | Before | After |
|---|---|---|
| Toolbar, WT view | RCSB PDB: 1YOV | AF-Q13564-F1 v6 · AlphaFold DB predicted model |
| Site confidence | pLDDT 94.5 (Very High) | pLDDT read from the AlphaFold model at 116, with its AFDB band; 94.5 Å² is reported as 1YOV's B-factor where it applies |
| Variant view | pLDDT colours / "ESMFold-2 / ESM3 Allosteric" | FoldX variant on PDB 1YOV chain A, coloured by the template's B-factor quartile ("copied") |
| Superposition | Raw variant beside the AlphaFold model, all "≥ 2.5 Å" | Variant on 1YOV chain A; displacement not offered (fixed backbone); Cα RMSD 0 by construction; χ1 "not applicable (Gly)" |
| Experimental list | 1YOV "100% ID", 9QN5 "5% ID · In Range" | Identity and range from RCSB's alignment, "not reported" where absent |
| ESMFold view | "ESMFold-2 … (Lin et al. 2023)", pLDDT 94.5 / 1YOV | Engine named per structure; citation matches the engine; site read from the de novo model |

## Round 2 — review of round 1, and the follow-ups (30 September 2026)

Round 1 was re-read from the start before its follow-ups were built. What that found, and what the
follow-ups changed:

| # | Sev. | Finding | Evidence | Fix |
|---|---|---|---|---|
| R1 | Medium | When the viewer fetched the AlphaFold model itself (a cold start), it drew it before its provenance was known — plain colours — and then skipped the store's echo because the text was unchanged. The canvas stayed plain while the legend said pLDDT. | `useMolstarStructure` compared only the text to decide to skip. | The hook publishes the fetched text and draws from the store's echo, when the colouring is known. The same path now serves loaded PDB entries. Rendered: the cold-start model is in AFDB bands. |
| R2 | Medium | The FoldX pair was the variant against the template *before RepairPDB*. RepairPDB moves side chains across the chain, so χ1, polar-contact and contact changes counted the repair as the substitution. | `useFoldxSuperposition` fetched the resolver's template. | BuildModel's paired wild type (`WT_wt_1_0.pdb` / `WT_wt_1.pdb`, same run, same repair) is returned by `/generate-mutant` as `wtReferencePdb`, with the template's B-factors, and the pair is measured against it. A check that the two differ at the site alone guards against a stale pair. Results cached before this still use the template and say so on each affected reading. |
| R3 | Medium | Perturbation tab "Neighbour side-chain RMSD" had the same repair confound, and `calculateLocalSidechainRmsd` returned 0.0 when it could not measure (empty window, fewer than three backbone pairs, a failed fit) — shown as a measured 0.00 Å. Its unit test passed only through that failure path. | `structural-diff/contacts.ts`, `foldx/runner.ts`. | Null when not measured; measured against the paired wild type; the row names its reference (`localSidechainRmsdReference`). Test fixed to fit a real backbone. |
| R4 | Medium | A local fit with fewer than four Cα pairs silently fitted the whole chain, but the metrics echoed "local"; and the readings were labelled by the scope toggle, which runs ahead of the metrics while a new fit computes (and stays wrong if it fails). | `aligner.ts`; `structure3dEvidence.ts`. | The aligner reports the fit it applied; readings and the drawn pair's fit label follow the metrics. |
| R5 | Medium | A loaded PDB entry was highlighted by author number (round 1 only warned on a mismatch). | `/pdb/entry/:id`. | With the variant's accession, position and residue, `/pdb/entry/:id?uniprot=&pos=&wt=` returns the chain PDBe maps to the protein renumbered to UniProt, through the resolver FoldX templates already pass (SIFTS, else Needleman–Wunsch at ≥85% identity), only when the wild-type residue is at the position. Otherwise the whole entry in its own numbering, with the reason. Headers carry the numbering; the rail names the chain or the reason. |
| R6 | Medium | The SIFTS tier fell back to the entry's *first* UniProt mapping when the requested accession was absent (an ortholog's entry, a complex partner's chain), then accepted it on a one-residue identity check. This path also validates FoldX templates. | `sequence-aligner.ts querySiftsMapping`. | The requested accession only; orthologs go to the alignment tier. SIFTS documents are memoised for an hour, so one entry is fetched once. *Disclosed:* a template accepted through the wrong mapping would now resolve differently, so a FoldX ΔΔG can change for such a variant. No ACMG criterion reads FoldX or structure (`acmg/criteria.ts`). |
| R7 | Medium | The disruption step reported "low" disruption, status "ok", when no structure was resolved or it failed; the client's placeholder result was `{ level: "low", plddt: 100 }` before a result existed and in demo data. The Energetics inspector's low-confidence-template warning reads that pLDDT, so the placeholder suppressed it; the clinical card passes it into its facts. | `core-data-fetcher.ts`, `pipelineStateFactory.ts`. | `level: "unknown"`, `plddt: null`, a reason, and status `not_found` (or `error`). |
| R8 | Low | The FoldX pairing re-fetched and re-superposed whenever the canvas text changed, even for a crystal template it cannot be — a flicker through "loading" on every cold start. | `useFoldxSuperposition` dependencies. | Depends on the canvas text only for an AlphaFold or client-provided template. |
| R9 | Low | `/esmfold` folded the wild type and the variant one after the other. | `routes/structure.ts`. | Concurrent (`Promise.all`); the budget test still covers the sequential worst case, so a revert cannot shorten the client's patience below it. |
| R10 | Low | The store's `structureProvenance` had no reader left and two writers. | `biophysicalSlice.ts`, sinks. | Removed. The structure sink's setter is named for what it sets (`setPdbTextProvenance`); FoldX's template lives only on its energetics. |
| R11 | Low | `pocket.test.ts` passed a Windows path as a job directory, which becomes a file in the working tree on Linux. | — | Fixed on `main` in parallel (a real temp directory, removed afterwards); that version was kept in the merge. |
| R12 | Low | The glossary entry for the side-chain RMSD called it "the mutated sidechain" and gave "> 1.5 Å = substantial repacking", credited to Guerois 2002, which defines neither. | `src/components/evidence/MetricExplanations.ts`. | Describes the neighbour window, the local fit and the reference (paired wild type or pre-repair template), with no band; cites FoldX for the models. |

Not changed in round 2: the dormant compare-variant code — removed in round 3 below.

## Round 3 — the remaining follow-ups (30 September 2026)

| # | Sev. | Finding | Evidence | Fix |
|---|---|---|---|---|
| R13 | Medium | Chains were renumbered to UniProt by one shift, taken at the variant's position. Past an insertion, a deletion or an engineered linker every residue carried a neighbour's UniProt number, so contacts, pockets and highlights there landed on the wrong residues; a tag's residues took UniProt numbers they do not have. The same path builds FoldX's experimental templates. | `sequence-aligner.ts` (`rewritePdbCoordinates` with `seq + shift`). | `renumberChainToUniprot` numbers each residue from the tier that validated it (the SIFTS residue map, or the Needleman–Wunsch alignment). Residues with no UniProt position (tags, linkers, insertions) are left out — as missing density would be — rather than given invented or insertion-coded numbers, which FoldX reads poorly; waters are dropped; a ligand keeps its number unless a mapped residue now carries it (then 9000 up). Modified residues deposited as HETATM (MSE, SEP, TPO, …) are read as their parent amino acid, so a selenomethionine chain no longer aligns with a gap at every Met. The rail says how many residues were left out. *Disclosed:* FoldX templates with a tag, an insertion or a second segment now differ from before, so their ΔΔG can change; the FoldX cache is keyed on the template text, so no stale result is served. No ACMG criterion reads FoldX or structure. |
| R14 | Low | The compare-variant feature had state, setters, three remote-engine pollers, job timers and a diff effect, but nothing ever set `compareMode` or `compareVariant`, and no compare fold could start. `compareFoldAbortRef` was aborted on every reset and never assigned. | `useBiophysicalModeling.ts`, `biophysicalSlice.ts`, `useVariantAnalysis.ts`, `usePipelineAbortController.ts`, pipeline sinks. | Removed (≈660 lines). `setVariantBiophysics` and `resetBiophysics` lose their `isCompare` flag; the primary variant's behaviour is unchanged. |

## Verification

- `npx tsc --noEmit` clean; `npm run lint` (boundaries, focus indicators, verify parity, tsc) clean;
  `vite build` succeeds.
- Full `vitest run` after round 2: **217 files, 2,730 tests passed, 5 skipped, 0 failed** (after round
  1: 215 files, 2,710; before round 1: 213 files, 2,662). After merging `main` (the Energetics and
  Landscape rebuilds): 222 files, 2,792 passed, 5 skipped, 0 failed. After round 3: 222 files,
  2,797 passed, 5 skipped, 0 failed (new renumbering tests for both tiers, tags, an insertion, MSE,
  ligands and waters; the compare-only store assertions removed). Round 2 added
  `server/services/structure/entry-for-variant.test.ts` (SIFTS, alignment fallback, reason), route
  tests for the entry headers and a malformed request, the paired wild type in the FoldX runner test,
  the applied-fit report in the aligner test, the side-chain RMSD null case, model tests for the pair
  basis, the measured fit, renumbered and author-numbered entries, the site-pair check, and the
  Perturbation row's reference note.
- Rendered with a harness in Chromium (SwiftShader WebGL): WT, variant, superposition (paired and
  older-template bases), pocket, ESM3, ESMFold (success, mixed engines, failure, folding), light, dark,
  900 px; and, with the two structure routes intercepted, a cold-start AlphaFold fetch and a loaded
  entry in UniProt and in author numbering. Each route was fetched once. The harness used PDB 2OCJ
  chain A as stand-in geometry (no network to RCSB/AFDB in the sandbox) with the NAE1 metadata.

## Follow-ups not done

1. The RCSB verbose field names (`query_beg`/`query_end`) still could not be checked: the sandbox's
   egress proxy blocks `search.rcsb.org` and its documentation hosts. The parser accepts the older
   names too and prints "range not reported" when neither is present. Confirm on a live run.
Closed without a change: reusing the wild-type fold across variants of one protein. The server
already keeps folds by sequence hash (`esmfoldCache`, and the JapanFold client's own cache), and since
round 2 it folds the pair concurrently, so a second variant of the same protein waits only for its
own fold.

## Sources

- Jumper J. et al. 2021, Nature — AlphaFold2, pLDDT. doi:10.1038/s41586-021-03819-2
- Varadi M. et al. 2022, Nucleic Acids Res — AlphaFold DB and its pLDDT bands. doi:10.1093/nar/gkab1061
- Lin Z. et al. 2023, Science — ESM-2 and ESMFold (v1). doi:10.1126/science.ade2574
- Candido S. et al. 2026, bioRxiv — ESMC and ESMFold2 (ESMFold2-Fast). doi:10.64898/2026.06.03.729735
- Hayes T. et al. 2025, Science — ESM3. doi:10.1126/science.ads0018
- Schymkowitz J. et al. 2005, Nucleic Acids Res — the FoldX force field. doi:10.1093/nar/gki387
- Delgado J. et al. 2019, Bioinformatics — FoldX 5.0. doi:10.1093/bioinformatics/btz184
- Kabsch W. 1976, Acta Cryst A — least-squares superposition. doi:10.1107/S0567739476001873
- Sun Z. et al. 2019, Chem Rev — interpreting and normalising B-factors. doi:10.1021/acs.chemrev.8b00290
- Sehnal D. et al. 2021, Nucleic Acids Res — Mol* Viewer. doi:10.1093/nar/gkab314
- Krivák R., Hoksza D. 2018, J Cheminform — P2Rank. doi:10.1186/s13321-018-0285-8
