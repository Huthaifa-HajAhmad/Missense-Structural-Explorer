# Calibrated biophysical stacking — retired

This page used to describe a two-stage "calibrated consensus": per-engine isotonic curves fitted on
the Tsuboyama mega-scale set, S669 held out, homology filtering, and Venn-ABERS conformal intervals.
**None of that was implemented.** `tools/train_stacker.py` downloaded nothing, filtered nothing, and
wrote hand-typed bins to `src/shared/stacking_config.json`; the per-context AUC weights in
`src/shared/protein_class_calibration.json` had no source either. The "calibrated probability",
"90% conformal interval" and "95% CI" that the app showed came from those literals.

All of it was removed in the Energetics review (`doc/ENERGETICS_TAB_REVIEW.md`). The stability
consensus is now an agreement count (`computeStabilityConsensus` in
`src/shared/thresholds/consensus.ts`, rule in `src/shared/energeticsEvidence.ts`): how many engines
that returned a value pass their own local destabilizing mark, plus their median ΔΔG and range, as a
closed-set verdict.

## If you want a calibrated probability back

It needs, checked into this repository:

1. a script that downloads the named datasets and builds the training and held-out sets
   reproducibly (pinned versions and checksums), with homology filtering that actually runs;
2. the fitted parameters, written by that script, never by hand;
3. an evaluation on the held-out set (calibration curve, Brier score, interval coverage) whose numbers
   the UI cites;
4. a test that fails if the parameters file changes without the evaluation being regenerated.

Until then, no surface may show a probability of destabilization.
