# Release note: popEVE leaves the PP3/BP4 vote; BayesDel and EVE scale fixes

**What users will notice**

- **popEVE is shown, not counted.** It moves from "Voting tools" to its own group, "Cross-gene severity", with
  a card that says what it measures and why it is not counted. Its authors publish cut-points for
  deleterious changes only (≤ −4.617, ≤ −5.056), so in the count it could add pathogenic votes but never a
  benign one. That pushed the PP3/BP4 count one way. popEVE is also trained with human population data,
  which PM2 and BS1 already use.
- **PP3/BP4 can change, always away from PP3.** Counted over every combination of calls from the six
  voting tools (9,216 with popEVE's four states; MetaRNN and ClinPred have no indeterminate call):
  - popEVE deleterious: 918 of 2,304 combinations change. 490 lose PP3, which they had only because of
    popEVE. 428 gain BP4, where popEVE's vote had cancelled a benign majority.
  - popEVE indeterminate or missing: no change, because the rule counts only pathogenic and benign votes.
  - popEVE timed out: the call is no longer withheld. 1,814 of 2,304 combinations now get PP3 or BP4,
    because a model that does not vote cannot make the vote incomplete.
  The combinations are not equally common, so these counts show which cases change, not how often.
- **Saved analyses:** none of the 8 analyses on hand (7 local, the 1 in production) changes. In all of them
  popEVE is above −4.617 or missing, and none timed out.
- **BayesDel is missing more often, never wrong.** The dbNSFP.org path used `BayesDel_addAF` when the noAF
  score was absent, then graded it on the noAF bands. A missing noAF score now stays missing.
- **EVE is gone.** On the MyVariant path, an EVE score (0 to 1, higher = harmful) was written into popEVE
  (a negative scale) when popEVE had none. A harmful EVE score of 0.85 read as a harmless popEVE score.
  EVE's guide entries are removed. Its attribution stays, because popEVE is built on EVE.

**What happens at deploy**

- The browser's saved analyses move to cache version `v4.14`, so no stored PP3/BP4 call from the old rule
  is replayed.

**Not changed, on purpose:** MetaRNN and ClinPred still vote. They are retired in Phase 5 of
`doc/IN_SILICO_PRUNING_PLAN.md`, together with the new single calibrated tool, so the vote changes once.
