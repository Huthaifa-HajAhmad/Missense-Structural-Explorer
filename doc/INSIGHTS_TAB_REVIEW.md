# Insights tab (Synthesis): review

Reference variant: NAE1 p.Asp116Gly (Q13564). The tab is rebuilt as a consolidator: it reads the recorded call of
each evidence tab, shows where they agree and disagree, and states the rule engine's tier and what would move it.
It adds no science and no combined score.

## Findings and what changed

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Critical | The verdict badge and the rail's "N Met" counted model-proposed codes the tier never used. | Both count `partitionCriteria(...).engine` only. |
| 2 | Critical | The model proposed PM2 with no frequency in its prompt, and the server kept it because the engine had not fired PM2. | Proposals for engine-owned codes (`ENGINE_OWNED_CODES`) are dropped in the server merge and again on the client; a test reads `criteria.ts` and fails if the list stops covering what the engine can emit. |
| 3 | High | The rail said the narrative was "reconciled with rule-based ACMG criteria". | Wording states the criteria list is merged and the prose is not checked. |
| 4 | High | ClinVar tone was `includes("pathogenic")`, painting "Conflicting…pathogenicity" red. | The ClinVar block is removed (Population Data owns it). |
| 5 | High | The JSON export stated model names and `appVersion` as literals. | Removed; only `narrativeModel` from the payload is exported. |
| 6 | High | The rail's synthesis directions were the live search box. | Still the box (the run does not record what it used), now labelled as such. **Not fixed at source.** |
| 7 | Medium | The prompt asks for structural hypotheses "based on peptide chain coordinates" and gives none. | **Not changed** (needs a prompt-version bump). The tab now lists what the model was and was not shown (`NARRATIVE_PROMPT_EVIDENCE`, test-checked against the prompt). |
| 8 | Medium | The PP3 line was a frozen string. | The rail reads the vote live from `buildPredictorEvidence`; a recorded/current tier mismatch is flagged. |
| 9 | Medium | No marker when a narrative saw less evidence than the tab shows. | Partly: the footer names what the model was shown. No per-run "written before X arrived" marker yet. |
| 10 | Medium | "Consensus" and "Combinatorial rule" were wrong names. | "Rule-engine classification"; weighting shown. |
| 11 | Low | Radar, Multimer callout, ClinVar block and splicing alert repeated other tabs. | Removed; each is a board lane linking to its tab. |
| 12 | Low | Vendor name in the loader; emoji in prompt headers. | The vendor-named loader line went with the old panel. Prompt headers **not changed**. |
| 13 | Low | "Database-verified" misnames rule-engine codes. | Labels are "Rule engine" and "Model-proposed". |

The AUC calibration chips in the review screenshot were already removed from `main` (55c035d).

## What the tab is now

1. Verdict card: engine tier, five-tier scale, and the smallest additions that reach the next tier, found by running
   `classifyVariant` (moved to `src/shared/acmgClassifier.ts` so the browser runs the same rule) on hypothetical codes.
2. Evidence board: one lane per area (computational, population, splicing, function, stability, assembly, sequence models).
   A solid bar means the engine recorded a code; a dashed bar leans but is not counted and carries no magnitude.
3. Compare and contrast, generated from the lanes' calls.
4. Model proposals for codes the engine cannot compute, dashed and uncounted.
5. Still needed to decide, a plain-language guide (collapsed), and the condensed clinical summary.

Rail: how the case was built, the live in-silico vote, narrative method, directions, sources.

## Decisions taken

Model proposals for engine-owned codes are hidden (recommended option; the owner did not answer the card before "go").

## Not done

- The stability lane reads the Energetics consensus; residue-change and burial context are not a lane yet.
- Sequence-model and assembly lanes never lean by an engine code because the engine has none for them.
- Tier-gap wording assumes the standard Richards 2015 rule the engine implements; it does not model ClinGen point-based scoring (Tavtigian 2020).
- Not checked against a live backend payload: the board was rendered from an NAE1-shaped fixture.

## Sources

Richards et al. 2015, Genet Med, doi:10.1038/gim.2015.30. Pejaver et al. 2022, AJHG, doi:10.1016/j.ajhg.2022.10.013.
