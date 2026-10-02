# Multimer assembly + Protein interactions: pre-merge audit

Reference variant: **SLC12A4 p.Gln867His** (NM_005072.5, UniProtKB Q9UP95, 1085 aa; KCC1).
Checked live against UniProt, PDBe-KB, IntAct (PSICQUIC) and the DDMut-PPI paper on 2026-10-02.
Earlier reviews: `MULTIMER_TAB_REVIEW.md`, `INTERACTIONS_TAB_REVIEW.md` (both on NAE1). This audit
does not re-list what they fixed. It covers what is still wrong, what only shows up on a large
homomer, and what the merge has to settle.

Neither tab feeds the ACMG engine. `criteria.ts` reads no multimer, PPI or STRING field, so
"Engine record: None" is true on both tabs. **No finding below changes a classification.**

Severity: **C** = the screen states something the data contradicts. **H** = misleading, or the
evidence is structurally unreachable. **M** = imprecise or inconsistent. **L** = polish.

---

## 1. Scientific integrity

| # | Sev | Finding | Evidence | Fix in the merge |
|---|---|---|---|---|
| S1 | **C** | **"Gln867 is at the interface … in 8 solved structures" is false.** PDBe-KB puts Gln867 at the dimer interface in **1 of 8** entries (7AIQ). `parsePdbeInterfaces` merges every residue's `allPDBEntries` (entries that *cover* the residue) and `interactingPDBEntries` into one partner-level set. The count is therefore "entries showing this partner at all", and both tabs print it beside the variant. | Live `interface_residues/Q9UP95`: residue 867 has `interactingPDBEntries: [7aiq]` and `allPDBEntries`: 8 ids. Residue 242 is interfacial in 6KKR/6KKT/6KKU. | Keep **per-residue** interacting entries. Report "at the interface in 1 of 8 solved structures of the dimer (7AIQ)". A residue seen in a minority of entries is a *conformation-dependent* contact, and the screen must say so. |
| S2 | **H** | **The variant-at-interface rule is "any one entry".** `variantAtInterface = residues.includes(position)` over the union. One crystal contact, or one conformational state, gives the same "At an interface" verdict as a contact present in every entry. The rail's own note warns about crystal packing, but no number shows it. | Same payload. 92 interface residues in the union. | Interface **support = k/n entries** per residue. The verdict wording grades with support ("in every solved structure" / "in some" / "in one"). No new cut-point is needed: show the fraction, don't band it. |
| S3 | **H** | **The Boltz-2 complex cannot succeed for this protein, and the failure is reported as a provider fault.** 2 × 1085 = 2170 residues is submitted with a 60 s timeout (`japanfoldFoldingMs`; the client falls back to 15 s) and no size gate, unlike ESMFold's `foldingLimits`. Every outcome (HTTP error, timeout, too large) collapses to `null` → "unreachable, refused the request or timed out". | `japanfold-client.ts:293–345`, `structure/multimer.ts`. | Size gate before submit (`not-modelled: too-large`, a stated limit, not an amber fault). Keep the HTTP status / timeout in the reason. A solved complex already answers the interface question, so the model is optional when PDBe has one. |
| S4 | **H** | **The "curated physical interaction" partners are one high-throughput Y2H screen.** All 8 UniProt INTERACTION partners (AP3M1, CNFN, CYSRT1, KRTAP12-2, KRTAP19-2, MB21D2, TMEM102, ZNF655) come from Luck et al. 2020 (HuRI, PMID 32296183). "3 experiments" is three Y2H assay versions in that one paper, not three studies. Several are well-known sticky Y2H preys (KRTAPs, CYSRT1, CNFN). The partners are cytoplasmic, the protein is a 12-TM transporter, and none is flagged. | IntAct PSICQUIC for Q9UP95. | Show **method and study count** per partner ("Y2H · 1 study"). Group a high-throughput binary-only screen apart from literature-curated or structural partners. Rename the group "Reported binding", not "Curated physical interaction". |
| S5 | **H** | **SUBUNIT's heterodimer claim is dropped from the partner grid, and its evidence qualifier is lost.** "Heterodimer with other K-Cl cotransporters **(Probable)**" names a family, not symbols, so `subunitPartnerMentions` finds nothing. SLC12A5/6/7 then appear only as "Functional association only · No curated interaction", the opposite of what UniProt says. The Multimer tab lists "Also stated: Heterodimer" with "(Probable)" stripped. | UniProt Q9UP95 SUBUNIT text. | Keep UniProt evidence qualifiers (`Probable`, `By similarity`) on every SUBUNIT reading. Show an **unresolved family claim** as a row ("Other K-Cl cotransporters, stated as probable, not resolved to genes"). Never mark a stated partner "no curated interaction". |
| S6 | **H** | **The interface verdict ignores disagreement between observation and prediction.** The header comment says "observation outranks prediction", but a model contact with no solved contact still returns "At an interface · In the predicted complex", even when solved structures of the same assembly exclude the residue. | `multimerEvidence.ts:296–311`. | One verdict with explicit sources. When the model and the solved structures disagree, say so in words, as the Predictors tab does for calibrated vs aggregate readings. |
| S7 | **M** | **The binding change is blocked by the Multimer model, not by science.** `chainsOk` needs `multimerData.status === "success"`, only to learn the chain list. `/ppi/binding-shift` then re-models the wild type itself. A homodimer's chains are known from SUBUNIT alone. | `interactionsEvidence.ts:347–355`. | Derive the chains from the assembly record. |
| S8 | **M** | **DDMut-PPI is run on a predicted complex when an experimental one exists.** DDMut-PPI was trained on experimental PDB wild types, with MODELLER mutants. A Boltz-2 wild type is out of its training distribution. For SLC12A4, 8 cryo-EM dimers exist. | Zhou et al. 2024. | Prefer a solved complex (the entry where the residue is interfacial, here 7AIQ) as the wild type. Fall back to Boltz-2 and label it. |
| S9 | **M** | **DDMut-PPI performance is quoted selectively.** The app says "r 0.75 in cross-validation, 0.60 on a blind antibody–antigen set". The paper's stricter leave-one-binding-site-out figure (r 0.67, RMSE 1.51 kcal/mol) and the RMSE are omitted. An RMSE of about 1.3–1.5 kcal/mol is what tells a reader that a value of −0.4 is noise. | Zhou et al. 2024, NAR 52:W207. | Quote 0.75 / 0.67 with RMSE. Draw an RMSE band on the ruler around 0. |
| S10 | **M** | **Counts that contradict each other.** The PPI facts say "Curated partners 8 · SUBUNIT, IntAct, solved", but for this protein all 8 are IntAct (SUBUNIT 0, solved heteromers 0; the homomer is skipped). The trace says "1 interface in PDBe-KB". The Multimer tab says "8 PDB entries". | Screens 3–4; `interactionsEvidence.ts:464–469`. | Build the caption from the sources that actually contributed. One count per concept, computed once. |
| S11 | **M** | **Missing context in the "Domains" lane.** "No domains annotated" is literal: Q9UP95 has no `Domain` feature. It has 12 transmembrane segments, cytoplasmic/extracellular topology, and **Region 665–681 "Scissor helix"**, the domain-swap dimer interface named in the SUBUNIT text. `INTERACTION_NOTE` does not match it either. | UniProt Q9UP95 features. | The lane shows topology (TM / cytoplasmic / extracellular) and Regions. Gln867 sits in the cytoplasmic C-terminal domain, which is the useful orientation here. |
| S12 | **M** | **STRING is cut to the top five by combined score, from `/network`.** "Not in STRING's top five" is repeated for every IntAct partner, so whether STRING supports them is never actually asked. STRING also offers a **physical** sub-network, which is closer to the question this tab asks. | `string.ts` (`slice(0, 5)`). | Ask STRING for the listed partners specifically (`/network?identifiers=A%0dB…`). Consider `network_type=physical` as the default column, with functional as secondary. Record the STRING version (`/api/json/version`). |
| S13 | **M** | **Insights' Assembly lane treats "not stated" as "no complex".** `uf.isMultimer === false` covers both "unstated" and "monomer", so the lane says "UniProt records no complex". It also never reads the interface verdict the pipeline already has. | `insightsEvidence.ts:428–445`. | Read the merged model's verdict. Keep "not stated" distinct from "monomer". |
| S14 | **L** | Hard-coded `"JapanFold Boltz-2 (Tier 1)"` provenance survives in `japanfold-client.ts`, although "Tier 1" labels were removed elsewhere. | `japanfold-client.ts:335`. | Name the model and the service only. |
| S15 | **L** | Isoform check: UniProt marks 749–955 as altered in isoform 4, which covers residue 867. PDBe and the variant both use canonical numbering, but the MANE → canonical identity is assumed, not asserted, on these tabs. | UniProt Q9UP95. | Show the mapping check (`numbering.ts`) on the merged tab's axis. |

**Verified correct (keep):** DDMut-PPI sign (≤ 0 = weaker binding; the paper's own binary split is
at 0, and there are no graded cut-points), the ipTM guidance (EMBL-EBI: > 0.8 confident, < 0.6
likely wrong), STRING's 0.15 / 0.4 / 0.7 / 0.9 bands, "contact is not disruption", the
variant-only-on-chain-A caveat, and engine record = None.

---

## 2. UI and UX

| # | Sev | Finding | Fix |
|---|---|---|---|
| U1 | H | **The same answer twice.** Both heroes say "At an interface", both draw the `SLC12A4 (another copy)` track, and both carry an "Engine record: None" cell. The reader has to visit both tabs to learn that they agree. | One verdict, one track, one engine-record cell. |
| U2 | H | **A dead end across tabs.** The PPI binding card says "the complex model failed on the Multimer tab" and links there. The Multimer tab offers "Run again", which fails the same way (S3). | Same page, plus a stated size limit, means no loop. |
| U3 | M | **Empty columns.** In the PPI grid, SUBUNIT and Solved are hollow for every row, "None mapped" repeats 13 times and "Not in STRING's top five" repeats 8 times. The Multimer readings table has a "Value" column that is empty in most rows, which breaks the "no lone column label over nothing" rule. | Drop columns with no hits for this protein. Say so once in the group header ("No partner has a mapped site"). |
| U4 | M | **The provider failure takes over the hero.** A full-width amber banner on a structurally impossible job (S3) reads as a broken app. Amber is reserved for run faults, and this is a limit. | A "Not modelled" statement in the readings, with the reason. |
| U5 | M | **Two refresh verbs, two costs, no explanation.** "Run again" (Boltz-2, minutes, GPU) and "Read again" (database lookups, seconds) look identical in the header. | Per-section actions: "Read sources again" on the partners section, "Model complex" / "Estimate binding change" on the prediction section, each stating its cost. |
| U6 | M | **The chip vocabulary differs.** The Multimer hero chip says "At an interface" and the PPI hero chip says "Informational". | One verdict chip from the merged model. |
| U7 | L | The track label is clipped: "SLC12A4 (another cop…" (PPI, screen 3). "another copy" is awkward in any case. | "SLC12A4 · other chain of the dimer", with the label column sized by container query. |
| U8 | L | In the Multimer fact strip, the "identical chains" sub renders in mono (the `mlt-mono` class is always set). | Mono only for accessions and numbers. |
| U9 | L | The legend shows "Predicted interface" when nothing is predicted. | The legend lists only the marks that are drawn. |
| U10 | L | The rails disagree with the tab during loading: `MultimerRail` builds with `isLoading: false`, so it says "not evaluated" while the tab says "Running". | The rail takes the same status the tab has. |
| U11 | L | The "Score thresholds" sub-nav item in the screenshots is a stale build. `EVIDENCE_SUB_ITEMS` no longer has it. | None needed. Redeploy. |

## 3. Visual representation

- **Track (biggest gain).** Both tracks draw 92 interface residues as uniform black ticks, so a contact
  seen once looks identical to one seen in every structure. Encode **support (k/n entries)** as
  mark height or ink density. Gln867 at 1/8 then reads faint beside 242 at 6/8. That is the
  S1/S2 correction made visible.
- **One axis, lanes by evidence kind.** Topology/regions → mapped sites (UniProt) → solved
  interfaces (one lane per partner, homomer first) → predicted interface (when built). Today the
  Multimer track is "lane per reading" and the PPI track is "lane per partner" on the same axis,
  with different mark grammars (outlined box vs solid bar vs tick).
- **Assembly diagram.** Keep it, but draw the variant dot at the seam only when the verdict is
  supported, and hollow or partial for a minority-entry contact. The chains are drawn apart for a
  stated-not-modelled assembly, yet the dot sits on the seam, which mixes the two messages.
- **STRING bars.** These are fine as neutral ink. Move them to a secondary column once a physical
  evidence column leads.
- **ΔΔG ruler.** Add the RMSE band around 0 (S9) so a small value visibly sits inside the error.

## 4. Messages (copy)

- The headline should carry support: *"Gln867 is at the SLC12A4 dimer interface in 1 of 8 solved
  structures (7AIQ). The contact depends on the conformation captured."* It should not say "in 8".
- Partner provenance in words: *"8 partners from one yeast two-hybrid screen (Luck et al. 2020)"*,
  not "Curated physical interaction · 3 experiments".
- Keep UniProt's qualifiers verbatim: *"Heterodimer with other K-Cl cotransporters (probable)"*.
- A limit is not a fault: *"Not modelled: two chains of 1085 residues exceed what this service
  folds."* Name the limit, not three possible failures.
- A single sentence for the dominant-negative frame, as context rather than a claim: *"In a
  homodimer only one chain carries a heterozygous variant; mixed dimers are the expected state."*
  This is already in the rail. Lift it to the verdict when the residue is interfacial.

## 5. What else

- **Cost.** `workflowOrchestrator` pre-fetches the multimer for every analysis
  (`fetchProgressiveMultimer`), so every homomer submits a Boltz-2 job, including impossible ones.
  Gate it by size, and make the model on-request once PDBe already answers.
- **Provenance and versions.** Record the STRING version and the PDBe-KB fetch date in the payload,
  and show them in the rail. The caches run 14 days (STRING) and 7 days (PDBe) with no date on screen.
- **Tests.** Every fixture is NAE1 (a heterodimer with mapped sites). Add SLC12A4 as the second
  reference: large homomer, solved-only interface, minority-entry contact, Y2H-only partners,
  family-level SUBUNIT claim, no `Domain` features. Each of S1–S5 and S11 becomes a contract test.
- **Accessibility.** The track lanes need a per-lane text summary that includes support. The
  dot-only source columns need their `sr-only` text kept in the merged grid. Re-check focus order
  when the two refresh buttons become per-section actions.
- **Guard list.** Add the merged tab to `energeticsLabels.guard.test.ts`.

---

### Cost, in detail (S3 / §5)

- **Where:** `workflowOrchestrator.ts:636` (fresh analysis) and `:600` (cache hit without
  `multimerData`) call `fetchProgressiveMultimer` → `POST /api/v1/structure/multimer` →
  `analyzeMultimerStructure` → `queryBoltz2Multimer`, a GPU job on the external JapanFold API
  (`api.japanfold.aiand.com`, our API key). This happens for every homomer of four chains or fewer
  and every resolvable heterodimer, whether or not anyone opens the tab.
- **Not shared between variants:** the job's cache key hashes the chain sequences, and chain A
  carries the mutation. Every variant of a gene is therefore a new job, although the PDBe answer is
  the same for all of them.
- **Failures are not cached:** only a success is stored. SLC12A4, which can never finish, is
  re-submitted on every new analysis and holds a server request for up to 60 s each time.
- **Open to anyone:** `/structure/multimer` is in `PUBLIC_ENDPOINTS` (no auth) with no rate limit.
  Correction (owner): `JAPANFOLD_API_KEY` is optional and not set, so nothing is billed to us; the
  cost is load on a shared service and server request slots, not money.
- **Screen:** the sidebar's Evidence stage stays "running" until the job settles.

### Decisions taken (owner, 2026-10-02)

1. Name: **"Interfaces & PPI"**.
2. Boltz-2 on request only; no pipeline pre-fetch. **No size gate of the app's own** (owner: "don't
   be too stringent"): the job is submitted and followed, and only the service's own rejection
   (a 4xx) is a limit. **Failures are never cached**: a cached transient fault would be a lasting
   false negative.
3. Binding-change wild type: **the experimental complex** where the residue is interfacial;
   Boltz-2 only when no solved complex exists.
4. STRING: the physical network leads; the functional score is secondary.
5. No global "Run again" / "Read again" header button. A section that failed offers "Try again"
   in place; the complex model is a stated action ("Model the complex") in its own section.

## Proposed shape of the merged tab ("Interfaces & PPI")

Model: `src/shared/interfacesEvidence.ts`, composing the existing parsers (`multimerAssembly.ts`,
`readInteractionSites`, PDBe) into one object for tab and rail. `multimerEvidence.ts` and
`interactionsEvidence.ts` become internals or are absorbed.

1. **Finding.** The verdict chip (at interface / not / not measured, with support). Headline =
   assembly + interface with support. Diagram. Fact strip: Assembly · Interface support ·
   Reported partners · Binding change (one "Engine record" note in the foot, not a cell).
2. **Where on the sequence.** The single track above.
3. **Assembly.** SUBUNIT quote with qualifiers. Complex model (size-gated, on request) with ipTM.
   Solved complexes per partner with k/n.
4. **Partners.** One grid: assembly partners → structural → literature-curated → high-throughput
   binary → functional only. Columns: evidence/method, studies, physical STRING, mapped site.
5. **Binding change.** DDMut-PPI on a solved wild type when one exists, else Boltz-2. RMSE band.
6. **Rail.** One trace (curation → partners → solved interfaces → model → interface verdict →
   binding → engine). Cut-points: ipTM guidance, STRING bands, "ΔΔG: none published (RMSE shown)".
   Method notes from both rails, de-duplicated. Sources with dates and versions.

Routes `multimers` and `interactions` both redirect to the new id. `EvidenceTabId`, the sub-nav,
the command palette, About, Insights links and `EvidenceInspector` all update together.

## Sources

- UniProtKB Q9UP95 (SLC12A4): SUBUNIT, INTERACTION, features. rest.uniprot.org, read 2026-10-02.
- PDBe-KB interface residues, `ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/Q9UP95`, read 2026-10-02.
- IntAct via PSICQUIC, interactor Q9UP95, read 2026-10-02.
- Luck K, et al. A reference map of the human binary protein interactome. Nature 2020;580:402. doi:10.1038/s41586-020-2188-x
- Zhou Y, Myung Y, Rodrigues CHM, Ascher DB. DDMut-PPI. Nucleic Acids Res 2024;52:W207. doi:10.1093/nar/gkae412
- Varadi M, et al. PDBe-KB aggregated API. Bioinformatics 2021. doi:10.1093/bioinformatics/btab424
- Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638. doi:10.1093/nar/gkac1000
- EMBL-EBI AlphaFold course, "Confidence scores in AlphaFold-Multimer" (ipTM guidance).

---

## Resolution (branch `interfaces-ppi-merge`, 2026-10-03)

The two tabs are one: **Interfaces & PPI** (`interfaces`). `multimers` and `interactions` redirect
to it through `RETIRED_EVIDENCE_TABS`. One model, `src/shared/interfacesEvidence.ts`, feeds the tab,
the rail and the Insights "Assembly" lane.

| # | Status | What changed |
|---|---|---|
| S1 | Fixed | `pdbe-interfaces.ts` keeps `interactingPDBEntries` per residue (`support[]`, `variantEntries`); the denominator is the pair's structures. Screen: "in 1 of 8 solved structures (7AIQ)". |
| S2 | Fixed | The verdict carries its support everywhere (headline, figure, fact, trace, diagram half-dot). The predicate says a minority contact depends on the conformation or construct, and gives the interface's best-attested support (5 of 8) for scale. No new cut-point. |
| S3 | Fixed | `runBoltz2Multimer`: submit, follow the job (202/job id), keep it across calls (`pendingBoltzJobs`), typed failures (`timeout`, `http`, `rejected`, `network`, `job-failed`, `no-model`), one sentence per kind. Only models are cached. On request only. |
| S4 | Fixed | New `intact.ts` (PSICQUIC MITAB): methods and distinct studies per partner. Grid groups "Binary screen only"; row reads "Yeast two-hybrid · 1 study (PubMed 32296183)". |
| S5 | Fixed | `subunitStatements`: every assembly sentence with its qualifier; a family partner is an unresolved row, never "No curated interaction". |
| S6 | Fixed | Disagreement between model and solved structures is stated in words (callout + trace warning). |
| S7 | Fixed | The binding change no longer needs the variant model; chains come from the assembly. |
| S8 | Fixed | `/ppi/binding-shift` scores on a solved complex where the residue is interfacial (best resolution first; SIFTS + residue listing to the AUTHOR number; PDB format from RCSB). Boltz-2 wild type only when no solved complex exists; when solved complexes exist and none has the residue at the interface, nothing is estimated. |
| S9 | Fixed | Performance quoted as r 0.75 (RMSE 1.33) / r 0.67 (RMSE 1.51); ± RMSE band on the ruler; "inside the method's error" stated. The unverified "0.60 antibody–antigen" figure was removed. |
| S10 | Fixed | Counts come from one model: "8 reported partners: all two-hybrid, one study". |
| S11 | Fixed | Track lanes: membrane topology (12 segments; Gln867 cytoplasmic) and domains & regions (Scissor helix 665–681). Empty lanes are not drawn. |
| S12 | Fixed | `fetchStringPartnerLists`: physical and functional lists down to 0.15 (limit 500) and the STRING version (12.5). Absence reads "None ≥ 0.15" or "Not in STRING's top 500". |
| S13 | Fixed | Insights lane reads the merged model; "not stated" is not "no complex"; the lane states the interface support. |
| S14 | Fixed | Provenance "Boltz-2 via JapanFold"; the "Tier 1 / Tenstorrent / OpenFold3" header claims removed. |
| S15 | Open | The MANE → canonical identity is still assumed on this tab. |
| U1–U11 | Fixed | One verdict and track; no cross-tab dead end; empty columns dropped; a limit is not an amber banner; no permanent Run/Read again ("Try again" only on a failed section, "Model the complex" and "Estimate binding change" as stated actions); one chip vocabulary; track label not clipped; mono only for numbers; legend lists drawn marks only; rail shows "No result" while payloads are missing. |
| — | Added | Construct partners (MBP, T4 lysozyme, BRIL, GFP, GST, thioredoxin) are set aside, never counted as interfaces (NAE1 shows an MBP interface in PDBe-KB). |
| — | Added | Stored payloads without per-residue support or the IntAct/STRING fields are re-read, not rendered. |

**Effect on the reference variant (SLC12A4 p.Gln867His).** Before: "At an interface … in 8 solved
structures", "Provider error" for the model, "Curated physical interaction · 3 experiments" for
eight partners, SLC12A5/6/7 as "No curated interaction". After: at the dimer interface in **1 of 8**
structures (7AIQ; the interface's core residues reach 5 of 8); model not run (on request); 8
partners from one two-hybrid study; SUBUNIT's probable heterodimer with other K-Cl cotransporters
shown, unresolved, beside STRING's physical partners SLC12A6 0.999, SLC12A7 0.982, SLC12A5 0.938;
the binding change planned on 7AIQ (EM 3.72 Å, chain A, author residue 867). No classification
changes: no ACMG criterion reads this tab.

**Verification.** `npm run lint` (boundaries, focus indicators, verify parity, tsc) clean; full
vitest 3321 passed, 5 skipped. New: `interfacesEvidence.test.ts` (live-captured SLC12A4 fixture +
NAE1 cases ported from the retired suites), `InterfacesTab.test.tsx` (tab + rail), rewritten
`multimer.test.ts` / `ppi.test.ts` (on-request model, job follow and resume, typed failures,
per-residue support, construct tags, IntAct parsing, solved wild type in author numbering). The
services were run live for SLC12A4 (PDBe, UniProt, IntAct, STRING, SIFTS, RCSB). Rendered in light,
dark and 820 px with headless Edge.

**Not done.**
- No DDMut-PPI job was submitted against 7AIQ from here (a third-party academic server); the path
  is unit-tested with the live entry's mapping and file.
- JapanFold's job-results shape for Boltz-2 is assumed to match ESMFold-2's (`id`, `links.results`,
  `status`/`ready`); not observed live.
- Large entries available only as mmCIF are skipped for the solved wild type, not converted.
- `/structure/multimer` is still a public endpoint with no rate limit.
- S15 (isoform mapping check on the axis).
