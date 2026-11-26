# Technical Limitations & Constraints — MissenseResolve®

This document details the boundaries, performance limitations, dependency constraints, and environmental requirements of the application.

---

## 1. Biophysical Mutant Modeling Constraints (`/api/v1/generate-mutant`)

### 1.1. Single-Site Coordination Substitution
The biophysical mutant model builder is designed specifically for point mutations (single-site substitutions). It performs a focused side-chain modification on top of the native AlphaFold 3D template coordinates.
* **Online/production Mode**: Integrates FoldX calculations to perform localized side-chain energy minimization, but does not execute exhaustive full-protein backbone reconfiguration or heavy molecular dynamics (MD) solvent trajectories.
* **Removal of Offline Fallbacks**: The application no longer performs offline/fallback side-chain mutations or labels when FoldX is unavailable on the server. If biophysical tools fail or are unconfigured, a structured error (`503 MODELING_UNAVAILABLE`) is propagated to the client. The backend expects a local FoldX Windows executable `foldx_1_20270131.exe` (or path configured in `FOLDX_BINARY`) placed inside `tools/foldx/` and copies its `molecules` parameter folder to the job workspace before execution.

### 1.2. Hetero-assembly Constraints
Both AlphaFold reference structures and mutated models operate on single-chain, translated monomer structures.
* Critical bound co-factors (e.g. tetrahydrobiopterin (BH4) in PAH, heme groups in hemoglobin, ATP, or nucleotide sequences) are not dynamically re-docked. Researchers must refer to native experimental multi-subunit structures to confirm structural interactions with ligand molecules.

### 1.3. Clash Counting and Crystal Interface Limitations
While steric clash counting is calculated globally across the superposed structures, the contact and hydrogen-bond difference metrics focus specifically on the mutated residue's local neighborhood. Additionally, global clash counting ignores inter-chain contacts (except beyond a ±1 residue local sequence exclusion window). This can occasionally lead to an overrepresentation of clashes at crystal packing interfaces in multi-chain context files.

---

## 2. EMBL-EBI AlphaFold DB API Integrity

Our application relies on fetching 3D atomic structures dynamically from the AlphaFold Database. EBI prediction endpoints are subject to version deprecations and CDN updates:
* **The Version Slideway**: When querying direct PDB downloads, the version identifier can shift (e.g. from `v6` down to `v1`) and include various isoform suffixes (such as `-F1` to `-4-F1`).
* **Our Solution**: The backend queries the official EMBL-EBI Prediction API to get the mapped structure path first, failing fast on 404. If that lookup fails, it falls back to a cascade that iteratively checks combinations of common isoform suffixes and file versions (v6 down to v1).
* **Third-Party Rate Limits**: High-frequency bulk queries directly to upstream APIs (EBI, ClinVar, Ensembl, MyVariant, STRING) may trigger occasional HTTP 429 rate-limiting blockades. The application implements automatic fetch retries with exponential backoff and caches resolved UniProt mapped records inside the active memory session to prevent duplicate backend requests.

---

## 3. Gemini API Credentials Dependency
For live, real-time clinical analyses, the application relies on the `GEMINI_API_KEY` being configured inside the environment secrets:

* **Graceful Degradation**: If the API key is not configured, the backend catches the null-client initialization error and returns a structured configuration state (`isConfigError: true`).
* **Visual Fallback**: Instead of crashing or showing a blank page, the frontend shows an educational banner instructing the user on how to add their `GEMINI_API_KEY` to settings, while seamlessly falling back to local biophysical and structural metrics computed dynamically on-the-fly.

---

## 4. GPU & WebGL Iframe Constraints
Because the application runs in a sandboxed iframe environment, several client-side parameters apply:

* **WebGL Isolation**: Low-tier hardware or strict GPU sandboxing in certain enterprise networks may prevent the WebGL context from initializing. To mitigate this, Molstar's configurations are set to prefer hardware acceleration but support software rendering fallbacks if needed.
* **Memory Management**: Loading multiple heavy macromolecular targets can trigger WebGL memory leaks if contexts are not freed. The `MolstarViewer` component actively listens for component unmount events, running a cleanup function (`plugin.dispose()`) to release GPU buffers.
* **Iframe Sandbox Exemptions**: Interactive triggers like opening external tabs are constrained. To prevent browser blocks, the app does not call restricted APIs like `window.open` or `window.alert` inside the Molstar canvas.

---

## 5. Stateless Session Tokens & Security Tradeoffs

To ensure multi-replica security and horizontal scaling across server clusters, the application uses stateless AES-256-GCM encrypted tokens for session key exchange.

### 5.1. Session Revocation Limbo
* **Stateless Design**: No session data is persisted in the server memory or databases. Any server replica can decrypt and validate the session token using the shared `APP_SESSION_SECRET`.
* **No Revocation/Denylist**: Because tokens are stateless and expire after 1 hour, there is no active token revocation database or blocklist. Once issued, a session token remains valid for its full lifetime.
* **Token Rotation**: Rotating or changing the `APP_SESSION_SECRET` will immediately invalidate all active sessions, requiring clients to re-authenticate (which happens transparently on the client if credentials are in active state).

### 5.2. IP-Spoofing and Rate Limiter Proxy Decoupling
* **Proxy Trust**: Under `trust proxy: 1` settings, the API rate limiters rely on Express's native `req.ip`, which trusts the `X-Forwarded-For` header.
* **Security Decoupling**: This design assumes that the upstream load balancer, ingress controller, or reverse proxy is configured to sanitize and scrub incoming `X-Forwarded-For` headers to prevent IP spoofing.
* **Scope Appropriateness**: These stateless session and rate-limiting tradeoffs are acceptable and chosen by design for the application's declared single-tenant lab environment. For multi-tenant or public production deployments, a fast in-memory blocklist (e.g., Redis) and strict ingress header sanitation must be enforced.

---

## 6. PII Filtering best-effort mitigation

The server implements a regular-expression-based PII (Personally Identifiable Information) filtering helper (`filterPII`) to screen user-supplied directions for sensitive information like emails, phone numbers, SSNs, dates of birth, and patient/medical record IDs.
* **Best-effort Constraint**: This is a regex-based helper and acts as a secondary mitigation control. It cannot guarantee the detection of arbitrary patient names or unique custom identifiers.
* **Primary Control**: The primary clinical safety control is the user policy: researchers must **never** input real Patient Health Information (PHI) or identifiable clinical notes into the custom narrative directions field.

---

## 7. Modified ACMG Framework Rules

The ACMG rule engine (`server/services/prediction/acmg/`) applies Richards et al. 2015 and ClinGen SVI calibration updates with these rules:
* **Single Primary Calibrated Predictor & ClinGen VCEP Overrides (`PP3`/`BP4`)**: Computational `PP3`/`BP4` comes from one calibrated score rather than an unweighted tool vote — either the gene's audited ClinGen VCEP rule (113 active Released specs / 110 genes in `src/shared/insilico/vcepRules.ts`, snapshot 2026-11-24) or the default fallback order `REVEL → BayesDel noAF → AlphaMissense → ESM1b` using Pejaver et al. 2022 and Bergquist et al. 2025 strength bands, capped together with `PM1` at `Strong` (`PP3 + PM1 ≤ Strong`). Opposing calibrated tools are shown as non-blocking disagreement notes.
* **Walker 2023 Splicing `PP3` and `BP4` Gate**: When `PVS1` does not already apply, SpliceAI `max Δ ≥ 0.20` (or the gene's VCEP splicing cutoff) blocks missense `BP4` and applies splicing `PP3` at most once per variant; missing or unverified nucleotide loci withhold `BP4`.
* **PS1 (Same Amino Acid Substitution)**: ClinVar same-amino-acid pathogenic variants map directly to `PS1` as strong evidence of pathogenicity.
* **PP5 / BP6 (ClinVar Mapping)**: `PP5` / `BP6` are retired and NOT used, in strict alignment with ClinGen SVI working group guidelines.
* **BS1 / PM2 / PP2**: `BS1` maps benign frequency thresholds, `PM2` is evaluated at `Supporting` (`PM2_Supporting`), and `PP2` uses gnomAD regional missense constraint (`O/E`) with Chao et al. v3 bands.
  `PM2` is withheld, below its ceiling too, when gnomAD reports two or more homozygotes on an autosome, when All of Us
  is above the ceiling, or when the only frequency is the combined local copy (no ancestry groups) above a tenth of the
  ceiling (`pm2Hold`, `src/shared/frequencyRule.ts`). The 10x margin is an app-defined judgement, not a published cut-point.
  For a protein change with several candidate alleles, a hold on any one candidate withholds PM2. A saved analysis that
  counts a PM2 the rule now withholds is recomputed once when it is next opened.
* **ACMG Weighting Models**:
  - **Conservative Mode**: Omit computational and population frequency criteria (`PM2`, `PP3`, `BP4`, `PP2`) unless corroborated by ClinVar clinical significance.
  - **Strict-Structural Mode**: Omit non-structural computational/frequency criteria (`PM2`, `PP3`, `BP4`, `PP2`), relying on ClinVar evidence and structural criteria (`PM1`/`PVS1`).

---

## 8. ESM Model Sequence & Token Constraints
When utilizing ESM representation and folding models, the following computational boundaries apply:

* **Sequence Length Truncation Guard**: The local VESM-150M sidecar enforces a strict sequence length guard of 1022 residues to prevent GPU out-of-memory states. Longer sequences are automatically truncated, and mutations falling outside the 1022-residue boundary will fail to analyze.

---

## 9. Local dbNSFP Ingest First-Transcript Approximation

When utilizing local dbNSFP predictions (enabled via `ENABLE_LOCAL_DBNSFP=true` and parsed using the `ingest_dbnsfp.ts` utility):
* **First-Transcript Approximation**: dbNSFP files contain multi-valued annotations for variants affecting multiple transcripts (delimited by semicolons or commas). The ingestion script parses and stores only the first value from these lists. This introduces a first-transcript approximation where scores (such as REVEL, CADD, or popEVE) may occasionally reflect a non-canonical transcript.
* **Database Size**: The local dbNSFP SQLite database (`data/dbnsfp_v5.sqlite`) is disabled by default and requires running the ingestion utility locally. If not found or empty, the application falls back transparently to querying remote prediction APIs.

