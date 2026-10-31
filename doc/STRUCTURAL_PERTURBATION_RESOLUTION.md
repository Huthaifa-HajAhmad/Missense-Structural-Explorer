# Structural perturbation: checked findings and provider decision

Investigation: 2026-10-29. Second increment and provider decision: 2026-10-30 (below). The sections after "Corrections to preliminary findings" are the audit trail; where they differ from this section, this section is current.

## ESM-2 decision (2026-10-30, owner-approved)

The screenshot's failure was HTTP 402 (no Hugging Face inference credits), not an expired token. ESMFold succeeds because it uses a different provider chain.

**Decision: on a host without a GPU, the ESM-2 card runs genuine ESM-2 650M (`facebook/esm2_t33_650M_UR50D`, pinned revision) on the server's CPU.** Hugging Face stays an optional first tier when a token is saved. VESM-150M serves the card only if genuine ESM-2 cannot load, and the card then names VESM as the model that ran. Setting: `ESM2_CPU_MODEL` (`facebook/esm2_t30_150M_UR50D` for a smaller host; `vesm` restores the old route).

Measured on the 2-OCPU production VM, in a dedicated container, 2 threads (forward pass, seconds):

| Residues | ESM-2 150M | ESM-2 650M |
|---|---|---|
| 300 | 1.6 | 6.7 |
| 600 | 3.7 | 14.3 |
| 1,022 | 7.0 | 25.3 |

A new variant needs three passes (one masked pass for the score, two unmasked passes for the embedding shift); another allele at the same site needs one, because the masked and wild-type passes are cached. The two embedding passes run only if they can finish within `ESM2_EMBEDDING_BUDGET_S` (90 s from the request's arrival; the Node layer allows 120 s). Otherwise the score is returned complete and the card says the shift trace was skipped for time. The pinned 650M weights were placed in the production `missense_resolve_hf_cache` volume, which persists across deployments; a cached, offline load took 0.2 s. At startup the sidecar downloads the weights in the background, outside the model lock, and loads them; until they are on disk the ESM-2 card is served by VESM-150M and says the weights are still downloading. Measured peak memory (650M, 1,022 residues, all three passes, 2 threads): 2.95 GB. The VM has about 6 GB free, so ESM-2 650M with the default SaProt 35M fits; two 650M models at once would not leave much room (`MAX_LOADED_MODELS` stays 2).

Alternatives checked and rejected for now:

- **BioLM ESM-2 650M:** the TLS handshake to `biolm.ai` failed from the development machine and from the production VM on 2026-10-30 (and earlier). The SDK (`py-biolm`) shows the endpoint pattern and `Authorization: Token` header, but no response schema could be retrieved, so masked-position logits are unverified. Revisit only after a successful reachability and schema check.
- **NVIDIA ESM-2 650M:** marked deprecated (24 Aug 2026, now past) and returns embeddings only, so it cannot score a variant.
- **Hugging Face:** free accounts receive no inference credits; the route remains for users who add credits.
- **JapanFold:** lists ESMC and SaProt, not ESM-2.

KL divergence is not reported on any language-model path (ESM-2, SaProt, ESMC). Masking the site in both alleles gives one input, so the site KL is 0 by construction; an unmasked site KL measures the model copying the residue it can see. A neighbour-residue KL could be computed from existing passes but has no published interpretation, and the embedding shift already answers the same question.

## Implemented and verified (2026-10-30, second increment)

Correctness and contracts
- ESM-2 local scoring uses the masked site; embedding shifts use separate unmasked passes. The regression test fails if the mask is removed (checked by reverting it: 3 failures).
- Remote amino-acid distributions are normalised over the 20 residues only; incomplete or invalid ones raise `InvalidProviderResponse` instead of being padded.
- Every ESM-2 result records `checkpoint` and `scoringMethod` ("masked-marginal"). The client bundle cache moved to v4.9, so stored bundles from the old unmasked path are dropped. A result restored from anywhere else carries no `scoringMethod`, and the model details then say "not recorded by this engine". Changing `ESM2_CPU_MODEL` does not invalidate stored bundles: re-run the analysis to score with the new checkpoint.
- ESMC and SaProt no longer report a missing embedding-shift mean as 0 (shared `parseShiftWindow`).
- Every model router returns `remoteFailure: {provider, code}` with code billing, auth, region, rate-limit, timeout, invalid-response or unavailable. The tab words the cause from the code; it no longer matches words in error text. Raw provider errors stay in Engine notes.
- ESM-3 remote scores drop the start and end tokens, so score i is residue i + 1 (it was offset by one). When VESM stands in for ESM-3 it now supplies cosine distance over its whole window, the metric the slot is labelled and drawn in (it supplied Euclidean distance over ±10 residues).
- The mutant structure's method is recorded (`mutantModel: "foldx-buildmodel"`), so "fixed backbone" is stated rather than inferred from a zero RMSD.

Interface
- Every sentence, heading and selector names the model that actually produced the numbers (`LmReading.name`): a stand-in is named, never credited to the card's family.
- One model selector (the strip); the residue detail names the served checkpoint.
- Packing & geometry states the build method and the input structure's pLDDT at the site (shown only when the structure is an AlphaFold model; an experimental entry's B-factor is a temperature factor), flags low-confidence regions, and adds reference/mutant clash counts and lost/gained contact counts as labelled figures. Plotted readings are not repeated in the table; empty scale cells carry no filler text.
- Sequence embeddings: the unsourced drift bands are removed; the ruler marks only the variant residue. The profile shows gaps for unmeasured residues, an accessible exact-value table, and correct axis labels.
- The language-model primer appears only where the language models are shown; its example odds are neutral. Callouts read as complete sentences.

Validation
- `npm run lint` (boundaries, focus indicators, verify parity, `tsc`): passed.
- Full Vitest: 466 files, 6,031 passed, 5 skipped, 3 failed under full-suite load (two 20 s timeouts in `verify-parity.test.ts` and `ContextualCoverage.test.tsx`, one memory measurement in `admission.test.ts`), none in a changed file. Rerun alone, the three files passed (59 tests).
- Python model-server, resilience and ESM-2 scoring suites: 66 tests passed.
- Browser fixture check (`scratch/perturbation-browser.mjs`, headless Chromium): all three views, light and dark, 1500 and 800 px; no browser exceptions, no `NaN`, no second selector. Screenshots in `scratch/perturbation-proof/` were inspected. These are fixture checks, not live inference.

Not done in this increment
- Not deployed: production runs the previous code until the next deployment (the 650M weights are already in place there).
- No live end-to-end run on the VM with the new router; latency figures above are per-pass measurements.
- A residue contact map needs pair-level contact data the structural comparison does not produce; only counts are drawn.
- Hosted ESMC (Forge) now sends a masked sequence ("_" is the SDK's mask character, replaced by `<mask>` in `tokenize_sequence`), but no Biohub token was available, so that request was tested against a fake client only. If the service rejects it, the request fails visibly and VESM (masked) serves, named as such.
- Local SaProt masks the whole residue/3Di pair (`<mask>`), as the remote path already did. SaProt's authors keep the 3Di state of the masked residue (`#` + state); that variant was not compared.
- JapanFold tier-1 results carry no `scoringMethod`; the model details say so.

## Independent review of this increment (2026-10-30) and what it found

A four-reviewer pass (Python scoring, TypeScript adapters and evidence logic, interface, plan conformance) reported 35 distinct claims. Each was checked against the code before any change. Result: 27 confirmed as stated (77%); 7 real but overstated or already harmless (20%); 1 not a defect (3%). Counting real issues of any size: 34 of 35 (97%).

Not a defect: "repeated rank prose survives in two places". The rank sentence appears once on screen (it qualifies what a rank means); the second place is the inspector's record, which is meant to carry the detail.

Real but overstated: the headline figure "1 of 3" is a true count, not a majority claim (it was uninformative for a split, now shown as "Split" with the breakdown); the ESM-2 masked pass is not deadline-checked by design (the score needs it; the hosted try and the embedding passes are); the legacy "RMSD 0" rule only withholds a measurement (its wording no longer asserts a method); the at-site value was discarded without a window but nothing displayed it; a CSS margin rule was out-ranked but margins collapse to the same gap; cache identity across a checkpoint change is a design limit (documented above); the memory/eviction concern applies only when two 650M models are selected.

Fixed because of it: SaProt (local) and ESMC (hosted) now score the hidden residue; the SaProt stand-in for VESM receives the full protein and positions; SaProt's hosted tier has a timeout and refuses incomplete distributions; failure states and the unauthorized/timeout/offline wording come from the status code the adapter set; JapanFold fields that were not returned stay absent; ESM-3 reports real coverage and does not cache a stand-in; provenance is never defaulted to the requested family; the ESM-2 hosted try runs on a clock and is skipped when the request has waited too long; the first-run download no longer blocks other model loads or user requests; tokenizer and vocabulary mismatches are refused; the headline figure, peak chip, ruler label, step list and profile text were corrected; the inspector names rows by the model that ran and has records for the FoldX readings and the embedding reading; pins say which view they came from; the preview shows the new Packing content and a GATA4 stand-in case.

## Corrections to preliminary findings

- Duplicate VESM fallback checkpoints are already deduplicated in the headline by `deduplicateServedModels`. Do not report absent deduplication as a defect.
- Local thresholds are already labelled app-defined/unsourced and drawn distinctly. The recommendation concerns their prominence and scientific usefulness, not missing disclosure.
- Fallback identity is already disclosed. The remaining issue is that requested-family headings still dominate the actual serving identity.
- No claim is made that the reported GATA4 fallback score came from the defective local ESM-2 GPU branch: that branch did not serve the screenshot.

## Confirmed implementation findings

High: `tools/model_server_app/routers/esm2.py` masks remote input but computes local ESM-2 residue preference from the unmasked reference pass. Keep unmasked passes for embedding differences; add a distinct masked pass for preference scoring. The methods must not share an unqualified masked-marginal label.

High: the remote ESM-2 adapter inserts 1e-9 for omitted amino acids and then computes rank and entropy. This can turn incomplete provider output into a complete-looking distribution. Reject incomplete canonical logits/probabilities or explicitly return unavailable dependent metrics.

Medium: `server/services/external-api/esm2.ts` initializes localEmbeddingShift to zero when no shift window exists. Preserve absence instead of returning a measured-looking zero.

## Model comparison

Checked `PerturbationTab`, `ResidueDetail`, `PerturbationRail`, `perturbationEvidence`, `perturbationModels` and related styles.

- Requested-family card headings persist when another model serves the values; make actual model identity primary throughout figure, detail and inspector.
- Fallback callouts repeat full remote exception text already present in engine disclosures. Show a concise reason/action, preserving detailed diagnostics in one disclosure.
- ReadingPrimer is hidden when the normal evidence workspace is enabled. Provide short, visible guidance for reference-versus-variant preference.
- Duplicate model selectors and repeated rank prose compete with the distribution. Consolidate selection while preserving keyboard access and explicit pinned-reading state.
- The embedding trace uses a 300 by 120 viewBox with width 100% and auto height, scaling its typography with panel width. Use bounded chart dimensions and legible independently sized labels.
- Do not turn directional agreement into independent clinical evidence. Existing code excludes these scores from its informational PP3/BP4 contribution.

## Packing & geometry

- The language-model hero is unconditional, preceding this subtab too. Replace it here with a physical-model summary, available measurements and model limitations.
- Most rows have no threshold but still reserve scale and reading columns. A value/unit/explanation layout would use this space better.
- Preserve the existing distinction between FoldX energy components and total stability; preserve the paired-wild-type versus pre-repair-template RMSD qualification.
- Preserve the existing withholding of rigid-backbone C-alpha displacement. The current rigid flag is inferred from exactly zero RMSD; explicit method provenance would be stronger than inferring method from a numeric result.
- Treat zero changes as model output, not evidence that the protein is unaffected. Input structure confidence should accompany structural interpretation.

## Sequence embeddings

- The same language-model hero and fallback warning displace the ESM3-specific question.
- Existing code correctly distinguishes maximum drift, site drift and distance from the variant; retain this distinction prominently.
- Existing ESM3 computation uses cosine distance; the comparison subtab's local traces use Euclidean distances. Explain these separately, with no shared magnitude interpretation.
- Site pLDDT is already explicitly described as input-structure confidence, not ESM3 confidence. Preserve this safeguard.
- The unsourced 0.08/0.22/0.38 marks add visual classification without validated outcome meaning. Recommend neutral numeric presentation and a positional profile; this is a presentation recommendation, not a discovered clinical threshold error.
- A pinned language-model reading remains visible across subtab switches by design. Label retained selection clearly instead of silently resetting it or presenting it as the new subtab's context.

## Verification and remaining work

Passed 43 tests in four files: perturbationEvidence.test.ts, PerturbationTab.test.tsx, external-api/esm2.test.ts and external-api/esm2-credentials.test.ts. These test existing behavior, not live provider inference or visual quality. No application files changed in this investigation. No new browser/render verification performed. Full backend geometry audit, authenticated provider parity, implementation and light/dark/narrow subtab verification remain outstanding.

## Reconciled remediation plan (owner steering, 2026-10-29)

This section governs sequencing and provider selection where earlier provisional recommendations differ. Read together with `PERTURBATION_REVIEW.md` (including its later direction/odds correction) and `MOLECULAR_WORKSPACES_REVIEW.md`. Preserve all three categories, especially Packing & geometry. Do not restore the retired composite, rank-led conclusions, fake progress, missing-as-zero values, clinical colour bands, or pooled model scores.

### Provider decision after additional retrieval

The BioLM guide at https://biolm.ai/guides/esm2-api/ loaded successfully and demonstrates ESM-2 650M encoding. Both detailed model-page hosts timed out via web retrieval and failed with SSL EOF via direct Python HTTPS. The guide's Postman link timed out and its SDK link returned 404. Earlier indexed model documentation describes prediction logits, but this is not a successful endpoint test. BioLM therefore remains the leading documented candidate, not a validated default or a reliability recommendation. The accessible encode guide alone does not prove the predict response contract.

Decision: repair provider-independent correctness first; keep existing provider selection until a candidate passes authenticated contract/parity tests. Distinguish 401/403 credentials or permissions, 402 billing, 429 throttling, timeout, unsupported capability and invalid response. Recovery should target the failed model, retain successful results and respect credential-scoped refusal handling. No automatic paid-provider activation. A replenished HF account can address the recorded billing refusal but must still pass response validation. Local genuine ESM-2 needs a measured resource/latency budget before replacing VESM. VESM remains explicitly identified when it serves a result.

### Reconciliation ledger

- Confirmed current defects: local ESM-2 masking mismatch, incomplete remote probabilities filled with a floor, missing local mean shift initialized to zero, normal-workspace primer hidden, unconditional language-model hero across subtabs.
- Existing safeguards to retain: fallback deduplication, local-mark disclosure, direction rather than rank as the main preference, absence states, paired FoldX reference qualification, withheld rigid-backbone displacement, input-confidence distinction, pin persistence and explicit-reveal focus behavior.
- Presentation recommendations, not scientific defect claims: reduce repeated prose and selectors, replace sparse table columns, demote arbitrary drift bands, improve actual-model prominence and chart sizing.
- Historical follow-ups requiring current-code recheck: SaProt 3Di mapping and probability marginalization; ESM3 BOS/EOS and crop/residue mapping; shell floating-control overlap. A distant embedding peak is not proof of an indexing bug. Do not presume the largest response must be at the variant.
- Current geometry concern requiring provenance audit: exactly zero RMSD is used to infer rigid-backbone behavior. Do not infer a method solely from its numerical output.

### Subtab design and visual contracts

Model comparison answers: Which amino acid does each actual model prefer? Use concise actual-model cards, one active-model selection and an accessible probability figure. Keep the 0–100% probability scale, explicit reference/variant labels, tiny-value precision, complete distribution access and exact inspector records. Never imply disease probability or independent votes. Diagnostics belong in one disclosure with a concise recovery action. Keep Euclidean embedding traces clearly labelled and bounded in height.

Packing & geometry answers: What changed in the FoldX mutant model relative to its matched reference? This remains a first-class subtab with its own summary, reference model, structure confidence, run/method status and dedicated visuals:

1. Separate zero-centred energy-component dot plots, labelled kcal/mol and mutant minus reference. VdW and electrostatics may share a unit but must not become a composite or stand in for total stability. Show exact small values; never attach total-ddG uncertainty to component values.
2. Reference/mutant clash-count comparison when both counts exist; gained/lost contact counts as separate labelled quantities. Zero is visible and missing has no plotted marker.
3. A residue contact-change strip only when verified residue identifiers, chain/mapping and pair-level changes exist. Current shared readings expose counts, not a sufficient graph. Do not fabricate spatial positions or a molecular network from aggregates.
4. Neighbour side-chain RMSD and SASA delta as compact measurements with their own units/reference explanations; no forced shared axis. SASA change is not automatically a burial change.
5. Rigid-backbone limitation beside the geometry figure. Displacement stays unavailable when the method cannot measure it. Link to existing 3D inspection only if structure-pair and residue selection can be carried accurately; no new decorative 3D viewer.

Sequence embeddings answers: Where did the model representation change? Use a measured residue-position profile with the variant and maximum marked separately; expose site value, peak value, distance to peak and evaluated coverage. Distinguish cosine distance from other subtabs' Euclidean distance. Show cropped/unsupported positions as gaps. Preserve exact records and input pLDDT context. Remove unsourced bands from the primary visual without changing shared engine rules. Keep retained pins visibly labelled with their originating view.

All figures need keyboard and pointer parity, named controls, exact-value text/table alternatives, stable reading keys, visible focus, responsive typography, light/dark contrast and no implicit focus jumps. Scope the trace to the active scientific question while preserving explicit pinned records. Never use new visuals to invent measurements.

### Implementation sequence and bounded file map

1. Baseline and reproduce. Inventory current changes; read all files for each bounded batch before edits. Add meaningful fixtures for GATA4 Ser159Cys, existing NAE1/SLC12A4 cases and missing/failure states. Capture current three-view behavior. Existing 43 passing tests are baseline only.
2. Correct computation and contracts. Scope: ESM-2 router, model loader only if routing requires it, external-api adapter and associated Python/TS tests. Validate unknown provider values once at the owning boundary; use typed values inward. Preserve full-coordinate mapping and independent optional embedding availability. Record scoring method/checkpoint; prevent corrected results from sharing cache identities with legacy unmasked results. Mark legacy method provenance unknown where it cannot be recovered.
3. Upgrade the shared evidence model, then three views and rail. Scope: perturbationEvidence/perturbationModels, PerturbationTab, perturbation/ResidueDetail and focused new visual components, PerturbationRail, perturbation.css, their tests. Inspect molecularWorkspace and geometry producers before extending those contracts. Extend existing reading/selection contracts rather than creating parallel stores or parsers. Preserve existing external consumers and old payload readability with explicit unknown states.
4. Validate provider candidate separately. Reconcile live BioLM API schema, auth, billing and capabilities; obtain credentials through the secure secret flow if needed. Test fixed public sequences against the same checkpoint and scoring convention. Record numerical tolerances, latency, crop policy and optional feature support. Add a governed adapter/settings path only after feasibility is established; keep activation reversible. If candidate fails, report it and retain the correctly labelled working route.
5. Verify and document. Run targeted regression tests after each completed edit batch and again after fixes; run required lint/type checks, full Vitest and relevant Python suites at integration. Drive all subtabs in the real wrapper at wide/narrow sizes, light/dark, keyboard-only, with pin retention, view switching, settings recovery, partial results and failure fixtures. Live inference parity is separate from fixture UI verification. Update translational coverage and this audit with actual results, not planned claims.

### UX, DX and AX acceptance

UX: an unfamiliar researcher can identify the question, serving model, reference, meaning, limitation and next action without opening several disclosures. Packing & geometry remains visible and useful even when language models fail.

DX: one evidence model shared by view and inspector, typed provider contracts, explicit units and methods, stable cache identity, isolated provider adapters, no unnecessary dependencies or single-use helper proliferation. Keep UI state independent of scoring.

AX: deterministic offline fixtures; accessible labels and stable reading keys; structured redacted failure codes and provenance; documented commands and test artifacts; clear distinction between mocked, local and live-provider verification. Agents must be able to reproduce failures without tokens or scraping exception prose. Do not expose credentials through diagnostics.

Release gates: preserve classification outputs and existing navigation; no provider activation without live proof; no geometry graphic without verified source fields; no claim of completion without passing relevant tests and rendered checks. Retain reversible changes and record any unrelated baseline failures. Zero regressions is a goal to test, not a guarantee.

## Source links

- https://huggingface.co/docs/inference-providers/en/pricing
- https://huggingface.co/facebook/esm2_t33_650M_UR50D
- https://github.com/facebookresearch/esm/tree/main/examples/variant-prediction
- https://landing.biolm.ai/models/esm2-650m/
- https://landing.biolm.ai/models/
- https://build.nvidia.com/meta/esm2-650m/experience
- https://japanfold.aiand.com/docs/models-and-limits/
