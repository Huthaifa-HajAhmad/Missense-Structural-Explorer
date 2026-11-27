# Common rules for fix workers (release coherence audit)

- Work in `C:\Users\HSA19\antigravity\release-coherence-audit` (git worktree, branch `audit/release-coherence`). Do not commit. Other fix workers edit OTHER files at the same time: touch only the files your brief owns. If a fix needs a file you do not own, do not edit it; list it in your report under "Needs another owner".
- First read `AGENTS.md`, `.agents/rules/*.md`, and the findings named in your brief in `doc/release-audit/review/group-*.md` (each finding has screens, quotes, producer file:line and a proposed fix). The captures behind them are in `doc/release-audit/raw/<variant>/tabs|views/*.txt|png`. Verify every finding in the code before fixing; if a finding is wrong, say so and skip it.
- Root causes, fixed once and centrally (prefer this over patching one sentence):
  - T1 run state reaches summaries: anything built from a source that is still running says so (provisional), never a final verdict.
  - T2 one state, one set of words: reuse the existing state-to-words helpers (`src/shared/providerStatus.ts`, `src/shared/engineStatus.ts`, `criterionStateLabel` in `src/shared/insightsEvidence.ts`); do not invent new synonyms.
  - T3 one count, one builder, and each count is named for what it counts.
  - T4 each explanation once per screen; the rail does not repeat the body.
  - T5 summaries name only readings that came back, plus explicit "not available" / "withheld".
- Test-first (`test-driven-development` habits): for each fix, a failing vitest test that states the intent, then the fix. Tests verify intent, not implementation details.
- Plain-English comments and UI text a non-native speaker understands. Small functions, files ≤300 lines where practical, match existing conventions. No engine-rule changes (which criteria apply and at what thresholds) unless your brief says so.
- After your edits: run the tests for the files you touched (`npx vitest run <paths>`), then `npx tsc --noEmit -p .` if quick. Do not run the whole suite (the lead does) unless your brief says so. If you add test files, `git add` them (staged, not committed).
- If you rename screen text or roles, grep `tests/*.e2e.ts` and update matching e2e expectations (they are in your ownership for that text only).
- Report (short, for the lead): per finding id → fixed / skipped (why) / wrong finding (why); files changed; tests added (names); test results with failures BY NAME; "Needs another owner" list; any bold proposal you recommend but did not build (merge/split/rename), with reasons.
