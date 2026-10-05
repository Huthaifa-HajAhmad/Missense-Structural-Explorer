# Residue Shifts & Pockets: review

Reference variant: NAE1 p.Asp116Gly (burial from 1YOV, pocket on the AlphaFold model).
Tab: `components/evidence/StructureTab.tsx`. Rail: `components/inspector/ResidueShiftInspector.tsx`.
Both render one model, `shared/residueContextEvidence.ts`, through `lib/useResidueContextEvidence.ts`.

No ACMG criterion reads this tab, so no classification changes. The burial word does feed the
Perturbation disruption rules (`server/services/structure/pocket/disruption.ts`, `isBuried`); see
decision below.

## Findings

| # | Severity | Was | Now |
|---|---|---|---|
| 1 | High | The four 0–100 scales were a hand-made table labelled "Kyte & Doolittle", "van der Waals volume" and "IUPAC classification", matching none of them (Trp 65 on hydrophobicity, Asp 45 vs Gly 10 on volume). | `shared/residueScales.ts`: net charge at pH 7.4, Grantham 1974 polarity and volume, Kyte–Doolittle hydropathy, each cited on its row and shown in native units. `AMINO_ACID_PROPERTIES` (Insights radar) is derived from it. |
| 2 | High | Headline "polarity −85" was an artefact of #1. | Charge 50%, polarity 49%, hydropathy 35%, volume 31% of each scale's range. |
| 3 | High | Burial word fell back to Cα packing cut-points (≤7 surface, ≥15 core) with no source. On 2OCJ chain A (194 residues, Shrake–Rupley RSA vs Tien 2013 maxima), 34 of 48 exposed residues read as boundary; packing agreed with RSA for 60% of residues. | Packing cut-points retired. The word comes from measured RSA only; the Cα count is shown as a reading. |
| 4 | Medium | SASA failures were silent. | `sasaUnavailableReason` travels in the payload; the row says accessibility was not measured and why. |
| 5 | Medium | Tab printed 22.97 Å to the residue centroid, rail 23.14 Å to the cavity centre. | One distance, to the cavity centre when reported, labelled. |
| 6 | Medium | "Likely co-factor: None recorded" was a constant. | Removed. |
| 7 | Medium | Pocket residues ranked by a hand-set propensity weight, no chain. | Sorted by distance, chain shown. |
| 8 | Medium | Pocket structure and P2Rank profile not named. | Profile carried in provenance and named on the pocket group. |
| 9 | Low | Local bands called 0.23 "moderate"; "23%" in rail vs "23 / 100" in tab. | Probability printed once as 0.23, with no band word. |
| 10 | Low | Raw codes `DISTAL_SURFACE`, `ACTIVE_SITE_PROXIMATE`. | Words: lines the pocket, within 8 Å, rim, distal. |
| 11 | Low | Gly/Pro backbone effects invisible. | Caveat line when either residue is Gly or Pro. |
| 12 | Low | Legacy labels "Standby", "Model Offline", "N/A". | `ENGINE_STATE_LABELS`; four files added to `energeticsLabels.guard.test.ts`. |
| 13 | Low | `sasa_eval.py` called the Tien 2013 maxima "empirical". | "Theoretical", with DOI. |

UI: one finding card, a properties table and an environment table (burial and pocket groups), flat
rows, tokens only, no red or green, local cut-points dashed. The rail is a five-step trace (burial
flagged when not measured), the app's cut-points with this variant's band marked, the model
narrative labelled as model-written and checked against the scales, method and sources.

## Decision taken

Owner chose **"Show as unmeasured"** (2026-09-29): when accessibility was not measured, burial
reads "Not measured" rather than a packing estimate. A stored word from an earlier engine is named
("an earlier engine estimated from packing density") and not shown as a finding. Server side,
`disruption.ts` no longer invents a word from packing, so `isBuried` is false without RSA and the
buried-residue disruption rules do not fire on an estimate.

## Effect on NAE1 p.Asp116Gly

- Largest shift: net charge (−1 → 0), not "polarity −85".
- Burial: not measured (was "boundary" from 9 Cα neighbours).
- Pocket: 23.1 Å from the cavity centre, distal; probability 0.23 (alphafold profile).
- Grantham distance 94, moderately conservative (Li, Wu and Luo 1984 classes).

## Follow-ups not done

- Choose the P2Rank profile from the structure source (X-ray vs predicted); today it is always
  `alphafold`, now at least named.
- Bump the cached analysis version so stored payloads with a packing-derived word are recomputed;
  the client handles them meanwhile by naming the stale word.
- Find why `uv run tools/sasa_eval.py` fails in deployment; the reason is now visible.

## Visualizations & Dead Space Refactor (2026-10-04)

Audit and visual overhaul under `evidence-tab-refactor` and `CHARTING_AND_VISUALIZATION_PLAN.md`:

| # | Severity | Was | Now |
|---|---|---|---|
| F1 | High | Server selected nearest pocket by centroid distance, while the tab and rail displayed and banded distance to the cavity centre. | `server/services/structure/pocket/selection.ts`: selects pocket by cavity centre distance for P2Rank (`selectPocketForResidue`), guaranteeing display and banding alignment. |
| F2 | Medium | When wild-type and variant had identical values (e.g. net charge 0 → 0), variant marker eclipsed wild-type marker on the track. | `PropertyDumbbell.tsx`: the wild-type ring uses `data-coincident` to remain visible around the variant dot, and the axis has an ARIA description that both share the value. |
| F3 | Medium | Shift magnitude bands had decimal gaps (e.g. 9 vs 9.1). Rail used "large" while model used "marked". | Model cut-points made gap-free (`> 29 marked`, `> 9 to ≤ 29 moderate`, `> 0 to ≤ 9 slight`), labels standardized. |
| F4 | Medium | Pocket distance bands in rail inspector lacked exact inequality symbols. | Standardized to `<= 4 Å lining`, `> 4 to <= 8 Å proximal`, `> 8 to <= 12 Å peripheral`, `> 12 Å distal`. |
| F5 | Low | Fact strip reported "Pocket confidence" while P2Rank outputs a calibrated probability. | Aligned to "Ligand-site probability" (or "P2Rank score" for rescaled raw scores), matching table row. |
| F6 | Visual | No visual representation of side-chain differences; pure text table. | `ResidueGlyph.tsx`: 2D skeletal bond topology diff for all standard amino acids, showing atoms and bonds kept, lost, and gained on a unified coordinate frame. |
| F7 | Visual | Property tracks had no amino-acid context; hard to see where other residues sat. | The Properties card keeps the exact grouped values for every scale in one keyboard-accessible disclosure in its footer. |
| F8 | Visual | Environment section had separate distance row and 4-column residue grid; no spatial reference. | `PocketDistanceStrip.tsx`: continuous distance axis with 0 Å origin, cut-points, cavity centre marker ◆, and interactive residue buttons. |
| F9 | Dead space | Excessive whitespace in hero finding and environment cards. | Compact multi-column hero integrating `ResidueGlyph`, dense data layout in `PocketDistanceStrip`. |
| F10 | Architecture | Rail was dispatched only via `ViewInspector`, falling through in `EvidenceInspector`. | Directly wired in `EvidenceInspector.tsx`. |

## UI polish follow-up (2026-10-05)

This pass changed presentation only. It did not change a reading, cut-point, classification or source.

| # | Severity | Was | Now |
|---|---|---|---|
| P1 | Medium | Every distinct value among the other amino acids drew a 1 px mark on each property axis. The marks looked like scientific cut-points and their tooltip-only values were inaccessible from the keyboard. | Each axis now shows only the wild-type and variant readings. One native `<details>` disclosure in the Properties footer retains every scale’s grouped reference values for keyboard and assistive-technology users without repeating a control in every row. |
| P2 | Medium | The property axis stopped at 440 px inside a flexible table column, leaving a variable gap before the wild-type, variant and shift columns. | The property table uses one fixed column grid and each axis fills its track column, so markers and numeric columns align across rows. |
| P3 | Medium | Ligand-site probability and cavity size put prose under the axis heading, skipped the value column, then pushed the value to the far-right call column. | The environment table now has four explicit columns: reading, axis or context, value, and interpretation. Every populated row fills all four. |
| P4 | Low | The hero placed a small residue pair and sentence above a full-width glyph panel with two small centred drawings. | The finding copy and side-chain sketch share a compact two-column body at wide widths and stack at a narrow container width. |
| P5 | Medium | The inspector listed ten cut-point rows across three groups, making the active band hard to find. | Each evidence group is one compact row containing every exact inequality; the active band alone gains weight and the visible “this variant” marker. |
| P6 | Low | Dead `.rsx-track__same` and `.rsx-track__same-core` rules described an element the component no longer rendered. | Removed the obsolete rules; the live `data-coincident` ring remains the single coincidence treatment. |

Visual checks used the real `font-mono text-xs` Evidence wrapper at wide light, wide dark and 820 px. The 820 px page has no root overflow; the two evidence tables scroll within their own cards. Dark-theme text sampled from the tab and rail was at least 4.93:1 against its local surface.

## Sources

- Grantham R. 1974. Science 185:862. doi:10.1126/science.185.4154.862
- Kyte J, Doolittle RF. 1982. J Mol Biol 157:105. doi:10.1016/0022-2836(82)90515-0
- Li WH, Wu CI, Luo CC. 1984. J Mol Evol 21:58. doi:10.1007/BF02100628
- Tien MZ et al. 2013. PLoS One 8:e80635. doi:10.1371/journal.pone.0080635
- Krivák R, Hoksza D. 2018. J Cheminform 10:39. doi:10.1186/s13321-018-0285-8
- Hamelryck T. 2005. Proteins 59:38. doi:10.1002/prot.20379
