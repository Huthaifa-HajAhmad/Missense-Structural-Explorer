---
name: evidence-tab-refactor
description: Audit and redesign an Evidence tab or a coherent batch of Evidence workspaces in Missense & Fold (scientific integrity first, then UI/UX and typography) to the standard set by the Population Data and Predictors tabs. Use when asked to audit, refactor, redesign or polish any evidence tab, its inspector rail, or the thresholds that feed it.
---

# Evidence tab refactor

Apply `doc/TRANSLATIONAL_PHILOSOPHY.md` to every changed reading and explanation. Update
`doc/TRANSLATIONAL_COVERAGE.md` when adding a model, metric, method or contextual entry point.
Individual explanation drawers must teach their subject; there is no global topic browser.

Population Data and Predictors establish the scientific reading and trace contracts. The current
workspace references are `doc/EVIDENCE_WORKSPACE_REVIEW.md`, `doc/CONTEXT_WORKSPACES_REVIEW.md`,
`doc/MOLECULAR_WORKSPACES_REVIEW.md` and `doc/MECHANISM_WORKSPACES_REVIEW.md`. Read the relevant
review and its tab/shared-model/inspector implementation before changing that family. The goal is
one recognisable product that never claims more than its data supports.

Order of priorities, never reversed: **true → traceable → legible → beautiful.** A polished screen
that asserts an unsourced cut-point is worse than the ugly one it replaced.

Reviewing here is read-only; bug hunting may edit, but only inside the reviewed surface and the copies a
fix must reach. The feasibility matrix and stop rules live in `.agents/rules/review-posture.md` — read
them before turning step 2's findings into edits.

## The workflow

1. **Read the whole chain, not just the tab.** Tab component → any panel it renders → the shared
   evaluators/thresholds it calls → the server code that computes the values
   (`server/services/**`, especially `prediction/acmg/criteria.ts` if the tab feeds an ACMG code) →
   the inspector rail case in `inspector/EvidenceInspector.tsx` → `MetricExplanations.ts`,
   `shared/attributions.ts`, `THRESHOLD_NOTES`. Most defects live in the gaps between these.
2. **Audit scientific integrity** with `references/integrity-checklist.md`. Verify every cut-point
   and citation against the primary paper (WebSearch/WebFetch the paper or its PDF; do not trust
   memory, code comments, or "ClinGen-calibrated" labels). Record each finding: severity, what is
   wrong, evidence, fix.
2b. **Audit data presentation** with `references/data-presentation.md`, on the densest real case for
   the tab as well as the user's variant: what the backend should aggregate before the screen sees it,
   the density budget, and the interaction minimum. A tab that shows every provider row is not done.
3. **Stop for the one decision that is the owner's.** If a finding changes what the rule engine
   classifies (a criterion, a strength, which tools vote), ask with one AskUserQuestion, findings in
   the question, recommended option first. Everything else — wrong labels, wrong citations,
   swapped bars, drifted copies — just fix.
4. **Build one pure model** in `src/shared/<tab>Evidence.ts` that both the tab and the rail render
   from (see "Architecture"). Unit-test it with the variant on the user's screenshots.
5. **Rebuild the tab** around its scientific question and workspace views, then **the rail** as a trace. **Own your CSS:**
   every class the tab and rail use lives in `src/styles/<tab>.css` under a short prefix
   (`prd-`, `ag-`…), `@import`ed in `src/styles/components.css`. Copy the house VALUES from the
   latest reference tab (see `references/design-system.md`); never reference another tab's
   `pop-*` / `rail-*` classes. The Predictors tab first reused them, and when Population Data was
   polished (fact strip removed, rail cut-points re-gridded to a 44px code column) Predictors lost
   its fact strip and group-row styling and its rail codes overprinted their thresholds.
   Shared workspace components may own a shared prefixed stylesheet; scope tab-specific overrides
   to their workspace roots, and keep the print stylesheet last in the import order.
6. **Propagate fixes to every copy.** grep for the old literal numbers and labels across `src/` and
   `server/` (strength-ladder rows in `shared/ladderEvidence.ts`, heatmaps, knowledge modal,
   attributions, engine reason strings). A fix in one surface that leaves a second copy is a new bug.
7. **Verify** (see "Verification"): tsc + `npm run lint`, full vitest, and look at the rendered page
   in light, dark and a narrow column.
8. **Write `doc/<TAB>_REVIEW.md`** (findings table, decision taken, effect on the reference variant,
   follow-ups not done, sources with DOIs). If committing is in scope, **commit only your files**;
   preserve the current shared branch during concurrent review.

## Scientific integrity — the rules

- **Every drawn or tested cut-point carries its provenance**, and the UI says which kind:
  published calibration (ClinGen etc.), the authors' own operating point, a local/app-defined mark
  (drawn dashed), or none. Never promote an author's class or a local mark to "calibrated".
- **One source of truth per number.** Cut-points live in `src/shared/thresholds/` (published PP3/BP4
  bands in `calibration.ts`); surfaces import them. A hand-written copy in a component is a defect
  even when it is currently equal.
- **Read the engine, never re-derive it.** A tab shows the code the rule engine recorded
  (`ruleBasedInsights.acmgCriteria` ?? `insights.acmgCriteria`). If the payload has no record, show
  what the evidence supports with a DASHED chip and say "unconfirmed". If a weighting withheld it,
  say so. If the recorded code differs from what the current rule gives, say the payload was
  classified by an earlier engine.
- **The tab and the engine share one rule function** (e.g. `insilicoVoteOutcome`). Two
  implementations of one rule will disagree on screen.
- **Absence is a state, not a value.** Missing ≠ 0 ≠ benign. Use `shared/evidenceAvailability`
  (`resolveSourceAvailability`) and the `ENGINE_STATE_LABELS` vocabulary ("Running", "No result",
  "Not available here", "Provider error"…). The legacy words in `LEGACY_ENGINE_LABELS`
  ("Standby", "N/A", "Offline"…) are banned; `energeticsLabels.guard.test.ts` lists guarded files —
  add your tab there.
- **Name what actually served a number.** Read `provenance` / `fallbackReason` from the payload; a
  fallback model's score must not wear the preferred model's name.
- **Say what a score is.** Conservation is constraint, not pathogenicity. A rank/percentile is not a
  probability. Destabilisation is not pathogenicity. A tool that uses allele frequency or was trained
  on ClinVar gets a visible caveat chip, because it double-counts with PM2/BS1 or is circular.
- **No composite may re-count its own inputs** (the AlphaGenome AVI contained AlphaMissense and
  voted beside it).
- **Show the calibrated reading beside any uncalibrated aggregate**, and flag disagreement in words.
- Removing a false claim beats softening it. Delete prose that asserts a feature the code lacks
  ("calibrated against local odds", "prevents double-counting", "populated from live services").

## Architecture

```
src/shared/<tab>Evidence.ts   pure: build<Tab>Evidence(result, flags) → readings[], finding, engine record, reference
src/components/evidence/<Tab>Tab.tsx      renders the model; tests no score itself
src/components/evidence/<tab>/*.tsx       small presentational pieces (e.g. ScoreRuler)
src/components/inspector/<Tab>Rail.tsx    renders the SAME model as a trace; wired in EvidenceInspector
src/styles/<tab>.css                      prefixed classes, tokens only
src/shared/__tests__/<tab>Evidence.test.ts   model contract on the reference variant
src/components/__tests__/<Tab>Tab.test.tsx   what the screen may claim (jsdom)
```

Each reading carries: key, name, one-line description, group/role, score + formatted text + unit,
display scale and orientation, cut-points `{kind, source, bands, marks}`, call label + tone, caveats,
a one-line note (served model, authors' class, percentile), availability `{state, label, reason,
action}`, source, knowledge-modal key, optional cross-tab link. Put a header comment on the module
listing its INVARIANTS and the defects it replaced — the codebase's convention is comments that say
*why*, citing the prior failure.

## Screen shape

**Tab (current workspace pattern)**
1. *Finding*: retain the engine's actual record, one clear headline and the qualifications needed
   to read it. Repeated metadata may live in a disclosure when it would displace the primary figure.
2. *Figure*: lead with the map or comparison that answers this tab's question. Use the existing
   `EvidenceWorkspace`/`EvidenceViewTabs`/`EvidencePanel` contracts for navigation and state.
3. *Source records*: exact readings in a named view, using the same stable keys as figure and rail.
   Add a separate view such as Partners only when it serves a different exploration task.

A figure selection pins a reading above the existing rail trace. View switches retain the pin and
never move keyboard focus implicitly; an explicit reveal action may unfold, scroll and focus its
record. Explain hidden selections. Persist display choices across tab navigation and reset for a
new analysed allele; transcript-specific geometry controls also reset for a different transcript.

For a second design pass or a batch of tabs, read `references/second-pass-design.md`. Shared
interaction does not require identical biological figures. The older single-table shape remains
useful for a genuinely small evidence set; it is not the required layout for every workspace.

**Cards and rows** — one tint per card, on its head and foot bars only; rows flat with hairline
dividers on the card's 16px edge; no dashed boxes for empty states (dashed means "unconfirmed");
an empty state is a bold sentence on the card, never a box inside it. See "Cards, rows and empty
states" in `references/design-system.md`.

**Rail (Evidence Lineage)** — `rail-section`s: (1) Rule trace, numbered `rail-steps`, last step the
engine record, `data-state="warn"` on a mismatch; (2) the cut-points list `rail-cuts` with the band
this variant is in marked "this variant"; (3) `rail-notes` "Method" details with the caveats a
curator must know; (4) Sources from the payload plus DOI links. No hard-coded version strings.

Design rules in `references/design-system.md`; copy-ready rendering harness in
`references/preview-harness.md`.
For positional maps, score axes, display filters and comparison plots, also apply
`references/data-visualization.md`. These rules keep view controls separate from scientific rules.

## Verification

- Run checks in the current workspace with its native dependencies first. Windows builds are valid
  on Windows; do not create a Linux mirror solely because the workspace uses Windows. If testing
  from Linux against Windows dependencies, use a Linux mirror:
  `git clone <repo> ~/work/mse && npm ci --ignore-scripts` (run long installs/suites with
  `setsid nohup … &` and poll the log; a plain background job is killed when the shell call ends),
  then `rsync` `src/` and `server/` over before each run.
- `npx tsc --noEmit`, `npm run lint` (boundaries, focus indicators, verify parity, tsc), full
  `npx vitest run`. `pocket.test.ts` Java auto-discovery fails on machines with no JDK — unrelated.
- Update existing tests whose expectations encoded the old wrong numbers; rename them to state the
  corrected rule, and comment the source of the new value. Never delete a test to go green.
- Render inside the real wrapper: the Evidence panel sets `font-mono text-xs` on every tab, so
  the screen and rail roots must reset to sans. Render with the CURRENT `src/styles/` of the
  branch you will merge into, not a stale copy — shared styles move under you.
- Render the tab + rail with the reference payload (harness) in light, dark and ~800px; look at the
  screenshot, fix, re-shoot. Check: no clipped chips, no overflow, bands/markers in the right
  direction, tints match calls, every empty state reads as a sentence.

## Commit hygiene

Other agents often work in the same folder at the same time. Record the initial working tree and
preserve unrelated changes. During concurrent review, make narrow edits and re-read shared files
before editing; do not switch the shared branch. If committing is requested, stage owned paths or
hunks rather than `git add -A`. Keep reusable fixture harnesses under `tools/`; temporary browser
profiles and screenshots belong in ignored scratch space.

## Tab status

| Tab | Current reference |
|---|---|
| Population data, In-silico predictors, AlphaGenome | Workspace pass complete: `doc/EVIDENCE_WORKSPACE_REVIEW.md`. Earlier scientific reviews still apply. Predictors owns the merged strength ladder. |
| Gene-disease, Expression, Species & models | `doc/CONTEXT_WORKSPACES_REVIEW.md`, including subsequent review corrections. |
| Residue shifts & pockets, Structural perturbation, Functional domains | `doc/MOLECULAR_WORKSPACES_REVIEW.md`. |
| RNA splicing, Interfaces & PPI | Second presentation pass: `doc/MECHANISM_WORKSPACES_REVIEW.md`. Prior scientific audits remain authoritative; full isoform identity checking and interface-to-3D linkage remain open. |
| 3D structure (viewer + inspector) | `doc/STRUCTURE_3D_REVIEW.md`; `shared/structure3dEvidence.ts`, `s3d-` CSS. |

Confirm these references against the current working tree; a status table is navigation, not proof
that a later change has been validated. Multimer assembly and Protein interactions are now part
of Interfaces & PPI rather than separate redesign targets.
