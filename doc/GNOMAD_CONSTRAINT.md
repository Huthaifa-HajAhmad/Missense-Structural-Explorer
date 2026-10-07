# Pinned gnomAD constraint data

The header and ACMG constraint inputs use the official **v4.1.2 gene constraint** release on GRCh38. Regional missense intervals are an independent **v4.1.1** product. The live frequency API remains `gnomad_r4`; it does not supply these pinned constraint values.

## Runtime and deployment

`server/data/constraint/gnomad-4.1.2.json.gz` contains a compact projection of the official sources: 86,491 protein-coding transcript records and 40,435 regional intervals. It is committed with its SHA-256 manifest. The server validates the compressed snapshot checksum before building an in-memory gene/transcript index on first use. There is no network download on the analysis path.

`npm run build` copies the snapshot and manifest to `dist/constraint`, which both Docker images already include through their distribution copy. The production loader reads that copy; development reads the source directory. Missing/corrupt snapshots raise an error and appear as unavailable evidence, rather than falling back to an older release or treating the gene as tolerant.

To deliberately rebuild the same pinned release:

```powershell
npm run data:constraint
npm run build:constraint
```

The importer streams the approximately 574 MB BGZF source, keeps the needed columns without rounding, validates records, and downloads the 3.8 MB regional TSV. It records hashes of both original sources and the compact snapshot, and refuses to write a snapshot unless the downloaded bytes match the pinned `CONSTRAINT_SOURCE_SHA256` / `REGIONAL_SOURCE_SHA256`, so a silent upstream replacement cannot redefine a release. No intermediate raw download is stored. A future release upgrade must update `src/shared/constraintSource.ts` (release constants and pinned source hashes), regenerate the snapshot, review threshold guidance, and update the persisted-analysis retirement policy together. Do not silently refresh data at startup.

## Identity and quality rules

- Exact Ensembl transcript identity is preferred. An explicitly supplied version must agree. Otherwise a unique MANE Select reference is preferred, then a unique canonical reference, then a sole protein-coding transcript for the gene. Ambiguous reference selection yields no call — never a thrown provider error the user is told to retry — and row order never decides.
- A reference transcript's gene metrics are identified as reference context. Regional calls require an exact annotated transcript and a locus already verified by the pipeline's allele-identity resolver.
- Regional coordinates are GRCh38 **1-based inclusive** genomic ranges, not amino-acid positions. Both endpoints are tested; overlapping matches are refused. The regional file uses chromosome names with `chr`, normalized at import. Indels, unknown builds and protein-only positions do not produce a regional call.
- Gene flags, missing/zero expected counts, and regional low-coverage flags withhold interpretation. The payload retains the quality flags, expected counts, raw metrics, transcript/version, release, source URL and source hashes. Only usable metrics reach the engine.
- A regional depletion call uses the app's existing significance filter (`p < 0.05`) with `O/E < 1` and passed QC. It is descriptive context, not an ACMG criterion. Failed QC, nonsignificance, missing identity and missing intervals have distinct states.
- Values are classified at source precision; rounding is exclusively presentational. The header discloses off-scale markers rather than implying that its display window bounds the score.

The header's Z bands are app-defined. Its PP2 text describes the app's input proxy (`Z >= 3.09` and missense `O/E < 0.6`), not a ClinGen-wide calibration or the final recorded criterion. LOEUF is LoF constraint context; the engine does not use it to award a criterion. Current optional pLoF constraint guidance is **LOEUF <0.45**; **<0.36** is the MANE Select strongest-10% reference cutoff. v4.1.2 retains the v4.1.1 score values and fixes rank/bin computation.

Legacy saved values without release provenance remain readable but are not interpreted using current thresholds. Persisted analyses from earlier constraint releases are retired on lookup; external cache schema v9 also retires the old rounded v2 entries. Gene-only cache healing cannot restore regional evidence.

The Landscape overview uses a protein axis. Its old v2 regional lane mixed transcript numbering and parsed amino-acid fields out of a genomic source. The lane now carries an explicit status — `available`, `none` (the source answered; no constrained sub-region), `withheld-mapping` (v4.1.1 intervals exist but no verified transcript-to-protein mapping), or `unavailable` (the source did not answer) — instead of calling every empty map "not loaded", and it never projects genomic ranges onto the axis. ClinVar and frequency lanes remain available; the header can show regional evidence when the verified genomic identity is present.

## Validation

`gnomad.test.ts` covers precision boundaries, transcript/version mismatch, GRCh38 identity, inclusive interval endpoints, overlaps, invalid p-values, QC, nonsignificance and actual packaged scores/rank bins. Header model tests cover source errors, pending/no-result states, legacy payloads, QC and release-specific LOEUF guidance. SQLite tests cover retirement of previous release conclusions. The geometry harness exercises the real header styles and fonts at desktop and narrow widths.

## Sources

- [Official v4.1.2 release](https://gnomad.broadinstitute.org/news/2026-09-gnomad-v4-1-2/)
- [v4.1.1 methods and LOEUF guidance](https://gnomad.broadinstitute.org/news/2026-03-gnomad-v4-1-1/)
- [Gene constraint source](https://storage.googleapis.com/gcp-public-data--gnomad/release/4.1.2/constraint/gnomad.v4.1.2.constraint_metrics.tsv.bgz)
- [Regional constraint source](https://storage.googleapis.com/gcp-public-data--gnomad/papers/2026-rmc/gnomad_v4.1.1_all_mcrs.tsv)
- [gnomAD source field mapping](https://github.com/broadinstitute/gnomad-browser/blob/main/data-pipeline/src/data_pipeline/datasets/gnomad_v4/gnomad_v4_constraint.py)
