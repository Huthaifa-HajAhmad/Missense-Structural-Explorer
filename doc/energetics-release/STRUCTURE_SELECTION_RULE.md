# Experimental chain selection: rule fixed before any new FoldX score was seen

Written on 2026-11-18 after the user chose "rank by local quality" and before the rule was built or any
FoldX value under it was read. The advisor's design (second review, item 9) is followed. A change to this
rule after results are seen must be stated, with its reason, in the release report.

## Why

PDBe's `best_structures` list is ranked for the protein as a whole, led by coverage. The selector took the
first row whose UniProt range contains the variant. For TP53 p.Arg175His that was a 3.2 Å cryo-EM chain
(8UTS:K, later 9R2Q:K) with 165 of 200 residues missing side-chain atoms; FoldX skipped repair and
returned +15.6 / +15.4 kcal/mol. A range can also span residues that were never observed.

## Candidates

1. All `best_structures` rows for the accession whose `unp_start`–`unp_end` contains the variant position.
2. Ordered for examination by: reported resolution (lower first; missing resolution last), then
   `coverage` (higher first), then PDB ID, then chain ID (exact, case-sensitive). At most the first
   **4 distinct chains** are downloaded and examined; the number not examined is recorded and logged, and
   the result is described as the best *examined* chain.
3. Each examined chain is numbered through `fetchVerifiedExperimentalChain` (SIFTS per residue, or the
   sequence alignment). A chain that does not verify is not eligible.

## Eligible

The verified chain must have, at the variant's UniProt position:
- a residue whose name (selenomethionine read as methionine) matches the UniProt wild type, and
- an observed backbone: atoms N, CA, C and O.

The existing whole-chain wild-type gate (`chainDifferences`, mutating engines) still applies to the chosen
chain afterwards, and explicit user-supplied structures and the AlphaFold fallback are unchanged.

## Ranking among eligible chains (first difference decides)

1. Target side chain complete (every expected heavy atom of the residue type present; glycine has none).
2. Neighbourhood at least 90% complete. Neighbourhood: residues of the same chain whose CA lies within
   8 Å of the target CA, the target excluded. A residue is complete when all its expected heavy atoms are
   present. An empty neighbourhood counts as not meeting the 90% mark.
3. Lower reported resolution (missing resolution after any measured one).
4. Higher exact neighbourhood completeness fraction.
5. Higher `coverage`.
6. PDB ID, then chain ID (exact, case-sensitive), so the same input always gives the same chain.

Atom counting uses one alternate location per atom (the first seen), counts only heavy atoms (no
hydrogens), and ignores occupancy values below or equal to zero. 8 Å and 90% are engineering thresholds
chosen in advance, not validated physical cut-offs.

## Validation (pass rule fixed now)

On the frozen candidate lists for TP53 p.Arg175His and p.Arg273His, FHIT p.Val95Ala, HBB p.Glu7Val,
CNNM2 p.Glu357Gln and SCN1A p.Arg1648His:
- every chosen residue maps to the stated wild type;
- where the examined set contains a chain with a complete target side chain and a ≥90% neighbourhood, a
  chain without them is never chosen;
- shuffling the PDBe row order gives the same chosen chain;
- explicit structures and the AlphaFold fallback still work;
- the chosen structure is named in the panel's Sources and survives a reload.

Not a pass condition: any change in a FoldX value. Selecting a template by the answer it gives would be
choosing the answer.

## Amendment (2026-11-18, after the first validation run; no FoldX value was used)

The first run on candidate 1132d7fe showed two problems that are about the structures, not about scores:

1. For TP53 p.Arg273His the rule chose 3D06 chain A (1.2 Å, target and neighbourhood complete), which the
   existing whole-chain wild-type gate then refused, and the resolver fell back to AlphaFold. The sharpest
   TP53 chains are engineered constructs with stabilising mutations elsewhere in the chain. Change: a chain
   whose sequence differs from the UniProt wild type anywhere (`templateSequenceDifferences`) is not
   eligible, and examination continues in the same fixed order until 4 eligible chains are found or 12
   chains have been downloaded. The log reports how many were examined, refused as not the wild type, and
   not examined.
2. For TP53 p.Arg175His the resolver served a choice remembered under the old rule (six-hour memo). Change:
   the memo key carries the rule version (`select-v2`), so a rule change is never masked by a cached choice.

The ranking itself (target, neighbourhood, resolution, completeness, coverage, IDs) is unchanged.

## Second amendment (2026-11-18, after the empty-cache validation run; no FoldX value was used)

For TP53 p.Arg175His and p.Arg273His no chain among the 12 examined was eligible: the 30 best-resolved of
the 483 covering chains are all engineered constructs (the Y220C stabilised-core series and 3D06). The
fallback then returned PDBe's first row, 9R2Q:K, the incomplete chain this rule exists to avoid. Changes:
- When a variant position is given and no examined chain is eligible, no experimental chain is returned;
  every caller uses the AlphaFold model (the resolver's next tier).
- The rule is applied even when only one chain covers the variant, so a single unusable chain is not
  passed through unchecked.
- The memo key moves to `select-v3`, so choices remembered under the previous version are not reused.

## Implementation corrections after review (no rule change)

- Each batch fetches only as many chains as eligible slots remain, so the comparison is always among the
  first 4 eligible chains in the fixed order; duplicate PDB/chain rows are sorted before one is kept.
- An examination that could not complete (UniProt sequence unavailable, or no examined chain verified) is
  not remembered, by the selector or by the resolver's memo, so the next request checks again; only a
  completed examination with no eligible chain is remembered (1 hour) and logged with its counts.
