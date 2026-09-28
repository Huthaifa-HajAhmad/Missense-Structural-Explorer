---
name: evidence-tab-refactor
description: Audit and redesign one Evidence tab of Missense & Fold (scientific integrity first, then UI/UX and typography) to the standard set by the Population Data and Predictors tabs. Use when asked to audit, refactor, redesign or polish any evidence tab, its inspector rail, or the thresholds that feed it.
---

# Evidence tab refactor

Population Data (`ClinicalTab.tsx` + `PopulationRail.tsx`) and Predictors (`PredictorsTab.tsx` +
`PredictorsRail.tsx`) are the reference implementations. Open both, with their shared-model modules
(`src/shared/frequencyEvidence.ts`, `src/shared/predictorEvidence.ts`) and `src/styles/population.css`
/ `predictors.css`, before touching another tab. The goal is that every tab reads as the same product
and never claims more than its data and its sources support.

Order of priorities, never reversed: **true → traceable → legible → beautiful.** A polished screen
that asserts an unsourced cut-point is worse than the ugly one it replaced.

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
3. **Stop for the one decision that is the owner's.** If a finding changes what the rule engine
   classifies (a criterion, a strength, which tools vote), ask with one AskUserQuestion, findings in
   the question, recommended option first. Everything else — wrong labels, wrong citations,
   swapped bars, drifted copies — just fix.
4. **Build one pure model** in `src/shared/<tab>Evidence.ts` that both the tab and the rail render
   from (see "Architecture"). Unit-test it with the variant on the user's screenshots.
5. **Rebuild the tab** in the three-tier shape, then **the rail** as a trace. Use the shared
   primitives in `references/design-system.md`; add a `src/styles/<tab>.css` with a short prefix
   only for what is genuinely new, and `@import` it in `src/styles/components.css`.
6. **Propagate fixes to every copy.** grep for the old literal numbers and labels across `src/` and
   `server/` (Threshold Guide rows in `shared/thresholds/guidelines.ts`, heatmaps, knowledge modal,
   attributions, engine reason strings). A fix in one surface that leaves a second copy is a new bug.
7. **Verify** (see "Verification"): tsc + `npm run lint`, full vitest, and look at the rendered page
   in light, dark and a narrow column.
8. **Write `doc/<TAB>_REVIEW.md`** (findings table, decision taken, effect on the reference variant,
   follow-ups not done, sources with DOIs) and **commit only your files** on a branch.

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

**Tab (three tiers, top to bottom)**
1. *The finding* — `pop-card pop-hero`: eyebrow naming the ACMG question, verdict chip (engine's code),
   one headline figure (`figure-headline`, mono), one finding sentence (`detail-prose`, bold
   headline + predicate), the key visual (scale, vote strip), any disagreement/withheld callout, and a
   4-cell fact strip (`pop-facts`) ending in "Engine record".
2. *Readings* — ONE table (`pop-table`) replacing card grids and sub-tabs: every source a row,
   grouped with `pop-group` rows, numbers right-aligned mono, a status/call column, absent rows
   spanning their reason across the numeric columns, a legend foot.
3. *Secondary panel* only if it is a different kind of evidence (ClinVar assertion on Population).

**Rail (Evidence Lineage)** — `rail-section`s: (1) Rule trace, numbered `rail-steps`, last step the
engine record, `data-state="warn"` on a mismatch; (2) the cut-points list `rail-cuts` with the band
this variant is in marked "this variant"; (3) `rail-notes` "Method" details with the caveats a
curator must know; (4) Sources from the payload plus DOI links. No hard-coded version strings.

Design rules in `references/design-system.md`; copy-ready rendering harness in
`references/preview-harness.md`.

## Verification

- `node_modules` in the user's folder are Windows builds. Test in a Linux mirror:
  `git clone <repo> ~/work/mse && npm ci --ignore-scripts` (run long installs/suites with
  `setsid nohup … &` and poll the log; a plain background job is killed when the shell call ends),
  then `rsync` `src/` and `server/` over before each run.
- `npx tsc --noEmit`, `npm run lint` (boundaries, focus indicators, verify parity, tsc), full
  `npx vitest run`. `pocket.test.ts` Java auto-discovery fails on machines with no JDK — unrelated.
- Update existing tests whose expectations encoded the old wrong numbers; rename them to state the
  corrected rule, and comment the source of the new value. Never delete a test to go green.
- Render the tab + rail with the reference payload (harness) in light, dark and ~800px; look at the
  screenshot, fix, re-shoot. Check: no clipped chips, no overflow, bands/markers in the right
  direction, tints match calls, every empty state reads as a sentence.

## Commit hygiene

Other agents often work in the same folder at the same time. `git status` before committing; stage
your files by path, never `git add -A`; leave others' modified files alone. Branch
`<tab>-redesign`. Commit message: what changed in engine vs tab vs rail, the verification numbers,
and the repo's attribution lines. Delete temporary files you created (ask for delete permission if
the environment requires it).

## Tab status

| Tab | State |
|---|---|
| Population data | Done (reference) |
| In-silico predictors | Done (reference); `doc/PREDICTORS_TAB_REVIEW.md` |
| AlphaGenome | Rail in progress elsewhere; still shows `acmgStrength` PP3/BP4 tiers derived from an uncalibrated rank — must become the percentile |
| RNA splicing, Residue shifts & pockets, Structural perturbation, Multimer assembly, Functional domains, Protein interactions, Score thresholds, 3D structure | Not yet audited with this skill |
