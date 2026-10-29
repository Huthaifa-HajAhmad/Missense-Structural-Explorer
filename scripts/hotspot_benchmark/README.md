# 3D proximity benchmark: reproducibility artifact for an ADOPTION decision

The record is [`doc/HOTSPOT_3D_DECISION.md`](../../doc/HOTSPOT_3D_DECISION.md). `thresholds.json` was registered before any
score was joined to a variant; editing it invalidates the record, which quotes its sha256.

- `fetch.py` is the network step, run once; its output is committed in `data/`. SOD1, BRCA1 and LDLR reuse the tolerance
  benchmark's slices. VHL, SCN1A and KCNQ2 are sliced here with the same helpers, and all six AlphaFold DB models are stored
  with their sha256 in `data/manifest.json`.
- `benchmark.ts` is offline and takes about 14 s:

  ```sh
  npx tsx scripts/hotspot_benchmark/benchmark.ts
  ```

  It imports the production statistic (`src/shared/spatialClustering.ts`), so the benchmark grades exactly what the
  Hotspots view shows. It writes `results.json` and `results.md` and grades P3/P5 mechanically.
