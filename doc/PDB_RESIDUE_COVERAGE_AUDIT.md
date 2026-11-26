# PDB residue coverage audit (2026-11-26)

Question: outside the Interfaces & PPI tab (fixed in PR #303), does any part of Missense & Fold count
solved PDB structures at a residue while including structures that have **no coordinates** for that
residue? And does it ever show "no coordinates" as a negative ("not at the interface", "None",
"covers the site")?

Answer: **yes, in five places.** Two put a false statement on screen (C), one gives inflated counts
(H), two are medium or low. The places that pick coordinates for FoldX, pockets and binding change are
correct: they check atoms at the site.

## Method

- Live data, 2026-11-26: PDBe `mappings/best_structures/{acc}`, PDBe `graph-api/uniprot/unipdb/{acc}`
  (observed ranges per entry, best chain, UniProt numbering), PDBe `interface_residues`, UniProt
  secondary-structure features.
- The app's own functions, run with `tsx` on live data: `fetchPdbeInterfaces` + `observedFor` +
  `nativeInterfaceSupport`, `fetchBestPdbStructure`, `buildFunctionEvidence`. The scripts were deleted.
- "True n" below = `entriesModelling(coverage, entries, residue).length`, the rule PR #303 uses.

Variants: ABCG1 p.Gly358Arg (P45844), SOD1 p.Ala5Val (P00441), SLC12A4 p.Gln867His (Q9UP95), plus
three with disordered or unresolved stretches: CFTR Ser670 in the R domain (P13569), PTEN residue 300
in the loop that crystal constructs delete (P60484), TP53 Pro72 in the disordered N-terminus (P04637).

## Findings

Severity: **C** = the screen contradicts the data, **H** = misleading, **M** = medium, **L** = low.

| # | Where | What it counts | Sev. | Live evidence | Proposed fix | New payload data? |
|---|---|---|---|---|---|---|
| F1 | `src/shared/interfaces/stored.ts:81` (`nativeInterfaceSupport`, `n: p.pdbEntries.length`) → `src/shared/functionEvidenceInput.ts:20` → `src/shared/functionEvidence.ts:1010-1021` | Function tab caveat "PDBe-KB places residue N at the interface with … in k of n solved structures". Same input feeds the Function rail, Insights and the Report. | H | SLC12A4 Gln867: shows **1 of 8**, true **1 of 4**. CFTR Ser670: **1 of 23**, true **1 of 1**. CFTR Phe508: 3 of 23, true 3 of 21. SOD1 Ala4: 1 of 118, true 1 of 115. | For the variant residue use `p.modelledEntries.length` (already on the payload since #303), as `src/shared/interfaces/observed.ts:23` does. | No |
| F2 | Same `nativeInterfaceSupport` map → `src/shared/hotspotEvidence.ts:502` → `src/components/evidence/function/HotspotsView.tsx:220-226` and `src/shared/molecularWorkspace.ts:76` | Hotspots table, "Native interfaces" column, for every ClinVar P/LP residue: `k/n`, or **"None"** when the residue has no support. | C | The map gives "None" where no native entry models the residue: ABCG1 350 and 358 (5 entries listed, 0 model them); PTEN 300 (4 partners, 0 model it); TP53 72 (49 native partners, 0 model it). Inflated `n` as in F1 (SOD1 4: 1/118, true 1/115). I did not check that a P/LP row falls on one of these residues; any row that does reads "None". | Part, with current data: a residue inside every native partner's `unmodelled` stretch → "Not modelled", not "None". Full: put each entry's observed ranges on `MultimerExperimentalInterfaces` and compute `n` per residue with `entriesModelling`. That moves `entriesModelling` from `server/` to `src/shared/` and changes a shared contract, so it needs a refactor proposal first. | Yes, for exact `n` at other residues |
| F3 | `server/services/structure/structure-fetcher.ts:952-957, 982, 1004-1012, 1081` → `src/shared/structure3dEvidence.ts:1227, 1344-1360` → `src/components/inspector/StructureExperimentalEntries.tsx:17, 45` | 3D structure tab, experimental entries: "covers the site", and the "closest covering entry" tag. Both come from the construct span `unp_start..unp_end` (PDBe) or the alignment span (RCSB), not from modelled residues. The list itself keeps only "covering" rows. | C | Entries marked "covers the site" vs entries that model the site: **ABCG1 358: 5 vs 0.** **PTEN 300: 8 vs 0.** **TP53 72: 13 vs 0.** CFTR 670: 30 vs 6. SLC12A4 867: 8 vs 4. SOD1 5: 146 vs 141. CFTR 508: 51 vs 41 (the ΔF508 entries delete the residue). "Show" then loads an entry with no atoms at the site. | In `fetchPdbHomologs`, read `fetchResidueCoverage(acc)` (one cached call) and set "covers" from `entriesModelling` for entries PDBe lists; keep the span only for other-protein homologs, labelled "aligned span". Screen text: "models the site" / "site not modelled". | No (boolean meaning changes; add a field if both are wanted) |
| F4 | `server/services/structure/structure-fetcher.ts:300-301` (`covering` by span) → `best-chain.ts:65-95` → `structure-resolver.ts:408-416` | Experimental chain choice for the canvas and FoldX. The final pick is correct (atoms are checked, `chain-quality.ts:82`), but chains with no atoms at the site count as "did not verify". When all do, the result is "incomplete", which is treated like an outage: not cached. | M | ABCG1 358: examined 10, did not verify 10 → incomplete, 4.0 s, repeated on every request. PTEN 300: 12 of 12, 3.8 s, 5 not examined. CFTR 670: the 12-download cap is filled by chains that do not model 670; the 6 entries that do (1XMI, 2BBO, 2BBS, 1XMJ, 2BBT, 4WZ6) are never examined. They are mostly engineered NBD1 constructs, so a missed wild-type chain is possible, not shown. | Filter `covering` with `entriesModelling` before ranking. Empty → `"none"` (cached, AlphaFold, a reason such as "no solved structure models residue N"). | No |
| F5 | `src/shared/functionEvidence.ts:551-555` (`structureContext`) | Function tab "Structure" tile when the residue lies before the first or after the last helix/strand that UniProt assigns. | M | ABCG1 residue 20: **"Terminal, no regular structure"**, "PDB 7R8D". 7R8D models nothing before residue 72; residues 1-71 are unresolved, not shown to lack structure. | Same honest wording the long-gap branch already uses: "No helix or strand assigned … may be flexible or simply unresolved". | No |
| F6 | `src/shared/functionEvidence.ts:537` | Same tile names the PDB entry of the protein's first element, not of the elements next to the residue. | L | PTEN 300: cites **PDB 7JUL**; the flanking elements come from 5BZZ and 5BZX, and 7JUL does not model 300. | Cite the `pdb` of the before/after elements. | No |
| F7 | `server/services/structure/structure-resolver.ts:240` | Tier 3 homolog template: requires the alignment span to cover the site, never checks atoms there. | L | Not reproduced: Tier 3 runs only when AlphaFold fails. | After `fetchPdbFromRcsb`, refuse a chain with no atoms at the site. | No |

Not verified live (reasoning only, L): `functionEvidence.ts:567-570` calls a gap of up to 8 unassigned
residues a "link … of the solved structure". If those residues are unresolved, "link" is still true of
the chain, so I left it out of the table.

## Suspects that turned out correct

| Where | Why it is correct |
|---|---|
| Interfaces & PPI verdict and counts (`src/shared/interfaces/verdict.ts:92, 104`, `observed.ts:23`) | Use `modelledEntries`; "Not modelled" is its own verdict (PR #303). |
| Insights interface sentence (`src/shared/insightsEvidence.ts:558-569`) | Reads the verdict and `observed.n` from the fixed path. |
| Mechanism workspace rows (`src/shared/mechanismWorkspace.ts:74-86`) | Shows "k of n" and "n of total that model this residue". |
| Binding-change wild type (`server/services/external-api/ppi.ts:278-291`) | Counts entries that model the residue; says "not modelled in any of the N" when none does. |
| Energetics / FoldX final chain (`chain-quality.ts:82`, `pdbe-entries.ts` `locateResidue`) | Refuses a chain without the wild-type residue and full backbone at the site; `locateResidue` needs an OBSERVED residue. |
| Pocket finder (`server/routes/biophysics/pocket.ts:237-257`) | A residue missing from the PDB falls back to AlphaFold, or returns 422. Never "not in a pocket". |
| Function tab long-gap sentence (`functionEvidence.ts:560-565`) | Already says "may be flexible or simply unresolved" (ABCG1 358, PTEN 300 and 395). |

## Fixes (same day)

| # | What changed | Data |
|---|---|---|
| F1 | `nativeInterfaceSupport` divides each residue's support by the pair's entries that model that residue (`src/shared/interfaces/stored.ts`). SLC12A4 Gln867 reads 1 of 4; SOD1 Val6 104 of 137. | Payload: `MultimerExperimentalInterfaces.coverage` |
| F2 | `nativeInterfaceSupport.modelledAt(residue)` counts the native entries that model a residue; the Hotspots row carries it (`interfaceModelled`), and the table and side panel say "Not modelled" with the reason, never "None", when it is 0. | Same |
| F3 | The 3D tab says "covers the site" only where coordinates are confirmed (`PdbHomolog.modelsPosition`, or the verified FoldX template). A range that includes the residue without that check reads "range spans the site, coordinates not checked" and is tagged "closest entry by range"; PDBe's "no" reads "no coordinates at the site". A list built without PDBe coverage is not cached. Cache key `homologs_v5`. | One optional field |
| F4 | `fetchBestPdbStructure` leaves out rows with no coordinates at the residue (`server/services/structure/site-coverage.ts`). When none is left the answer is final: cached, no download, AlphaFold used, and the screens say why. Selection rule amended, `select-v5` (`doc/energetics-release/STRUCTURE_SELECTION_RULE.md`). | `excludedExperimental` also takes `{ unmodelledResidue, entries }` |
| F5 | Past the first or last assigned element the tile reads "Outside the assigned helices and strands … may be flexible or simply unresolved". | None |
| F6 | The tile and the Sources list cite the entries of the elements next to the residue (`structureContext.pdbs`). | None |
| F7 | Tier 3 skips a homolog PDBe says has no coordinates at the site. A homolog of another protein is in its own numbering and PDBe does not list it, so it is judged by its aligned range only. | None |

`entriesModelling` moved to `src/shared/residueCoverage.ts` so the server and the browser count the same
way. A stored assembly with `coverageChecked: true` but no `coverage` is re-read once (`isStaleAssembly`).
The ABCG1, SLC12A4 and SOD1 fixtures gained `experimental.coverage` from PDBe unipdb (2026-11-26).

## Limits

- PDBe reports one "best chain" per entry. In 193 multi-chain entries of the six proteins, another copy of
  the chain sometimes resolved residues the best chain lacks: always within 3 residues of one the best
  chain resolves. So a "k of n" count at the edge of a gap can miss an entry. Chain choice and the 3D tab
  treat the 5 residues next to a gap in such an entry as unconfirmed and leave them to the coordinates.
- A residue's real coordinates cannot be mapped from RCSB or PDBe segment ranges alone: both treat a
  construct with an internal deletion (PTEN 1D5R, CFTR 1XMJ, SOD1 4XCR) as one continuous block. PDBe's
  `unipdb` handles these correctly.
