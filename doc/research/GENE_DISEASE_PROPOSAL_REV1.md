# Gene–disease — a tab for causality, mechanism and variant locus

Design proposal, companion to `EXPRESSION_AND_MODELS_PROPOSAL.md`. Status: **not implemented.**
Written **2026-10-05**. This document is shorter and its source survey is **thinner** than the expression
proposal's: only GenCC, ClinGen and Gene2Phenotype were looked at, and mostly through search-result
summaries. Every source row below is therefore marked; nothing here has been exercised live.

Labels: **verified (page)** · **snippet** (search summary or third-party description — treat as
UNVERIFIED) · **UNVERIFIED**.

---

## 0. The question this tab answers

*For the disease the researcher has in mind: is the gene's causal role established, does a missense
variant fit the way the disease arises, and does this variant sit where that disease's variants sit?*

It is one of two tabs:

- **This tab** — curated assertions about the gene–disease relationship (disease-conditioned).
- **Expression & models** — measured biological context (phenotype-conditioned).

They share one `DiseaseFrame`. Choosing a disease here pre-fills suggested systems there; the
researcher's own ticks there always win.

**Nothing in this tab computes a score.** It shows how many axes are answered, never how favourable they
are. A composite would be a hidden vote, the defect this repo already corrected once.

---

## 1. The three axes

| Axis | Question | Candidate sources | Status |
|---|---|---|---|
| **Causality** | Is this gene established for *this* disease, and by whom? | **GenCC** (Definitive / Strong / Moderate / Limited / Disputed / Refuted, multiple submitters); **ClinGen Gene-Disease Validity**; **Gene2Phenotype** confidence | GenCC: bulk TSV, no live API, ~24 MB, republished weekly, rate-limited, **CC0** — snippet. ClinGen validity: CSV at `search.clinicalgenome.org/kb/gene-validity/download` — snippet. G2P: confidence levels on LGMDE threads — verified (page, medRxiv) |
| **Mechanism** | Is disease caused by loss, gain, or dominant-negative action, with what inheritance — and does a missense fit? | **Gene2Phenotype** (mechanism, allelic requirement, LGMDE threads); **ClinGen Dosage Sensitivity** (haploinsufficiency / triplosensitivity); the app's existing **gnomAD constraint** (`mis_z`, `oe_mis`, `pLI`, `oe_lof_upper`) | G2P mechanisms LoF / GoF / DN: verified (page, medRxiv). ClinGen dosage JSON at `search.clinicalgenome.org/api/dosage` and TSV on `ftp.clinicalgenome.org` — snippet |
| **Variant locus** | Does this variant sit where this disease's variants sit? | **ClinVar** variants at/near the residue and in the domain (already fetched by the app); regional missense constraint; PM1 hot-spot context | Existing app evidence. **The PM1 hot-spot decision is still open** (project memory: density shown as context only) — this axis must stay context until you decide |

### Context for the mechanism axis (literature)

- "Prevalence of loss-of-function, gain-of-function and dominant-negative mechanisms across genetic disease
  phenotypes" (PMC12462468) and "Proteome-scale prediction of molecular mechanisms underlying dominant
  genetic diseases" (PMC11341024) exist. The first reports dominant-negative and gain-of-function mechanisms
  together account for **48 %** of phenotypes in dominant genes (snippet). The second is a **predictor** — a
  predictor of mechanism is not curated evidence of it, and the app must not present it as such.
  Calibration, thresholds and licence of both: **UNVERIFIED.**

### What must be shown for mechanism

- Mechanism **per disease**, because one gene can have several (a gene can be LoF for one phenotype and GoF
  for another). The frame, not the gene, carries it.
- A plain statement of what a missense can and cannot mean under each mechanism ("under pure haploinsufficiency
  a missense matters only if it is loss-of-function"). This is explanation, not a verdict.
- Where sources disagree (e.g. G2P says GoF, ClinGen dosage says haploinsufficient), show both with their
  names. Never reconcile silently.

---

## 2. The `DiseaseFrame`

```ts
interface DiseaseFrame {
  id: string;                   // MONDO / OMIM / ORPHA, from ClinVar condition xrefs — not free-text traits
  label: string;
  moi: "AD" | "AR" | "XLD" | "XLR" | "MT" | "other" | "unknown";
  mechanism: Array<{ kind: "LoF" | "GoF" | "DN" | "other"; source: Provenance }>;
  validity: Array<{ level: string; submitter: string; releaseDate: string }>;
  onset?: HsapDvStage;
  systems: HpoSystem[];         // suggestions for the Expression & models tab
  provenance: "published" | "local";
}
```

- **Selected, not inferred silently.** The app proposes a frame from the gene's ClinVar condition ids and GenCC
  rows; the researcher picks one or overrides it. A multi-disease gene (LMNA, FGFR3, SCN1A) presents a list
  with the researcher's choice, never a blended frame.
- **Condition ids, not trait strings.** ClinVar trait text is free text and brittle; use the condition database
  ids it carries.
- **Provenance per field.** Anything the app curates itself is `local` and drawn dashed; anything taken from a
  published file cites the file and its release date.

---

## 3. Licensing and access

- **GenCC** — CC0, attribution requested (snippet). **Orphanet**, **ClinGen**, **G2P** terms — UNVERIFIED.
- **OMIM** — not redistributable. Use OMIM ids only as cross-references carried by ClinVar/GenCC; never ship
  OMIM text.
- **No live API for GenCC**: ship a pinned weekly snapshot with its date in the rail; per-gene subset only.
- **Rate limits** (GenCC 20 downloads per IP per day — snippet): fetched by a build step, not per request.

---

## 4. Failure modes

1. **A disputed or refuted gene–disease link must dominate the screen.** If validity is Disputed or Refuted,
   no downstream context may read as supportive; it is hidden behind that finding.
2. **Disagreement between submitters is data.** Show each submitter and level; do not average.
3. **Validity is per gene–disease pair, not per gene.** A gene Definitive for one disease can be Limited for
   another.
4. **Mechanism is not transferable across diseases** (§1).
5. **Predictor ≠ evidence.** Mechanism predictors are labelled as predictors.
6. **Variant-locus context is not PM1.** Clustering of ClinVar variants is shown as density, per the open
   decision; it must not be worded as a criterion.
7. **Absence ≠ unsupported.** A gene missing from GenCC is `not curated by these sources`, not "no evidence".
8. **Stale snapshots.** The release date of every file is printed.

---

## 5. Screen

- **Tier 1 — finding.** "Is *<gene>* an established cause of *<disease>*?" Headline: the highest validity level
  with its submitter and date, or `not curated`. Beside it, *how many of the three axes are answered* (a count,
  not a score).
- **Tier 2 — three rows** (causality, mechanism, variant locus), each with the closed state vocabulary the
  app already uses (`install` / `coverage` / `upstream` for absence).
- **Tier 3 — rail.** The submitters and levels in full, the mechanism sources side by side, the snapshot
  release dates, and the licence.
- **Cross-link.** The selected frame's `systems` feed the Expression & models picker.

---

## 6. Phases

| Phase | Content |
|---|---|
| **0** | `DiseaseFrame` + selector (also required by the Expression & models tab) |
| **1** | Causality: GenCC snapshot (+ ClinGen validity cross-check) |
| **2** | Mechanism: G2P + ClinGen dosage, beside existing gnomAD constraint |
| **3** | Variant locus: ClinVar-at-residue and domain density context (blocked on the PM1 decision) |

---

## 7. Tests

- A Disputed/Refuted fixture suppresses supportive wording downstream.
- Two submitters with different levels both render; no averaging.
- A multi-disease gene (LMNA) shows a frame list, never a blended frame.
- A gene absent from GenCC renders `not curated`, not zero.
- A mechanism predictor is labelled as a predictor.
- A guard that nothing in this tab reaches `criteria.ts`.

---

## 8. Open decisions

1. **PM1** — until it is decided, the variant-locus axis stays context only.
2. **Which disease source is the frame's identity** when MONDO, OMIM and ORPHA ids all exist (recommend:
   MONDO as the key, with the others as cross-references).
3. **Verification before build.** Exercise GenCC, ClinGen validity, ClinGen dosage and G2P live; none of them was
   read directly in this session.
