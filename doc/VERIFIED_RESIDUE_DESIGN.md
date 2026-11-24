# Verified residue: gate and candidate residues (design, approved 2026-11-24)

Status: approved 2026-11-24 (A, B1, B2, C in that order). Step A is built: `numbering-proof.ts` (issue, verify),
`src/shared/verifiedResidue.ts`, the proof on `POST /translate-variant` (coordinate and `NP_…` input) and on
`POST /numbering-proof` (typed protein notation, called by the browser before the requests that run in parallel
with the analysis), the check in the analysis parser, `numberingProof` in all six analysis audit entries and in
`GENERATE_MUTANT` (queued, joined or cache hit). The other routes in `structure.ts`, `biophysics/generation.ts`,
`literature.ts` and `narrative.ts` do not check the proof yet: they have no audit entry, and nothing there uses
the result before B2 (owner decision, 2026-11-24). Their checks are listed under "Proof on the other routes" in §5.
Part of "Residue numbering" in `IN_SILICO_PRUNING_PLAN.md`.
This is the second version, revised after a three-part code review (correctness, tests, architecture).

## 1. What was measured (2026-11-23)

| Input kind | Source | Unverified |
| --- | --- | --- |
| Genomic / cDNA coordinate | Production audit log, 2026-10-25 to 2026-11-20 | 16 of 22 translations |
| Protein notation (`p.Lys281Asn`) | Replay of the 14 distinct protein variants in the 30-day audit log through the same isoform check, live UniProt | 0 of 14 (all canonical, 0.7–1.2 s, inside the 2.5 s limit) |

The 16 coordinate cases break down as:

- **11 (2026-11-20, 07:41–08:35 UTC):** Ensembl VEP was skipped by our own circuit breaker (the switch that
  stops all calls to a host after 5 failures in a row). The prediction step's 8 s VEP lookups had opened it.
  Fixed in PR #285. Evidence: each of the 11 translations took 141–283 ms in total, which is less than an
  uncached VEP answer can take (table below), and reproduced live (Appendix A).
- **4:** Ensembl VEP used its whole 25 s window, then VariantValidator answered. Ensembl being slow; no code change.
- **1:** Ensembl VEP answered, but the numbering could not be reconciled.

Ensembl VEP answer times measured from the production VM (2026-11-23, same request shape as the app):

| Request | Seconds |
| --- | --- |
| Translation, uncached | 13.0, 12.0, 14.4, 15.1 |
| Translation, cached by Ensembl | 0.10, 0.09 |
| Prediction lookup (hgvs), uncached | 18.2, 9.5, 16.0 (HTTP 400 answers) |
| Prediction lookup (region) | 27.8 (HTTP 503), 12.0, 0.3 |

The protein figure covers only the position checks (MANE and canonical differ, or another isoform reads the
same residue). It does not cover outages, which were not logged. PR #286 now logs them in all six analysis
audit entries (`numberingBasis: "unavailable"`). About two weeks of data will give a real rate.

## 2. Finding that changes the design

Two numbering verdicts exist, and they do not meet:

1. `POST /translate-variant` decides the verdict for coordinate and `NP_…` input and returns it to the browser.
2. `POST /analyze-variant*` receives only the canonical protein notation. It runs its own gene-level check
   (`basisScope: "mane"`, `variant-parser.ts`) and never sees verdict 1.

The browser does show the unverified disclosure from verdict 1. But the server cannot enforce it, and a flag
the browser sends is only a claim (today's `numberingBasis: "canonical"` already is).

### Why the first version of this design was wrong

It proposed rebuilding the proof on the analysis route. That fails for three reasons:

- The analysis request carries no declared protein. `originalNotation` is set by no client, and accession-qualified
  notation is refused with a 422 by design. So `NP_…` input cannot be re-checked there.
- The translation cache key is the exact submitted notation (`coord_translation_<build>_<notation>`). The analysis
  request holds a different form of the coordinate (`X-23723975-C-A`), so the rebuild would be a cache miss and
  would ask Ensembl and VariantValidator again (10–40 s).
- Unverified answers are never cached, so they would be asked again on every analysis, during the very outage that
  created them. (The ten-year figure in the first version was the L2 store; the memory cache keeps 365 days.)

### The mechanism: a signed numbering proof

The translate route already knows the proof. It signs it, and the browser passes it back unchanged.

- **Payload:** `{ accession, canonicalPosition, wildType, mutant, proof, schema }`. `schema` is the cache schema
  version, so a version bump invalidates old proofs.
- **Signature:** HMAC-SHA256 with a key derived from `APP_SESSION_SECRET` (the server refuses to start without it
  in production, `config.ts`), as `user-secrets.ts` already does with its own key label. The same key works across
  blue/green containers.
- **Lifetime:** 30 days. After that the parser falls back to its own check.
- **Binding:** the signature covers the residue, so a proof for one residue cannot be replayed onto another.
- **Unverified answers get no proof.** A request without a valid proof falls back to the parser's own check
  (`canonical-vs-mane` or `unverified`).
- **Cost:** one HMAC check. No network, no cache read, no new request field beyond `numberingProof`.

This removes the cache and latency problem and the missing-field problem together. It needs no `NP_…` re-check on
the analysis route, because the translate route already did that (`verifyDeclaredNumbering`, PR #284).

**Refactor needed first** (propose-then-build, per the owner's global instructions): a `numbering-proof` module
(issue, verify) and `Residue` type, used by the translate route (issues), the parser (verifies) and the other routes
listed in section 5. Two days, with tests.

## 3. One proof vocabulary

Authoritative vocabulary: `ResidueProof`. PR #286's `numberingBasis` stays as the logged *outcome of the check*, and
the mapping is fixed, so the two-week data needs no migration:

| `numberingBasis` (#286 log) | `ResidueProof` | Verified |
| --- | --- | --- |
| `canonical` (bare notation, canonical vs MANE only) | `canonical-vs-mane` | yes |
| `canonical`/`remapped` from a coordinate translation | `genomic` | yes |
| `canonical`/`remapped` through the declared `NP_…` | `declared-protein` | yes |
| `user-confirmed` | `user-confirmed` | yes |
| `unverified`, `unavailable` | `unverified` | no |
| `ambiguous` | never reaches an engine (refused today) | no |

The first version called the bare-notation proof `single-basis`. That name was wrong: with `basisScope: "mane"` the
parser compares canonical and MANE only and never proves a single basis. `canonical-vs-mane` says what was checked.
It is a weaker proof than `genomic`; the report shows the proof name. The audit entry gains `numberingProof` in step A.

## 4. Order of work (changed)

The first version waited two weeks for data before building anything, which left the mismatch live. New order:

| Step | What | Visible to users | Days |
| --- | --- | --- | --- |
| A | Proof module, signed proof from translate, check in parser and other routes, `numberingProof` in audit | No | 4 |
| B1 | Refuse an analysis whose residue is unverified: 422 that names the remedy (qualify with the `NP_…` protein, or use the coordinate) | Yes | 1 |
| B2 | The full gate, replacing B1 only if the data show refusal is too blunt | Yes | 10 |

After step A the server enforces what the browser already discloses. Step B1 can ship straight after approval, so the
exposure lasts about 5 days, not 2 weeks plus the build. The two-week #286 data then decides B2 only. Proposed rule:
build B2 if more than 1 in 50 runs is unverified, or if failures cluster (the 2026-11-20 outage was 11 in one hour,
where a refusal blocks every user at once). Otherwise B1 stays.

## 5. Step B2: the gate

### Types (`src/shared/verifiedResidue.ts`)

```ts
type ResidueProof = "genomic" | "declared-protein" | "canonical-vs-mane" | "user-confirmed" | "unverified";
interface Residue { accession: string; position: number; wildType: string; mutant: string; proof: ResidueProof; reason?: string }
class VerifiedResidue { #brand; private constructor(readonly residue: Residue) {} static of(r: Residue): VerifiedResidue | null }
```

`VerifiedResidue.of` returns null for `unverified`. The first version used `readonly __verified: true`, which is only
a property: any object literal can copy it. A class with a `#private` field and a private constructor cannot be built
by a literal. TypeScript cannot stop a deliberate `as any`, so a second guard is added: a `check-boundaries` rule that
only `verifiedResidue.ts` may construct it. Engines take a `VerifiedResidue` where they took `pos` / `wt1Letter`.

### Which engines are gated: by input kind, not by name

Whether an engine depends on protein numbering depends on how it is keyed, and that changes with the input kind.
Predictors, dbNSFP tiers, popEVE and AlphaGenome use the genomic coordinate when the run has one; they use the protein
position only for protein input. So the table is per input kind. The keys in it come from reading the code and the
review; the inventory test below is what confirms them engine by engine. A generated inventory test (as the engine-label guard
tests do) lists every engine and its key, so a new engine cannot skip the decision.

| Engine or route | Coordinate input, unverified numbering | Protein input, unverified numbering |
| --- | --- | --- |
| Predictors (AlphaMissense, CADD, REVEL by coordinate), dbNSFP, popEVE, AlphaGenome, SpliceAI | Run (coordinate-keyed) | Withheld |
| gnomAD frequency (PM2, BA1) | Run (the allele is known) | Withheld (alleles are derived from the position; PM2 is counted today) |
| ClinVar same-residue lookup (PS1) | Withheld | Withheld |
| Position-keyed: ProtVar FoldX and conservation, structure mapping, pockets, interfaces and PPI, multimer, `/analyze-variant/landscape` (position window) | Withheld | Withheld |
| Energetics (FoldX, ThermoMPNN, RaSP, StabilityOracle, DynaMut2, DDMut) | Withheld | Withheld |
| Gene-wide: GenCC, G2P, `/landscape-context` (gene-wide, takes no position), constraint by gene | Run | Run |

Correction to the first version: "landscape context" is gene-wide and was listed wrongly; the position-windowed route is
`/analyze-variant/landscape`.

Routes that take a position, and so need the proof (six files, not two): `analysis.ts` (six endpoints), `structure.ts`,
`biophysics/generation.ts`, `literature.ts`, `narrative.ts`, and `translation.ts` (issues the proof).

### Proof on the other routes (decided in step A, built in B2)

- **Inventory.** Besides the routes above: `GET /pdb/entry/:pdbId?uniprot=&pos=&wt=` and
  `POST /structure/multimer/import`. `GET /alphafold-pdb/:uniprotId` takes no position and needs no proof.
- **How the proof travels.** POST routes take `numberingProof` in the body (`requestFieldsOf` already sends it to
  every analysis, landscape, structural, multimer and PPI request). GET routes take it in an `X-Numbering-Proof`
  header, not the URL, so proofs stay out of the request log. The browser does not send the header in step A:
  `fetchHomologStructures` and `fetchPdbCoordinates` take long positional argument lists, so the header is added
  together with the server check, with those signatures changed to one options object.
- **Position-only match.** `GET /pdb/:uniprotId?pos=` and `GET /homologs/:uniprotId?pos=` name no wild type or
  mutant. They accept a proof that names the same accession and position (a proof for K281N proves position 281's
  numbering), through a separate `verifyPositionProof`; `verifyNumberingProof` stays strict for every route that
  names the substitution (`/literature` with `variant`, `/pdb/entry` with `wt`).
- **Caching.** These responses set no `Cache-Control` today, Caddy has no response cache, and Cloudflare's cache
  ignores a custom `Vary`. Once a response can be withheld for one request and not another, every gated response
  sets `Cache-Control: private, no-store` and `res.vary("X-Numbering-Proof")`, so neither a browser nor a shared
  cache serves a withheld answer to a request with a valid proof, or the reverse. The server's own caches are keyed
  by accession and position, not by the proof, and are not affected. Check that the edge Worker forwards the header.
- **A structure the caller sends** (`wtPdb` on `/generate-mutant`; the retry buttons' `/dynamut2-submit` and
  `/thermompnn-submit`) is read in its own numbering, so no UniProt proof applies and it is not gated; the audit
  entry says `caller-structure`. Known defect, not fixed: with a caller's structure, `/generate-mutant` still asks
  RaSP and ProtVar FoldX for the UniProt accession at the file's position, which is another residue when the
  file's numbering differs.
- **B1 and coordinate input.** Without a valid proof the parser falls back to its own canonical-versus-MANE check,
  so an unverified coordinate translation can be named `canonical-vs-mane`. B1 must accept only `genomic` or
  `declared-protein` when the request carries a coordinate.

### Effect on criteria (corrected to the real rule engine)

| Criterion | How it uses the position | Unverified residue |
| --- | --- | --- |
| PP3 / BP4 | predictors | withheld for protein input; counted for coordinate input |
| PS1 | ClinVar same amino acid change | withheld |
| PM1 | VCEP (CSpec) text by position | withheld |
| PP2 | regional constraint at the position | withheld |
| PVS1 | C-terminal branch reads the residue number | the C-terminal branch is withheld; the rest is unchanged |
| PM4 / BP3 | in-frame repeat region | withheld |
| PM2 / BA1 | frequency | counted for coordinate input; withheld for protein input |
| BP1 | never applied automatically (owner decision, `THRESHOLDS_TAB_REVIEW.md`) | n/a |
| PM5 | not evaluated by the rule engine | n/a for the rule engine, **but see below** |

PM5 and PS1 are in the language-model whitelist (`gemini.ts`), so a model could still suggest them. For an unverified
residue the suggestion step removes position-based codes (PS1, PM1, PM4, PM5, PP2, PVS1 C-terminal) and the prompt says
numbering is unverified. The first version's example ("PP3 + PM5 falls to VUS") was wrong, since the rule engine never
applies PM5. A real example: protein input with PP3 + PM1 + PS1 becomes VUS when its residue is unverified.

### Data model and UI

Withholding is a structured fact, not free text. Today `CriteriaEvaluationResult.unavailable` is free text. Added:
`withheld: { code, cause: "numbering-unverified" }[]` on the criteria result and on `ACMGItem` (zod in `contracts.ts`),
so a report can say "withheld for numbering", not "unmet".

Two availability vocabularies exist, and both change: `EvidenceAvailabilityState` has six values (`available` and five
no-value states), and `EngineState` has eleven. Add `withheld` to both, mapped in `STATE_TO_ENGINE_STATE`, with its label
"Not assessed: numbering unverified" and tone in `engineStatus.ts`. The existing `skipped` means "the user hid a running
engine", so it cannot be reused. The residue chip in the header shows "Numbering unverified" and the reason once. No
per-row warnings. The existing `numberingWarning` field stays in the payload for older clients and saved reports;
`provenance.ts` keeps reading the old fields, and the new ones are additive.

### Effort for B2

| Work | Days |
| --- | --- |
| Type, boundary rule, engine inventory test | 2 |
| Core and structural engines | 3 |
| Biophysics, PPI, literature, narrative routes | 2 |
| `withheld` in both vocabularies, zod, guard tests | 1.5 |
| Criteria data model, report, suggestion filter | 2.5 |
| **Total** | **about 11** |

## 6. Step C: candidate residues (design only)

Treat ambiguous or unverified numbering as a set of candidate residues: score every candidate, show a value only when
all agree, count a criterion only if all agree.

**Relation to the gate (corrected).** The first version said "a verified residue is a set of one, so the gate is the
case of an empty set". That is not sound. Two cases differ:

- *The gate* withholds when no proof exists.
- *Candidates* withhold when readings disagree.

An unverified fallback answer has two readings that can be named (canonical, and the reading on the `NP_…` it names), so
it is a set of two, not an empty set. When the readings cannot be named (provider down), the set is empty and the engine
reports "not assessed". So the rules are: set of one verified → value; set of several → value only if all agree; empty →
"not assessed". The gate becomes the rule for "empty or unproven".

**It is new work, not a generalisation.** The allele helpers (`allele-candidates.ts`, `candidateScores.ts`,
`candidate-frequencies.ts`) work within one codon: the candidates sit at the same position. Residue candidates sit at
different positions, so the fan-out, the cache keys and the decision functions are new (`decideAcrossResidues`, modelled
on `decideCandidateCadd`).

- **Translation.** The numbering step returns a `ResidueSet` instead of refusing (ambiguous) or passing (unverified).
  Candidates come from `resolveGeneProteinNumbering` and, for a fallback answer, the `NP_…` reading. Usually two; in
  ACOT9, 3.4 % of positions have two.
- **Engines.** Cheap engines (dbNSFP, ClinVar, conservation, structure mapping) run per candidate. A second candidate
  does **not** need a new structure: the structure belongs to the canonical accession, and only the position changes.
  Energetics engines need one more mutant run each. The repaired structure is reused, because the cache is keyed by
  structure hash + mutation + conditions (`prewarm-manager.ts`). They run per candidate only on request ("Run for both
  readings"); otherwise they show "Not assessed: two readings".
- **Values and criteria.** All agree on the band → shown; otherwise "Differs by numbering" with each reading behind a
  disclosure. A criterion counts only when every candidate meets it at the same strength.
- **UI.** The header shows "Two readings: canonical 85 / canonical 76 (MANE numbering)". Choosing one makes it a single
  `user-confirmed` residue.
- **Caching and provenance.** Results are cached per residue. The run records the set, each member's proof, and what was
  withheld for disagreement.
- **Effort: about 5 weeks** after B2 (was 3): new decision helpers 8 days; fan-out, request limits and cost control 6
  days; "differs by numbering" UI 6 days; criteria, report and provenance 3 days; tests 2 days. Request count roughly
  doubles for ambiguous runs only.

## 7. Questions raised by the review, and the decision taken

| Question | Decision | Why |
| --- | --- | --- |
| Which proof vocabulary is authoritative? | `ResidueProof`; #286's `numberingBasis` stays as the logged outcome, with the fixed mapping in section 3 | The data needs `numberingVerified` and the reason, which #286 already logs. No migration |
| Gate per input kind or per engine name? | Per input kind (section 5 table) | Engines change their key with the input kind |
| Is PM5 applied outside the rule engine? | Only by the language model (whitelist in `gemini.ts`) | Position-based codes are filtered from suggestions for an unverified residue |
| Add `withheld` to both vocabularies? Does it count in "N of 6 engines"? | Yes to both. It counts as missing: the denominator stays 6, the numerator excludes it, and enough withheld engines set `insufficient` | `summarizeCoverage` treats a no-value state as missing |
| Does a second candidate need a new fold? | No. It needs one more mutant run per energetics engine, with the repaired structure reused | Cache key is structure hash + mutation + conditions |
| Ship the 422 refusal now? | Ship it as B1 right after you approve this design | It is user-visible, so it waits for approval. Step A has no visible change |

## Appendix A. How the numbers were produced

- **Coordinate rate:** every `TRANSLATE_VARIANT_RESOLVED` entry in `logs/audit.jsonl` on the production VM, read only:
  count `numberingBasis == "unverified"`, group by `provider` and `usedFallback`. The duration of each is its
  `TRANSLATE_VARIANT` entry to its `TRANSLATE_VARIANT_RESOLVED` entry for the same hashed `variant`.
- **Protein rate:** the distinct `(gene, variant, uniprotId)` of the `ANALYZE_VARIANT*` entries (14), each passed to
  `resolveGeneProteinNumbering({ basisScope: "mane" })` against live UniProt. Run on 2026-11-23.
- **VEP times:** `curl` from the VM with the app's exact query strings (`hgvs=1&canonical=1&uniprot=1&mane=1`, and the
  predictor's `AlphaMissense=1&CADD=1&mane=1`).
- **Breaker reproduction:** `fetchPredictorData` for four uncommon variants, then `resolveCoordinate`, with the repo code
  and the real Ensembl hosts. Before the fix the breaker opened ("Tripped to OPEN state due to 5 consecutive
  failures") and the translation's VEP attempt failed in 1 ms with "circuit breaker open"; after the fix three such
  analyses left it closed. The 2026-11-20 container logs no longer exist (removed by a later deploy).
