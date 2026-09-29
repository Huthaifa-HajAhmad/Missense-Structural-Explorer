# Multimer assembly tab: review and redesign

Reference variant: NAE1 p.Asp116Gly (UniProt Q13564). UniProt's SUBUNIT record for Q13564 reads
"Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2". The old
tab showed "Physiological monomer" for it.

Nothing on this tab feeds the ACMG engine, before or after. No classification changes.

## Findings

| # | Severity | Defect | Fix |
|---|---|---|---|
| 1 | High | `uniprot.ts` read the SUBUNIT text from `comment.note.texts`. UniProt REST puts it at `comment.texts`, so it was null for every protein, and every protein was called "a single-chain monomer under physiological conditions". The test mocks copied the wrong shape. | Read `texts` (keep `note.texts` as a fallback); mocks use the real shape; the features cache key moves to `…_subunit2_…` so stored nulls are retired. |
| 2 | High | No SUBUNIT record was read as "Monomer". | New `unstated` kind and `not-modelled` status; the tab says "UniProt states no assembly" and that absence is not evidence of a monomer. |
| 3 | High | The Insights card's "Quaternary assembly detected" warning never fired (same null) and named Boltz-1/Chai-1. | Fixed by #1; `isMultimer` now comes from the shared parser; copy points to this tab. |
| 4 | High | Substring parsing: "The complex binds…" became "Oligomeric Complex (A2)"; "hetero" anywhere beat "Homodimer"; "Homodimer; can form a homotetramer" became a tetramer; a second regex decided `isMultimer`. | `src/shared/multimerAssembly.ts`: the first sentence that names an assembly decides, word-bounded, later assembly words shown as "Also stated"; one parser for server and client. |
| 5 | High | A heteromer was a red "Complex Modeling Unavailable" failure ("automatic sequence cloning prohibited"). | Heterodimers are modelled when the SUBUNIT sentence names exactly one partner that UniProt resolves (curated INTERACTION list first, then a reviewed human gene search). Otherwise `not-modelled` with a stated reason. |
| 6 | High | `mutationInterfaceDisrupted` was true for any contact within ±4 residues in sequence (±2 in the tab's chips, ±4 again in Protein interactions), shown as "directly disrupts inter-chain contacts". Only the mutant complex is modelled, so no loss was ever measured. | `variantContacts`: the variant residue itself must be in a contact; `resB` is matched only in a homomer. Copy says "at an interface", and the tab says a contact in the variant model is not a lost contact. Protein interactions uses the same function. |
| 7 | Medium | A hexamer was modelled as 4 chains and still labelled "Homohexamer (A6)". | Above four chains the assembly is stated, not modelled (`too-many-chains`). |
| 8 | Medium | A variant whose reference residue did not match the sequence was modelled anyway. | `reference-mismatch`, not modelled. |
| 9 | Medium | "ipTM ≥ 0.80 indicates high-confidence" had no source, and any ipTM was coloured green. | `THRESHOLDS.complexConfidence` (0.8 / 0.6) from EMBL-EBI's AlphaFold-Multimer guidance, labelled as the authors' guidance, drawn neutral; Boltz-2 has no cut-points of its own. |
| 10 | Medium | Prose claimed OpenFold3 (never called), "heavy-atom distance ≤ 4.5 Å" (the provider's contacts are used as given), "Tenstorrent superclusters", hard-coded "Tier 1 · JapanFold" and "Swiss-Prot Curated". | Removed; the rail's sources come from the payload. |
| 11 | Low | The complex model was never shown, the contact table silently kept the first 8 rows and never named the partner chain, and a stored payload from the broken service was rendered as final. | Download of the model; only the variant's own contacts, with the total; partner chain named; payloads without `assembly` are re-requested. |

## What the tab shows now

1. The finding: the stated assembly as the headline, one sentence on the interface, an assembly
   diagram (chains, the variant's chain outlined, the variant placed on the seam, beside it or off
   the chain when nothing measured it), and a fact strip ending in "Engine record: None".
2. Where the interfaces are: one sequence axis with UniProt domains, the modelled interface, each
   solved-structure partner interface from PDBe-KB, and the variant ruled across all of them.
3. Readings: curated assembly, predicted complex (ipTM on its ruler, pTM, the variant's contacts),
   solved structures per partner.
4. Contacts made by the variant residue, and a download of the model.

The rail is a five-step trace (curation, partner, model, interface, engine), the ipTM guidance with
this model's region marked, method notes and sources.

## New data source

PDBe-KB interface residues (`https://www.ebi.ac.uk/pdbe/graph-api/uniprot/interface_residues/{acc}`),
read in `server/services/external-api/pdbe-interfaces.ts`. A 404 is "no interface recorded"; any other
failure is a provider error and is never shown as "no interface".

## Also in this change

Evidence sub-tab order: Population data, Functional domains, In-silico predictors, AlphaGenome, RNA
splicing, Residue shifts & pockets, Structural perturbation, Multimer assembly, Protein interactions,
Score thresholds (`EVIDENCE_SUB_ITEMS` only).

## Not done

- No wild-type complex is modelled, so loss of contact is not measured.
- Heteromers larger than dimers, and complexes, are stated but not modelled.
- The live UniProt INTERACTION shape and the PDBe response were checked against documentation and
  unit fixtures, not against a live call from this environment.
- The model is offered as a download, not rendered in the 3D viewer.

## Sources

- UniProtKB Q13564, SUBUNIT comment.
- Passaro S, et al. Boltz-2. bioRxiv 2025. doi:10.1101/2025.06.14.659707
- Evans R, et al. Protein complex prediction with AlphaFold-Multimer. bioRxiv 2021. doi:10.1101/2021.10.04.463034
- EMBL-EBI AlphaFold course, "Confidence scores in AlphaFold-Multimer" (ipTM > 0.8 confident, < 0.6 likely failed, grey zone between).
- PDBe aggregated API documentation, https://www.ebi.ac.uk/pdbe/graph-api/pdbe_doc/
