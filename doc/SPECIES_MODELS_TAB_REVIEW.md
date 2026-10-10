# Species & models review

10 October 2026. Split from Expression & models and implemented as a dedicated Evidence workspace.
See [Context workspaces review](CONTEXT_WORKSPACES_REVIEW.md) for the audit, architecture,
verification and outstanding source limitations.

The three main views are Alliance orthologs, Ensembl variant-site alignments and curated model
phenotypes. Every one-to-many ortholog remains available; grouping uses taxon identity. Pins expose
provider-specific IDs, exact mapping and phenotype coverage. No cross-provider gene equivalence
is inferred from a species label, and no model observation supplies an automatic ACMG vote.

The IMPC source panel now renders every returned screen and preserves unknown availability.
Partial phenotype parsing and per-ortholog failures remain visible. Allele/assay/sex/age details
not present in the current provider contract are explicitly unavailable, not invented.
