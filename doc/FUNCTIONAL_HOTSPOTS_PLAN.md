# Plan: Hotspots subtab, Interfaces polish, 3D guides (2026-10-28)

Status: **built on 2026-10-28** (uncommitted). Section 0 records what was built and the two owner decisions. Sections 1 to 5
are the plan as written, kept as the record of why.

## 0. What was built

**Owner decisions, 2026-10-28**
- **PP2 now uses a citable rule.** The old rule (gene missense Z ≥ 3.09 AND o/e < 0.6) was app-defined. PP2 now reads the
  O/E of the gnomAD v4.1.1 regional interval that contains the variant, with Chao et al. v3's calibrated edges:
  - ≤ 0.36 → `PP2_Moderate` (weighted as Moderate by `acmgClassifier.ts`)
  - ≤ 0.59 → `PP2`

  No verified locus or interval means no PP2; gene Z is not a fallback. BP1 bands (> 0.97, > 1.23) are shown as context
  only, and BP1 stays unapplied, as already decided. The code is in `calibration.ts` (`REGIONAL_MISSENSE_CALIBRATION`,
  `regionalPp2Code`), `gnomad-gene-constraint.ts` (`pp2Code`), `criteria.ts`, `ladderEvidence.ts`, the header's Regional
  O/E row and the Predictors rail. A payload that recorded PP2 under the old rule is flagged as stale.
- **Rung E was benchmarked before it was shown.** It passed the pre-registered gates: doc/HOTSPOT_3D_DECISION.md.

**Hotspots subtab** (Functional domains → Hotspots)
- **Server:** `server/services/evidence-context/hotspots.ts`, served at `GET /evidence-context/:gene/hotspots?uniprot=&transcript=`.
  - It is prefetched up front with the other Evidence context.
  - It shares one gnomAD read with the Landscape context.
  - It checks numbering against the AlphaFold DB model's sequence (SOD1, VHL and NAE1: 0 mismatches).
- **Model:** `src/shared/hotspotEvidence.ts`. View: `HotspotsView.tsx`. Guides: `hotspots`, `hotspot_cspec`,
  `hotspot_regional`, `hotspot_per`, `hotspot_spatial`.
- **Rung A (CSpec):** `cspec.ts` reads the registry's JSON API. The PM1 text is shown verbatim; residues are never parsed
  from it. Only the status "Released" counts.
- **Rung C (published PER):** `server/data/per/per-regions.json.gz` (1,336 genes, 92 KB, built by `npm run data:per`). Each
  region is verified residue by residue against the model's sequence.
- **Rung D (PER re-run):** `src/shared/perBurden.ts`, a port of the published R code. It agrees with the Python probe on VHL.
- **Removed:** the Functional domains density windows (15 and ±10 residues, the ≥10/≥12 triggers) and the Landscape ±5 window.

**Interfaces & PPI**
- The Assembly card is always visible. Edges are drawn only for measured native PDBe-KB pairs.
- The Domains lane uses the Functional domains map's own domains (`drawnDomains`, InterPro included). A Region that is a
  mapped site is drawn once.
- Names are measured and fall back to callouts; each lane ends with an exact containment readout.

**3D canvas guide**
- An "On this canvas" card keys each highlighted set with its drawn colour, source and count.
- Residue labels are a toggle. "Label all N highlighted" labels a large set only when the reader asks.
- It is proven on WebGL by `npm run test:geometry:focus` (17 assertions).

**Reached but not done**
- PathProx's per-variant score is shown as a suggestion only. No ACMG strength table was attempted.
- `doc/MECHANISM_WORKSPACES_REVIEW.md` is not updated for the Interfaces changes.

The plan covers three requests: a "detected hotspots" subtab on Functional domains, a visual upgrade for Interfaces & PPI
(the Assembly card and the Domains/Sites lanes), and informational guides on the 3D canvas. Scope is **germline only**.
The rule is **no heuristics**: every cut-point, window or label on screen must come from a published source, a measurement,
or an expert specification. If a published method is re-run here, it must be labelled as **not validated** in this app.

## 1. Findings: what the first draft got wrong

### Interfaces & PPI
- The draft proposed a "seam bridge" between chains. `AssemblyDiagram.tsx` removed contact edges on purpose: *"neither
  contact edges nor a spatial position can be inferred from SUBUNIT text."* An edge is only justified where PDBe-KB has
  measured a native, non-fibril interface between two chains (see the PDB fibril rule in `pdbe-interfaces.ts`).
- The draft said the bridge styles "already exist". The `.ifc-diagram*` rules at `src/styles/interfaces.css:125-138` are
  dead CSS: no component uses them.
- InterPro domains in the interface atlas are right, but a second implementation would let two tabs disagree. The
  domain-drawing decision (InterPro entry type decides, family-level matches flagged) already lives in `functionEvidence.ts`.
- The 6 % label cut-off in `InterfaceTrack.tsx` is a layout rule. It should become a measured fit (label width against
  available pixels), with a callout when a label does not fit.

### Functional domains (Hotspots)
- Every number in the draft was invented: a sliding window, a ≤10 Å Cα cut-off, an RSA cut for "buried", a ΔΔG cut for
  "destabilising". "Breaks contact / breaks fold" states a mechanism the data do not show.
- The tab already carries the same kind of constants: `DENSEST_WINDOW = 15`, `NEAR_WINDOW = 10` and the ≥10 / ≥12 triggers in
  `functionEvidence.ts:723-744`, and ±5 gnomAD in `landscapeEvidence.ts:635`. Under this rule they go.
- No new fetch is needed for 1D work. `server/services/prediction/landscape-context.ts` already returns gene-wide ClinVar
  (classification, stars, HGVSp) and gnomAD v4 missense per residue on the canonical transcript. `clinvarClassification.ts`
  already excludes conflicting records.
- Hot-spot PM1 remains the owner's decision (memory: PM1 hot-spot decision open). Nothing below feeds the engine.

### 3D structure
- Choosing the "top hotspots" or "key sites" for callouts is itself a selection rule.
- A HUD card would be a fourth story beside the toolbar, legend and rail that `structure3dEvidence.ts` unified.
- Leader lines re-projected from the camera each frame are fragile; Mol* labels are attached to atoms.
- `ResidueAt` (`coordinateText.ts`) holds no coordinates, so Cα distances need the index extended first.
  `server/routes/structure.ts:598` already parses Cα atoms server-side.

## 2. The evidence ladder for "is this residue in a hotspot?"

Research done on 2026-10-28. Ranked from most to least evidential. Each rung keeps its own label on screen; rungs are never
merged into one verdict.

| Rung | Source | What it is | Grade | Status for our data |
|---|---|---|---|---|
| A | **ClinGen CSpec** (`https://cspec.genome.network/cspec/api/svis?detail=high`, JSON, 211 specifications, 195 genes) | Expert panel's gene-specific PM1 text and strengths | Expert specification | API works. PM1 content is **prose**, and some residue lists are images (VHL's hotspot table). It must be shown verbatim with its link, never parsed into residues. Only `Released` specifications count: SOD1's ALS panel is "Pilot Rules In Prep", with no PM1 record. |
| B | **gnomAD v4.1.1 MCR O/E** with the calibration in Chao et al. bioRxiv v3 (10.1101/2024.04.11.588920v3; 730,947 exomes; ClinVar 20250504; ClinGen local-posterior framework, prior 4.41 %) | Regional missense depletion, calibrated with likelihood ratios | Calibrated, preprint | The app already loads exactly these MCRs (`constraintSource.ts`, `papers/2026-rmc`). **v3 calibrates them to PP2 and BP1, not PM1**: PP2 Moderate O/E ≤ 0.36, Supporting ≤ 0.59; BP1 Supporting > 0.97, Moderate > 1.23. The v2 preprint's PM1 cuts (≤ 0.37 / ≤ 0.21) were on gnomAD v2.1.1 and are superseded. The engine's current PP2 input (Z ≥ 3.09 and O/E < 0.6, doc/LANDSCAPE_TAB_AUDIT.md:29) is app-defined; replacing it is an engine change for the owner. |
| C | **PER, published output** (Pérez-Palma et al. 2020, Genome Res 30:62, `github.com/dlal-group/PERs`, MIT) | Pathogenic-enriched regions from ClinVar P/LP + HGMD DM vs gnomAD 2.0.2 | Published and validated (de novo NDD OR 8.33; ClinVar P vs B OR 106) | Data frozen in 2019, GRCh37, canonical transcripts of that time. Gene-wise: PERs in only 105 of 9,742 genes in the M–Z file. **None in SOD1, VHL or NAE1** (VHL minimum adjusted p 0.38). Family-wise covers paralog families (e.g. SCN1A/2A/3A/8A/9A, KCNQ2/3/5). |
| D | **PER method re-run on current data** (`scripts/hotspot_probe/per_probe.py`) | Same parameters as the published R code: ±4 window centred every 5 residues, one-sided Fisher, Bonferroni, adj. p < 0.05 | Published method, **not validated here** | Runs in about 1 s per gene. **Finds nothing in SOD1, NAE1 or VHL.** gnomAD v4 saturates the population side (VHL: 164 of 213 residues carry a PASS missense), so this test has little power now. That is why VHL, which has an expert PM1, gets no region. HGMD is not available, so only ClinVar is used. |
| E | **3D spatial clustering** (Sivley et al. 2018 AJHG, PathProx; `scripts/hotspot_probe/ripley_probe.py`) | Ripley's K for P/LP residues against random residues; bivariate K_P − K_N against gnomAD missense; per-protein distance range; permutation p | Published method, **not validated here** | **Finds clustering where D finds none** (2,000 permutations, seed 7; p = 0 means p < 1/2000): SOD1 univariate p < 0.0005, P − N p = 0.005. VHL, all residues: p < 0.0005 and p < 0.0005. VHL, confident residues only (pLDDT ≥ 70, AlphaFold DB's published band): p < 0.0005 and p = 0.001, so the disordered tail does not explain the result. NAE1 has 3 P/LP residues, the paper's minimum, so it is not tested. |
| F | **Raw distribution** | ClinVar P/LP per residue above the axis, gnomAD missense below, no cut-off | Measurement | Always shown. |

Coverage is uneven. A gene can reach rung E and nothing above it (SOD1), or rung A while D finds nothing (VHL).

### Why rung E is the strongest suggestion, and why it is still only a suggestion
- In the paper, PathProx has a leave-one-out median AUC of 0.75 over 89 proteins with significant clustering, comparable to
  SIFT and PolyPhen-2. **Unfiltered it is 0.55**, so the clustering test must pass before any per-variant score is shown.
- Deviations from the paper: AlphaFold models instead of solved structures, unique residues instead of variants, gnomAD v4
  missense instead of ExAC, 2,000 permutations instead of 100,000, a 40-step distance grid, and a single protein, so the
  paper's 10 % FDR across proteins cannot be applied.
- Confounds that remain: ClinVar submission bias toward well-studied regions; monomer models of obligate oligomers (SOD1 is a
  dimer); PDBe-KB interfaces are on solved structures, not the model.
- Before any rung-E reading reaches the screen, it needs a **pre-registered benchmark** in the form of
  doc/RESIDUE_TOLERANCE_DECISION.md: fixed genes (SOD1, VHL, RYR2, LDLR, BRCA1, SCN1A), fixed thresholds, a time-split ClinVar
  hold-out, and comparison against rung B. If it fails, it is rejected and recorded, as the tolerance scores were.

## 3. Plan

### Group 1 · Interfaces & PPI
1. **Assembly card, always visible.** Remove the collapsed `<details>` in `InterfacesTab.tsx`. Show chain chips (the
   variant's chain marked), copy numbers, and the SUBUNIT qualifier as a chip. Draw an edge **only** between chains with a
   native PDBe-KB interface, labelled k/n structures. Partners named only in text get no edge, with a caption saying why.
   Delete the dead `.ifc-diagram*` CSS or reuse it for the edge glyph.
2. **One domain model for two tabs.** Lift the domain-box decision out of `functionEvidence.ts` into a shared function. Use
   it for the Interfaces "Domains & regions" lane. Remove duplicates only for the same UniProt feature (same type, start, end
   and description).
3. **Labels that fit.** Replace the 6 % cut-off with a measured fit and a callout (`211 · UBA3`), so no box is left
   unlabelled. Add an exact containment readout ("In domain" / "Outside") at the end of each lane.

### Group 2 · Functional domains → Hotspots subtab
1. **Model** (`src/shared/hotspotEvidence.ts`, pure): rungs A–F as separate, labelled readings, each with source, version
   and grade. Rung D runs in the shared model from data the app already has. Rung E runs server-side on the loaded
   coordinate model, is cached per gene and model, and is only shown after its benchmark passes. Until then the rung reads
   "Not shown: method not yet validated in this app".
2. **Screen:**
   - A ladder strip: one row per rung, in the order above, each with its grade chip. "Expert specification", "Calibrated
     (preprint)", "Published region", "Published method, not validated here" and "Measurement" are distinct words.
   - The aligned distribution (rung F) under the domain bar, with any rung A/C/D/E region drawn as a labelled band.
   - The disease-residue table: UniProt site with its ECO code, PDBe-KB native interface k/n, RSA as measured,
     sequence distance, and 3D Cα distance on the named model with that residue's pLDDT. This closes the open
     "From N is sequence only" item.
   - The PM1 caveat stays: the engine tests PM1 as a critical site only, and nothing on this subtab changes that.
3. **Remove** `DENSEST_WINDOW`, `NEAR_WINDOW`, the ≥10/≥12 triggers and the Landscape ±5 window; the distribution replaces them.
4. Loads with the other Evidence data (no fetch on tab open); underline subtab; white body with an accent-wash header.
   Fixtures: SOD1 p.Ala5Val, VHL (a released expert PM1), NAE1 p.Asp116Gly (sparse).

### Group 3 · 3D guides
1. Mol* labels, attached to atoms, for what is already chosen: the variant, the current selection's companions
   (`ResidueFocus`), and rows sent from Hotspots or Interfaces with "Show in 3D". Nothing is picked automatically.
2. No HUD. The rail already describes the focused residue; a Guides on/off toggle sits in the toolbar.
3. A geometry-harness case asserts each label is attached to the right atoms (pattern: `npm run test:geometry:focus`).

## 4. Decisions for the owner
1. **Rung E**: run the pre-registered benchmark before showing it (recommended), or show it now under "Published method,
   not validated here".
2. **Rung B**: show the v3-calibrated PP2/BP1 band as context only (recommended), or replace the engine's app-defined PP2
   input with it. The second is an engine change.
3. **PM1 hot spot**: still open. No rung feeds it.

## 5. Open checks, and what became of them

Resolved on 2026-10-29:
- **PER data licence.** The repository's `LICENSE` is the unmodified MIT text; its README masks HGMD genomic information as `NA`;
  the bundle holds region bounds and residues only. Not established: whether HGMD's own terms reach a derived region table
  (`server/data/per/README.md`).
- **PER numbering.** Each published region is checked residue by residue against the AlphaFold model's sequence at request
  time, and withheld on any mismatch (`hotspots.ts`), so a GRCh37-era numbering difference cannot draw a wrong region.
- **gnomAD's ClinVar field is germline.** gnomAD's pipeline reads `ClassifiedRecord/Classifications/GermlineClassification`
  and skips a record that has none (`data_pipeline/datasets/clinvar.py`, lines 175-181); `clinical_significance` is that
  classification's description. Read from the repository on 2026-10-29, not from the browser's documentation.

Still open:
- PathProx's per-variant score itself; only the clustering tests and the residue-level AUROC were benchmarked.
- Run time of the 3D statistic for a very large protein on the 2-OCPU OCI host. Measured here: SCN1A (2,009 residues) 5.4 s,
  BRCA1 (1,863) under 1 s of statistic plus 2 s of accessibility; AlphaFold DB serves no model above 2,700 residues.

## Sources
- Pérez-Palma E. et al. 2020, Genome Research 30:62–71, doi 10.1101/gr.252601.119; code and data `github.com/dlal-group/PERs`
  (last commit 2019-12-10).
- Sivley R.M. et al. 2018, AJHG, PMID 29455857; preprint doi 10.1101/109652.
- Chao K.R. et al., *The landscape of regional missense mutational intolerance quantified from 730,947 exomes*, bioRxiv
  10.1101/2024.04.11.588920 v3 (v2: 125,748 exomes, PM1 cuts on gnomAD v2.1.1).
- ClinGen Criteria Specification Registry API, `https://cspec.genome.network/cspec/api/`.
