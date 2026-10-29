# Documentation Index — MissenseResolve®

Welcome to the comprehensive documentation repository for **MissenseResolve®**. This folder serves as a centralized hub of knowledge detailing the product designs, tech stack, and biological computing pipelines.

[Translational philosophy](./TRANSLATIONAL_PHILOSOPHY.md) is the active standard for unfamiliar-researcher clarity, interpretation and scientific honesty. See [contextual explanation coverage](./TRANSLATIONAL_COVERAGE.md) for implemented entry points and validation.

---

## 📂 Navigation Index

### 1. [Product Requirements Document (PRD)](./PRD.md)
* **Goal**: Outlines the strategic purpose, problem statement, target personas, and clinical workflows of the application.
* **Key Topics**: User personas, core problems solved, and non-functional requirements.

### 2. [Technical Architecture Design](./ARCHITECTURE.md)
* **Goal**: Details the physical full-stack network layout, APIs, WebGL graphics engine, and pipeline mechanics.
* **Key Topics**: Front-end WebGL states, Express API gateway endpoints, and proxy mechanisms.

### 3. [Interactive Feature Catalog](./FEATURES.md)
* **Goal**: Serves as a user manual mapping out interactive utilities, color themes, and algorithmic analyses.
* **Key Topics**: Variant presets, Molstar rendering representations, and ACMG criteria codes.

### 4. [Technical Limitations & Constraints](./LIMITATIONS.md)
* **Goal**: Highlights physical boundaries, API dependencies, cropping systems, and browser limitations.
* **Key Topics**: Mutational modeling workspace constraints, EBI AlphaFold API versioning, and iframe sandbox restrictions.

### 5. [API Reference](./API.md)
* **Goal**: Reference documentation for all server-side API endpoints, query parameters, payloads, and error codes.
* **Key Topics**: Variant analysis, biophysical modeling, pocket finding, and authentication.

### 6. [Deployment Guide](./DEPLOY.md)
* **Goal**: Setup runbook for a single Windows host using Caddy and PM2. The production server (OCI, Docker, blue/green handover) is described in [`deploy/ROLLOUT.md`](../deploy/ROLLOUT.md).
* **Key Topics**: Reverse proxy setup, SSL, environment configuration, and sidecar lifecycle.

### 7. [Accounts & Server Jobs Runbook](./ACCOUNTS.md)
* **Goal**: For the server owner: create the first admin, invite people, switch on sign-in, and set how server jobs are shared.
* **Key Topics**: `AUTH_MODE` cut-over and rollback, applying a setting safely, job limits, `COMPUTE_ROUTING`, backups, FoldX licence.
* **Measurements**: [Compute Benchmark](./COMPUTE_BENCHMARK.md), FoldX and P2Rank time and peak memory per machine class (`npm run compute:benchmark`).

### 8. [Future Work & Enhancements Roadmap](./FUTURE_WORK.md)
* **Goal**: Highlights alternative machine learning models, visualization upgrades, and technical roadmap items.
* **Key Topics**: FoldX PositionScan, Rosetta cartesian_ddg, Boltz-2 diffusion, and 2D Δ-distance matrices.

### 9. [Independent Audit Response](./INDEPENDENT_AUDIT_RESPONSE.md)
* **Goal**: Records how each finding of the 2026-09-30 independent audit was verified, fixed, refuted with evidence, or left as an owner decision.
* **Key Topics**: Richards 2015 combining rules, ClinVar "Conflicting" handling, citation integrity, PM2 strength decision.

### 10. [Literature Tab Review](./LITERATURE_TAB_REVIEW.md)
* **Goal**: Records the audit and redesign of the Literature tab: what it claimed, what it now proves, and why no journal metrics are shown.
* **Key Topics**: Query provenance, full-text matches, variant-specific search, degraded-search reporting.

---

## 🛠️ Infrastructure Overview
* **Runtime**: Node.js & Vite (TypeScript)
* **API Ingress**: Port 3000
* **Graphics**: HTML5 Canvas with WebGL (Molstar API)
* **AI Orchestration**: Gemini 3.6 Flash with a fallback ladder (`@google/genai` model client)
* **Biological APIs**: EMBL-EBI AlphaFold Database & Mutational Side-Chain Modeling Engine

## Evidence workspace redesigns

- [Population, Predictors and AlphaGenome](EVIDENCE_WORKSPACE_REVIEW.md)
- [Gene-disease, Expression and Species & models](CONTEXT_WORKSPACES_REVIEW.md)
- [Residue shifts, Perturbation and Functional domains](MOLECULAR_WORKSPACES_REVIEW.md)
- [RNA splicing and Interfaces & PPI: second presentation pass](MECHANISM_WORKSPACES_REVIEW.md)
- [Functional domains: the Germline hot spots subtab](FUNCTIONAL_HOTSPOTS_PLAN.md) — six definitions, each with its own grade, and what the view may claim
- [The 3D-clustering adoption decision](HOTSPOT_3D_DECISION.md) — pre-registered thresholds, the per-gene benchmark, and why the score is a suggestion that never feeds the engine
