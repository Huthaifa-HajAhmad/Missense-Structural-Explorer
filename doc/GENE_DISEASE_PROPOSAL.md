# Gene–disease — causality, mechanism and variant context

**Revision 4, 2026-10-06. Implemented: shared selection, GenCC validity, verified G2P choices and mechanisms.**
Companion: [Expression & models](EXPRESSION_AND_MODELS_PROPOSAL.md).
The original survey is preserved in `research/GENE_DISEASE_PROPOSAL_REV1.md`.

## 0. Confirmed decisions

The owner confirmed explicit disease choice, manual acceptance of phenotype suggestions, context only
(no new ACMG votes), and advancing both companion tabs equally. These choices supersede the original
preselection, highest-validity headline and open PM1 blocker.

The question is disease-conditioned: *is this gene established for this disease and inheritance,
and what is known about its mechanism?* Variant-locus context is a separate read, not a validity score.

## 1. Scientific corrections

- **No strongest-assertion headline or consensus.** Retain each submitter and assertion date.
  A disputed/refuted assertion leads the finding with contrary evidence still visible. The app flags
  scientific disagreement; it does not resolve the dispute or hide measured biological context.
- **Identity is a tuple:** stable gene ID + disease ID + inheritance/allelic requirement.
  MONDO is preferred where established; retain unresolved OMIM/ORPHA/MedGen source IDs explicitly.
  Disease labels, close matches and parent/child relationships cannot silently merge frames.
- **Dosage and mechanism have different scopes.** HI for one disease and GoF for another can coexist.
  Triplosensitivity is copy-number gain, not synonymous with activating missense GoF. Compare only
  matching disease/allelic contexts; population constraint establishes neither mechanism nor validity.
- **Missense is a consequence, not a mechanism.** It may cause protein dysfunction or splicing, and
  the relevant mechanism can vary by disease. G2P inferred mechanisms must stay distinct from
  experimentally supported mechanisms and from predictors.
- **ClinVar VCV aggregates are not disease-specific RCV assertions.** The old client discarded condition
  IDs; the implementation now retains raw `trait_xrefs` per condition and retires old ClinVar cache keys. Old saved analyses may lack them.
  Locus work requires RCV/SCV condition scope and compatible transcript numbering.
- **Clustering stays context.** Condition on disease, transcript and review status, deduplicate alleles
  and disclose ascertainment bias. A dense ClinVar domain does not automatically satisfy PM1.
- **Uncurated is not refuted.** A missing installed-source record differs from a missing adapter,
  incomplete response, transport error and adverse curation.

## 2. Verified access — 2026-10-06

Direct HTTP excerpts and hashes: `research/evidence-context-probes.json`,
`research/followup-source-checks.json`.

| Source | Verified contract | Role |
|---|---|---|
| GenCC | `https://thegencc.org/download/action/submissions-export-csv`, 200, quoted CSV; imported 30,345 assertions / 6,109 genes | Installed pinned snapshot; per-gene endpoint |
| ClinGen validity | `https://search.clinicalgenome.org/kb/gene-validity/download`, 200; CSV preamble, FILE CREATED: 2026-10-06 | Next: cross-check/reconcile GenCC ClinGen records, never count twice |
| ClinGen dosage | `https://search.clinicalgenome.org/api/dosage`, 200, total/rows; 2,233 rows checked | Next: disease-scoped HI/TS adapter; special codes 30/40 as well as 0–3 |
| G2P | `/gene2phenotype/api/gene/FGFR3/` and `/api/panel/all/download/`, 200; summary endpoint independently verified | Pin mechanisms, support, allelic requirement, consequence/type and G2P ID |
| ClinVar | E-summary Variation ID 16330 has MONDO, OMIM, Orphanet and MedGen xrefs per condition | Xrefs retained now; condition-specific locus remains follow-up |

GenCC is CC0 1.0; attribute GenCC and contributing submitters: <https://thegencc.org/terms>.
No fixed weekly cadence, exact daily rate limit or public REST API is asserted from old snippets.
Download once in an operator step. Release ID, retrieval time, assertion date and hash are separate.
This export provides no release identifier, so the installed manifest deliberately has `release: null`.

ClinGen attribution: <https://www.clinicalgenome.org/docs/terms-of-use/>.
G2P follows EMBL-EBI and resource-specific terms: <https://www.ebi.ac.uk/about/terms-of-use/>.
A paper's CC BY or repository's Apache licence does not establish a database redistribution licence.
Verify the specific Orphanet/Mondo artifact terms when ingesting them.

The GenCC importer excludes original/submitted OMIM label fields, notes and narrative; it uses the
normalized GenCC label and retains IDs. Do not redistribute OMIM clinical synopses or scraped text.

## 3. Shared frame and provenance

Implemented `src/shared/diseaseFrame.ts` carries stable gene/disease/inheritance identity, xrefs,
exact per-submitter validity assertions with dates/report URLs, mechanisms with evidence basis,
and separately derived suggested systems. GenCC-only dataset provenance is on the response.

Future multi-source assertions require **field-level provenance**, source record/version and lifecycle
status. G2P mechanism records need disease and allelic requirement, mechanism support, publications and
curation date. A curated record can contain an inferred mechanism.

Mondo joining must retain mapping predicates, ambiguity, retired IDs and lumping/splitting lineage.
Only resolved equivalence can join. A broader/narrower/close mapping cannot transfer a mechanism or
refutation to another disease. GenCC already aggregates ClinGen: reconcile matching report/record IDs,
not independent votes.

## 4. Screen

1. **Explicit disease/inheritance selector**, shared with Expression & models. No default disease.
   Owner-approved verified HGNC/MONDO G2P choices can extend GenCC frames, with separate validity
   coverage. Missing GenCC installation is never labelled as a negative curation result.
2. **Finding and assertion table**: disputed/refuted or disagreement first, full submitters and dates,
   neutral evidence styling. No strongest-level or axes-answered score-like headline.
3. **Inspector trace**: selected identity → retained assertions → context boundary; source endpoint,
   retrieval date, release availability, licence and fingerprint.

Mechanisms retain source support, confidence, review date, publications, consequence and modifiers.
Exact HGNC + MONDO IDs precede a local autosomal dominant/monoallelic or autosomal recessive/biallelic
display mapping. Modifiers remain visible and are not resolved for the variant; other allelic scopes
are separately disclosed. This does not establish applicability to the selected variant or add
functional evidence. ClinGen dosage and condition-specific locus remain not integrated. Researcher systems and
onset survive disease changes. Review systems are not patient-observed HPO and cannot supply PP4.

## 5. Implementation and remaining limits

Started: schemas, shared per-variant selection/store, browser-session persistence, robust quoted CSV
import with identity/schema/duplicate validation and atomic replacement, public per-gene GenCC
endpoint, both tabs/rails, ClinVar xrefs. Standalone context export was removed at the owner’s request.

Second paired slice implemented: G2P snapshot mechanisms alongside dGTEx V1 pediatric expression.
Next: shared HPO disease context with manual suggestion acceptance, then report/export integration.
Following paired context: ClinGen reconciliation/dosage and HPA expression coverage; then RCV/SCV-aware locus,
animal models and complementary developmental atlases. Nothing enters the classifier.
HPO suggestions will be accepted individually with organ-system summaries, as review context
separate from patient observations. Main reports will default to a brief selected-disease summary,
coverage gaps and source dates; full evidence belongs in an appendix. Both choices are owner-confirmed.

| Limitation | Remedy |
|---|---|
| Unresolved condition identity or old label-only cache | Refresh cache schema; pinned exact crosswalk with ambiguity; never fuzzy-name assign |
| Disease absent from GenCC | Owner approved verified-ID choices. G2P HGNC/MONDO AD/AR choices now work with separate validity coverage; HPO-only choices and other allelic mappings remain to add |
| Mechanism applicability unresolved | G2P CSV is pinned; retain raw support/modifiers and review variant/allelic restrictions explicitly |
| Shared ClinGen/GenCC records | Source-lineage reconciliation, no duplicate evidence count |
| Snapshot freshness | Operator refresh; pin hash/release in export, preserve assertion dates |
| No main report/session context integration | Separate JSON export now; structured document/session integration next |

## 6. Verification contracts

Different inheritance frames stay separate; every conflicting submitter survives; no disease choice
means no conditioned claim; stale choices are reported, never replaced. Missing source/error/no
curated gene differ. Imports fail before replacing a snapshot on schema drift, truncation or duplicate
IDs. Disease changes preserve systems/onset; raw ClinVar xrefs survive. The ACMG engine never imports
these context modules.

Independent reviews are retained in `GENE_DISEASE_EXTERNAL_AUDIT.md` and
`EXPRESSION_MODELS_EXTERNAL_AUDIT.md`. They are advisory: blanket “CC BY equivalent” licences,
“PM1 requires RMC” and nonsignificance-as-normality claims are not adopted as authoritative rules.
See [review and implementation status](EVIDENCE_CONTEXT_REVIEW.md).
See [implementation re-audit and operator deployment runbook](EVIDENCE_CONTEXT_IMPLEMENTATION_AUDIT.md).

Deployed baseline corrections and revised verification: [baseline audit](EVIDENCE_CONTEXT_BASELINE_FIX.md).
