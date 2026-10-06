## Review: evidence-context (gene–disease + expression/models)

**Audit window:** 2026‑10‑06 16:2x–16:32 (+03:00). Note: the parent was editing the same files *during* this audit (`gencc.ts`, `g2p.ts`, `dgtex.ts`, `diseaseFrame.ts`, `import-*.ts` all changed at 16:26–16:30). Findings are against the state at 16:32. Current tree is green: `tsc --noEmit` clean, `check-boundaries` clean, `check-focus-indicators` clean, targeted vitest **34/34 pass**, `test:evidence-context-import` **4/4 pass**.

### Checklist (verified as implemented)
- **Explicit disease/inheritance, no default** — `DiseaseContextPicker.tsx:18‑22` empty option, `disabled={!frames.length}`. Shared by both tabs; both registered (`EvidenceDashboardCard.tsx:253‑254`) and rail wired (`EvidenceInspector.tsx:60`).
- **Manual acceptance / context only, no ACMG** — no context module is imported by the classifier; boundary check passes. `EvidenceContextRail` and both tab footers state "no ACMG criterion". HPO suggestions are not installed and are labelled so (`ExpressionModelsTab.tsx:51`).
- **Per-variant browser-session selection** — `evidenceContextIdentity.ts` keys on gene + uniprot + variant + transcript/isoform/assembly/coords; slice uses `mse.evidenceContext.v1:<key>` (`evidenceContextSlice.ts:19‚31`); hook and rail share the same identity function.
- **dGTEx V1 + counts** — installed snapshot verified: `metadataSamples=379, included=332, excluded=10, wgs=37, donors=34/40`; 75,738 gene rows; 125 tissue×age groups (52 single-donor); medians are donor-weighted; cohort labels verbatim and filtered independently of onset. Shipped hashes match the probe receipts (`gencc aa3ffd0b…`, `g2p 86374a1d…`, `dgtex c1c4b6a9…`). The 8 duplicate `tissueId|cohortId` rows are the three subcutaneous-adipose sampling sites sharing `UBERON:0002190`, correctly kept separate by label.
- **Source integrity** — GenCC `disease_curie` is 100 % MONDO (15,350/15,350 frames), so the exact-MONDO G2P join is valid today. Admission that "G2P support ≠ experimental validation" holds in `MechanismContextCard.tsx:34`.

### Confirmed defect (reproducible)
**Prototype-chain gene lookup — schemas now index-check the *snapshot* but the *lookup* is still unsafe.**
- `server/services/evidence-context/store.ts:25` — `frames: data!.genes[gene] ?? []`
- `server/services/evidence-context/g2p.ts:45` — `records: cached.data.genes[gene] ?? []`

`JSON.parse` gives `genes` an `Object.prototype`, so `genes["constructor"]` (etc.) resolves to an inherited member and `?? []` never fires. The route regex `^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$` (`server/routes/evidence-context.ts:11,18,25`) accepts `constructor`/`toString`/`valueOf`, so this is HTTP-reachable. Reproduced live:

```
{"gene":"constructor","gencc_status":"ready","frames_isArray":false,"frames_type":"function","response_has_frames":false}
{"gene":"toString",   "g2p_status":"ready","records_isArray":false,"records_type":"function","response_has_records":false}
```

Effect: a `status:"ready"` response whose `frames`/`records` are functions; `res.json` drops them, the client `geneDiseaseResponseSchema.parse` throws, and the tab shows a false "could not be read" error. Not clinically dangerous (real symbols aren't prototype keys) but it is exactly the key-consistency class under review and is the one hole the new `superRefine`s do not close.

**Fix (one guard each):**
```ts
// store.ts:25
const frames = Object.prototype.hasOwnProperty.call(data.genes, gene) ? data.genes[gene] : [];
return { gene, status: 'ready', frames, provenance: data!.provenance, message: null };
// g2p.ts:45 — same with cached.data.genes
```

### Fixed during the audit (verified correct, not defects now)
- `genccSnapshotSchema` / `g2pSnapshotSchema` `superRefine` now reject wrong record key, wrong frame key, duplicate ids, and `rowCount` mismatch, with tests (`gencc.test.ts:7‑15`, `g2p.test.ts:8‑13`). Confirmed the shipped snapshots still parse under the new schemas.
- `dgtex.ts:31‑32` now reconciles `manifest.geneCount` against `COUNT(*)`; `dgtexManifestSchema:14‑18` now checks totals, donor bounds, and the four required file kinds. Installed snapshot passes.
- `timestampBasis` added end-to-end (importers → schema → rail) so a `--input`/`--input-dir` install no longer displays as a download.

### Remaining hardening gaps (not active bugs — no current caller triggers them)
1. **dGTEx positional join is unproven.** `dgtex.ts:40‑41` assigns `value: values[i]` purely by array order against `manifest.coverage`; the schema checks uniqueness but not that a gene's medians order corresponds to coverage order. Both are written in one importer pass, so no misassignment exists today, but a manifest-level coverage fingerprint (hash of ordered `tissueId|tissue|cohortId`) verified at load would make the join provable.
2. **`loadMechanismContext` has no single-flight** (`g2p.ts:38‑45`), unlike `store.ts`; each cold concurrent request re-reads/parses the ~2 MB file. Efficiency only.
3. **`parseCsv` is applied to G2P's unquoted export** (`g2p.ts:18`). A literal `"` mid-field aborts the whole import loudly; a field *starting* with `"` could silently absorb delimiters. Latent; current snapshot imports fine.
4. **G2P↔GenCC join reads only `diseaseId`** (`mechanismContext.ts:14`) and ignores stored `xrefs`. Safe today because GenCC ships MONDO; if a future GenCC export uses OMIM/ORPHA as `disease_curie` (MONDO only in `xrefs`), mechanisms would silently drop.

### Scientific/design notes for the owner
- **G2P→disease-choice promotion is new and beyond the written proposal.** `diseaseFrame.ts:46‑64` (`addVerifiedMechanismChoices`, called at `evidence-context.ts:30`) turns G2P AD/AR *mechanism* records into selectable disease/inheritance frames with `validity: []`. It is mitigated (separate `selectionSource`, "G2P choice; no GenCC assertion", empty-validity wording), but it puts mechanism-derived contexts into the same control as GenCC validity frames. The owner may want a distinct "mechanism-derived context" control, or an explicit decision record, so the selector doesn't read as validity coverage.
- **Confirmed missing follow-ups, correctly labelled not-installed, not bugs:** HPO annotations/suggestions, ClinGen dosage/validity reconciliation, ClinVar RCV/SCV locus context, HPA, animal/orthology, complementary atlases, pext, main report/session export, DECIPHER.
- **No ACMG change found**; ClinVar `conditions`/xrefs are retained in the contract (`contracts.ts:86‑88`, `clinvar.ts:236‑239`) and are not read by any criterion.

**Bottom line:** the scientific-sourcing slice is faithful (counts, donor weighting, cohort/onset separation, exact identities, receipts) and the importers are fail-closed. The only *actual* code defect I could reproduce is the prototype-chain lookup at `store.ts:25` and `g2p.ts:45`; everything else is either already fixed mid-audit or a documented/hardening gap.
