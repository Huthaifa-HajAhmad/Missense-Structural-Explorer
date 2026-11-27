# Shared-fact summary (W2, deliverable 2)

Source: `facts.csv` (160 rows, same folder; the table in section 1 groups them into fact families). Counts below are rows in that file, so they show where the sweep looked, not every render in the app. The sweep used keyword search over `src/components` and `src/shared` (non-test files), then read the formatter at each hit. It is not an AST walk, and it did not run the app. Known gaps are at the end.

## 1. Per-fact counts

| Fact | Sites | Formatters and precisions seen | Consistent? |
|---|---:|---|---|
| Gene symbol | 3 | raw string (header, energetics title) | yes |
| UniProt accession | 2 | raw; `encodeURIComponent` for the link | yes |
| Transcript ID | 9 | raw (7), concatenation of ID and version (1), pass-through (1) | **no**, see L1 |
| Residue number and numbering basis | 4 | template string; schema only | n/a (see gaps) |
| HGVS p. | 4 | raw template string | yes |
| HGVS c. | 1 | raw | yes |
| Genomic coordinate | 3 | raw; template with assembly | yes |
| Combined allele frequency (AF) | 11 | `formatAlleleFrequency` (6), `formatFrequencyPercent` (4), raw fraction (1) | **no**, see L2 |
| grpmax | 3 | `formatAlleleFrequency`, `formatCount`, `toLocaleString("en-GB")` | minor, see L3 |
| FAF95 | 4 | `formatAlleleFrequency`, `formatFrequencyPercent`, `gnomadGroupLabel` | **no**, see L2 |
| Homozygotes (gnomAD) | 5 | `formatCount` (4), raw with "—" fallback (1) | **no**, see L3 |
| All of Us counts and AF | 2 | `formatCount`, `formatAlleleFrequency` | yes |
| Ancestry group | 2 | `gnomadGroupLabel` | yes |
| ClinVar classification | 4 | raw string (3), typed field (1) | yes |
| ClinVar review status (text) | 2 | raw with two different fallbacks | **no**, see L4 |
| ClinVar review stars | 6 | `reviewStars()` plus six wordings | **no**, see L4 |
| REVEL | 4 | `toFixed(3)` (predictorEvidence and primaryPredictor agree) | yes |
| BayesDel | 1 | `toFixed(3)` | yes |
| AlphaMissense | 1 | `toFixed(3)` | yes |
| ESM1b | 2 | `toFixed(2)` | yes |
| CADD | 2 | `toFixed(1)` | yes |
| popEVE | 1 | `toFixed(3)` | yes |
| AlphaGenome AVI | 1 | `toFixed(1)` | yes |
| ScoreCons | 1 | `toFixed(2)` | yes |
| SpliceAI max Δ | 3 | `toFixed(2)` (hard-coded in two places) | yes |
| Predictor band call (PP3/BP4 + strength) | 3 | `calibratedCall`; `formatEvidenceCode` | yes |
| Band edge labels | 3 | two formatters for the same edges, see L5 | **no** |
| Criterion code label | 7 | `formatEvidenceCode` (4 rows); literal "PP2 Moderate" / "PP2 Supporting" text (3 rows) | mixed, see L6 |
| Criterion state label | 3 | three casings: "not met" lower, "Not met" title, "Withheld" | **no**, see L6 |
| Regional O/E | 7 | `toFixed(2)` (1), `toFixed(3)` at edge (2), `toPrecision(2)` with "<0.6" clamp (1), raw (3) | **no**, see L7 |
| Function O/E (residue window) | 1 | `toFixed(2)` | n/a |
| LOEUF, pLI, missense Z | 2 | `number()` = `toFixed(2)`, "Not reported" | yes |
| MCR edges | 1 | edges only | n/a |
| AlphaFold pLDDT | 8 | `toFixed(0)` (3), `toFixed(1)` (5) | **no**, see L8 |
| pLDDT filter labels | 1 | literal | yes |
| PDB / solved-structure count | 15 | "k of n" from `n`; "Solved: N" from `total`; "–" for not modelled | **no**, see L9 |
| Domain or feature name at residue | 6 | template strings; `drawnDomains` typed | yes |
| Structure site label | 1 | literal | yes |
| ΔΔG (canonical) | 1 | `formatDdgValue` (`toFixed(2)`, kJ conversion) | the canonical source |
| ΔΔG (signed) | 6 | `signedDdg` / `signedDdgNumber` (zero has no sign) | **no**, see L10 |
| ΔΔG (other formatters) | 13 | `signed` (packing, zero shows "+0.00"), custom report `toFixed(2)`, hard-coded "kcal/mol" in 6 sites | **no**, see L10, L11 |

## 2. Ranked leads

Severity is the reader's risk: L1 to L3 can show a different transcript, unit or number for one variant on two tabs; L4 to L11 are wording, precision or unit drifts.

**L1. The header and the constraint chip can name different transcripts.**
`src/components/header/variantHeaderModel.ts:95`:
```ts
const displayTranscript = identity.maneRefSeqId || transcriptId || null;
```
The header chip (`VariantIdentity.tsx:38`) therefore prefers the MANE RefSeq `NM_` ID. The constraint provenance (`constraintMetrics.ts:538`) shows `${provenance.transcriptId}.${provenance.transcriptVersion}`, and the Splicing rail (`SplicingRail.tsx:82`) shows both IDs when they differ. Check whether one variant can show `NM_…` in the header and an `ENST…` in the constraint chip. This is the first thing W1 should capture.

**L2. Combined AF has two formatters with different zero words and precision.**
`src/shared/frequencyFormat.ts:20-26` (`formatAlleleFrequency`):
```ts
if (value === 0) return "0";
if (value < 0.0001) return value.toExponential(2);
if (value < 0.01) return `${(value * 100).toFixed(3)}%`;
return `${(value * 100).toFixed(2)}%`;
```
`src/shared/evidenceComparison.ts:38-42` (`formatFrequencyPercent`):
```ts
if (af === 0) return '0%';
const pct = af * 100;
return `${pct < .001 ? pct.toExponential(2) : Number(pct.toPrecision(4))}%`;
```
On the same Population tab, the table and rail use the first, and the comparison chart and its records use the second (`evidenceComparison.ts:70-72`, `:95-98`, `:120`, and FAF95 at `:82`). Example: AF 0.5 shows "50.00%" in the table and "50%" in the chart; AF 0.0012345 shows "0.123%" in the table and "0.1234%" or "0.1235%" in the chart. Zero shows "0" in one place and "0%" in the other.

**L3. Homozygote count is not formatted in the rail.**
`src/components/inspector/PopulationRail.tsx:236`: `{evidence.gnomadHomozygotes ?? "—"}` (raw). The clinical table uses `formatCount` (`ClinicalTab.tsx:469` and `:606`), which adds thousands separators. The PM2 grpmax note uses `toLocaleString("en-GB")` (`PopulationRail.tsx:189`). A count of 1234 shows "1234" in the rail and "1,234" in the table.

**L4. "no value" wording varies, and ClinVar review status has two fallbacks.**
- `src/components/evidence/ClinicalTab.tsx:668`: `cv?.reviewStatus || "Not reported"`.
- `src/shared/reportDocument.ts:99`: `cv.reviewStatus || "Not recorded"`.
- Stars: `ClinicalTab.tsx:201` ("N of 4 review stars"), `LandscapeLocalContext.tsx:67` ("N review star(s)" or "review stars not reported"), `LandscapeOverview.tsx:265` ("N★"), `HotspotsView.tsx:212` (raw number, with the title "gold stars"; nothing is shown when null), `molecularWorkspace.ts:58` ("N of 4 review stars").

**L5. The same predictor cut-off can read "0.29" in one view and "0.290" in another.**
`src/components/evidence/predictors/ScoreRuler.tsx:44-48` keeps the tool's own decimals (its comment: "REVEL reads '0.290' beside '0.644', not '0.29'"). `src/shared/ladderEvidence.ts:157-158` trims trailing zeros:
```ts
const fmtCut = (n: number) => {
  const s = Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString();
```
`StrengthLadder.tsx` renders the `ladderEvidence` labels (the "Strength bands" view), so the same edge shows "0.29" there and "0.290" in the Score scales view.

**L6. Criterion state wording has several casings and names, and "not evaluated" does not exist.**
- Canonical type: `src/shared/insightsEvidence.ts:133`: `"met" | "not met" | "withheld" | "not recorded"`.
- Insights table: `InsightsScreen.tsx:109`: `<td>not met</td>` (lowercase literal, `data-state="not met"`).
- Report table: `src/shared/reportCaseBlocks.ts:100`: `c.state === "met" ? "Met" : c.state === "withheld" ? "Withheld" : c.state === "not met" ? "Not met" : "Not recorded"`.
- Function PM1: `src/shared/functionEvidence.ts:113`: `"met" | "not-met" | "withheld-cap" | "withheld-weighting" | "not-assessed"` (hyphenated, a different union from insights).
- Clinical: `ClinicalTab.tsx:93` and `PopulationRail.tsx:222` show "Withheld" from `criterion.code === "withheld"`.
The word "not evaluated" has zero hits in `src/components` and `src/shared`, so the brief's example does not match the app. The closest UI words are "not recorded" and "not assessed" (`FunctionTab.tsx:67`).

**L7. The O/E value rounds across a calibrated edge on the predictor rail.**
`src/components/inspector/PredictorsRail.tsx:191`:
```tsx
`Regional O/E ${constraint.regionalOe.toFixed(2)} → ${constraint.pp2Code === "PP2_Moderate" ? "PP2 Moderate" : constraint.pp2Code === "PP2" ? "PP2 Supporting" : "not met"}`
```
A raw O/E of 0.3601 shows "0.36" beside "PP2 Supporting", while the Moderate edge is "≤ 0.36" (the code's own comment at `constraintMetrics.ts:420-422` describes this exact case). `constraintMetrics.ts:423` handles it:
```ts
const value = edges.some((e) => Math.abs(oe - e) < 0.005) ? oe.toFixed(3) : oe.toFixed(2);
```
`hotspotEvidence.ts:315` repeats that rule in its own `oeText`. The rail does not. Other raw O/E sites print unformatted numbers: `LandscapeLocalContext.tsx:52` (`${region.oe}`), `landscapeEvidence.ts:584` (`${region.oe ?? "—"}`), and the tooltip at `LandscapeOverview.tsx:664` (`${r.oe ?? "not reported"}`). The landscape label at `LandscapeOverview.tsx:662` uses `toPrecision(2)` with a "<0.6" clamp.

**L8. pLDDT is shown with 0 decimals on some tabs and 1 on others.**
0 decimals: `HotspotsView.tsx:216` (`toFixed(0)`), `MolstarViewer.tsx:241-243`, `molecularWorkspace.ts:73` (`toFixed(0)` plus " / 100").
1 decimal: `PackingFigures.tsx:57`, `EnergeticsRuleTrace.tsx:98`, `energeticsEvidence.ts:540`, `:556`, `:1002`, `structure3dEvidence.ts:1076`.
The same residue's pLDDT can read "78" on the Hot-spots tab and "78.4" in the Energetics narrative. `structure3dEvidence.ts:26` says a crystal B-factor must not be shown as pLDDT. Check that every site also has the provenance guard.

**L9. "Solved structures" has two denominators, and the labels pick one at random.**
`src/shared/interfaces/observed.ts:21-25`:
```ts
n: p.modelledEntries ? p.modelledEntries.length : p.pdbEntries.length,
total: p.pdbEntries.length,
```
`n` counts only the entries that model the residue. `total` counts all entries. The insights phrase uses `n` (`insightsEvidence.ts:343`: `in ${k} of ${n} solved structures`). The partner row uses `total` (`src/shared/interfaces/partnerGroups.ts:59`: `Solved: ${plural(row.observed.total, "structure")}`). The not-modelled sentence uses `total` (`finding.ts:44`, `:91`, `:127`). The artefact merge sets both to the same value (`observed.ts:43-44`). A partner can therefore read "Solved: 8 structures" on the partner row and "in 2 of 5 solved structures" in the insight sentence, with no label that says the two denominators differ.

**L10. ΔΔG has at least five formatting paths, and the zero case differs.**
- Canonical: `src/shared/engineStatus.ts:230-248` (`formatDdg`, `formatDdgValue`, with kJ conversion). Its comment at `:25` says "NO surface may format a ΔΔG itself".
- Signed: `energeticsEvidence.ts:400-403` gives "0.00" for zero (no sign). `packingEvidence.ts:93` gives "+0.00" for zero: `` `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}` ``.
- Report: `reportEvidenceBlocks.ts:110` writes its own `+`, `−` and "0.00" branches.
- Interfaces: `interfaces/binding.ts:41` (`toFixed(2)` plus a hard-coded " kcal/mol").
- FoldX 3D note: `structure3dEvidence.ts:1196` (`signed(ddG, 2)` plus `toFixed(2)` and "kcal/mol").
Six or more sites bypass the canonical helper, which the file's own comment forbids.

**L11. Some ΔΔG text is always in kcal/mol, even when the unit is set to kJ/mol.**
`src/shared/energeticsEvidence.ts:386-391`:
```ts
const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2).replace(/^-/, "−"));
return ` (${signed(lo)} to ${signed(hi)} kcal/mol)`;
```
`runRange` never converts (no `unit` parameter). The same screen converts other values through `formatDdgValue`. Other hard-coded units: `energeticsEvidence.ts:793` (`Math.abs(delta).toFixed(2)} kcal/mol`), `packingEvidence.ts:184` (`toFixed(1)} kcal/mol`), `PackingFigures.tsx:35` (`kcal/mol` axis label), `foldxRepairMode.ts:68-84`, `structure3dEvidence.ts:1196`. Check whether the kJ/mol setting reaches these texts (W1 capture with the unit toggle).

## 3. Checked and fine

- Predictor score formatters agree between `predictorEvidence.ts` (`fmt(score, decimals)`) and `insilico/primaryPredictor.ts:91-93` (`formatPredictorScore`) for REVEL, BayesDel, AlphaMissense, ESM1b, CADD and SpliceAI.
- `ScoreRuler.tsx:44-48` takes edge decimals from the calibrated threshold list. It is not a bug; L5 is about a different component.
- `ClinicalTab.tsx:294` and `populationFormat.ts:30` use one `reviewStars()` function, so the 0-4 value itself is consistent.

## 4. Gaps in this pass

- Residue number and numbering basis: found the schema (`contracts.ts:723-746`) and the headline (`variantHeaderModel.ts:86`), but not every page that prints a residue number. Not swept: `hotspotEvidence`, `functionalSites`, and the Landscape residue labels.
- Gene symbol: retired-symbol handling (`contracts.ts:2251`) can change the displayed gene. Not checked which field each tab prints.
- ClinVar classification and gnomAD constraint Z: only the literature panel and the local-context row were read.
- pLDDT and PDB counts were swept by keyword. Lines written with other words (for example, `InterfaceMapWorkspace`, `PartnerTable`) were not read.
- No formatter was run on sample values. Examples in L2 and L7 are computed by hand from the code.
