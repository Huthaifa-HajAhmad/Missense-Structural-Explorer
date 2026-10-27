# Residue-tolerance benchmark — reproducibility artifact for a NEGATIVE decision

This is not an adopted feature. It exists to make the decision in
[`doc/RESIDUE_TOLERANCE_DECISION.md`](../../doc/RESIDUE_TOLERANCE_DECISION.md)
falsifiable: the candidate tolerance scores benchmarked here (MetaDome, MTR3D-AF2, CCR and an
in-house count) all lost to the RMC score already in use, so nothing in the app imports this
directory, and the decision doc records why none of them was ingested.

The tests are offline and fast:

```sh
npx vitest run scripts/tolerance_benchmark
```

Do not re-propose a residue-tolerance metric without first falsifying
[the decision doc](../../doc/RESIDUE_TOLERANCE_DECISION.md).
