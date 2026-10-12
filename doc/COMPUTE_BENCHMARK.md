# Compute benchmark

Wall time and peak memory of FoldX and P2Rank, measured by `npm run compute:benchmark`
(`scripts/compute-benchmark.ts`) the way production runs them. One section per machine class;
the JSON beside this file (`doc/compute-benchmark/`) holds the same numbers for tools.

- Memory is the peak of the whole process tree (Box64 + FoldX, or the P2Rank script + its JVM).
- **Prior** is what the placement engine assumes TODAY before it has eight jobs of its own telemetry
  (`foldxPriorP50Ms`, `src/shared/computeRouting.ts`), recomputed each time this file is rendered.
  Native RepairPDB is anchored on the SOD1 row below. P2Rank has no time prior.
- One run per row: a single measurement, not a distribution. The engine learns the spread from telemetry.
- Structures are AlphaFold models with one mutation in the middle of chain A. Production skips
  RepairPDB for AlphaFold models; here it is forced on an AlphaFold model (400 residues or fewer),
  so the RepairPDB row is a LOWER BOUND for the experimental structures production actually repairs
  (an AlphaFold model has almost nothing to repair).
- A BuildModel row marked `repaired input` ran on RepairPDB's output, so it is not comparable to a
  BuildModel row on the cleaned model.

## x64-native-20c-16g

Measured 2026-10-11 on win32/x64, 20 cores (13th Gen Intel(R) Core(TM) i7-13700H), 16 GiB.
Tools: foldx 5.1, p2rank 2.6-alpha; this FoldX build stops working on 2027-01-31.

| Tool | Step | Structure | Residues | Result | Wall time | Prior | Peak memory |
|---|---|---|---:|---|---:|---:|---:|
| FoldX | RepairPDB | SOD1 | 154 | completed | 49 s | 49 s | 57 MiB |
| FoldX | BuildModel x5 | SOD1 | 154 | completed (repaired input) | 4.2 s | 2.3 s | 70 MiB |
| P2Rank | predict | SOD1 | 154 | completed | 4.4 s |  | 444 MiB |
| FoldX | BuildModel x5 | GCK | 465 | completed | 2.6 s | 3.3 s | 155 MiB |
| P2Rank | predict | GCK | 465 | completed | 4.6 s |  | 520 MiB |
| FoldX | BuildModel x5 | SLC12A4 | 1085 | completed | 17 s | 5.4 s | 425 MiB |
| P2Rank | predict | SLC12A4 | 1085 | completed | 5.3 s |  | 480 MiB |
