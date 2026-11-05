# Release note: FoldX repair mode and cache version 5

**What users will notice**

- **FoldX values change for templates above 233 residues.** They used to run unrepaired first, and a whole-chain repair could later replace the answer. They now get one answer, from a repair of the region around the variant, labelled "Local repair". The old and new values for one variant can differ by more than a kcal/mol. Measured on S669, the new value is no further from experiment (`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`, section 9.3).
- **Templates of 233 residues or fewer keep the whole-chain repair.** On a slow host, a crystal structure with many truncated side chains may still get one unrepaired result first. That result is labelled and is not kept.
- **Verdicts are marked "Provisional" while a counting engine is still running.**
- **Companion engine values persist.** A revisit no longer loses StabilityOracle, RaSP or ProtVar because the model service happens to be down.
- **ThermoMPNN and VESM values change for every variant.** Both had bugs. ThermoMPNN was missing a layer, and VESM was not scored the way its authors publish. Both now follow the published method and are closer to lab data. ThermoMPNN's values spread more widely, so verdicts can change too (`doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md`, section 9.5).
- **StabilityOracle values change for every variant, and verdicts can change.** Its inputs and its sign conversion were wrong. A partner chain touching the site now counts when a supplied template holds one; the app's own templates hold one chain. It now follows the authors' published predictions (r 0.81 to 0.88, not an exact match) and is much closer to lab data (`doc/STABILITY_ORACLE_INPUTS_RESEARCH.md`). A few chains cannot be scored, because hydrogens cannot be added to them; the reader is told so.
- **NMR structures now use their first model only**, in FoldX, ThermoMPNN, DynaMut, StabilityOracle and SaProt. Values on NMR templates can change.

**What happens at deploy**

- **Rebuild the image.** The model service has a new dependency, `pdb2pqr`. The OCI compose file mounts `tools/model_server_app` from disk, so the new code can arrive without it, and then every StabilityOracle request fails. The image build with this dependency has not been tested yet.
- Stored values from the old code are not served: the server moves to cache version 5, and the browser's saved analyses move to `v4.10`.
- If the charge table or PDB2PQR is missing, only StabilityOracle stops, with a message saying which. The other engines keep working.
- The result cache key moves to version 5, so every stored FoldX result is computed again on its next request. These entries lasted only 24 hours anyway.
- Stored whole-chain repairs stay valid, so templates of 233 residues or fewer do not repeat their repair.
- Paired computers running a build from before this change: a result for a template above 233 residues is refused and the job goes to the server. Results for smaller templates are still accepted, but not cached.

**Not changed, on purpose:** FoldX still gets one chain. Sending partner chains was tested and made the error larger (bench doc section 9.7).

**To watch after deploy**

- The log line `[FoldX] No repair on this run` shows how often a run falls back to no repair. In-memory counters reset on restart, so use the logs.
- `FOLDX_FULL_REPAIR_MAX_RESIDUES` must stay equal to the repair time cap divided by the cost per residue. `budget.test.ts` fails if they drift.

**Re-measuring**

`npx tsx scripts/foldx-repair-benchmark.ts`, then add `--report --write-disclosure` to update the numbers the interface shows. If any shell number changes, change the `FIX_SHELL_MODE` id too.
