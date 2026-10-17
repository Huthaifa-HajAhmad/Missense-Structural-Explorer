# Gene-disease loading and dosage recovery audit

16 October 2026. Scope: Gene-disease tab, its inspector and shared model, context loader,
ClinGen adapter, and the tests covering that chain. Scientific classifications and ACMG
inputs are not changed. Unrelated working-tree changes are preserved.

## What the reported sequence means

An error followed by a successful empty lookup is possible: the first request did not establish
curation availability; a later complete response can establish that the queried symbol is unlisted.
The old catch-all error message cannot identify whether the user's original request timed out,
received an HTTP error, or failed validation. This audit does not claim to reconstruct that failure.

Live verification against `https://search.clinicalgenome.org/api/dosage` returned 2,237 of 2,237 rows.
No exact NAE1 row was present. The production adapter returned `not-found` for NAE1 and `ready`
for PTEN (`HGNC:9588`), sharing the same validated response and provenance. That supports the
NAE1 empty lookup, not a conclusion about copy-number tolerance or this missense variant.

Adapter snapshot retrieved at 2026-10-16T19:06:44.032Z; SHA-256:
`cb6ac53fabfcc68281d424769c13af1df75a05ea21c3cf4383843fa5bf819701`.
The raw response and adapter results are retained in ignored `scratch/clingen-dosage-live.json`
and `scratch/clingen-adapter-live.json`. These are verification artifacts, not shipped fixtures.

## Confirmed defects and corrections

- **Misleading diagnostics:** every HTTP, transport, timeout, parsing and completeness failure said
  "did not return a complete, valid dosage table." The adapter now distinguishes those failures;
  each explicitly says that curation availability could not be checked.
- **False negative on an invalid identity:** a matching symbol with an unusable HGNC identifier was
  filtered away before absence was decided. Exact matches are now checked first; ambiguous duplicates
  or invalid gene identifiers return an error instead of `not-found`.
- **Contradictory payloads accepted:** `ready` with a null record could become a negative lookup.
  The shared response schema now enforces status/record consistency and exact symbol/HGNC identity.
  The pure model also rejects malformed legacy records rather than manufacturing absence.
- **Initial inspector mismatch:** an unrequested dosage slot had a Running label but a `no-result`
  machine state. It now uses `loading`, so main panel and inspector agree before the first request.
  Completed missing snapshot reads also use the same label/state vocabulary consistently.
- **Cold request recovery:** the table read now uses the shared retry client, with at most two
  transport attempts under one 30-second deadline, below the frontend's 40-second timeout. Shared
  rate-limit/refusal policy remains authoritative. Invalid or incomplete bodies are not retried
  automatically and never enter the table cache. Concurrent genes still share one request.
- **Unclear empty-lookup provenance:** the empty message names the exact gene and complete source
  table. The tab shows its retrieval date when supplied. Loading has a gene-specific explanation
  and an accessible busy state; retry is unavailable while a read is active.

## Other paths reviewed

Disease selection stays explicit and is usable while dosage is pending or failed. Validity,
Mechanism and Variant context remain reachable independently of dosage success. Pins, category/view
state, exact disease matching, source links and reference disclosures retain their existing contracts.
No missing dosage is converted to score zero, no alias matching is introduced, and no criterion is added.

## Verification

- Seven focused files: **107 passing tests**. Adapter tests cover incomplete tables, HTTP/transport
  failures, retry recovery, concurrent/cache sharing, genuine absence, invalid identifiers and
  duplicate identities. Hook/model/component tests cover malformed responses, coalesced retries,
  state agreement and disease review during a dosage failure.
- `npm run lint` passed (architecture, focus indicators, verification parity and TypeScript).
- `npm run build:client` passed with the existing large-chunk advisory.
- Existing `tests/gene-disease-workspace.e2e.ts` passed at desktop/tablet/phone widths in both themes.
- New `tests/gene-disease-dosage-recovery.e2e.ts` passed through the real UI and hook: pending request,
  usable disease review, provider error, explicit retry, synchronized loading, then a verified empty
  result with retrieval date and no residual error. This uses controlled, explicitly illustrative
  provider responses; live NAE1/PTEN verification is the separate adapter check above.
- Full suite: **418 files passed, 2 skipped, 1 failed; 5,318 tests passed, 5 skipped, 1 failed**.
  The failure is outside this chain: `server/services/infra/admission.test.ts:122` received null for
  `peak_rss_bytes` instead of a numeric memory measurement. No test was weakened or skipped.
  Its isolated rerun passed all 13 tests; the full-suite run remains recorded as failing.
  Full-suite log: `scratch/gene-disease-full-suite.log`.
- Browser evidence: `.e2e/proof/gene-disease-dosage-audit/` and
  `.e2e/proof/gene-disease-dosage-recovery/`. Error and recovered-state screenshots were inspected.

These changes are local. PR #137 is already merged; this audit does not claim a deployment or
modification of that merged PR. The exact original deployed failure remains unknown without its logs.
