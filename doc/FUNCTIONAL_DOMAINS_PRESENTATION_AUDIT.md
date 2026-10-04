# Functional domains tab: integrity and presentation audit

Reference variant: SOD1 p.Ala5Val (UniProtKB P00441, 154 aa, NM_000454.5). UniProt features checked live
against `rest.uniprot.org` on 2026-10-04. This follows `FUNCTIONAL_DOMAINS_TAB_REVIEW.md` (NAE1, SLC12A4).
SOD1 stress-tests the tab in a way those two did not: it is short, densely annotated and saturated with
disease variants (81 in UniProt). Status: every finding below was addressed on 2026-10-04 except the two that need a decision (A12's engine side) or a later phase (A13); see "Resolution" at the end.

## A. Scientific integrity (each confirmed in code)

| # | Sev. | Finding | Evidence | Fix |
|---|---|---|---|---|
| A1 | High | The foot says *"Not annotated for SOD1: active sites, **metal binding**…"*, yet SOD1 carries eight Cu/Zn ligands (H47, H49, H64 ×2, H72, H81, D84, H121), and the table lists two of them. | Since 2022 UniProt records metal ligation as `Binding site` with a ligand. `notAnnotated` in `functionEvidence.ts` still keys on the retired `Metal binding` type. | Count `Binding site` features whose ligand is a metal ion as metal binding. Add a SOD1 test. |
| A2 | High | Of the three UniProt variants at residue 5, the finding and the fact cell pick the first one (**A5S**). The exact change, **A5V**, is itself a UniProt ALS1 variant. | `sameResidueDisease[0]`, `functionEvidence.ts:615, 631` | Match `change.to` against the query. Exact match → "UniProt lists this exact change in ALS1 (PubMed …)". Other substitutions at the residue → "also A5S, A5T", as context only (they belong to PS1/PM5, which this tab does not score). |
| A3 | High | The A5V record says *"in ALS1; severe form; **reduces structural stability and enzymatic activity**"*, but the screen shows only "In ALS1". | `variantNote()` keeps the text before the first `;`. | Keep the disease, and show the remaining clauses in the row (dbSNP stripped). This is the most informative sentence UniProt has on the variant. |
| A4 | Med-High | Natural variants show **"Experimental"** evidence, and the rail says "Experimental, counts for PM1". On a variant, ECO:0000269 means a published report. A reader can take it for a functional assay (PS3). | `rowFromFeature` sets the same `evidenceLabel` for every group. | For variants, label it "Reported" with the PubMed link. Keep the evidence levels for sites, modifications and mutagenesis. |
| A5 | Medium | PROSITE **patterns** PS00087 / PS00332 (short Cu/Zn SOD signatures) are drawn and captioned as *domains*. One of them draws a box inside the Pfam box, with end numbers "139 150" floating at the right. | `DOMAIN_DATABASES` includes `"PROSITE"`. `DomainMatch` has no InterPro entry type, so a pattern cannot be told from a domain. | Server: carry the InterPro entry **type** (`domain`, `family`, `homologous_superfamily`, `conserved_site`, `active_site`, `binding_site`, `ptm`, `repeat`) on every match, and route by type, not by database. Draw conserved sites as motif ticks, not boxes. |
| A6 | Medium | A Trp33–Trp33 cross-link is labelled **"W33ub"**, a ubiquitination it is not. | `ptmShort` maps every `Cross-link` to `ub`. | Write `ub` only when the description names ubiquitin or SUMO. Label a Trp–Trp link "W33–W33". |
| A7 | Medium | The lead sentence reads *"Residue 5 carries 3 annotations: Ala5Ser (natural variant) and others"*. The three "annotations" are variants, the query among them. A variant is not a functional annotation of the residue, and counting the query annotates the query with itself. | `specificAtResidue` includes the `variants` group. Rule-trace step 3 says the same. | Keep variants out of "carries N annotations". State them in their own sentence (A2). |
| A8 | Medium | **Legacy numbering is invisible.** UniProt marks the initiator Met as removed, so p.Ala5Val is residue 4 of the mature chain, and most SOD1 literature, including the PubMed records linked in this table, calls it **A4V**. A curator searching the literature will not connect the two. | `Initiator methionine 1 Removed` is in the payload. Nothing reads it. | From `Initiator methionine` / `Signal` / `Propeptide` / `Chain` start, compute the mature-chain position and show it once ("mature-chain residue 4; older literature numbers it A4V"). Wording must stay generic (TTR V30M = p.Val50Met is the same case). Never present the legacy name as the HGVS name. |
| A9 | Medium | Header: **Missense Z +0.84 "Tolerant"**. Commit 93ee30b fixed this (0 < Z < 2 reads "Not constrained"), but the merge 14f1bf2/7746935 reverted it. | `src/components/header/constraintMetrics.ts:183` | Re-apply, and add a guard test so a merge cannot drop it again. |
| A10 | Low | The Domain fact reads "None at this residue · 3 annotated elsewhere", while the table lists Gene3D 2–154 as "inside". The ≥ 80% rule hides it without saying so. "3 elsewhere" counts the two PROSITE patterns. | `facts[0]` | "Only a whole-chain superfamily (Gene3D 2–154)". After A5, count domains only. |
| A11 | Low | Mutagenesis "Residue 51–52" names no substitution (UniProt: FG→EE). Cross-link names are raw ChEBI strings. Rail step 4 runs "study):none found" together. | `rowFromFeature`, `trace` | Parse multi-residue `change` strings. Shorten ChEBI names. Add the missing space. |
| A12 | Owner | **PM1 hot-spot reading.** SOD1 is the textbook case: 81 disease variants over 154 aa, 3 at this residue. "PM1 not met" is correct for the *site* reading the engine implements, but the screen reads as if PM1 were closed. A whole chain dense with disease variants is not a hot spot unless benign variation is compared, and gnomAD has no regional blocks for SOD1. | `assessPm1` | **Not changed: your decision.** Recommend (a) show disease-variant density in the residue's window as context with no cut-point, and (b) say in the PM1 sentence that the hot-spot reading is not tested. |
| A13 | Context | A4 sits on β1 at the dimer interface. That is the key structural fact for A4V, and this tab cannot show it, because every distance here is in sequence. | "From 5" column | Do not compute 3D here. Cite the Interfaces & PPI / Residue shifts result for the residue, with a link. |

## B. Output delivery and visual clarity

The model is sound (one pure builder; the tab decides nothing). The problem is that it hands the screen raw
UniProt rows and lets the screen show all of them. For SOD1 that means 118 features, 81 red pins and
"88 labels left off".

| # | Finding | Proposal |
|---|---|---|
| B1 | **Lollipop saturation.** 81 identical red pins say "red everywhere". The variant's place in that distribution, the one thing a curator wants from it, is not readable. | Replace the pins with a **density track**: disease-variant count per residue as short bars, with polymorphisms as a muted second series if any. The variant's residue gets a clay bar. Label only (i) this variant, (ii) other substitutions at the same residue, (iii) the window's densest cluster. Everything else shows on hover. |
| B2 | **Three encodings at once.** Circles mean variants. Diamonds mean every kind of site, PTM, cross-link and mutagenesis. Filled or hollow means evidence level, which nobody reads at 6 px. | **Lanes by type** under the backbone: metal/ligand binding, disulfide (one arc between the two cysteines), PTM, mutagenesis. Evidence level moves to the tooltip and the table, with a hollow mark only for "not observed in this protein". |
| B3 | The Gene3D line runs the full chain (2–154) and carries no positional information, which the model's own ≥ 80% rule already concludes. | Do not draw a match covering ≥ 80% of the chain. Name it once in the table, and in the rail under "Family signatures". |
| B4 | The helix/strand strip is grey dashes told apart only by thickness. SOD1 is a β-barrel, so the strip is almost all one glyph. | Use the standard cartoon (strand = arrow, helix = rounded bar) in one neutral token, with the variant's element outlined in clay. |
| B5 | A PROSITE pattern nests inside the Pfam box, with stray "139 150" end numbers. | Fixed by A5: motifs become ticks on the backbone. |
| B6 | **Known variants: 81 rows** at about 55 px each, many screens of scroll. Each row repeats "In ALS1 · includes 5" and "Experimental". | **One row per residue**: "Ala5 → Ser, Thr, **Val**", with "In ALS1" and the citations. The same-residue and exact-match rows are pinned first. A group summary leads: "81 in UniProt, 3 at residue 5, 9 within ±10; densest window 37–49". The ±50 window then shows about 20 rows. |
| B7 | "inside" and "+2" share a column. "includes 5" repeats it. | Use 0 / +2 / −3 with a column head "Δ residues". Drop "includes N". |
| B8 | The rail repeats the tab: an evidence-level list, then about 8 paragraphs of method text. | Keep the rule trace and the cut list. Fold Method behind one disclosure. Show only the evidence levels this variant's rows actually use. |

### What the backend should deliver (so the screen stays a renderer)

Add to `UniprotFeaturesData`, or compute once in `buildFunctionEvidence`, keeping the model pure:

- `domainMatches[].entryType` (InterPro entry type), the principled fix for A5, B3 and B5.
- `residueSummary`: the exact-match variant, other substitutions at the residue, functional sites at ±k residues, and the mature-chain position (A2, A7, A8).
- `variantDensity`: per-residue counts (disease / polymorphism) plus the densest windows, so the track and the summary row share one computation (B1, B6, A12).
- Normalised labels: ligand, cross-link, multi-residue mutagenesis, variant clauses after the disease (A3, A6, A11).

## C. Interactivity (today: click a mark to open its row; Whole / ±50 toggle)

1. **Linked hover** between schematic, table and 3D. Hovering a row lights its mark; hovering a mark scrolls to and highlights its row; "Show in 3D" stays.
2. **Brush to zoom** on the overview strip, replacing the two-state toggle (keep both as presets).
3. **Legend as layer toggles with counts** ("Disease variants 81", "Binding 8"). Hiding a layer frees its lane.
4. **Click a residue's density bar** to filter the table to that residue.
5. **Keyboard**: ←/→ steps through marks in the window, Enter opens the row. Mark hit targets of at least 24 px, which 81 pins cannot meet today.
6. **URL state** for window and selection, so a curator can share the exact view.

## D. evilcharts and Amicro

The question was never "a chart library for the protein schematic". It was whether either library is useful for
other data in this product.

[legions-developer/evilcharts](https://github.com/legions-developer/evilcharts): MIT licence, about 3.1k stars,
copy-paste shadcn + Recharts components for Bar, Line, Area, Pie and Radar charts, with gradients, glows and
animated effects.

**Recommendation: do not adopt it for evidence tabs.**
- The tabs' figures are positional or ruler-shaped (feature schematic, score rulers, residue maps). None of the five
  chart types fits, and a second x-scale would drift from the residue axis the drawing shares with its table.
- Its look (glow, gradient fills, entrance animation, Tailwind palette colours) breaks the design-system rules:
  `--cs-*` tokens only, no glow, motion only with meaning.
- Where a generic chart is genuinely right (a gnomAD frequency histogram, a ΔΔG distribution across predictors),
  Recharts is already a dependency and can be themed through the tokens directly. `recharts` is in `package.json`
  and unused in `src/` today; adopt it on purpose for such a chart or remove it.

[Amicro](https://amicro.vercel.app/) (read 2026-10-04): "premium React micro-interactions", built on Motion,
copy-paste, free. Card spreads, 3D carousels, loaders and transitions. It is a UI-motion kit, not a data-visualisation
kit, so it offers nothing for the charts. The repo already depends on `motion`; the interaction work here uses plain
pointer, keyboard and CSS state with no motion at all, which is what the design system asks for. Not adopted.

## E. What else

- **Regression guards.** A9 shows that merges silently revert fixes. Every "fixed" line in a `*_REVIEW.md` should name the test that pins it.
- **Consistency across tabs.** The exact-match variant (A2) and the mature-chain number (A8) are also needed by Literature, Insights and Report. Compute them once in the shared model.
- **Report export.** Check that the Report quotes the corrected finding sentence, not the old "Ala5Ser and others".
- **Narrow column / print.** The density track should drop to bars-only below about 600 px, with no labels.

## Order of work

1. A1–A4, A6, A7, A9–A11: label and rule-text fixes, with SOD1 tests (no engine change).
2. A5 + B3 + B5: InterPro entry type on the server, routed by type.
3. B1, B2, B6: density track, type lanes, per-residue variant rows (geometry harness cases for SOD1).
4. C1–C6 interactivity.
5. A8 mature-chain position (shared with Literature).
6. A12 only after the owner decides.

## Resolution (2026-10-04)

Evidence for each row is a test that fails without the change: `src/shared/__tests__/functionEvidenceSod1.test.ts`
(model), `src/components/evidence/function/__tests__/architectureLayout.sod1.test.ts` (layout),
`src/components/evidence/__tests__/FunctionTab.sod1.test.tsx` (tab), `server/services/external-api/uniprot.entry-types.test.ts`
(server), `src/components/header/__tests__/missenseZVerdict.test.ts` (header), and the geometry harness cases `sod1`
and `sod1-narrow` (219 assertions in all, up from 173).

| Finding | Status | What was done |
|---|---|---|
| A1 metal binding | Fixed | `isMetalBindingSite` counts a `Binding site` with an ion or Fe-S ligand; the foot no longer lists it |
| A2 exact variant | Fixed | `exactVariant` / `otherVariantsHere`; the finding and the fact cell name Ala5Val and list the others as context |
| A3 variant detail | Fixed | `variantNote` keeps the clauses after the disease name (dbSNP ids dropped); shown in the finding and the row |
| A4 "Experimental" on variants | Fixed | Variant rows read "Reported"; the rail's evidence levels exclude variants |
| A5 PROSITE patterns | Fixed | Server reads InterPro entry types (`DomainMatch.entryType`); `kindOfMatch` routes by type, falls back to the PS00xxx convention |
| A6 "W33ub" | Fixed | Cross-links label as ub / su only for ubiquitin or SUMO; Trp–Trp reads W33–W33; names tidied |
| A7 "carries 3 annotations" | Fixed | Variants are no longer annotations at the residue; the lead reads "No site, region or modification is annotated at residue 5." |
| A8 legacy numbering | Fixed | `processedChain` from the server; caveat "Older literature may call this A4V" with the offset explained. Cached payloads without it say nothing (the features cache key is now `fd2`, so they refresh) |
| A9 header "Tolerant" | Fixed | Re-applied in `constraintMetrics.ts`, with `missenseZVerdict.test.ts` so a merge cannot drop it again |
| A10 domain fact | Fixed | "only a whole-chain Gene3D segment covers it"; counts exclude patterns |
| A11 labels | Fixed | Multi-residue mutagenesis names each substitution; cross-link and ligand names tidied |
| A12 PM1 hot-spot | Context added; engine unchanged | `density` in the model and a caveat: 81 variants over 58 residues, 10 within ±10, hot-spot reading not tested. Whether to implement the hot-spot reading remains the owner's decision |
| A13 3D context | Not done | Needs the Interfaces & PPI result linked per residue; a later phase |
| B1 lollipop saturation | Fixed | Above 24 distinct residues the disease variants are a per-residue bar track (clay for this variant) |
| B2 three encodings | Fixed | Above 20 point marks they sit in lanes by kind (sites, modifications, mutagenesis); the disulfide is a bracket |
| B3 / B5 uninformative marks | Fixed | A single structural segment of 80% or more of the chain is listed, not drawn; PROSITE patterns are ticks |
| B4 strand glyphs | Not changed | The strip keeps its helix / strand glyphs; revisit with a cartoon style if wanted |
| B6 variant rows | Fixed | One row per residue ("Ala5 → Ser, Thr, Val"), summary row first, parts in the opened row |
| B7 distance column | Fixed | 0 / +2 / −3; "includes N" removed |
| B8 rail | Fixed | Method collapsed; levels exclude variants; two bullets on variant evidence and entry types |
| C1 linked hover | Fixed | Mark ↔ table row both ways |
| C2 brush zoom | Fixed | Drag on the axis or the overview; a custom-window button shows the range |
| C3 layer toggles | Fixed | Legend items are toggles with counts |
| C4 filter the table by residue | Partly | Clicking a bar selects and scrolls to that residue's row; no separate filter |
| C5 keyboard | Fixed | ←/→/Home/End step through marks, Esc closes, a live region announces |
| C6 URL state | Fixed | `?fnd=whole`, `near` or `40-100`, and `?fsel=<row key>`, read once, removed on unmount |
