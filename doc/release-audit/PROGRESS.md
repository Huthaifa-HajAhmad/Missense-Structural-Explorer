# Release coherence audit — progress note

Worktree: `C:\Users\HSA19\antigravity\release-coherence-audit` (branch `audit/release-coherence`, from origin/main b740430e = production).
Audit server: VM container `coherence-audit` (prod image oci-b740430e, AUTH_MODE=accounts, 127.0.0.1:3200), env in `/home/ubuntu/coherence-audit/env`.
Local tunnel: `ssh -N -L 3200:127.0.0.1:3200 ubuntu@92.5.173.166` → http://localhost:3200.
Remove when done: `ssh ubuntu@92.5.173.166 "docker rm -f coherence-audit && sudo -n rm -rf /home/ubuntu/coherence-audit"` (root-owned files require `sudo -n`).

Groups: (a) Population, Gene–disease, Dosage; (b) Structure/Residue shifts, Energetics, Interfaces & PPI, Functional domains, Hotspots;
(c) Expression, pext, Species & models; (d) RNA splicing, AlphaGenome; (e) Predictors; (f) Report, Comparison, Summary & notes.

## Status 2026-11-27 (final)
- All 14 signed-in captures finished (`raw/`): 12 `ok`, 2 harness label-wait timeouts (`ABCG1_G358R`, `TP53_K132N`; final streams returned HTTP 200), zero 401 errors.
- Fact matrix (`fact-matrix/README.md`), ClinGen comparison (`clingen/comparison.md`), and capture diagnostics (`clingen/capture-diagnostics.md`) complete.
- Independent reviews complete (Codex 6.2 Astra): `review/advisor-rereview.md` (**ClinGen comparison PASSED**, all 8 cases / 43 rows verified) and `review/advisor-final-signoff.md` (**CLEAR FOR MERGE** after verifying all 6 re-review blockers, Group-F F9/F14, and both live-replay UI fixes).
- Live Release Gate replay (`PORT=3917`, `AUTH_MODE=legacy`): `smoke.e2e.ts` & `chip-contrast.e2e.ts` (3/3), `urod-population.e2e.ts` (1/1), and full live browser/export/a11y replay (`TP53 p.Lys132Asn` vs `NM_000546.6:c.396G>C`, `ABCG1 p.Gly358Arg` with all 4 exports default/edited/excluded, `TP53 p.Arg175His`, `SOD1 p.Ala5Val`) **all passed**. Two UI bugs caught during replay (`InterfaceOverview.tsx` duplicate `"peptide"` key; `ReportReviewStatus.tsx` hiding gaps when a section is flagged) were fixed and re-verified.
- Verification: `npm run map` clean; `npm run lint` (1,586 files, `tsc --noEmit`) **0 warnings / 0 errors**; Vitest suite passing across all active test files.
- Final audit report updated in `doc/RELEASE_COHERENCE_AUDIT.md`.

## Steps
- [x] Panel chosen (`panel.json`); ClinGen erepo downloaded (`raw/erepo/erepo.tsv`, 2026-11-27)
- [x] W1 capture harness → `raw/<variant>/` (14 signed-in captures)
- [x] W2 inventory (tab registry, shared-fact sites, states) → `inventory/`
- [x] W3 staleness (retired names, docs reconciliation) → `staleness/`
- [x] W4 dead code + design rubric → `code-health/`
- [x] Fact matrix → `fact-matrix/`
- [x] ClinGen comparison & capture diagnostics → `clingen/`
- [x] Usability review per group (screenshots) → `review/group-*.md`
- [x] Codex 6.2 Astra reviews (`review/advisor-codex.md`, `review/advisor-fixes-review.md`, `review/advisor-rereview.md`, `review/advisor-final-signoff.md`) — ClinGen comparison PASSED; final code sign-off **CLEAR FOR MERGE**
- [x] All fix waves + all 6 re-review blockers + F9/F14 + live-replay bugfixes + `npm run map` + `npm run lint` + Vitest
- [x] Live Release Gate browser, 4-format export, and accessibility replay (`smoke`, `chip-contrast`, `urod-population`, `TP53 K132N` / `c.396G>C`, `ABCG1`, `TP53 R175H`, `SOD1`)
- [x] Report updated (`doc/RELEASE_COHERENCE_AUDIT.md`)
- [x] Temporary audit VM container (`coherence-audit`) and `/home/ubuntu/coherence-audit` removed
- [ ] Human teammate review of exported files + live Worker invite/reset link smoke test after deploy + deferred doc archive PR (53 files)
