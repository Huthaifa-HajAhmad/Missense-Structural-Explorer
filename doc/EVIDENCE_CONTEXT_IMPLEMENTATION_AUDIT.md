# Evidence context implementation audit

Audited from the original proposals through the importers, server routes, shared contracts,
store, UI, exports and deployment configuration on 2026-10-06. This supplements
[the research and implementation record](EVIDENCE_CONTEXT_REVIEW.md).

## Confirmed defects fixed

| Finding | Fix and verification |
| --- | --- |
| Installed JSON validated shape but allowed evidence under a different gene index, inconsistent frame keys, duplicated identities or false record counts | GenCC/G2P cross-record validation rejects these artifacts. CSV duplicate headers and conflicting stable-frame symbols fail before replacement. Regression fixtures exercise corrupted snapshots. |
| Prototype member names such as constructor could resolve as inherited gene records | Own-property checks in both snapshot lookups return empty coverage instead. Reviewer reproduced the defect; regression tests cover three prototype names. |
| dGTEx manifest could describe more genes than were actually stored; input receipts could be missing | Validate database gene count, four input receipt kinds, per-group donor totals and manifest reconciliation. Corrupt database fixture returns an error rather than no expression. |
| Per-variant key omitted transcript, isoform and assembly | Both tabs and rail use one identity helper including those fields and resolved locus. No implicit migration from old, less specific keys; earlier session choices must be selected again. Identity-separation tests added. |
| Raw dGTEx files and operator snapshots entered Docker build context | Exclude the input directory and GenCC/G2P artifacts. Preserve the small existing seed JSON files. Runtime evidence comes from the data mount. |
| Old ClinVar cache entries lacked the newly retained condition identifiers | Change only the ClinVar key generation, leaving unrelated caches intact. A new lookup refetches those identifiers. Previously saved analysis results still require reanalysis; cache invalidation cannot rewrite them. |
| Missing installations stayed cached with no UI recovery action | Add “Check again” for GenCC, G2P and dGTEx. These explicitly reload the source; no silent source refresh in an open review. |
| Context export could not distinguish unavailable validity from an uncurated disease or a still-loading request | JSON schema v2 adds export timestamp, query metadata, transport load states, complete validity response, context-only flag and unresolved saved disease key. Regression test inspects the downloaded payload. |
| Local input import time was presented as retrieval time | New imports state download versus local-import timestamp basis; legacy manifests display “Recorded”. The original remote retrieval time of a local file is not invented. |
| Failed JSON artifact replacement left temporary files | Importer cleanup runs in finally; prior validated artifact stays available if import fails. |
| G2P-only diseases could not be selected | Add source-verified HGNC/MONDO choices for the supported AD/monoallelic and AR/biallelic display mapping. Keep GenCC missing/error/uncurated states separate; no validity assertion is invented. Missing IDs, wrong genes and unsupported allelic mappings are excluded. |
| Export existed only in Expression & models | Both headers now use one receipt component; sources never requested remain explicit without triggering extra network calls. |
| Annotation identity enrichment could reset visible selections without explanation | Identity reads the actual top-level reference fields. A same-variant reference change shows a notice; prior choices remain stored under their original reference, with no unsafe fallback migration. Hook regression test covers enrichment. |
| An uninitialized inspector state was labelled not installed | Show “Not requested” before a source load; mechanism sections have a heading-linked accessible name. |

Actual installed FGFR3 artifacts remain readable under the stricter checks: 15 GenCC frames,
8 G2P records and 125 pediatric tissue/cohort observations. All changes remain context-only;
the ACMG engine is unchanged.

## Integration checks added

- Real API-router HTTP tests verify authentication on all three routes, invalid-symbol
  rejection before retrieval, exact gene forwarding and unavailable-source states.
- Actual hook/store tests verify late responses remain keyed to the previous gene, reject
  a mismatched response identity and recover through explicit retry.
- Source-verified choices are idempotent, preserve original data and distinguish missing
  GenCC installation from no GenCC curation. G2P support/modifiers remain unchanged.
- Browser review uses installed source data plus an explicitly simulated missing GenCC state,
  without a patient analysis or authentication bypass. Narrow tables remain internally scrollable.

## Production runbook

The owner chose **operator-imported pinned snapshots**. Run imports in a source checkout
with development dependencies installed (`npm ci`) and Python 3 available. The production
runner deliberately contains compiled application code, not the tsx importer tooling;
do not run these npm data commands inside that runner.

1. Run `npm run data:gencc`, `npm run data:g2p`, and `npm run data:dgtex` on the preparation host.
   Use the documented `--input` / `--input-dir` options when importing retained original files.
2. Keep original inputs and their recorded hashes with the operator's source archive. Validate
   source/release/manifest before replacing production artifacts; downloading a new file is not
   a decision to silently refresh an open review.
3. Install the three completed artifacts into the directory bind-mounted at `/app/data`.
   Compose currently mounts `../data:/app/data`. Default names work without extra environment
   variables. Custom GENCC_CONTEXT_PATH/G2P_CONTEXT_PATH/DGTEX_CONTEXT_PATH values must name
   paths inside the container and be explicitly passed to the service environment.
4. Exercise the authenticated context endpoints for a known gene and inspect provenance;
   missing installation, no curated gene and corrupt installation have different states.

The GTEx adult adapter is still live and requires network access. A reproducible offline
adult matrix is a planned upgrade. Docker build-context exclusions were reviewed locally;
no production image or deployment was executed in this audit.

## Remaining limitations and upgrade order

1. **HPO suggestions/manual acceptance first**, shared across both tabs: pinned ontology and
   disease annotations, exact-ID crosswalks with ambiguity, NOT qualifiers, annotation onset,
   and separate accepted review choices. HPO-only selection remains unimplemented; the G2P
   expansion currently supports only two documented allelic mappings. No arbitrary free-text
   or unsupported inheritance is assigned to a curated frame.
2. **Report and context import next:** add a validated export contract, import preview, source
   fingerprints and selection identity checks to main report/session round-trips. The current
   JSON is a separate receipt, not a complete reproducible analysis session. Restored analyses
   refetch context; exports should be retained when source reproducibility matters.
3. **Paired biological context:** ClinGen reconciliation/dosage and condition-scoped RCV/SCV
   alongside HPA/assay confidence, coordinate-aware pext, curated orthology and allele/assay
   scoped MGI/ZFIN/IMPC. These are labelled missing in the interface and remain planned.
4. **Developmental coverage:** dGTEx single-donor groups are descriptive, broad public cohorts
   cannot establish neonatal or prenatal coverage, and adult/pediatric TPM are not matched
   trajectories. Add complementary prenatal/organ atlases after age/tissue/source validation.
5. **Lifecycle and performance:** browser source caches remain per gene with explicit retry;
   no automatic dataset refresh/diff UI, alias resolution or batch/offline adult support.
   Whole-store rail subscription and uncoalesced G2P cold parsing are optimization opportunities,
   not evidence of incorrect scientific results. Input hashes establish identity, not authenticity
   against an independently signed upstream checksum.

User decisions in this audit: allow verified disease IDs beyond GenCC; keep both tabs advancing;
use operator-imported pinned artifacts. The next slice prioritizes HPO shared context, then
main report/export integration. No new ACMG vote, automatic phenotype adoption or fuzzy join.
The owner subsequently confirmed individual HPO term acceptance with organ-system summaries;
accepted terms remain review context. The default main report will include a brief selected-disease
summary, coverage gaps and source dates, with full evidence in an appendix. Both are next-slice
requirements, not claims that the HPO adapter or main report integration is already implemented.

## Verification record

Final full JavaScript suite: **310 files / 4,000 tests passed** (2 files and 5 tests skipped).
Lint, four Python importer tests and production build passed, with final client and server
bundles rebuilt after reviewer fixes. CSV closing-quote hardening is included. Installed source adapters
were exercised directly; authenticated-route tests mock only external retrieval.
Browser review covered 1280 and 820 pixels, light/dark and simulated missing GenCC, without
page overflow (scroll width 810 at viewport 820). Initial Electron preview startup errors
were resolved by navigating again; no application error was observed in the harness.
DeepSeek's independent source audit is retained at `research/EVIDENCE_CONTEXT_BACKEND_AUDIT_R2.md`;
its prototype-lookup finding is fixed and its G2P selection concern was resolved by the owner's
explicit verified-ID decision and visible source/coverage labels.
Gemini's raw review is retained at `research/EVIDENCE_CONTEXT_UI_AUDIT_R2.md`. Accepted:
export parity, identity-change disclosure, initial rail status and mechanism section naming.
Its case-mismatch scenario is not reproduced: adapters preserve the requested gene in their response,
and exact symbols are intentional. Do not loosen identity checks or guess aliases. Its stale-response
claim is contradicted by keyed-store hook tests; requests complete into their own gene cache with
bounded timeouts. Cancelling on tab unmount would also affect another subscriber. G2P single-flight
remains an efficiency improvement. Nested onset labels are valid accessible HTML; no WCAG failure
was demonstrated. Raw reviewer opinions about transcript-specific pext or automatic acceptance are
superseded by the scientific constraints in the revised proposals.
No commit, PR or deployment was performed.
