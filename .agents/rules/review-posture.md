---
trigger: always_on
description: Boundaries for reviewing and bug hunting — a feasibility matrix for what a review may read, what a bug hunt may change, and where either must stop and escalate.
---

# Boundaries: reviewing vs bug hunting

Two different activities wear the word "review" in this repo. Keep them apart.

- **Reviewing** audits a surface against a standard and produces findings. It is **read-only**: it may
  not edit, may not widen its own scope, and may not go green by weakening a test.
- **Bug hunting** fixes a defect. It may edit, but only inside a bounded surface, and it must carry the
  fix to every copy the standard names.

Neither is "search until something looks wrong". The boundary is the reviewed surface **plus the copies
a fix must reach**, and nothing else. This is separate from the ESLint `boundaries` rule (that one is
module import edges); when this file says "boundary" it means *what the agent is allowed to touch*.

## The feasibility matrix

Ranks use the repo's planning scale — Value and Effort **1 (low) → 5 (high)**, Risk **1 (reversible,
local) → 4 (changes what the product claims or what the engine classifies)**. Lead judgement, not
measurement. The `#` cells are referenced by the stop rules below.

| # | Activity | Lane | V | E | R | Default authority | Bound — may touch | Gate / stop rule |
|---|---|---|---|---|---|---|---|---|
| 1 | Trace the evidence chain (tab → panel → shared model → server → rail) | Review | 4 | 2 | 1 | read-only | nothing | always allowed |
| 2 | Integrity + data-presentation audit (`integrity-checklist.md`, `data-presentation.md`) | Review | 5 | 3 | 1 | read-only, findings only | nothing | findings go to `doc/<TAB>_REVIEW.md`, no edit |
| 3 | Verification runs (`tsc`, `lint`, `vitest`, render) | Review | 3 | 3 | 1 | read-only | nothing | never edit/skip a test to go green |
| 4 | Propagation scan (grep old numbers/labels across `src/` and `server/`) | Review | 4 | 2 | 2 | read-only, findings | nothing | hands off to **5**, or files a named follow-up |
| 5 | Fix a defect wholly inside the reviewed surface | Bug hunt | 5 | 2 | 2 | edit in scope | tab + panel + `shared/<tab>Evidence.ts` + rail + `<tab>.css` + its tests | — |
| 6 | Fix a shared invariant (thresholds, engine parity, attributions) | Bug hunt | 5 | 4 | 3 | edit **+ propagate** | the one source of truth and every copy row 4 found | every copy updated, or a named follow-up |
| 7 | Change what the rule engine classifies (a criterion, a strength, which tools vote) | Bug hunt | 5 | 4 | 4 | **STOP — owner's decision** | nothing until answered | one `AskUserQuestion`, findings in the question, recommended option first |
| 8 | Defect outside the reviewed surface (adjacent tab, unrelated module) | Review | 2 | 3 | 3 | report only | nothing | record as follow-up; do not chase |
| 9 | Defect inside another agent's concurrent work | Review | 1 | 2 | 4 | never edit | nothing | note it; preserve their tree; re-read shared files before editing |
| 10 | Opportunistic cleanup (dead code, unused exports, dependency bump, refactor) | neither | 2 | 2 | 3 | not part of either lane | nothing | separate task; out of scope by default |

Rows 5–7 are the **only** rows that may write. Rows 1–4, 8–10 produce findings. Risk 3–4 rows are where
the boundary is actually enforced, not where judgement is allowed to drift.

## Stop rules

1. **A review that edits is a bug hunt.** Label it as one, and name the surface it is allowed to change.
2. **Authority is the reviewed surface, not the diff.** Reaching a copy outside it (row 6) is sanctioned;
   reaching a neighbouring feature (rows 8–9) is not.
3. **One decision is the owner's** (row 7). Ask once, with the finding and the recommended option in the
   question. Everything reversible — wrong labels, wrong citations, swapped bars, drifted copies — is a
   fix, not a question.
4. **Off-task guard.** A defect found outside the bound is recorded, not chased. Chasing it is a new task
   with its own surface; it never rides along inside the current one.
5. **Never widen scope to pass a check, and never delete or skip a test to go green.** Update a test whose
   expectation encoded the old wrong value, name the corrected rule, and cite the new source.
6. **When in doubt, downgrade authority:** report instead of fix, and let the owner promote it.
7. **Preserve concurrent work.** Record the tree you started from; do not switch a shared branch or stage
   another agent's files.

## Explicitly out of scope for both lanes

Unrequested design changes, dependency upgrades, broad refactors, dead-code sweeps, branch moves, and any
edit to a file another agent is mid-edit on. These are separate tasks even when the defect is real and the
fix is small.
