# Report tab and inspector review

Updated 7 October 2026. Reference: supplied SOD1 p.Ala5Val screenshots. Browser and Office verification used a clearly labelled synthetic fixture, not a recovered clinical payload.

The Report remains a rendering of the engine record and shared Insights evidence. It does not calculate an independent clinical verdict.

## Findings addressed

| Area | Result |
|---|---|
| Scientific policy (A1/A2) | PM2 reasons describe a local pLI-based ceiling, not dominant/recessive inheritance. Computational evidence explicitly distinguishes the Supporting multi-tool vote from published per-tool calibrations. Both limitations travel with exports. Ceiling selection, voting membership and classification arithmetic are unchanged. |
| Narrative and provenance (A3) | Automated classification, source ClinVar assertion and unverified AI interpretation have distinct labels. ClinVar condition, review status and evaluation date are structured facts. Summary freshness uses the same deep-evidence context as the inspector and carries warnings into exports. |
| Export scope (A4) | Full evidence bundle is separate and explicitly ignores report filters. Report exports honor selected populated sections; JSON includes verdict, annotations, warnings and references. |
| Scientific readings (A5/A6) | Predictor table carries units, role, direction, calibration source, served-model notes and caveats. ESM1b remains informational despite published calibration. Stability contributes mechanistic context without implying disease direction. SpliceAI BP4 includes the published 0.10 boundary; splicing remains uncounted by this engine. |
| Duplication | Met/withheld criteria appear first; all checked criteria are available on request. Long recorded bases and methods use disclosures. Sequence-model scores are listed once. Identical numbering and repeated masthead identity are suppressed. |
| Editing (E1-E3) | Save and Cancel operate on local editor text. Blank edits remain blank. Fingerprints include structured evidence, not only generated sentences. Stale edits have a comparison and explicit keep/reset actions. Storage reports saving/saved/session-only, flushes to the old identity on rapid switching, and isolates resolved reference context. |
| Portable drafts | Save/reopen uses a bounded, validated versioned envelope bound to variant/reference identity. Malformed storage cannot populate invalid document fields. Browser persistence is still a convenience, not a signed record. |
| Content identity (C1) | Canonical content identifier includes annotations, warnings, stale state and selected document content. It excludes export timestamp and file formatting and does not claim to verify arbitrary file bytes or authorship. |
| Office parity (C2) | Word preserves warnings and native hyperlinks. PowerPoint is labelled a summary deck; complete selected blocks, facts, tables, warnings and sources are in speaker notes. Visible excerpts state when text continues there. |
| Inspector/UI (C3/U1-U3) | Brief replaces the unsupported One page promise. Populated exportable counts, grouped contents, active-section navigation, clickable native checkboxes, larger hit areas, sticky format/export controls, specific review links, real save/export-request state, expandable provenance and secondary diagnostics replace the long flat rail. All layout classes belong to Report. |
| Coverage and sources | Method states that gene-disease validity, expression and regulatory evidence are not reproduced. Literature and method links are preserved with safe HTTP(S) URLs. Structure reads link to their named view. Run ID and configured versus actually returned datasets are distinguished. |

## Scientific decision and effect on reference variant

The owner was asked whether to retain the engine with truthful policy labels or change inheritance and computational aggregation policy. No replacement policy was selected during implementation. The conservative implementation preserves criterion counts and the recorded tier; it does not choose a strongest predictor retrospectively. For the supplied SOD1 screenshot, PP3 and PM2 remain Supporting and the automated tier remains VUS. A separate ClinVar assertion or AI narrative does not replace that tier.

The SpliceAI boundary correction affects the informational reading at exactly 0.10, not the engine classification. The supplied 0.14 stays between cutoffs. Mechanistic stability context has no assessed clinical direction.

## Validation

- Full Vitest suite: 4,173 passed, five skipped (327 test files passed, two skipped).
- After final evidence-context wiring: five focused Report/copy/draft suites, 59 tests passed. Lint, architectural boundaries, focus indicators, verification parity and TypeScript passed.
- Frontend production build passed. Standard server output failed with Windows Access is denied; identical server bundling to temporary stdout succeeded. No build-policy workaround was committed.
- Office package inspection verified evidence annotations, full tables, DOI references (native relationship links in Word), and all 300 sentences in a long author-notes fixture.
- AO browser reported no page errors. Measured narrow main width approximately 409 px and inspector width 276 px: zero horizontal overflow and no checkbox targets below 24 px. Repeated at 200% CSS scaling in dark mode with zero report/rail overflow; light mode also passed the narrow measurement. This is geometry verification, not browser-zoom or screenshot approval.

## Remaining limits

- Choosing a disease-specific frequency policy and a pre-specified calibrated computational policy requires the owner's decision and new engine fixtures. Current local policies are disclosed, not clinically validated by this work.
- Browser screenshots require the session Browser panel to be visible; captures timed out while it was hidden. Pixel-level light/dark review, contrast measurement and saved-PDF/Office pagination remain unverified. Package/content and DOM geometry checks do not establish visual pagination.
- Configured data releases are not asserted as independently verified per-run versions. Missing retrieval dates are not invented. The original complete analysis payload was not supplied, and no fresh variant classification was performed.

## Draft integrity follow-up

Two native-review P2 findings were reproduced and addressed without changing scientific criteria or classification arithmetic.

| Finding | Correction |
|---|---|
| The reference key read `metadata.transcriptId`, which is not the typed selected transcript field. Different transcripts could share persisted drafts and portable file identity. | `reportDraftKeys` reads `result.transcriptId`, falling back to `predictorData.transcriptId`. Browser persistence and portable export/import call that one helper. Drafts for different selected transcripts are distinct and cross-transcript file imports are rejected. |
| Hydration replaced legacy or pending author work with defaults when a matching result introduced a reference suffix, including a meaningless all-null suffix. | All-null references retain the unresolved key. Legacy and earlier missing-transcript keys migrate once, retiring their source only after saving the destination. Pending edits, section choices, metadata and citations survive reference resolution and compatible refinement, including blocked-storage cases. |

If a resolved reference already has a different saved draft, both copies remain available until the author chooses. The inspector offers downloads of both copies and explicit Keep current / Use saved actions. Pending conflict copies are themselves bound to the resolved reference so changing transcript or remounting cannot reuse them under another transcript.

Validation: 24 focused draft/inspector tests passed. The final full suite passed 4,201 tests with five skipped; lint/TypeScript and frontend build passed. Both geometry suites passed (116 header and 241 function-track assertions). A concurrent build/test run hit two coordinate-resolver timing failures; the isolated 35-test suite and full rerun without a competing build passed. Narrow recovery UI measurement found no horizontal overflow at 409 px main / 276 px rail, all four recovery controls met the minimum hit area, and Use saved draft restored the saved title in the live page. Dark mode at 200% CSS scaling also had zero report/rail overflow and four correctly sized recovery controls. Pixel-level screenshot approval is not claimed.

## Primary sources

- Richards et al. 2015, DOI [10.1038/gim.2015.30](https://doi.org/10.1038/gim.2015.30).
- Pejaver et al. 2022, DOI [10.1016/j.ajhg.2022.10.013](https://doi.org/10.1016/j.ajhg.2022.10.013): per-tool calibration and pre-specified predictor guidance, not validation of the app vote.
- Bergquist et al. 2025, DOI [10.1016/j.gim.2025.101402](https://doi.org/10.1016/j.gim.2025.101402): expanded computational calibrations including ESM1b.
- Walker et al. 2023, DOI [10.1016/j.ajhg.2023.06.002](https://doi.org/10.1016/j.ajhg.2023.06.002): spliceogenicity cutoffs at or above 0.20 and at or below 0.10.
- [gnomAD constraint documentation](https://github.com/macarthur-lab/gnomad-docs/blob/master/docs/gene-constraint.md): pLI concerns truncating-variant constraint. It does not by itself establish disease-specific inheritance.
