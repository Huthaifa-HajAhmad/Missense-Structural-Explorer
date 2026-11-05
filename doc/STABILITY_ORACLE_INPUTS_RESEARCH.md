# StabilityOracle: rebuilding the model's inputs from a PDB file

**Status (2026-11-05):** shipped, but not an exact match. The checkpoint is sound. It reproduces the authors' published predictions exactly (r 1.00000) from the authors' own stored inputs. The authors did not publish the code that builds those inputs, so we rebuilt it from what the stored inputs show. The target was r ≥ 0.95 with their predictions. We reached r 0.81 to 0.88.

Terms: **r** is the Pearson correlation. **Bootstrap** re-samples whole chains, so nearby variants do not count as independent. **Hydrogens** are usually missing from PDB files and must be added before the model can read a chain.

## What was wrong

The old code was barely related to the published model. Run directly from the old source, it gave r 0.27 (Ssym) and 0.23 (S669) with published predictions, and 0.17 and 0.12 with lab values. Its bad inputs and its missing sign change happened to cancel in direction: fixing only the sign would have made the values point the wrong way. It had these problems:

| Input or output | Old code | Now |
| :--- | :--- | :--- |
| Value returned | The raw model output | Published value = −output / 2, so positive means destabilizing, as everywhere in the app |
| Models in an NMR file | All of them, stacked on each other (1N88: 45,936 atoms instead of 1,584) | The first model only |
| Hydrogens | None | Added with PDB2PQR |
| Charge | Formal charge on every atom of charged residues | Table by residue and atom name |
| Exposure | A guess from counting neighbours | Measured: Shrake-Rupley on the chain's heavy atoms, ProtOr radii, 1.4 Å probe; hydrogens get 0 |
| Atoms around the variant | 512 nearest, including the variant residue | Within 10 Å of its alpha carbon, without the variant residue, at most 512 |
| Partner chains | Ignored for hydrogens and charges | Any chain with an atom within 10 Å of the site joins the environment |

The same NMR bug was in the cleaning step shared by FoldX and DynaMut (`cleanPdbForFoldX`) and in the ThermoMPNN and SaProt parsers, and is fixed in each.

## The recipe

1. From the first model, take the variant's chain and any chain with an atom within 10 Å of its alpha carbon.
2. Add hydrogens: `pdb2pqr --ff=AMBER --noopt --nodebump --keep-chain --drop-water`. The default run hangs on some chains.
3. Read charges from `tools/model_server_app/data/stability_oracle_inputs.json`. Heavy atoms: residue and atom. Hydrogens: residue and hydrogen name, then the parent atom, then 0.07.
4. Measure exposure as in the table above.
5. Run `stability_oracle_cdna117k.pt` and report −output / 2.

The charge table was recovered by inverting the authors' stored inputs (Zenodo record 12636946) for p53 and myoglobin only. S669 and Ssym played no part in the table, but recipes were compared on them, so they are development sets, not independent tests. The independent test is T2837 and FireProtDB, below.

## Results of the shipped code

Re-measure with `scripts/stabilityoracle-published-eval.py` and `scripts/stabilityoracle-independent-check.py`.

| Set | Scored | r with published (95%) | Mean difference from published | r with lab: before, now, published model |
| :--- | ---: | ---: | ---: | ---: |
| Ssym (development) | 337 of 342 | 0.851 (0.793 to 0.883) | 0.272 kcal/mol | 0.17, 0.642, 0.693 |
| S669 (development) | 637 of 666 | 0.813 (0.749 to 0.854) | 0.309 kcal/mol | 0.12, 0.393, 0.491 |
| **Independent:** T2837 and FireProtDB, 94 chains, none in S669, Ssym, p53 or myoglobin, at most 5 variants per chain | 333 of 357 | 0.877 (0.841 to 0.905) | 0.318 kcal/mol | not run, 0.426 (0.276 to 0.573), 0.462 (0.324 to 0.601) |

The independent result sets the recipe's accuracy: it did not fall on proteins it never saw, so it was not fitted to S669 and Ssym. These sets include many of the kinds of protein the model was tested on, and all are experimental structures with lab values.

**Partner chains** were tested under a rule fixed before the run: adopt if, on S669, r with published rises by 0.02 or more with the chain-resampled 95% interval above zero, r with lab does not fall, and Ssym does not fall by more than 0.01. All chains in the file gave 0.786 to 0.812 (paired 95%: +0.001 to +0.071), lab 0.380 to 0.394, and Ssym unchanged, so it passed. To stay affordable on large complexes, the shipped version adds only chains touching the site. Re-measured with that version: S669 0.813, Ssym 0.851, and on the independent set 0.861 to 0.877 and lab 0.388 to 0.426. AlphaFold models hold one chain and do not change.

The app's own templates hold one chain today: AlphaFold models are monomers and `extractChainFromPdb` cuts PDB entries to one chain. So this rule reaches readers only through a multi-chain file a client supplies. Sending partner chains from the fetcher would be a separate change, and it would also change FoldX's input.

- **Refused chains.** PDB2PQR refuses 5PTI chain A, 3DV0 chain I and some others (18 of 357 variants on the independent set). The reader sees that StabilityOracle could not score the chain, and no value is made up. A further 6 independent variants were refused because the published numbering did not match the deposited residue.
- **Values are less spread out** than published (SD 0.44 to 0.50 against 0.59 to 0.65). This is why the engine alone rarely reaches a "destabilizing" band. It is not corrected with a rescale: that would add a fitted number with no held-out test behind it.
- **Time.** On this development PC, 5.3 s for the first variant on the largest protein tested, then 0.2 s per variant on that chain. Typical chains take about 1 s. The server waits 60 s.

## Tested and rejected

| Idea | Result |
| :--- | :--- |
| Energy minimization (AMBER14 in OpenMM; vacuum or implicit solvent) to match the authors' atom positions | No setting moves atoms closer. Longer runs move them further away |
| Charges from AMBER14, AMBER99SB, CHARMM36, Gasteiger, MMFF94 | None reproduces them. Best r 0.93, and sizes are off by 1.3 to 3.5 times |
| ChargeFW2, all 22 methods, computed for the whole p53 chain | None reproduces them, although the authors' loader reads a field named `_atom_site.fw2_charge`. Best r with recovered heavy-atom charges 0.935, against 0.984 for our table on other proteins. Even after a linear rescale the best error is 0.16 e. Recovered charges barely vary by environment (median spread between quartiles 0.019 e for heavy atoms, 0.03 e for hydrogens, on p53), so a table loses little. Per-structure ChargeFW2 was not run through the model end to end: it fails this per-atom test first |
| Exposure from the nearby atoms only | Worse by about r 0.10 on both sets |
| Exposure with all chains in the file | No change |
| OpenMM hydrogens in place of PDB2PQR | No real difference, and slower |

## Still unknown

1. The authors' charge method. This is the largest known gap. With their geometry, our hydrogen charges alone bring r down to 0.91.
2. How they moved heavy atoms. About half of the S669 structures are exactly as deposited, and the rest are shifted by a median of 0.08 Å.
3. Which NMR model they used, and how they treat alternate atom positions and non-standard residues.

If the authors publish their input code, replace this recipe with it. Tests: `tools/test_published_reference.py` pins sign, scale and tracking against published p53 values. The ProtOr radii came from FreeSASA's tables, which are not re-checked at run time. The research scripts and full tables are local only (`logs/foldx_bench/so_research/`, 2 GB, not in git).
