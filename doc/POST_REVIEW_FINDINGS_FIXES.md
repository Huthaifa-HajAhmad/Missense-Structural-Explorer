# Follow-up fixes for the multi-dimensional review

16 October 2026. Implements the eight findings from the working-tree review after `ab501f6`.
Changes are local, with existing unrelated edits preserved. No dependency, scoring-policy,
benchmark-action or index-policy change is included.

## Decisions and regression coverage

1. **Energetics coverage sentence.** The returned-engine count excludes reference-only readings,
   matching the intended-engine denominator. A ProtVar cross-check remains visible without creating
   a seventh engine. `src/shared/__tests__/energeticsEvidence.test.ts` verifies six returned values
   plus a reference reading still produces "6 of 6".
2. **Legacy dbNSFP stores.** On opening a store, the ingest tool inspects its actual schema and adds
   missing genomic/transcript identity columns in one transaction. Existing scores and metadata are
   retained; unknown identity fields in old rows stay NULL. This also works for `--indexes-only` and
   repeated opens. `tools/ingest_dbnsfp.test.ts` exercises both upgrade paths with old and new rows.
   The unused `(pos, ref, alt)` index is not restored; indexes used by the reader remain present.
3. **Ensembl version verification.** An explicitly versioned protein accession requires an equal
   returned version. A response lacking the version is unverified, rather than accepted as the current
   sequence. `server/services/translation/protein-numbering.test.ts` covers the missing-version case
   alongside existing matching/mismatching-version tests.
4. **Short replacement acceptance.** The exported genomic/cDNA regexes accept single-base
   substitutions only. `isSupportedGenomicHgvs` and `isSupportedCdnaHgvs` additionally accept
   replacements only when the replaced span and inserted sequence have the same length (2 or 3).
   Coordinate arithmetic is checked in one helper, including positive safe-integer positions.
   VEP still must confirm the protein consequence. Shared grammar and translation-route tests cover
   supported forms, unequal spans, reversed/zero ranges and rejection before provider requests.
5. **Diagnostic-body privacy.** `redactRequestBody` is the shared capture boundary for JSON and form
   data. Credential-looking fields are redacted after decoding form keys; duplicate form fields are
   preserved. Malformed, opaque, oversized and binary bodies are omitted. Form format is recorded in
   optional diagnostic metadata, so cURL exports use the correct content type; historical entries
   retain the existing JSON default. Redaction and export tests verify that secrets cannot survive
   into captured metadata or copied requests.
6. **Mixed ClinVar records.** A VCV containing both an SNV and a non-SNV is refused with an explicit
   mixed-record explanation and exact-coordinate guidance. Candidate coordinates remain available,
   without claiming that the entire record contains only one variant. Identifier-intake tests also
   confirm this ambiguous answer is not cached as a unique SNV.
7. **ProtVar reference residue.** Missing `wildType` is an unverifiable provider response, not a
   biological absence and not a license to accept the value. The adapter raises a provider error;
   it does not cache that error as a month-long negative lookup. Tests cover omitted/null/empty
   reference residues and successful recovery on the next valid response. Genuine residue
   mismatches retain their existing refusal behavior.
8. **Shared genomic parsing.** The translation route uses `parseGenomicNotation` for chromosome,
   position and alleles. Its route-specific conversion to genomic HGVS remains local. Tests retain
   accepted spellings and confirm invalid chromosomes/positions do not reach providers.

The rejected ClinGen-link finding remains rejected; the existing curation link is retained. The
benchmark's explicit Run action and secondary fill-form action remain intentional product behavior.

## Validation

- Initial focused run: 9 files, 267 passing tests.
- Additional route/export regressions: 3 files, 102 passing tests.
- `npm run lint` passed: architecture boundaries, focus indicators, verification parity and TypeScript.
- `npm run build` passed, and the final client rebuild after the form-format metadata change passed.
  Vite retains its existing large-chunk advisory.
- Final full suite on the completed code: **420 files passed, 2 skipped; 5,341 tests passed, 5 skipped**.
  No test was weakened or skipped to obtain this result. The earlier run overlapped the final cURL
  edit and failed against mixed module versions; the completed-code rerun supersedes it.
- Final full-suite results are recorded in `scratch/review-findings-full-suite-final.log`; build output is in
  `scratch/review-findings-build.log` and `scratch/review-findings-client-final.log`.

Validation covers unit/component/route contracts and real SQLite CLI invocations, including compressed
and streaming ingest cases in the existing test file. It does not claim new live provider analyses,
deployment, or an end-to-end browser session for this follow-up.
