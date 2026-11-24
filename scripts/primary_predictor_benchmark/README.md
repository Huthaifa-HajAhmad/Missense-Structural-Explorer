# Primary Predictor Benchmark & CSpec Audit (Phase 5a)

Pre-registered evaluation of the four ClinGen-calibrated missense predictors in
`src/shared/thresholds/calibration.ts` (REVEL, BayesDel noAF, AlphaMissense, ESM1b)
against release-dated ClinVar ≥2-star missense variants and the production VM's
`data/dbnsfp_v5.sqlite` store, plus an audit of active ClinGen CSpec VCEP overrides.

- `PLAN.md` — Pre-registered hypotheses, cohort filters, subgroup definitions, statistical metrics, and selection rules.
- `metrics.py` — Pure-stdlib calibration bands, ClinVar/VCF parsers, AlphaFold fragment mapping, gene-cluster bootstrap, selection logic, and markdown/JSON reporting.
- `test_benchmark.py` — Unit tests pinning exact threshold parity with `src/shared/thresholds/calibration.ts`, parsers, bootstrap determinism, and selection/disagreement rules.
- `run_vm_benchmark.py` — End-to-end read-only VM runner joining ClinVar snapshots, `dbnsfp_v5.sqlite`, `g2p-context.json`, and AlphaFold v6 proteome pLDDT.
- `compare_chains.py` — Post-hoc amendment: scores whole fallback orders (first tool with a score answers) from `variant_calls.tsv.gz`, with the same metrics and paired bootstrap. `test_chain_comparison.py` covers it.
- `audit_cspec.py` — Fetches and classifies all Released non-legacy VCEP PP3/BP4 specifications from `cspec.genome.network`.

## Running Tests

```bash
python -m unittest discover -s scripts/primary_predictor_benchmark -p "test_*.py" -v
```
