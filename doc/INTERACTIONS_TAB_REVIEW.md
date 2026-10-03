> **Superseded.** The Protein interactions tab no longer exists. It was merged with its sibling into
> **Interfaces & PPI** (`interfaces`; the old ids `multimers` and `interactions` redirect to it).
> See [INTERFACES_AUDIT.md](INTERFACES_AUDIT.md) for what changed and why. The findings below are kept
> as the record of the earlier tabs; the files, classes and functions they name are gone.

# Protein interactions tab: review

Reference variant: NAE1 p.Asp116Gly (UniProtKB Q13564). Built on the Multimer assembly change (PR #5),
which fixed the UniProt SUBUNIT parsing that labelled every protein a monomer. Nothing on this tab
feeds the ACMG engine, so no classification changes.

## Findings

| # | Severity | What was wrong | Evidence | Fix |
|---|---|---|---|---|
| 1 | Critical | ΔΔG_bind sign read backwards. DDMut-PPI values ≥ 1.0 were "Interface disruptive" and the footnote said a positive value weakens binding. DDMut-PPI reports reduced affinity as ΔΔG ≤ 0, so a strongly weakening prediction read as "Surface neutral". | Zhou et al. 2024: "mutations that reduce binding affinity (ΔΔG ≤ 0 kcal/mol)". | Value carried with `signConvention: "negative-weakens"`; words "weaker/stronger binding"; classes removed. |
| 2 | Critical | DDMut-PPI was given the Multimer tab's complex as its wild type. That model carries the variant on chain A, so the substitution was applied to a residue already substituted. | `multimer.ts` ("Chain A carries the variant"); old tab sent `complexPdb` as `wtPdb`. | New `POST /ppi/binding-shift`: models the same chains again, all wild type (Boltz-2), checks the reference residue, then runs DDMut-PPI on chain A. Run on request. |
| 3 | High | One number, two unsourced classifiers: DDMut-PPI classes at 1.0/0.5, the tab coloured at OpenBind 1.5/0.5. "Allosteric perturbation" is a mechanism a ΔΔG cannot show. | `ddmut-ppi.ts`, `THRESHOLDS.openBind`. | No classes; signed ruler centred on 0, no bands; the authors' reported performance shown instead. |
| 4 | High | "JapanFold OpenBind-0 (Tier 1)" named by default, and described as computing steric clashes and electrostatics, but the tab always sent `mutPdb: null`, so it never ran. | Old `InteractionsTab.tsx`, `EvidenceInspector.tsx`, `ppi.ts`. | OpenBind path removed from the PPI service; the rail names only what served a value; attribution corrected. |
| 5 | High | "Swiss-Prot records no residue-level subunit interface annotation for NAE1" was false. UniProt maps REGION 331–344 and SITE 211, "Interaction with UBA3". The filter dropped every Region and Site, required "interface"/"subunit", kept only `start`, capped at five. | UniProtKB Q13564 flat file. | `readInteractionSites`: Region/Site/Binding site/Motif whose note is an interaction; full ranges; partners parsed from the note; no cap. |
| 6 | High | "Monomer · Intramolecular: residue is internal to the single-chain structure · ΔΔG N/A" for a heterodimer. Root cause fixed by PR #5; the tab still claimed "internal" from curation with no structure read, and restated the assembly. | Old tab lines 244–330. | Assembly stated once, on the Multimer tab (linked); proximity chip removed. |
| 7 | Medium | STRING functional association wore green "Highest" chips and green bars, reading as benign and as binding. | Old tab; STRING API default network type is functional. | Neutral ink; STRING-only partners grouped "Functional association only". |
| 8 | Medium | UniProt's curated IntAct partners (APP, HEXB, UBA3) and solved interfaces (PDBe-KB) were never shown. | UniProtKB Q13564 INTERACTION. | One partner grid: SUBUNIT, IntAct, solved, STRING per partner, joined by accession then symbol. |
| 9 | Medium | A STRING row with no score defaulted to 0.4, the medium band floor. | `string.ts`. | Row skipped. |
| 10 | Medium | Partner links used `string-db.org/network/9606.<GENE>`; STRING documents `/cgi/network?identifiers=…`. | STRING API help. | Documented form, both proteins named. |
| 11 | Low | "v12.0" hard-coded; no `caller_identity`. | Old rail; `string.ts`. | Version removed; `caller_identity` sent. |

## Decision taken

Asked the owner whether to hide ΔΔG_bind until a wild-type complex exists or to model one. Chosen:
**model the wild type** (option B). The binding change runs on request, because it is a Boltz-2 model
plus a DDMut-PPI job.

## Effect on the reference variant

NAE1 p.Asp116Gly now reads "Outside mapped sites": Asp116 is not in UniProt's UBA3 region 331–344 or
site 211. Six curated partners (UBA3, APP, HEXB, NEDD8, UBE2M, TP53BP2), one STRING-only (UBE2F).
ΔΔG_bind: not measured until requested; the Multimer tab's NAE1–UBA3 chains are offered.

## Not done

- PDBe-KB interfaces for Q13564 were not read live from this environment (rate-limited); whether
  residue 116 contacts UBA3 in the solved structures (e.g. 1R4M) is decided at runtime.
- The live DDMut-PPI response field `distance_to_interface` is not in the paper and is not shown.
- An experimental complex (PDB) would be a better wild type than a Boltz-2 model; not wired.
- `queryOpenBind` and `THRESHOLDS.openBind` remain in `japanfold-client.ts`, now unused by the PPI
  service. Unused icon imports left in `EvidenceInspector.tsx` to avoid colliding with other open work.
- The STRING release is not read (STRING offers `/api/json/version`).

## Sources

- Zhou Y, Myung Y, Rodrigues CHM, Ascher DB. DDMut-PPI. Nucleic Acids Res 2024;52:W207. doi:10.1093/nar/gkae412
- Szklarczyk D, et al. The STRING database in 2023. Nucleic Acids Res 2023;51:D638. doi:10.1093/nar/gkac1000
- STRING API help, https://string-db.org/help/api/
- Del Toro N, et al. The IntAct database. Nucleic Acids Res 2022;50:D648. doi:10.1093/nar/gkab1006
- UniProtKB Q13564 (NAE1): SUBUNIT, INTERACTION, REGION 331–344, SITE 211
- Passaro S, et al. Boltz-2. bioRxiv 2025. doi:10.1101/2025.06.14.659707
