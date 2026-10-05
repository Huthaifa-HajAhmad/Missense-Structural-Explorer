# Interfaces & PPI: SOD1 audit (integrity, delivery, clarity, interaction)

Reference variant: **SOD1 p.Ala5Val** (NM_000454.5, UniProtKB P00441; legacy **A4V**), the densest real case
for this tab: 157 PDB entries, 15 of them amyloid fibrils, a nanobody, an unmapped chain, mouse and yeast
orthologs, 80 UniProt partners (66 from one two-hybrid screen), and STRING lists of 213 physical and 500
functional partners (500 is its cap). Data checked live against PDBe-KB, RCSB, UniProt, IntAct and STRING
on 2026-10-04. Earlier audit: `INTERFACES_AUDIT.md` (SLC12A4). No ACMG criterion reads this tab, so **no
finding changes a classification**.

Severity: **C** = the screen states something the data contradicts. **H** = misleading or unreadable at
this density. **M** = imprecise. **L** = polish.

## 1. Scientific integrity

| # | Sev | Finding | Evidence | Fix | Pinned by |
|---|---|---|---|---|---|
| I1 | **C** | **Amyloid fibril stacking was reported as the dimer interface.** The hero said "Ala5 is at the interface with the other SOD1 chain in 4 of 157 solved structures (7VZF, 9JBO, 9JBP, 9LI1)", the diagram put the dot on the homodimer seam, and the context line spoke of mixed mutant/wild-type dimers. All four entries are cryo-EM structures of SOD1 **amyloid fibrils** (RCSB keyword `PROTEIN FIBRIL`). In a fibril every chain stacks on the next, so PDBe-KB lists most of the core as "interface". In the 142 native structures Ala5 is at the dimer interface in **none**. | RCSB titles: 7VZF "amyloid fibril formed by full-length human SOD1", 9JBO/9JBP/9LI1 "human SOD1 … amyloid filament". 15 of 157 SOD1 entries are fibrils. | `pdbe-interfaces.ts` classes every entry through RCSB GraphQL (keyword or title) and splits each partner into `context: "native"` and `"fibril"`, recounting support on each side. The verdict reads native only. The fibril reading is stated apart, has its own lane, and is never counted. | `pdbe-interfaces.test.ts` (split, classifier), `interfacesEvidenceSod1.test.ts` "tests Ala5 against the 142 native structures" |
| I2 | **C** | **The binding-energy plan targeted a fibril.** "Not run yet. DDMut-PPI on a solved complex where Ala5 is at the interface (7VZF, 9JBO, 9JBP…)". A fibril is not a binding complex, and DDMut-PPI was trained on complexes. | Same entries. | `experimentalWildType` excludes fibril partners. For SOD1 the card now reads "Ala5 is not at the interface in any solved complex of SOD1, so no binding change is estimated." | `ppi.test.ts` "never scores on an amyloid fibril", SOD1 model test |
| I3 | H | **A nanobody and an unmapped chain were counted as partners.** PDBe puts a label in the accession slot for non-UniProt chains ("IG-heavy chain" for NB1, "Other") and types them (`additionalData.type` AB / OTHER). They appeared as partner rows, as track lanes and with STRING links to "Other". | Live PDBe-KB payload. | Read the type: AB → "antibody or nanobody, a tool binder", OTHER (or a non-accession label) → "chain with no UniProt record". Set aside like construct tags, one row each, never counted. | `pdbe-interfaces.test.ts`, SOD1 tab test |
| I4 | H | **Other species were not named.** Mouse SOD1 (P08228), yeast CCS1 (P40202) and IntAct partners from mouse or rat (Chga, Chgb, Hspa5, Cstb) read as human partners. Hspa5 also took the *human* HSPA5's STRING score (0.964) by gene-name match. | UniProt `organismDiffer`, IntAct MITAB taxid columns, UniProt organism of PDBe partners. | Organism from UniProt (PDBe partners) and IntAct taxid / UniProt flag (binary partners). Shown as a chip; matched by accession only; no STRING link; STRING cells read "Not scored (mouse)". Counted apart: "77 reported partners … 6 more from other species". | SOD1 model and tab tests |
| I5 | M | **CCS was listed twice**: once as SUBUNIT's heterodimer partner (no accession, no solved column) and again as "Copper chaperone for superoxide dismutase, O14618" under solved structures, carrying IntAct's methods. | Screen 3. | SUBUNIT genes resolve to the accession IntAct or PDBe gives for the same human gene before rows are keyed. One CCS row: "Heterodimer · Solved: 3 structures · Anti tag coimmunoprecipitation, Pull down · 4 studies". | SOD1 model test "keeps CCS as one row" |
| I6 | M | **"Heterodimer with CCS, SLC31A1"** for SUBUNIT's "The heterodimer CCS:SOD1 interacts with SLC31A1; this heterotrimer …". The parser took the first oligomer word. | UniProt P00441 SUBUNIT. | `subunitStatements` takes the largest assembly a sentence states: "Heterotrimer with CCS, SLC31A1". | SOD1 model test |
| I7 | M | **"Reported partners 86"** included the nanobody, the unmapped chain, the duplicated CCS and the other-species proteins. | Fact strip. | Counted once over every row, shown or folded; human only; other species stated apart. SOD1: 77 + 6. | SOD1 model test |
| I8 | M | **"IntAct binary interaction (9 assays, methods not read)"** when IntAct *was* read and simply holds no row for the pair. | SNCA, DYNC2LI1, Hspa5, Cstb. | "UniProt: 9 experiments; IntAct gave no method for this pair". | SOD1 model dump |
| I9 | M | **STRING's cap hidden.** "500 functional ≥ 0.15" is STRING's `limit`; the network is larger. | Trace step 6. | "500+ functional", "STRING returns its top 500", and "369+" on the tier. | SOD1 model test |
| I10 | L | "Reported binding" meta said "by co-purification, structure or several studies" over rows whose evidence is "Binds (SUBUNIT)" or methods not given. | Screen 3. | "UniProt or IntAct, beyond a single two-hybrid screen". | — |

**Verified correct (kept):** per-residue support from `interactingPDBEntries`; ipTM guidance (> 0.8 / < 0.6,
EMBL-EBI, not a calibration); STRING bands 0.15 / 0.4 / 0.7 / 0.9; DDMut-PPI sign and RMSE 1.33 / 1.51;
the engine record "None".

**Context added, not a claim.** Ala5 is not at the native interface, but its neighbour Val6 is, in 104 of
142 native structures. The finding now says so ("Val6, 1 residue away, is at that interface in 104 of
142"), so "not at the interface" is not read as "far from it". Legacy A4V is known to destabilise the
dimer indirectly. The tab does not assert that, because no source on the tab measures it.

## 2. Output delivery and clutter

| # | Sev | Finding | Fix |
|---|---|---|---|
| D1 | **H** | **120 partner rows; 66 of them repeat one sentence**, "Yeast two-hybrid · 1 study (PubMed 32814053)". The 15 attested binders sat above a wall of one screen, and STRING's strongest physical partners (SOD2 0.957, HSPA4, PARK7) were 70 rows down. | The model groups and folds (`PartnerGroupView`). One study for a whole tier is said once in its head. A screen tail of more than 12 keeps only the rows with STRING physical support of 0.40 or more (BCL2, RNF19A, KARS1) and folds the other 63 behind one line, listed as names on request. STRING tails keep 8 and 5 rows and fold the rest as names with scores. SOD1 now shows 34 rows by default. |
| D2 | M | The tab filtered and counted provider rows itself (hidden counts, empty columns). | The model owns tiers, folds, counts and the cap; `filterPartnerGroups` is pure and tested; the tab renders. |
| D3 | M | Six solved-partner lanes, two of them non-biological ("NB1", "Other"), with labels clipped. | Biological native lanes only, fibrils last in a quieter ink and italic name, set-aside chains in the table only. |

## 3. Visual clarity and charts

- **Support profile instead of ink weight.** Each solved lane draws interface residues as bars whose
  *height* is the share of that pair's structures with the residue at the interface. Opacity is the weakest
  channel there is: a 4-of-157 fibril contact read as dark as the dimer core. Heights make the core
  (Val6, Val8, Gly18, 51–55, 112–116, 149–154 in ~100 of 142) and the faint contacts readable at a glance.
- **Readout column.** Each solved lane ends with the variant's own count ("0/142", "4/15" in clay when > 0).
- **Partner tier chart** (`PartnerTiers.tsx`, the chart the user asked about). One bar per evidence tier,
  in two bands: *binding evidence* (assembly 3, solved 2, reported 13, screen 66) and *association only*
  (STRING physical 202, functional 369+). Linear lengths, number printed on each bar, neutral ink. The shape
  is the finding: few attested binders, many associations. The bars double as the filter.
- **Where a generic chart was not used.** No scatter of STRING physical against functional (two
  association scores against each other answer no question about the variant). No donut (part-to-whole of
  tiers that overlap in meaning). No chart library: the track shares the residue axis, and the tier bars
  are six divs (data-presentation.md §4).

## 4. Interactivity

- **Linked highlight:** hovering a solved lane lights its Assembly-table row and the reverse. The lane name
  is a button that scrolls its row into view (no smooth scroll under reduced motion).
- **Tier filter:** each tier bar is an `aria-pressed` toggle that narrows the grid; "Show all" clears.
- **Search:** "Find a partner" matches gene or accession across shown, folded and STRING-tail rows, and
  shows each match as a full row. "No partner matches" is a sentence, not an empty table.
- **Folds:** "Show 63 names" / "Hide names", `aria-expanded` and `aria-controls`.
- **URL state:** `?ppit=<tier>` and `?ppiq=<query>` (`interfaces/viewUrlState.ts`), read on open, written on
  change, removed on unmount, reset for a new variant.

## 5. Effect on the reference variant

Before: "At an interface · 4 of 157 · Ala5 is at the interface with the other SOD1 chain …", seam dot, mixed
dimer context, binding change "ready" on 7VZF/9JBO/9JBP, 86 reported partners, 120 grid rows.
After: "Not at an interface · 0 of 142 native solved structures", Val6 next door at 104 of 142, a callout for
the fibril contact (4 of 15, read apart), no binding change estimated, NB1 and Other set aside, CCS once,
mouse and yeast proteins named, 77 human partners plus 6 from other species, 34 rows by default.

## 6. Verification

- `npm run lint`: boundaries, focus indicators and verify parity pass. `tsc` reports only
  `server/services/structure/pocket/runner.ts` (`selectPocketForResidue`), another agent's uncommitted work.
- Full vitest: 3767 passed, 5 skipped (289 files; 2 skipped files).
- New tests: `server/services/external-api/pdbe-interfaces.test.ts` (6), SOD1 model
  `interfacesEvidenceSod1.test.ts` (14), SOD1 tab and rail `InterfacesTab.sod1.test.tsx` (10), and two in
  `ppi.test.ts` (fibril wild type, IntAct species). Four existing assertions were updated for the new copy:
  the screen meta, the set-aside sentence and the support legend. SLC12A4's fixture gained
  `context: "native"`, `gene` and `organism` (its 8 entries are transport-protein structures, not fibrils).
- Fixture `sod1Interfaces.ts`: captured live through `analyzeMultimerStructure` and `analyzePpiBinding`.
- Rendered with the SOD1 fixture in the T3 preview browser: light 1500 px, dark with a fold open, and
  820 px (no horizontal overflow).

## 7. Not done (follow-ups)

- **Isoform/numbering check (S15 from the earlier audit)** is still open.
- **3D linkage:** lane ↔ structure viewer highlight is not wired. The structure tab owns the viewer.
- **Fibril and crystal classification need RCSB.** One batched GraphQL call reads each entry's keyword/title
  and its primary biological assembly (`polymer_entity_instance_count`). When it fails, the lookup is not
  cached and the trace warns that fibril and crystal-packing entries could not be told apart.
- **Crystal contacts are now split out, by a conservative rule.** An entry whose primary biological assembly
  is a monomer has a deposited assembly with no protein interface, so a contact PDBe-KB lists in it lies outside that assembly. This is a proxy for crystal packing, not proof (authors can deposit a monomer as assembly 1 for a true dimer; 24 of SOD1's 142 entries do):
  it is recounted out of the native denominator and read apart in the callout and the solved-structures
  table. A packing contact in a multi-chain assembly is *not* separated — that needs per-interface PISA
  data, which PDBe-KB's `interface_residues` payload does not carry. The tab says "outside the deposited assembly" and never "crystal packing".
- **IntAct names a species only by taxid text.** UniProt's `organismDiffer` without an IntAct row reads
  "other species".
- STRING's `SOD2-2` style names come from STRING itself and are shown as given.

## Sources

- PDBe-KB interface residues, `ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/P00441`, read 2026-10-04. Varadi M, et al. Bioinformatics 2021. doi:10.1093/bioinformatics/btab424
- RCSB PDB Data API (GraphQL `entries { struct { title } struct_keywords { pdbx_keywords } }`), read 2026-10-04.
- Wang LQ, et al. Cryo-EM structure of an amyloid fibril formed by full-length human SOD1 reveals its conformational conversion. Nat Commun 2022;13:3491 (PDB 7VZF; citation as RCSB records it). Preprint doi:10.1101/2021.12.07.471532
- UniProtKB P00441 (SUBUNIT, INTERACTION with `organismDiffer`), rest.uniprot.org, read 2026-10-04.
- IntAct PSICQUIC MITAB 2.5 for P00441 (taxid columns 10–11). Del Toro N, et al. Nucleic Acids Res 2022;50:D648. doi:10.1093/nar/gkab1006
- Haenig C, et al. Interactome mapping provides a network of neurodegenerative disease proteins and uncovers widespread protein aggregation in affected brains. Cell Rep 2020;32:108050 (PubMed 32814053).
- Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638. doi:10.1093/nar/gkac1000
