# Energetics benchmark: rules fixed before the results

Written on 2026-11-18, before any result of the `bench/energetics` run was read. These rules decide
release criteria A5, A6 and A7. A rule changed after the results are seen must say so, and why, in the
release report.

## Values

- Every engine value is converted with `toCanonicalDdg` (`src/shared/engineStatus.ts`): positive means
  destabilizing, in kcal/mol. DynaMut2 and DDMut report the opposite sign natively and are negated;
  the other five engines are used as reported.
- Measured values are converted to the same convention. The conversion is checked on five signed
  examples per dataset (large buried residue to alanine or glycine must be destabilizing) before any
  statistic is computed. Correlation alone cannot reveal a sign or unit error, so this check is
  required, not optional.
- Destabilizing for ROC AUC means a measured value of at least 1.0 kcal/mol.

## Which variants count

- Eligible: every variant in the dataset with a measured value and a structure the engine accepts.
  A variant the engine did not score is reported as missing, with its reason, and is not silently
  dropped. Coverage (scored / eligible) is reported beside every statistic.
- RaSP and ProtVar cover human proteins only; their coverage is reported separately and their
  statistics are marked "partial set".

## Statistics

- Spearman, Pearson, RMSE and ROC AUC per engine and dataset.
- 95% intervals from 2,000 bootstrap draws (fixed seed) that resample whole proteins, never single
  variants. In Ssym a direct variant and its reverse are resampled together.
- Ssym reverse check: Pearson between direct and reverse predictions (ideal -1) and the mean bias
  (direct + reverse) / 2 (ideal 0), each with its interval.

## A6: agreement with the paper

- The comparator is the statistic the paper actually published, of the same type and on the same
  subset (for example, if a paper reports Pearson r on S669 direct, our Pearson r on S669 direct is
  compared with it). Each comparator is cited by paper, table and subset. An engine without a
  published figure for the set is "no comparator", not a pass.
- Pass: the published figure lies inside our 95% interval, or our interval lies above it.
  Fail: our interval lies wholly below it. A fail is treated as a possible fault in how the app
  calls the engine and is investigated before anything else.

## A7: held-out proteins

- Per engine: drop proteins in that engine's published training data (matched by UniProt accession;
  a protein that cannot be matched is dropped, not kept). Sources are cited per engine.
- Pass: lower bound of the 95% interval of ROC AUC above 0.5. Fewer than 20 destabilizing and 20 other
  variants left: "too few to judge", reported as unverified, not as a pass.
- An engine that fails A7 is shown with a warning on the panel; dropping it from the consensus is the
  user's decision, made with these numbers.

## A5: sign and units

- Pass: the signed-example check above passes, and on Ssym direct the Pearson with measured values is
  above 0. A negative value blocks the release.

## What is reported

For each engine and criterion: pass, fail, or unverified, with n, coverage, the interval and the
evidence file. The figures that decide a criterion are the ones from the commit named in the report.
