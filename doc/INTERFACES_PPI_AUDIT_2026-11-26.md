# Interfaces & PPI: ABCG1 p.Gly358Arg audit (2026-11-26)

Reference variant: **ABCG1 p.Gly358Arg** (NM_016818.3, MANE Select; UniProtKB P45844), from the user's four
production screenshots (Interface map, Partners, Assemblies & models). Data checked live on 2026-11-26 against
PDBe-KB, the PDBe entry API, UniProt, NCBI and localfold.org. Earlier reviews: `INTERFACES_PPI_REVIEW.md` (SOD1),
`INTERFACES_AUDIT.md` (SLC12A4), `MECHANISM_WORKSPACES_REVIEW.md`. No ACMG criterion reads this tab, so **no
finding changes a classification**.

Severity: **C** = the screen states something the data contradicts. **H** = misleading. **M** = imprecise.
**L** = polish.

## 1. Scientific integrity

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| C1 | **C** | **"Not at an interface, 0 of 5" for a residue that no solved structure contains.** Gly358 lies in the NBD–TMD linker, which is disordered and unmodelled in all five ABCG1 structures. The tab counts every entry that holds the pair as a denominator, so "absent from the model" reads as "not at the interface". The same false premise appears in eight places: hero figure and chip, finding sentence, assembly schematic ("Gly358 not at it, in 5 solved structures"), the solved-structures row ("not among its 86 interface residues"), rail step 3, the binding-change reason ("not at the interface in any solved complex … so no binding change is estimated"), and the complex-model reason ("solved structures already answer whether the residue is at an interface"). | PDBe `polymer_coverage`: observed ranges 7FDV 96–333 / 401–675; 7OZ1 96–345 / 386–664; 7R8C, 7R8D 100–347 / 385–666; 7R8E 98–347 / 386–666. PDBe `residue_listing/7oz1/chain/A`: residue 358 GLY `observed_ratio 0.0`. Author numbering = UniProt numbering (residues 344, 345, 386, 387 checked). `pdbe-interfaces.ts:121-126` builds the denominator from `allPDBEntries`, which lists entries that contain the pair, not entries that model the residue. | Read per-entry coverage of the variant residue. Denominator = entries that model it. New verdict state **"Not modelled"**: "Gly358 is not modelled in any of the 5 solved structures (disordered 346–384 in all of them), so they cannot place it." The complex-model and binding-change reasons must stop citing the solved structures as an answer. Source options: extend the batched RCSB GraphQL call that already classes fibrils (`rcsb_polymer_instance_feature` type `UNOBSERVED_RESIDUE_XYZ`, plus the UniProt alignment), or PDBe `polymer_coverage` per entry. This changes the `MultimerData`/observed-partner contract. |
| H1 | H | **"ABCG" (a subfamily) is treated as a gene.** SUBUNIT: "May form heterodimers with several heterologous partners of the ABCG subfamily." `partnerTokens` accepts any capitalised token, so "ABCG" becomes a partner: an Assembly row with a STRING link to a gene that does not exist, "None ≥ 0.15", "Not in STRING's top 500", rail "Heterodimer with ABCG", and it is counted as a partner. The family path (`family: string`) that exists for this case is never reached because `partnerGenes` is not empty. | UniProt P45844 SUBUNIT, read live. `multimerAssembly.ts:108-118, 214-218`. | A token followed by "subfamily", "family", "members" or "proteins" (or preceded by "partners/members of the") is a family. Test with the ABCG1 SUBUNIT text. |
| H2 | H | **Three partner counts on one screen.** Tier chart: "Binding evidence 8 entries" (includes ABCG1's own other chain and the fake "ABCG"). Rail step 5: "7 reported partners" (includes "ABCG"). Real human partner genes: 6. | Screens 1 and 3; `interfacesEvidence.ts:1327`, `PartnerTiers.tsx`. | One count, computed once, of partners (not "entries"); the query's own chain and families are not partners. |
| H3 | H | **LocalFold is offered for a fold a browser cannot run, and the warning comes after the click.** The ABCG1 homodimer is 2 × 678 = 1,356 residues. The size warning (`tooLarge`, > 800) is shown only after the tab has opened and the job file has downloaded. The reason text and the rail present LocalFold as an equal choice ("or free in your own browser"). See §2. | `InterfacesTab.tsx:393-414`; `multimerHandoff.ts:40`. LocalFold's own cost model (`webgpu/runtime/cost-model.js`) puts one trunk pass at 65 s for 700 tokens and scales with tokens³, so 1,356 tokens is roughly 7× longer per pass, several passes per fold. Its memory ceiling is a third of what the browser reports. | Know the size before the click (the planned chains are on `ev.chains`). Over the limit: do not offer the button as an option; state the size and the limit in one sentence. |
| H4 | M | **The complex-model provider has no size gate either** (see resolution: kept by design). S3 in `INTERFACES_AUDIT.md` (size gate before submit) is still open: `multimer.ts` has no residue limit, and 1,356 residues would be sent to JapanFold. | `grep` of `server/services/structure/multimer.ts`, `japanfold-client.ts`: no limit. | Add the limit with a stated `not-modelled: too-large` reason. Ask the provider for its real limit first. |
| M1 | M | **The map hides the reason.** The solved-interface lane draws bars where contacts exist and nothing elsewhere, so the unmodelled 346–384 linker looks the same as "modelled, no contact". The lane readout says "0/5". | Screen 2. | Draw unmodelled stretches on each solved lane (a hatched gap, "not modelled"), and read "—/5, not modelled" for the variant. |
| M2 | M | **Useful orientation is missing from the finding.** Gly358 is in the cytoplasmic NBD–TMD linker (UniProt topological domain 1–426 cytoplasmic; Domain 77–317 ABC transporter; 415–673 ABC transmembrane type-2). The domains lane says only "Outside". | UniProt features. | One context line: "in the cytoplasmic linker between the ATP-binding and transmembrane domains". |
| M3 | M | **MANE protein ≠ UniProt canonical.** NM_016818.3 encodes 666 aa; P45844 is 678. They differ by a 12-residue insert after residue 374 (`VKQTKRLKGLRK`), so Gly358 maps 1:1 but any ABCG1 variant past 374 is off by 12. The map reads "Residues 1–678" with no warning. | NCBI CDS 124..2124; alignment against the PDBe sequence. See memory note on ABCG1 non-MANE refusals. | Show the numbering note in the hero when the transcript and UniProt lengths differ, not only in a closed disclosure. Verify that a position > 374 is remapped. |
| L1 | L | The five structures come from three studies (7FDV; 7OZ1; 7R8C/D/E). "5 structures" can read as 5 independent observations. | RCSB entries. | Already stated in the workspace guide; repeat it in the row's caption once C1 is fixed. |

**Verified correct (kept):** PDB ↔ UniProt numbering for ABCG1; STRING bands 0.15 / 0.4 / 0.7 / 0.9; ipTM guide
marked "not a calibration"; DDMut-PPI RMSE 1.33; engine record "none"; the CAV1 row from SUBUNIT; the ABCG4
heterodimer (PubMed 27228027).

## 2. LocalFold: what works, what does not

Verified on 2026-11-26:

- Production served the job request: two `POST /api/v1/structure/multimer` → 200 (1.3–1.4 s) in the last 72 h.
- Our job file passes LocalFold's own reader. `buildLocalFoldJobJson` output, run through localfold.org's
  `web/job-json.js` `jobFromJson` in Node, gives 2 protein entities, `dialect: alphafold3`, no refusal.
- `?model=boltz2` is honoured (`applyModelFromUrl`; option `boltz2` exists).
- LocalFold's "PDB" button writes a PDB, which is what our import reads.

Why it fails for this variant, most likely first (I cannot run WebGPU here, so I did not see the failure):

1. **Size.** 1,356 tokens. LocalFold refuses a fold above its memory ceiling with "Needs N MiB, over this
   device's M MiB limit" (and a "Fold anyway" button), or runs for a very long time.
2. **The hand-off is seven manual steps,** and one is hidden: "Load job JSON…" is an item in LocalFold's **MSA**
   drop-down, which our note does not say. LocalFold has no URL or message API for a job (`app.js` reads only
   `?model=`), so a file is the only route.
3. **The tab opens before the file exists.** `window.open` runs first (correct, to avoid popup blockers), then the
   job file downloads ~1.4 s later into the *original* tab, while the reader is already looking at LocalFold.
4. **Default MSA sends the sequence to api.colabfold.com** and adds a search for two chains. Our note says so, but
   it sits in a four-line paragraph under the table.

Recommendation: gate on size before the click; when under the limit, show a numbered three-step card ("1 Save job
file · 2 In LocalFold, MSA menu → Load job JSON… · 3 Fold, press PDB, load it here") with the download as its own
button rather than a side effect of opening the tab. For C1-type residues (unmodelled in every solved structure)
say plainly that a predicted complex of a disordered linker will place it with low confidence, so the model is
unlikely to settle the question.

## 3. UI, layout and spacing

| # | Sev | Finding | Cause | Fix |
|---|---|---|---|---|
| U1 | H | **Empty bands above and below the hero text** (circled). | `mechanism-workspace.css:7`: `.ifc-workspace .ifc-hero__text { justify-content: center }` centres the text against the taller assembly figure. | Align to the start. Better: make the figure shorter (see U12). |
| U2 | M | **Floating verdict pill** (circled). | `.ifc-hero__top` uses `justify-content: space-between`, so the chip sits ~500 px from the number it qualifies, and it repeats the bold sentence. | Put the state beside the figure, or drop the chip. |
| U3 | H | **The largest text on the page is a zero that is wrong** ("0 of 5"). | C1. | After C1 the figure is "Not modelled" in words, not a fraction. |
| U4 | H | **Partner tier chart shows only one thing: STRING is big.** Linear bars make 3 and 5 into dots beside 487+; the right column is a lone search box over empty space (circled). | `PartnerTiers.tsx` linear scale; `.ifc-partners__head` two-column grid. | Replace the bars with one row of tier filter chips with counts (same pattern as the atlas layer chips), search on the same row. State the shape in one sentence ("6 partners with binding evidence; 500+ associations"). |
| U5 | M | **"Binding energy change" shows under every sub-tab.** | `InterfacesTab.tsx:1001`: the section is outside `<EvidencePanel>`. | Move it into "Assemblies & models". |
| U6 | M | **Domain names overprint** ("ABC tranAbcAtPase…", screen 2). | Overlapping InterPro ranges are each judged "fits inline" on their own width (`planRangeNames`). | Overlapping ranges go to callout rows; at most one inline name per pixel span. |
| U7 | M | **Axis:** a stray superscript beside "Gly358", and no 400 / 600 ticks (only 1, 200, 678). | Tick suppression around the variant chip and the end label. | Check with the geometry harness; keep at least one tick each side of the chip. |
| U8 | L | Atlas layer chips read "Domains & regions 1 · Topology 1 · Native interfaces 1": the count is lanes, which says nothing. | `interfaceMapView` layer counts. | Count records (6 membrane segments, 2 domains, 86 interface residues) or drop the number. |
| U9 | M | **Two affordances on every partner name** (inspect button plus a "STRING ↗" chip), and a column of repeated absences ("None ≥ 0.15", "Not in STRING's top 500"). | `PartnerRowView`. | One link target per row; say a shared absence once in the group head. |
| U10 | M | **LocalFold is pitched three times** (complex-model reason, rail step 4, the foot paragraph) and the foot is a dense block of browser and egress caveats (underlined in screen 4). | Copy in `interfacesEvidence.ts` and `multimerHandoff.ts`. | One place: the LocalFold card in §2. |
| U11 | L | Rail "Explore a reading" box takes the rail's first screen with an instruction. | `InterfacesRail`. | Collapse it to one line, or show it only when nothing is pinned and the trace is short. |
| U12 | M | The hero "A — B" composition schematic restates the assembly label and takes half the card. | `AssemblyDiagram`. | Replace with a ±40-residue window of the map around the variant: modelled/unmodelled, interface support, the variant. That is the answer the card exists for. |

## 4. Code health

- `InterfacesTab.tsx` is 1,052 lines and `interfacesEvidence.ts` 1,524 lines (limit 300). Proposed split:
  model → `interfaces/assembly.ts`, `observed.ts` (coverage, support, fibril/crystal), `partners.ts` (rows, tiers,
  folds, counts), `complexModel.ts`, `binding.ts`, `finding.ts`; tab → `InterfaceHero`, `AssemblyTable`,
  `PartnersPanel`, `ComplexModelRows`, `LocalFoldCard`, `BindingCard`.
- Add ABCG1 as the second reference fixture: unmodelled residue, family named in SUBUNIT, MANE ≠ canonical,
  1,356-residue homodimer.

## 5. Not checked

- The LocalFold run itself (needs WebGPU). The user's status line from LocalFold would confirm cause 1 or 2.
- AlphaFold DB pLDDT for 346–384 (the AFDB file download was refused from this machine).
- The JapanFold provider's real residue limit.

## Sources

- PDBe-KB interface residues, `ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/P45844`; PDBe entry API
  `pdb/entry/polymer_coverage/{7fdv,7oz1,7r8c,7r8d,7r8e}`, `pdb/entry/residue_listing/7oz1/chain/A`; read 2026-11-26.
  Varadi M, et al. Bioinformatics 2021. doi:10.1093/bioinformatics/btab424
- UniProtKB P45844 SUBUNIT and features, rest.uniprot.org, read 2026-11-26.
- NCBI RefSeq NM_016818.3 (MANE Select), CDS 124..2124.
- localfold.org `index.html`, `web/app.js`, `web/job-json.js`, `webgpu/runtime/cost-model.js`, read 2026-11-26.
- Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638. doi:10.1093/nar/gkac1000

## 6. Resolution (2026-11-26)

| # | What changed | Where |
|---|---|---|
| C1 | The server reads PDBe residue coverage (`uniprot/unipdb/{acc}`, one call per protein, run alongside the RCSB and UniProt calls). Each solved partner now carries `modelledEntries` (the structures with coordinates for the variant residue) and `unmodelled` (stretches no structure of the pair models). The denominator is the modelling structures; a residue no structure models gets the new verdict **"Not modelled"**. Stored payloads without `coverageChecked` are re-read once. The binding-change service says "not modelled in any solved complex" instead of "not at the interface". | `server/services/external-api/pdbe-coverage.ts`, `pdbe-interfaces.ts`, `ppi.ts`, `structure/multimer.ts`, `src/shared/contracts.ts`, `src/shared/interfaces/observed.ts`, `verdict.ts` |
| C1 effect | ABCG1 Gly358: "Not modelled", 348–396 unmodelled in all 5. SLC12A4 Gln867: 1 of **4** (4 of 8 entries model it; was "1 of 8"). SOD1 Ala5: 0 of **137** native (was 142); fibrils 4 of **4** that model it (of 15). The best-attested residue's support still counts every structure of the pair ("seen in 5 of 8"). | fixtures re-derived from live unipdb |
| H1 | "partners of the ABCG subfamily" is a family (`FAMILY_SYMBOL_RE`); "ABCG" is no longer a gene, row or STRING link. Statements are re-read from the SUBUNIT text so old stored records heal. | `src/shared/multimerAssembly.ts`, `interfaces/assembly.ts` |
| H2 | One count of partner proteins (`partnerSummary`: human, not the protein itself, not a family) feeds the facts, the rail and the partner sentence. ABCG1: 6. | `interfaces/partnerGroups.ts` |
| H3 | The residue count is known before any click (`model.residues`, `browserFoldable`). Over 800 residues LocalFold is not offered, and the reason says so; a PDB folded elsewhere can still be loaded. Under the limit, three numbered steps: save the job file (its own button, no popup), open LocalFold, load the PDB back. The MSA-menu step and the Single Sequence advice are spelled out. | `LocalFoldCard.tsx`, `shared/multimerHandoff.ts`, `interfaces/complexModel.ts` |
| H4 | Not changed. `japanfold-client.ts` states that the service decides what it can fold and its 4xx refusal is kept as a non-retryable "rejected"; inventing a limit here could refuse a fold the provider accepts. The size is now printed in the model reason and group head. | — |
| M1 | Solved lanes draw unmodelled stretches hatched; the variant cell reads "–/5"; a legend key explains the hatch. | `InterfaceTrack.tsx`, `interfaces/track.ts`, `interfaces.css` |
| M2 | A location sentence when the residue is outside every domain: "Gly358 lies in the cytoplasmic part, between … (274–332) and … (403–612)." Domains are the map's own (InterPro when it answered). | `interfaces/track.ts` (`locationSentence`) |
| M3 | Not changed: the existing "Residue numbering and reference" note stays. The remap check for positions after 374 belongs to the numbering work (see memory note on ABCG1 numbering refusals). | — |
| U1, U2, U3, U12 | The hero is full-width text: the figure (a count, or the verdict in words), the chip beside a count only, the sentence, the location, and a read-only map of ±60 residues around the variant (no buttons, no duplicate reading keys). The A–B schematic moved to the head of "Assemblies & models". | `InterfaceHero.tsx`, `AssemblyRecords.tsx`, CSS |
| U4 | The bar chart is replaced by one sentence ("6 partner proteins with binding evidence; 500+ with STRING association only") and tier filter chips with counts, on the same band as the search. | `PartnerTiers.tsx`, `PartnersPanel.tsx` |
| U5 | The binding-change card belongs to "Assemblies & models" in the workspace (it showed under every sub-tab). | `InterfacesTab.tsx` |
| U6 + atlas | Overlapping domain boxes are packed onto stacked rows (`packRows`), so no two blocks share space, and a name sits inside its own box when it fits. | `trackLayout.ts`, `InterfaceTrack.tsx` |
| U7 | Axis ticks are round multiples of the step (a window 298–418 reads 350, 400, not 347, 397), clear of both end labels, and clear of the variant chip by its measured width. | `trackLayout.ts` (`trackTicks`) |
| Topology | The membrane-topology lane is drawn as a membrane: a centre line, segments crossing it at full height in darker ink, the cytoplasmic side below and the outside above, matching the legend (both sides used to sit above the lane's bottom edge). A zoomed window labels what it shows ("0 of 6 segments in view" for 298–418). The domains lane lost its baseline rule, which marked nothing once domains stacked. | `interfaces.css`, `shared/mechanismWorkspace.ts` |
| U8 | Layer chips count records (5 domains, 6 membrane segments, 1 partner interface), not lanes. | `shared/mechanismWorkspace.ts` |
| U9 | One link per partner name; the STRING score links to the pair; absent scores read "< 0.15" or "beyond top 500". | `PartnerTable.tsx` |
| U10 | LocalFold is described once, in its card; the rail notes state the size limit. | `LocalFoldCard.tsx`, `InterfacesRail.tsx` |
| U11 | Not changed: "Explore a reading" is the shared inspector used by every Evidence tab, not this tab's. | — |
| Code | The 1,524-line model is 14 modules under `src/shared/interfaces/` behind the same import path; the 1,052-line tab is 13 components under `components/evidence/interfaces/`. The energetics-label guard now lists the new files. ABCG1 joins the preview harness (`tools/mechanism-preview`). | — |

### Verification
- `npm run lint`: passes (type check, boundaries, focus rings, code map, Oxlint rules).
- `npx vitest run`: 563 files passed, 2 skipped; 7,091 tests passed, 6 skipped, 0 failed.
- New tests: `pdbe-coverage.test.ts` (4), `interfacesEvidenceAbcg1.test.ts` (10), `InterfacesTab.abcg1.test.tsx` (5), subfamily parsing (2), track ticks, overlap and row packing, the LocalFold flow (3 rewritten), the Insights lane, and an AssemblyDiagram case.
- Updated expectations, each with its reason in a comment: SLC12A4 1 of 8 → 1 of 4, SOD1 142 → 137 and fibrils 4 of 15 → 4 of 4, the end tick 600 now drawn, the tier chart → chips, the assembly card under "Assemblies & models".
- Rendered with the preview harness (headless Chromium): ABCG1 light 1400 px, dark 820 px, 390 px; SOD1 1400 px. No page errors, no horizontal overflow.

### Not done
- The LocalFold run itself still cannot be tested here (WebGPU).
- PDBe gives one chain per entry; a heteromer whose two chains differ in what they model is read by that chain.
- `nativeInterfaceSupport` (other residues, for other tabs) still divides by every structure of the pair; coverage is read for the queried residue only.
