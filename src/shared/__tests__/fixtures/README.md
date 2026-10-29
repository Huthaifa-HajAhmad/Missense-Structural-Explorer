# Fixtures: provenance

A fixture is evidence only if the sentence beside it can be checked somewhere other than this codebase.
This file records where each hot-spot capture came from and what is — and is not — pinned.

## `hotspotsSod1.json` · `hotspotsVhl.json`

| Field | Value |
| --- | --- |
| Endpoint | `GET /api/v1/evidence-context/:gene/hotspots?uniprot=…` (this app) |
| Server module | `server/services/evidence-context/hotspots.ts` |
| Genes | `SOD1` (`P00441`, p.Ala5Val, residue 5), `VHL` (`P40337`, p.Tyr98His, residue 98) |
| Captured | 2026-10-29, development machine (not recorded by the capture itself — see the gap below) |
| Used by | `src/shared/__tests__/hotspotEvidence.test.ts`, `src/components/evidence/__tests__/FunctionTab.hotspots.test.tsx`, `src/components/inspector/__tests__/FunctionRailHotspots.test.tsx` |

### The accessibility field

`accessibility` was added to both files after the capture, measured with the production path (`fetchAlphafoldPdb`, then
`executeSasaAll` on chain A of the current AlphaFold DB model) and filtered to each file's own ClinVar P/LP residues. Every
other field is the original dump. It is the one value here that was not captured from the endpoint, so a regression in the
endpoint's own accessibility step is not pinned by these files; `server/services/evidence-context/hotspots.test.ts` covers it.

## `perBurdenGolden.json`

Not a dump of this app: the output of the Python PER probe (`scripts/hotspot_probe/per_probe.py`, `burden()`), run by
`scripts/hotspot_probe/make_golden.py` on the P/LP and gnomAD residues of the two fixtures above plus two synthetic cases
that force a region and the merge of adjacent windows. `perBurdenParity.test.ts` diffs the TypeScript port against it, so
it pins agreement between two implementations of one published procedure, not the procedure's output on live data.
Regenerate with `python -I scripts/hotspot_probe/make_golden.py` after changing either implementation or those fixtures.

### What these fixtures do pin

The model's own logic: six rungs and their grades, the rung wording, and the derived numbers
(`O/E 0.70` for SOD1, `O/E 1.12` for VHL, `PathProx ±d.dd`, 67 SOD1 P/LP residues). A regression in
`buildHotspotEvidence` changes an assertion, not just a snapshot.

### The gap, stated plainly

These files are dumps of this app's own endpoint. They therefore cannot prove that the **upstream** reads
are right: they carry no ClinVar release date, no gnomAD dataset version, no query string and no capture
timestamp. `clinvarSource` names the route ("…via the gnomAD browser API (GRCh38)"), not a release. A change
in ClinVar or gnomAD is indistinguishable from a change in this code by these files alone.

The independent records live elsewhere and should be preferred when they disagree:

- `scripts/hotspot_benchmark/{SOD1,VHL}.json.gz` — slices that *do* record `clinvarRelease`, the model
  version and the reference-set rule.
- `server/data/constraint/` and `server/data/per/` — the two published tables, with `sha256Inputs` in the
  importer and in `src/shared/perRegions.ts`.

To close the gap, re-capture with the response headers and the upstream releases recorded; until then, treat
the O/E and count assertions as **regression pinning, not independent verification**.
