# Documentation Index — MissenseResolve®

Welcome to the comprehensive documentation repository for **MissenseResolve®**. This folder serves as a centralized hub of knowledge detailing the product designs, tech stack, and biological computing pipelines.

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
* **Goal**: Setup and deployment runbook for production infrastructure using Caddy and systemd/PM2.
* **Key Topics**: Reverse proxy setup, SSL, environment configuration, and sidecar lifecycle.

### 7. [Future Work & Enhancements Roadmap](./FUTURE_WORK.md)
* **Goal**: Highlights alternative machine learning models, visualization upgrades, and technical roadmap items.
* **Key Topics**: FoldX PositionScan, Rosetta cartesian_ddg, Boltz-2 diffusion, and 2D Δ-distance matrices.

---

## 🛠️ Infrastructure Overview
* **Runtime**: Node.js & Vite (TypeScript)
* **API Ingress**: Port 3000
* **Graphics**: HTML5 Canvas with WebGL (Molstar API)
* **AI Orchestration**: Gemini 2.5 Flash (`@google/genai` model client)
* **Biological APIs**: EMBL-EBI AlphaFold Database & Mutational Side-Chain Modeling Engine
