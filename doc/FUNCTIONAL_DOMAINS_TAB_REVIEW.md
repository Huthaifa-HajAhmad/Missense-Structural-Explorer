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
