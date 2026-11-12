# Functional domains tab: review and redesign

Reference variant: NAE1 p.Asp116Gly (UniProtKB Q13564, 534 aa). UniProtKB feature table and UniParc
InterPro matches read 2026-09-29. The earlier `doc/FUNCTIONAL_DOMAINS_TAB_AUDIT.md` covered track geometry,
focus and target sizes; it did not look at what the annotations mean or at PM1, which is what this review adds.

## What NAE1's record says

A reviewed entry with **no UniProt Domain feature**. Region 331–344 and Site 211 "Interaction with UBA3" (no
evidence cited); acetylation at 2 and 6 (proteomics, ECO:0007744) and 341 (by similarity to mouse, ECO:0000250);
mutagenesis D331A (ECO:0000269, PubMed 12646924); four disease variants in NEDFIH, L49F, R85Q, C294W, R430Q
(ECO:0000269, PubMed 36608681); secondary structure from PDB 1TT5, with 116 between helices 109–114 and 117–122.
InterPro via UniParc (UPI000006EBDC): Pfam PF00899 ThiF fold 13–530 (IPR000594), Gene3D 3.40.50.720 at 2–289 and
376–534, and family-level CDD, PANTHER, PIRSF and SUPFAM signatures spanning almost the whole chain.

## Findings and what changed

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Critical | PM1 fired on every residue **between** two bonded cysteines: UniProt locates a disulfide by its two cysteines, the engine read it as a span. | `featureCoversResidue` (`src/shared/functionalSites.ts`) covers only the two cysteines; used by PM1 and PVS1's critical-domain check. The schematic draws both cysteines. |
| 2 | Critical | PM1 counted "by similarity" and sequence-analysis sites like observed ones, had no PP3 + PM1 cap, and did not say benign variation was unchecked. | Decided with the owner ("Tighten PM1"): only experimental, structure or large-scale evidence counts; PP3 + PM1 capped at Strong (Pejaver 2022); every PM1 reason says benign variation was not checked. `assessPm1` is shared by the engine and the tab. |
| 3 | High | The tab never showed PM1, the one ACMG question it answers. | Finding card led by the engine's PM1 record; "unconfirmed" when the payload has no record; a mismatch with the current rule is stated. |
| 4 | High | Every UniProt `Region` was painted and legended as "Disordered region", including NAE1's UBA3-binding region, and regions were left out of the at-residue check. | Only regions described as disordered are disorder; functional regions are drawn as insets and count as covering the residue. |
| 5 | High | "Inter-Domain Region", in green, for a protein with no domain annotated. | Domains come from InterPro (Pfam, SMART, PROSITE) with UniProt's own as fallback; with neither, the finding says "no domain annotated". A domain spanning ≥ 80% of the chain is flagged as positionally uninformative. |
| 6 | High | Sources hard-coded ("Swiss-Prot Verified", "InterPro / Pfam v2024") though no InterPro query was made; InterPro links attached by fuzzy name matching. | The server reads InterPro member-database matches with ranges from UniParc (one request on the UniProt host, in parallel, not cached on failure); reviewed status and entry version come from the payload; the fuzzy pass is removed. |
| 7 | High | Evidence level discarded; everything called "curated". | Each feature keeps its ECO codes and citation; the table shows the level and opens to the codes and the PubMed link. |
| 8 | High | The absence sentence overclaimed and several feature types were dropped server-side. | "UniProtKB annotates nothing at residue N", with the foot listing what the entry does not annotate; glycosylation, cross-links, lipidation, signal, propeptide, transit peptide, topological and intramembrane features are kept. |
| 9 | Medium | Disease variants were filtered out; mutagenesis shown as grey "other" pins. | Natural variants kept (disease ones drawn above the backbone, polymorphisms listed only); mutagenesis has its own group. |
| 10 | Medium | "Flanking proximity vectors" were sequence distances. | A "From N" column, labelled as sequence distance. A 3D neighbourhood is left for a later phase. |
| 11 | Medium | Numbering basis ignored. | Rule-trace step 1 states it; an unverified basis is a caveat. |
| 12 | Low | Guidelines rail described PM1 as "e.g. binding pocket interface" and BP3 as "structurally neutral substitution"; Predictors rail gave the PP3 + PM1 cap reason as "both draw on conservation". | Wording corrected in both rails. **Not changed here, resolved by the Score thresholds rebuild:** the Threshold Guide labelled the ΔΔG rows `acmgCode: "PM1 / BP3"` (`src/shared/thresholds/guidelines.ts`). That file is gone, the tab now builds its rows in `src/shared/thresholdEvidence.ts`, and no stability row carries an ACMG code (pinned by `thresholdEvidence.test.ts`). |

## Design

Three tiers in the approved flat style (white rows, hairlines, beige only on header, footer and group bands,
tokens only, neutral chips, no benign green):

1. **Finding**: residue as the headline, one bold sentence on what covers it plus its structural context and the
   nearest disease variant, the domain-architecture schematic, four facts ending in the engine record, caveats.
2. **What is annotated**: one grouped table with residues, sequence distance and evidence; a row opens to its
   source, ECO codes, citation and "Show in 3D".
3. **Rail**: a five-step rule trace, the evidence levels with the ones PM1 counts, method notes, family
   signatures the schematic does not draw, and sources with versions from the payload.

The schematic (`src/components/evidence/function/`) is drawn at its container's pixel width. `architectureLayout.ts`
is pure: one residue scale for every shape, labels on first-fit tiers that also keep each stem's column clear, a
label that cannot be placed is dropped and counted rather than overlapped. Colour carries meaning once each: clay
for this variant, red for disease variants (and the PM1 chip only when met), filled / hollow / grey for
experimental / inferred / uncited evidence.

## Verification

- vitest: the full suite, including `functionalSites`, `functionEvidence`, the layout and the tab and rail.
- `tools/function-track-geometry`: rewritten for the schematic, 107 assertions over seven cases (NAE1 whole,
  zoomed, phone width and dark; CNNM2; GZF1; a synthetic crowded cluster), each of seven mutations shown to turn
  its family red. See its README.

## Not done

- Benign variation in the region is not checked (would need gnomAD missense counts per region); PM1 says so.
- The hot-spot reading of PM1 (clusters of pathogenic variants) is not implemented.
- The Threshold Guide's "PM1 / BP3" label on ΔΔG rows, above.

## Follow-up audit, 2026-10-02 (SLC12A4 p.Gln867His, Q9UP95, 1085 aa)

PM1 "not met" was correct for this variant. Changes, all in `functionEvidence.ts` unless noted:

- A topological span or region covering ≥ 30% of the chain is stated as context ("a broad span rather than a site"), not "carries one annotation".
- A gap between helices is called a link only when ≤ 8 residues; a longer one is "no helix or strand assigned", since UniProt's secondary structure omits unresolved residues.
- UniProt strings are tidied for display: `Helical; Name=4` → TM4, `Ligand: K(+)` → K⁺ binding. The topology group carries a count summary.
- Domain segments are sorted by position; the disease-variant fact no longer reads an empty UniProt list as a negative finding; the rail trace states the evidence PM1 counts (experimental, structure, large-scale) accurately and lists only the evidence levels present in the entry.
- The table shows rows covering the residue or within 50 residues by default, with a per-group "Show N more".
- Variant header (separate commit): Missense Z below 2 is no longer labelled "Tolerant" unless Z ≤ 0 (0 < Z < 2 is "Not constrained"); LOEUF above the cut reads "Not LoF constrained".

### Schematic redesign (same day)

A 1085 aa membrane protein drew twelve helices and its cytoplasmic and extracellular spans as look-alike
boxes on the backbone, with forty labels dropped and a helix strip that was dashes at that scale.

- **Topology lane** (`layoutMembrane`): outside and inside rails with the helices as numbered bars between them,
  at the foot above the axis, the variant's tick running through it. Helices UniProt leaves unnamed are numbered
  by position and the row says the number is ours. A window that shows only the inside rail draws one line.
- **Opens on residue ± 50** above 600 residues (the reader's choice is kept per variant), with a whole-protein
  **overview strip** that brackets the window and places the variant.
- **Helix / strand strip** only in a window of 300 residues or fewer.
- **Space follows use**: only the label tiers below the backbone that were needed.
- Two defects found by rendering, both fixed: a label next to the right edge of a zoomed window ran off the drawing
  (now flips left of its mark), and in the whole-protein view the variant's stem crossed the end number of a domain
  box 27 residues away (an end number the stem would cross is now dropped; the range stays in the table). A lower
  stem under a domain box also starts on the box's bottom edge, as the upper ones do.
- **D1**: the gnomAD regional missense O/E is shown as context in the caveats, with its window and no cut-point;
  PM1 does not use it. **D2**: mutagenesis at the variant's own residue is named in the finding and not counted.
- Table: a group with nothing within 50 residues says so ("None within 50 residues of 867. Show 4").

Geometry harness: 173 assertions over nine cases (adds SLC12A4 as the tab opens and whole-protein, and the
`opens`, `view` and `membrane` families); every new guarantee has a mutation in `mutations.mjs` that turns it red.

Not done: 3D distances from the loaded model (the "From N" column stays a sequence distance, labelled as one).

## Follow-up audit, 2026-10-04 (SOD1 p.Ala5Val, P00441, 154 aa)

The densest case yet: 118 features, 81 natural variants (3 at residue 5), eight Cu/Zn ligands recorded as
`Binding site`, one disulfide, two PROSITE patterns beside a Pfam domain. Findings, decisions and the test behind each
are in `doc/FUNCTIONAL_DOMAINS_PRESENTATION_AUDIT.md`. In brief: the foot denied metal binding beside eight ligands,
the finding named A5S for a query of A5V, variants read "Experimental", PROSITE patterns were drawn as domains, a
Trp–Trp cross-link read "W33ub", and 81 identical red pins and 88 dropped labels hid where the variant sits.

Changes: model (`exactVariant`, folded variant rows, `density`, `matureNumbering`, `motifs`, entry-type routing),
server (`DomainMatch.entryType` from InterPro, `processedChain`, features cache key `fd2`), layout (bar track above
24 residues, lanes by kind above 20 point marks, motif ticks, disulfide bracket), drawing (linked hover, layer toggles,
drag-to-zoom, arrow keys), tab (URL state, folded variant rows). Geometry harness: 241 assertions over 11 cases (adds
`sod1`, `sod1-narrow`; the `dense`, `interact` and `prose` families).

Not done: PM1's hot-spot reading (owner decision), 3D neighbourhood, a helix/strand cartoon.

## Follow-up audit, 2026-11-12 (GZF1 p.Arg591Trp, Q9H116, 711 aa)

GZF1 has a BTB domain and ten C2H2 zinc fingers. InterPro entry IPR013087 models the zinc fingers with four
signatures: Pfam PF00096 (and PF13912 for finger 6), SMART SM00355, the PROSITE profile PS50157 and the PROSITE
pattern PS00028. UniProt lists one disease variant, "in JLSM", over residues 289–711. Fixture:
`src/shared/__tests__/fixtures/gzf1FunctionalDomains.ts` (UniProtKB, UniParc and InterPro, read 2026-11-12).

| # | Severity | What was wrong | Fix | Test |
|---|---|---|---|---|
| G1 | High (integrity) | The server tags a match with its InterPro **entry's** type. PS00028 sits in IPR013087, a `domain` entry, so the 2026-10-04 routing drew the short pattern as a fourth row of domain boxes | `kindOfMatch` checks the PS00xxx pattern accession before the entry type | `functionEvidenceGzf1.test.ts` |
| G2 | High (legibility) | One row per signature: forty look-alike boxes on four rows for ten zinc fingers. Matches of one domain read as independent evidence, and the variant's box was hard to find | `shared/domainUnits.ts`: one unit per InterPro entry and location (half-overlap rule); solid core where every database agrees, pale ends where only some extend; UniProt's name labels the unit; a click selects UniProt's row; any database row lights the unit | `functionEvidenceGzf1.test.ts`, `architectureLayout.gzf1.test.ts` |
| G3 | Medium (integrity) | UniProt zinc fingers were filed as "sites": the finding said "Residue 591 carries one annotation: C2H2-type 10", and the finger was drawn a second time as an inset over its own box | `Zinc finger` is a domain-class feature; the finding now says the residue lies inside the C2H2-type 10 zinc finger, with no site at it. Zinc fingers no InterPro domain models still get a box | same |
| G4 | Medium (integrity) | The Domain fact quoted one PROSITE match's ten locations ("PROSITE 350–371, 379–400, …, 27% of the protein") as the residue's domain | The fact names the covering unit: "C2H2-type 10 zinc finger · 575–602 · 10 of 10 · Pfam, SMART and PROSITE" | same |
| G5 | Medium (integrity) | The 289–711 disease variant was a pin at 289, "the nearest disease variant, 0 residues downstream"; after a partial fix the Disease fact said "None in UniProtKB"; the caveat said "1 disease variant across 1 residue" | Lane `span`: drawn as a red line over 289–711; fact "Disease variant over it: 289–711"; caveat "one over a stretch (289–711)"; density counts residues for single-residue variants only | same |
| G6 | Low (legibility) | In a zoomed window a domain cut by the edge drew a sliver with no name, and region labels centred off the drawing ("2H2-type 8") | Cut sides stay square; labels sit in the visible part; region labels are clamped inside the drawing | `architectureLayout.gzf1.test.ts` |
| G7 | Low (UX) | An empty "Pin an annotation" card repeated the inspector's prompt; a lone "Amino-acid positions" label sat far from its fields; an empty band sat over the domains when no single-residue disease variant was in view | The card shows only once something is pinned; the control reads "Zoom to residues [ ] to [ ] Zoom"; pin tiers are reserved only when there are pins | `MolecularWorkspace.integration.test.tsx` |
| G8 | Low (inspector) | Evidence levels: "counts for PM1" wrapped under the label and a separate paragraph explained two of the levels; thirteen FunFam rows buried the sources | One row per level with its count in this entry, its meaning and whether PM1 counts it (`EVIDENCE_LEVEL_MEANING`); a database with more than two family matches folds into one line | rendered check |

Effect on the reference variant: PM1 is unchanged (not met: no experimentally evidenced site at 591). Only labels,
the drawing and the finding's wording changed; the rule engine is untouched.

Verification: `npx tsc --noEmit`, `npm run lint`, full `npx vitest run` (519 files, 6741 tests passed, 5 skipped as
before), function-track geometry harness (241 assertions; the GZF1 case now expects 11 boxes, and box checks read the
new `.fnd-arch__box` path). Rendered with the GZF1 fixture in light, dark and an 820 px window.

Not done:
- The Annotation details table still lists each database match as its own row. That is a records view, so it keeps
  them, but it could group rows under their unit.
- An unintegrated signature (Pfam PF13894 at 377–400) is not merged into zinc finger 3, because InterPro has not
  said it models the same domain; it sits alone on a second row.
- A C2H2 finger's DNA-contact positions (−1, 3, 6 of the recognition helix) are a plausible functional reading for
  residue 591. No source in the payload states them, so the tab claims nothing about them.
- PM1's hot-spot reading remains the owner's decision.

Review follow-ups (same day):
- Placement is exact: new tests assert that every pin, span end, box edge and the variant's stem sit on the one residue
  scale (to 1e-6 px) in the whole protein, in a 541-641 window and at 380 px. The geometry harness checks the same
  in a real browser.
- The inspector's evidence levels now use the shared `rail-cut` list from `rail.css`, like the other tabs, with one
  scoped column override. A first version had its own `fnd-level` styles, which would have drifted. No colour or
  surface of the inspector changed; every rule uses design tokens.
- Hotspots still sees zinc fingers. They were "sites" by accident of the old grouping, and moving them to domains
  would have silently dropped them from the hot-spot neighbours (`hotspotInput.ts`; tested).
- A pinned unit now names every database that matched it ("Matched by: Pfam PF00096, SMART SM00355, PROSITE PS50157")
  and says where they agree. Before, a click on a zinc finger showed only UniProtKB.
- Removed `domainRowKey` and `domainRowKeyResolver`, which nothing used after the move to units.
