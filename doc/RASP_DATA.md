# RaSP data: what is installed and how to extend it

RaSP (Blaabjerg et al., eLife 2023, doi:10.7554/eLife.82593) is a lookup in this app, not a
calculation. The index is `data/df_rasp_gnomad_clinvar.sqlite`, built by `npm run migrate:rasp`
(`scripts/build-rasp-sqlite.ts` → `server/services/stability/build-rasp-sqlite.ts`).

| Source | File | Proteins | Numbering | Tag in the index |
|---|---|---|---|---|
| Experimental-structure set (default) | `df_rasp_gnomad_clinvar.csv`, Zenodo 10.5281/zenodo.6835877; downloaded automatically when absent | 1,345 | Mostly UniProt; the authors note some positions were shifted to the structure's numbering | `experimental` |
| AlphaFold human proteome (optional) | `rasp_preds_alphafold_UP000005640_9606_HUMAN_v2.zip` from https://sid.erda.dk/sharelink/fFPJWflLeE | 23,391 | Full-length AlphaFold model, i.e. UniProt | `alphafold` |

With only the default set, most variants have no RaSP value, and the Energetics tab says so.

## Add the proteome predictions

```bash
# 1. Download and unzip the proteome directory (several GB) somewhere under the repo, e.g. data/
unzip rasp_preds_alphafold_UP000005640_9606_HUMAN_v2.zip -d data/

# 2. Rebuild the index with both sources (the CSV is used too when present)
npm run migrate:rasp -- --proteome data/rasp_preds_alphafold_UP000005640_9606_HUMAN_v2
#    or: RASP_PROTEOME_DIR=data/rasp_preds_alphafold_UP000005640_9606_HUMAN_v2 npm run migrate:rasp
```

The builder writes to `<index>.building` and swaps it in only after it has counted and verified the
rows, so the old index keeps serving if the build fails. Restart the server afterwards, or wait for
the next lookup; the loader re-verifies an index whose file identity changed.

What the ingester does with each PRISM file (`parsePrismRaspFile`):

- Reads `score_ml`, the ΔΔG in kcal/mol. It ignores `score_ml_fermi`, which is a [0, 1] transform.
- Takes the UniProt accession from the `AF-<accession>-F<n>` file name, falling back to the file's `uniprot:` header.
- **Skips `F2`, `F3`… fragment files.** AlphaFold splits proteins longer than 2,700 residues into fragments with local numbering. Offsetting them would be a guess, so those proteins get only their first 1,400 residues.
- Drops any row whose wild-type residue disagrees with the file's own `sequence:` header, so a numbering slip cannot enter the index.
- Logs the files it skipped, by reason.

## At lookup

When both sources hold a variant, the `alphafold` row wins, because its numbering is UniProt by
construction. The payload carries `energetics.raspSource` (which table served the value) and
`energetics.raspCoverage` (the installed index's own protein counts). The tab and inspector use both
to name the table, and to say how much is covered when a variant is not.

## Compatibility

Index schema v3 adds the `source` column and per-source counts. A v2 index, the experimental CSV
only, is still read unchanged, so upgrading does not switch RaSP off before a rebuild.
