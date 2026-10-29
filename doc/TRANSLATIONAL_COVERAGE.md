# Contextual explanation coverage

Updated 13 October 2026. Implements [the translational philosophy](TRANSLATIONAL_PHILOSOPHY.md).

## What changed

The premise is clarity for a researcher unfamiliar with the method: an understandable question,
an honest answer, a readable quantity, its limitations and a useful next inspection. Explanations
must preserve the difference between a model's output and a conclusion about biology or disease.

The existing model, metric and 3D inspection notices now open individual right-side drawers with
a dimmed, inert background. There is no global guide button, all-topic browser or search drawer.
Related concepts are available inside an explanation with a return path to the original subject.
Shared dialog mechanics do not require identical teaching content: model input/method/output
sequences, metric comparisons, worked examples and inspection workflows serve different questions.

There are 91 explanation subjects. Availability in the registry alone does not constitute coverage:
the following entry points, source-record links and related-concept routes make them discoverable.

## Entry points and subject coverage

| Research context | Entry point | Explanation coverage |
|---|---|---|
| Variant query | Beside “Analyse a variant” | Allele, transcript, assembly, accession and residue identity; links to missingness and mapping |
| All 11 Evidence workspaces | Subject-specific “About…” control above the active workspace | Population, gene–disease, expression, species, predictors, AlphaGenome, residue properties, perturbation, function, splicing and interfaces |
| Predictor records | Existing model notice controls and pinned-reading inspector | AlphaMissense, CADD, REVEL, BayesDel noAF, EVE, popEVE, MetaRNN, ClinPred, Eigen, DANN, ESM-1b, ESM C/VESM, SaProt, GPN-Star, phyloP, GERP++ and ConSurf |
| Population and AlphaGenome records | Pinned-reading inspector | AC/AN/AF and population-rule context; feature attribution/SHAP. Related topics explain constraint, coverage, ranks and PHRED |
| Residue records | Pinned-reading inspector | Amino-acid properties, solvent accessibility/burial and P2Rank pockets |
| Perturbation model rows | Beside each model | ESM-2, ESM C, VESM and SaProt; ESM3 representation analysis identifies its VESM fallback when present |
| Perturbation physical rows | Beside each quantity, including unavailable readings | VdW energy, electrostatics, neighbour side-chain RMSD, atomic clashes, Cα displacement, contact changes and SASA |
| Per-residue perturbation detail | Beside rank/distribution, shift and entropy | Alternate/native preference, embedding distance and positional entropy |
| Splice scores | Existing model controls and pinned-reading inspector | SpliceAI, individual channels, dbscSNV Ada/RF and AlphaGenome attribution; transcript geometry and missing-position limits |
| Interface records | Predicted-complex section, confidence row, binding-change card and pinned-reading inspector | Boltz-2, ipTM/pTM, DDMut-PPI, contacts and STRING association. Non-STRING partner records retain interface context |
| Energetics | Workspace reading control and existing per-engine notices | FoldX, DynaMut2, DDMut, RaSP, ThermoMPNN and StabilityOracle; sign conventions, disagreement and repeat variability |
| 3D | Existing inspection notice and structure-inspector confidence control | Structure pair, mapping, pLDDT versus crystallographic B-factor, uninterpreted confidence, PAE and independent ESMFold predictions |
| Functional domains · Hotspots (2026-10-28) | “How to read hot spots” in the view head; “How to read: …” inside each definition’s method disclosure | Mutational hot spots overview; ClinGen expert panel rules (CSpec); regional missense constraint as PP2 (Chao et al. calibration); pathogenic-enriched regions (published and re-run); 3D proximity (PathProx). Each states its grade and what a negative does not mean |
| 3D canvas guide (2026-10-28) | “On this canvas” card, top left of the viewer | What each highlighted set is and where it comes from, with its drawn colour; “How to read a structure” opens the structure guide |
| Landscape | Beside workspace heading | Position/substitution scope, coverage, compatible comparisons and descriptive agreement |
| Insights | Beside workspace heading | Rule-engine result versus generated narrative, evidence strength and uncertainty |
| Literature | Beside workspace heading | Claim relevance, allele identity, study scope and direct evidence versus mentions |
| Report | Report heading | Author commentary, source evidence, provenance and qualifications that must survive export |

Concepts such as missing versus zero, model provenance, calibration, conservation and confidence
are linked from the readings they qualify. They do not require a separate global help workflow.

## Scientific corrections and boundaries

- Removed the obsolete external philosophy link and roadmap instructions for an unvalidated
  consensus index and geometry-derived binding-affinity claims.
- Rewrote explanation prose around the actual computation. Representation distance is not
  movement; fixed-backbone zero is not evidence that a protein cannot move; energy components
  cannot identify a broken bond or demonstrate backbone distortion on their own.
- Removed the invented universal EVE 0.25/0.75 categories from legacy metadata. Contextual prose
  distinguishes author classes, clinical calibration and app-defined reference marks.
- Published evidence-band tables read the existing shared calibration definitions. The help does
  not decide which criterion this analysis applied or add any new numerical threshold.
- ESM C and VESM explanations follow served-model provenance. AlphaGenome AVI cites the Atlas
  source separately from the base model. DDMut-PPI retains its binding sign convention and treats
  benchmark RMSE as population-level performance, not an individual confidence interval.
- The explanatory upgrade changes presentation and educational routing. Existing shared evidence
  models, inference services, clinical rules and export computations continue to own their results.
  Report guidance does not itself certify every generated narrative or exported document.

## Implementation and maintenance

`src/shared/researchGuides.ts` owns educational text and related concepts;
`src/shared/explanationTeaching.ts` owns subject-specific teaching figures.
`src/components/knowledge/ResearchGuideDrawer.tsx` provides the native modal dialog, source
links, reference copying and shared calibration table. Compatibility wrappers retain existing
model, metric and 3D notice call sites. `MetricExplanations.ts` retains legacy metadata and method
citations; drawer prose comes from the new educational content.

Reading models carry `knowledgeKey` for specific subjects. The inspector uses the relevant
workspace explanation when a record has no more specific method. This fallback is deliberate
for heterogeneous annotation records, rather than a claim that every record uses one model.

The always-on rule `.agents/rules/translational-philosophy.md` and the local
`evidence-tab-refactor` skill point to the active philosophy and this coverage record. New methods
must supply both explanation content and a contextual entry point. Add the source and any separate
calibration, preserve missing/fallback states, and update the coverage tests and this table.

## Follow-up closure: six findings

| Finding | Implemented correction | Verification |
|---|---|---|
| Entropy text claimed biological tolerance and evidence strength | Rank prose describes the model distribution, with explicit limits on biological interpretation | Shared rank tests; existing perturbation and molecular projections use the same helper |
| VESM embeddings were labelled ESM3 and opened LLR guidance | Provenance selects the visible model, embedding-specific explanation, 3D legend and citation; absent provenance stays unnamed | Rendered ESM3, VESM and unknown-source rows; 3D model and citation tests |
| Unknown confidence opened pLDDT guidance | A separate explanation distinguishes missing coordinates from an unidentified field and carries the actual reason | Real structure inspector tests for known, missing and unknown provenance |
| Shell shortcuts interfered with modal interaction | Command palette, sidebar and header search yield while a native dialog owns interaction | Palette capture/bubble tests; browser Ctrl+K, Ctrl+B, Tab, Escape and focus return |
| Metadata membership was mistaken for discoverability | Registry checks now cover content integrity only. Rendered tests open workspace, predictor and six stability-engine controls; browser coverage starts from observed controls | Real dashboard fixtures, collapsed groups, conditional fallback/physical rows and related-link traversal |
| Narratives and exports had not been checked for parity | Both synthesis routes distinguish observations, predictions and hypotheses. Embedding bands no longer become structural change. Report qualifications remain visible in PowerPoint slides | Prompt request tests; deep-evidence and narrative freshness tests; report text/HTML/JSON, DOCX and PPTX tests |

The narrative contract is version 5 and the deep-evidence projection is version 2. Older stored
narratives are marked outdated by the existing freshness mechanism. This changes explanatory
claims and cache identity, without changing clinical criteria, scores, cut-points or voting.

## UI and UX review

| Before | After | Why |
|---|---|---|
| Related-topic navigation reset the original reading position | Back restores the previous scroll position | Readers can investigate a term and resume reading |
| Late clipboard completion could affect another topic | Copy feedback belongs to the active topic and request | Feedback remains truthful after navigation |
| Long headings could crowd out the body on short screens | Header height is bounded and scrollable; the body and exit remain available | Short landscape screens and enlarged text remain usable |
| Legacy notice icons had 24px targets | Model and method controls have 44px targets with focus and press feedback | Easier pointer and touch activation |
| Qualifications were buried in PowerPoint speaker notes | Visible, paginated limits and provenance slides retain warnings and captions | Sharing the deck preserves the conditions on its claims |

Each explanation remains subject-specific. Shared dialog mechanics supply dimming, native
background inertness, focus containment, Escape/backdrop dismissal and responsive geometry;
there is no universal topic browser.

## Validation

- Browser: all 103 checks pass. The recorded corpus observes 55 direct subjects in actual controls;
  following their contextual links reaches all 85 subjects, with no orphan topics. It includes all
  11 Evidence workspaces, collapsed predictor groups, VESM fallback, physical rows, unknown
  structure confidence, six stability methods and the remaining research workspaces.
- Interaction checks cover dimming, native inertness, focus return, Tab/Escape, shell shortcuts,
  back-navigation scroll restoration, light/dark themes, OS and app reduced motion, narrow and
  short screens, and genuinely doubled text. No browser errors were recorded.
- Lint passes: architecture boundaries, focus indicators, CI parity and TypeScript.
- The dedicated regression run passed 200 tests across 10 files, including report exports,
  narrative freshness, embedding provenance, shortcuts and all six stability-engine controls.
- Final full suite: 4,635 tests passed, five skipped (362 files passed, two skipped), using
  `vitest run --maxWorkers=4`. The earlier unrestricted run had one Population chart readiness
  timeout; both the targeted regression and the final full run pass without loosening assertions
  or changing the test timeout.
- Geometry gate passes: 116 header, 241 functional-track and 34 Landscape assertions (391 total).
  The header Edge command-line process needed cleanup after rendering; its same 116 assertions
  also passed through Playwright. The standard gate then completed successfully.
- Production build passes (client, server, workers, admin utility and data copies); Vite retains
  its large-chunk advisory.
- Graphify AST extraction completed: 7,857 nodes and 22,035 edges, with 49 changed code files
  re-extracted. Two test files contain no symbols the extractor models.
- Browser screenshots, observed coverage and assertions are in ignored
  `scratch/explanation-preview/`; runner: `node tools/explanation-preview/check.mjs`.

The repository's requested `npm run review` gate cannot run because `package.json` has no
`review` script. Semantic search re-indexing is unavailable because
`tools/agent-tooling/cli.cjs`, referenced by `npm run search:index`, is missing from this checkout.
Manual diff review, TypeScript, tests and browser checks are used instead; no AI-review result
or semantic re-index is claimed.

These checks establish implemented educational coverage and interaction behaviour. They do
not constitute fresh biological validation of each model or live-provider end-to-end testing.


## Synthesis view ownership (18 October 2026)

Literature's **Mention coverage** view now owns the literal-mention chart and a text-availability
breakdown (with/without an abstract, denominator = all loaded papers). The explanation beside it
states that missing abstracts restrict screening to titles and that missing mentions do not establish
irrelevance. Selecting a group opens its papers in the single Reading desk. Insights separates
**Evidence gaps** from the direction map and criterion audit; hypothetical additions remain explicitly
uncounted. Report separates **Narrative & notes** from **Citations & methods**. See
[SYNTHESIS_WORKSPACES_REVIEW.md](SYNTHESIS_WORKSPACES_REVIEW.md) for integrity fixes and verification.

Predictors local agreement: Comparison and Native score scales name contributors and provide pin-to-inspector entry points. Clinical bands and sequence preference remain separate; absent and unclassified readings are explicit. See PREDICTORS_AVAILABILITY_REVIEW.md.
