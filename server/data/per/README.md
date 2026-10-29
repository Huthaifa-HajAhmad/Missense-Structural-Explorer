# Published pathogenic-enriched regions (PER)

`per-regions.json.gz` is built by `npm run data:per -- <dir>` (`scripts/import-per-regions.ts`) from the result tables of
Pérez-Palma E, et al. *Identification of pathogenic variant enriched regions across genes and gene families*. Genome Res
2020;30:62-71, doi 10.1101/gr.252601.119. Source: <https://github.com/dlal-group/PERs>, `db/`, last commit 2019-12-10.

It holds, per gene, the region bounds in that gene's protein numbering, the region's residues (so the app can check them
against the protein it is looking at), and the odds ratio and adjusted p of the window that defined it. It holds **no variant
list**. The authors' data are ClinVar (October 2019) P/LP plus HGMD Professional 2019.2 disease mutations against gnomAD 2.0.2;
the repository masks HGMD genomic information and disease associations as `NA`, and this file inherits that.

## Licence, checked 2026-10-29

- The repository's `LICENSE` is the unmodified MIT text (copyright 2019 dlal-group), with no non-commercial clause. Its README
  describes the `db/` result tables as part of the repository.
- The article's text is CC BY-NC 4.0 after the journal's embargo; that covers the paper, not these tables.
- Not established: whether HGMD's own terms constrain a derived region table. Nothing here reproduces HGMD records, and the
  authors publish the same tables under MIT, but this is a reading of those two facts, not legal advice. If it matters for a
  deployment, ask the authors or HGMD.

## What it is not

The regions are 2019 results on GRCh37 canonical transcripts. Each is verified residue by residue against the AlphaFold
model's sequence before it is shown (`hotspots.ts`); a region that cannot be placed is withheld, not drawn. A gene absent from
the table was either tested with no region found or never tested: the file cannot tell them apart.
