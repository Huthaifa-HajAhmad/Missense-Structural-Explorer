# Verified residue: gate and candidate residues (design, awaiting approval)

Status: design only. Nothing here is built. Part of "Residue numbering" in `IN_SILICO_PRUNING_PLAN.md`.

## 1. What was measured (2026-11-23)

| Input kind | Source | Unverified |
| --- | --- | --- |
| Genomic / cDNA coordinate | Production audit log, 2026-10-25 to 2026-11-20 | 16 of 22 translations |
| Protein notation (`p.Lys281Asn`) | Replay of every distinct protein variant in the 30-day audit log (14) through the same isoform check, live UniProt | 0 of 14 (all canonical, 0.7–1.2 s, inside the 2.5 s budget) |

The coordinate figure breaks down as follows:

- **11 (2026-11-20):** Ensembl VEP was skipped by our own circuit breaker. A circuit breaker is the switch that stops all calls to a host after 5 failures in a row. The predictor's 8 s VEP lookups had opened it. Fixed in PR #285, which also logs `vepFailure` in the audit entry.
- **4:** Ensembl VEP used its whole 25 s window, then VariantValidator answered. This is Ensembl being slow; no code change.
- **1:** Ensembl VEP answered, but the numbering could not be reconciled.

Since PR #284, a VariantValidator answer is checked through the `NP_…` protein it names. So the coordinate rate should now be far lower. It must be measured again after #285 is deployed.

The protein figure covers only the position checks: MANE and canonical differ at the position, or another isoform carries the same residue. It does not cover outages, because the "isoform service unreachable" case was not logged. PR #286 now logs it (`numberingBasis: "unavailable"`). About two weeks of production data is needed for a real rate.

## 2. Finding that changes the design

There are two numbering verdicts today, and they do not meet:

1. `POST /translate-variant` decides the verdict for coordinate and `NP_…` input and returns it to the browser.
2. `POST /analyze-variant*` receives only the canonical protein notation. It runs its own gene-level check (`variant-parser.ts`, `basisScope: "mane"`) and never sees verdict 1.

So a translation that ended "unverified" can reach the engines as `numberingVerified: true`, because the second check only asks whether MANE and canonical disagree at that position. The browser keeps verdict 1 (`pipelineStateFactory.ts`), but the server cannot trust a flag that the browser sends.

**Refactor needed before the gate (AGENTS.md rule):** one server-side numbering step that both routes call.

- When the analysis request carries `genomicCoordinates` (which it already forwards for coordinate input), the parser rebuilds the proof from the coordinate through `resolveCoordinate`. A verified translation is cached for 10 years, so this is a cache read. An unverified one is asked again.
- For `NP_…` input, the browser forwards the declared protein, and the parser re-checks it through `verifyDeclaredNumbering`.

Effort: about 2 days, with tests.

## 3. Step 1: the verified-residue gate

### Types (`src/shared/verifiedResidue.ts`)

```ts
type ResidueProof = "genomic" | "declared-protein" | "single-basis" | "user-confirmed" | "unverified";
interface Residue {
  accession: string;      // UniProt canonical accession
  position: number;       // canonical position
  wildType: string;       // one letter, checked against the canonical sequence
  mutant: string;
  proof: ResidueProof;
  reason?: string;        // why unverified, in plain words; shown once
}
type VerifiedResidue = Residue & { proof: Exclude<ResidueProof, "unverified">; readonly __verified: true };
```

- **Who builds it.** Only the numbering step (section 2) builds a `Residue`. Only `verifyResidue(residue)` returns a `VerifiedResidue`; it returns null for `unverified`.
- **Who needs it.** Every engine that reads a protein position takes a `VerifiedResidue` instead of `pos` / `wt1Letter`. The type system then refuses an unverified position at compile time. No engine runs its own check.
- **What each proof means:**
  - `genomic`: Ensembl VEP numbered the coordinate on canonical, or remapped it to canonical.
  - `declared-protein`: checked through the named `NP_…` or isoform.
  - `single-basis`: a bare notation where MANE and canonical agree and no other isoform reads the residue.
  - `user-confirmed`: the reader chose canonical at the ambiguity prompt.

### Engines gated (they read a protein position)

- **Core analysis (through the parser):** dbNSFP tiers (local store, Genos, dbnsfp.org, MyVariant), Ensembl VEP predictors (AlphaMissense, CADD by protein), popEVE (Genos), ProtVar conservation and the conservation orchestrator, ClinVar same-residue lookup (PS1/PM5), the landscape context at the position, regional constraint (MCR O/E for PP2), and the protein-derived candidate alleles that feed gnomAD frequency (PM2) for protein input.
- **Structural route:** structure mapping, pockets, PDBe interfaces and PPI, multimer.
- **Routes that take a position without the parser today:** `/analyze-variant-biophysical` and `/generate-mutant` (FoldX, ProtVar FoldX, ThermoMPNN, RaSP, StabilityOracle, DynaMut2, DDMut), `/structure/multimer`, `/ppi/binding-*`, and the literature and narrative routes. These must take a residue issued by the numbering step instead of a raw position: a short signed token, or a re-check on the server.

### Engines not gated

- Gene-level evidence: GenCC, G2P, gene-wide constraint, inheritance.
- For coordinate input, engines keyed by the genomic coordinate (SpliceAI, AlphaGenome, CADD and gnomAD by coordinate) do not depend on protein numbering, so they still run.

### UI state

- **The question for you:** the availability vocabulary (`src/shared/evidenceAvailability.ts`) has no state that fits. `not-covered` means the source has no data for the residue, which is a different statement. I propose a new state, `withheld`, labelled "Not assessed: numbering unverified", added in `engineStatus.ts` so every tab gets it from one place.
- The residue chip in the variant header shows "Numbering unverified" with the reason once. Gated rows show only the state label. There are no warnings per row.
- The existing `numberingWarning` banner is replaced by this.

### Effect on criteria

| Criterion | Unverified residue |
| --- | --- |
| PP3 / BP4 (in-silico) | not counted |
| PS1 / PM5 (same residue in ClinVar) | not counted |
| PP2 / BP1 (regional constraint) | not counted |
| PM2 (frequency) | counted for coordinate input (the allele is known); not counted for protein input |
| PS3/BS3, PVS1, de-novo, segregation | unchanged (not position-derived here) |

A run that used to reach "Likely pathogenic" through PP3 + PM5 can fall to VUS. The report states that the criterion was withheld for numbering, not that it was unmet.

### Simpler alternative to weigh

Refuse the analysis when the residue is unverified, with a 422 that names the remedy (qualify with `NP_…` or use the coordinate). This is the same pattern as the ambiguity refusal. There is no new state and no wiring per engine.

The cost: an isoform-service outage would block every run, including the coordinate-native engines. Given the measured rates (0 of 14 for protein input; coordinate causes mostly fixed), this may be enough.

My recommendation: build the section 2 refactor plus the `Residue` type first (needed either way), then decide gate or refuse from two weeks of #286 data.

### Effort

| Work | Days |
| --- | --- |
| Section 2 refactor | 2 |
| Types and parser | 1 |
| Core and structural engines | 3 |
| Biophysics, PPI, literature and narrative routes (token) | 2 |
| UI state and criteria | 2 |
| **Total** | **about 10** |

## 4. Step 2: candidate residues (design only)

Treat ambiguous or unverified numbering as a set of candidate residues. This reuses the ambiguous-allele rule (`allele-candidates.ts`, `candidateScores.ts`, `candidate-frequencies.ts`):

- score every candidate;
- show a value only when all candidates agree;
- count a criterion only if all candidates agree.

A verified residue is a set of one, so the gate in section 3 becomes the special case "set is empty → not assessed".

- **Translation.** The numbering step returns `ResidueSet = { candidates: Residue[]; proof }` instead of refusing an ambiguous notation (today a 422 with two choices) or passing an unverified one. Candidates come from:
  - `resolveGeneProteinNumbering` (canonical, plus the MANE or isoform reading at its canonical position);
  - for an unverified fallback translation, the canonical reading plus the reading on the `NP_…` it names.
  
  At most two or three candidates in practice (ACOT9: 3.4 % of positions have two).
- **Engines.** Each gated engine runs once per candidate, keyed by the candidate's canonical position. The existing per-position cache keys already separate them.
  - Cheap engines (dbNSFP, ClinVar, conservation, structure mapping) fan out freely.
  - Compute engines (FoldX, ThermoMPNN, RaSP, StabilityOracle, remote energetics) run per candidate only on request ("Run for both readings"). Otherwise they show "Not assessed: two readings".
- **Values.** Use a decision function per value, generalised from `decideCandidateCadd`:
  - all agree on the band → show it;
  - they disagree → show "Differs by numbering", with each reading behind a disclosure.
- **Criteria.** A criterion counts only when every candidate meets it at the same strength. Otherwise it is withheld with "differs by numbering". PM2 for coordinate input is unaffected (one allele).
- **UI.** The header shows "Two readings: canonical 85 / canonical 76 (MANE numbering)". The ambiguity prompt becomes optional: picking one turns the set into one `user-confirmed` residue.
- **Caching and provenance.** Results are cached per residue, as today. The run's provenance records the candidate set, each candidate's proof and basis, and which values or criteria were withheld for disagreement. The audit entry logs the set size.
- **Effort.** About 3 weeks after section 3:
  - generalising the candidate decision helpers from allele to residue: 4 days;
  - engine fan-out and cost limits: 5 days;
  - UI for "differs by numbering": 4 days;
  - criteria and report: 2 days.
  
  Risk: request count roughly doubles for ambiguous runs. Limited by the ambiguity rate (low single-digit % of positions in MANE ≠ canonical genes).
