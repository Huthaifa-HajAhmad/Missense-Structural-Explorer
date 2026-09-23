# AlphaGenome "Standby" with a configured key — RCA, and UI/UX audit of the panel

Variant under investigation: `ACOT9 p.Lys272Asn` · `NM_001031711.2` · `X-23723975-C-A` tagged **HG19** · `Q9Y305`.

---

## 0. Reconciliation with `doc/UNMAPPING_DEFECT_SPLICE_AUDIT.md`

**Read that document first.** It supersedes this one on the splicing surface, explains a layer this
audit stopped above, and corrects one claim here (§1) that was simply wrong.

**The remediations landed after this audit was written, and are still uncommitted.** File mtimes
today: this document 18:20 → `assembly.ts` 20:25 → `UNMAPPING_DEFECT_SPLICE_AUDIT.md` 20:27 →
`liftover.ts` 20:29 → splice audit finalised 21:27. `git status` shows 22 modified files and 4
untracked, with **`AlphaGenomeTab.tsx` last touched 9/14** and **`EvidenceInspector.tsx` not
touched at all**. So the findings below were accurate when written; the tree then moved under them.

### What that audit found that this one missed

This RCA stopped at *"Ensembl VEP returned incomplete data"* and treated the GRCh37 fallback as an
unlucky transient. F-1/F-2 show it is **structural and permanent** for this variant class, for two
independent proven-live reasons:

- `fetchPredictorData` queries VEP **by protein HGVS only**, and Ensembl rejects any substitution
  that does not back-map to a unique nucleotide change — **Lys→Asn never does** (`aaG → aaC` *or*
  `aaT`). So this fails for K↔N, G↔A, R↔Q, W↔C and every other ambiguous pair.
- The targets are **MANE** transcripts while the platform feeds the **canonical-numbered**
  substitution; MANE residue 272 is Glu, so the reference check fails before notation even matters.

The consequence this audit should have drawn: **the coordinate and a splicing-aware VEP consequence
were one request away** (`ENST00000336430:c.816G>T` → 200, `X:23,705,858`,
`missense_variant, splice_region_variant`). Asking "why is the key not working" was the wrong
question one level sooner than I took it.

That audit also documents a third failure class this audit never saw — the splicing panel drawing a
junction at "0 bp" and asserting "Outside Consensus Zone" from no measurement (F-9…F-11, F-15) —
which is the same defect family found here, at higher volume.

### Status of this document's recommendations

| Here | There | Actual state in the tree now |
| --- | --- | --- |
| **Fix 3** — implement the liftover §1's declared-but-absent policy | F-3 | **DONE.** `server/services/translation/liftover.ts:140` `liftCoordinateToCanonical`, forward map + exact reverse round-trip + GRCh38 REF check, applied at both coordinate producers (`vep-orchestrator.ts:260`, `:330`). `liftover.test.ts:68-79` asserts the real ACOT9 hg19 locus lifts to GRCh38 `X:23,705,858`, `reverseVerified: true`. My §1 claim that "no liftover is implemented anywhere" was true at authoring time and is false now. |
| **Fix 2** — stop the cache thrash | RCA-Fix2 | **DONE, as specified.** `analysis-orchestrator.ts:66-68` adds `isBuildRefused` from `cons.assemblyRefusals`, honouring a refusal exactly like the known-unaskable `"not indexed"` case. Its comment cites this document's "aggravating side effect". |
| **Fix 1** — surface the real reason | F-13 | **DONE for the splicing surfaces only.** `describeAssemblyRefusal` is now called in production (`conservation-orchestrator.ts:796-801`), travels on `conservationData.assemblyRefusals` (`contracts.ts:782`), is derived as `proximityRefusal` / `alphagenomeRefusal` (`splicingEvidence.ts:250-252`, `:472-473`) and rendered in `SplicingTab.tsx:359`, `:369`, `:568` and `SplicingInspector.tsx:311`. **`AlphaGenomeTab.tsx:776` — the panel in the screenshot that started this — still reads "Awaiting API key for exact rank".** |
| §C — reuse `engineStatus`'s `not-covered` vs `not-installed` | F-14 | **DONE at `SplicingTab.tsx:369`** (`alphagenomeRefusal ? "not-covered" : "not-installed"`, reason in `title`). Independently arrived at — same reasoning, different surface. Not applied to `AlphaGenomeTab.tsx`. |
| §1 "the fix was designed and left unwired" | — | **Now stale.** `assembly.ts:139-141` replaced the "wire this in or delete it" NOTE with "Wired into the production pipeline … (unmapping defect F-13)". |
| §1 "REGIONAL O/E — is the same root cause" | §4C refutes it | **Wrong, retracted above.** |

### What is still live, and now cheap

> **Resolved by §5.** The table below is kept as the pre-change inventory; §5 records what was
> subsequently implemented and verified.

The remediation left a **precedent and a plumbing path already built**. `alphagenomeRefusal` is
already derived for the AlphaGenome source, so the remaining copy fixes are consumers of an existing
field rather than new design:

| Severity | Still-live location | Now a |
| --- | --- | --- |
| HIGH | `AlphaGenomeTab.tsx:776` (+ `:595`, `:510`, `:803`, `:1013`) | 3-line change: read `result.conservationData?.assemblyRefusals` for `source === "alphagenome"` and render it, mirroring `SplicingTab.tsx:369`. This is the *only* remaining surface asserting the false credential cause for AlphaGenome. |
| HIGH | `EvidenceInspector.tsx:307` hardcoded `GRCh38 / hg38` | Read `predictorData.gnomadVariantAssembly`. **Sharper now**: with the liftover re-tagging the header chip to `hg38` for lifted variants, this literal will *accidentally agree* for them and still lie for any variant whose lift fails (`liftover.test.ts:81-134` enumerates six such paths). A string that is sometimes right by coincidence is the worst kind of bug to leave in a provenance panel. |
| HIGH | `EvidenceInspector.tsx:687-703` "populated dynamically from live backend microservices" | Untouched. `assemblyRefusals` is now on the payload, so this box has real data available and still renders filler. |
| MEDIUM | `PredictorSpecialistPanels.tsx:379` | Untouched. Same false cause, third surface. |
| MEDIUM | `concordance.ts:174-182` | Untouched. Comment still says "e.g. AlphaGenome without API key/endpoint" and still suppresses the source from `unavailable[]` — now demonstrably the wrong reason, since refusals are recorded per source. |
| HIGH/MEDIUM | `MasterSidebar.tsx:233-264` (keyboard trap), `:119-135` (motion-only state); `workflowStatus.ts:89-100` (status props never read) + `:238-239` (raw ΔΔG sign); `VariantSearchPanel.tsx:539` (banned `"In Progress"`); `EvidenceInspector.tsx:161/393/451` (unestablished versions); `VariantHeader` `title`-only reasoning; sub-11px build tag | All untouched by the remediation. None of it is a copy problem, so none of it was in F-1…F-16's scope. §2 stands as written. |

**One caution on the "expected effect" in the splice audit §6:** it predicts the ACOT9 panel goes
live end-to-end. That is a *prediction from mocked harnesses plus one live cDNA probe* — the
liftover tests mock `rest.ensembl.org`, and no run of the real `/analyze-variant` path for ACOT9 is
recorded. Given this document's own history — a clean-looking chain that turned out to skip two
layers — the panel should be re-screenshotted against the live server before that claim is treated
as settled. And `AlphaGenomeTab.tsx:776` will still blame the key on the day a lift legitimately
cannot be verified.

**Uncommitted risk:** all of F-1…F-16 — including the liftover and the honesty fixes — exists only
as unstaged working-tree changes. Nothing here is durable until it is committed.

---

## 1. RCA

### Verdict

**The API key is fine. It is not the thing that is broken, and no credential action will ever
make this panel go live.**

The AlphaGenome request is never issued for this variant. It is refused upstream by the
genome-build gate, three layers before any credential is read. The panel then renders a
hardcoded string that names a cause it does not know — "Awaiting API key for exact rank" —
which is why the symptom looks like a key problem.

The key is genuinely configured and genuinely works: `Test Connection` returns
`ok: true`, 296 ms, 22 scorers, because `verify-connection` authenticates over gRPC with the
header-supplied key and never touches the build gate.

### Causal chain

| # | Location | What happens |
| --- | --- | --- |
| 1 | `server/services/prediction/predictors/vep-orchestrator.ts:277-278` | Ensembl VEP returned incomplete data → `fetchPredictorsFallback()` (MyVariant.info + dbNSFP). **Why it is permanently incomplete for this variant — and for every ambiguous-substitution variant — is F-1/F-2 of the splice audit, not this document: protein-HGVS-only queries, Lys→Asn has no unique codon back-map, and the targets are MANE while the numbering is canonical. See §0.** |
| 2 | `vep-orchestrator.ts:132` | The fallback's `_id` is hg19 and MyVariant has no assembly parameter, so the coordinate is honestly tagged `gnomadVariantAssembly: "GRCh37"` |
| 3 | `src/shared/assembly.ts:75` | `ASSEMBLY_SUPPORT.alphagenome = ["GRCh38"]` — the Atlas holds GRCh38 SNVs and the model inputs GRCh38 sequence |
| 4 | `conservation-orchestrator.ts:765-767` + `:779` | `usableBy("alphagenome")` → **false** → `Promise.resolve(null)`. **`fetchAlphaGenome()` is never called.** The key is never read. |
| 5 | `conservation-orchestrator.ts:890` | `alphagenome: null` reaches the payload — with **no reason attached** |
| 6 | `src/components/evidence/AlphaGenomeTab.tsx:348` | `isLive = alphagenome?.status === "live"` → false → the entire Standby branch renders |
| 7 | `AlphaGenomeTab.tsx:776` | Renders `"Awaiting API key for exact rank"` — a guess about the cause, presented as fact |

Steps 1-4 are **correct behaviour**. `assembly.ts:20-24` states why: feeding a GRCh37 coordinate
to a GRCh38 service either rejects it (loud, safe) or — when the GRCh38 base at that numeric
position happens to match the supplied REF, which is common — *accepts it and scores a different
locus*, returning plausible numbers attributed to this variant. The gate is the fix for a silent
wrong-locus bug, not a bug itself.

**The bug is step 7.** The refusal is real and correct; the explanation the UI gives for it is
false.

### ~~Corroboration in the same screenshot~~ — RETRACTED

> **This paragraph was wrong. Corrected by `doc/UNMAPPING_DEFECT_SPLICE_AUDIT.md` §4C and
> re-verified against the code.**
>
> I attributed the header's `REGIONAL O/E —` / `No gnomAD blocks` to the same build gate. It is not
> gated by any coordinate. Regional constraint comes from `fetchGnomadGeneConstraint`
> (`gnomad.ts:223-308`) — a **gene-level** GRCh37 query whose RMC blocks are matched to the variant
> by **amino-acid position** (`gnomad.ts:313-328`, comparing `aaPos` against parsed `aa_start` /
> `aa_stop`). `hasRegionalData` is simply `rmc.regions.length > 0` (`gnomad.ts:300`). No genomic
> coordinate crosses that boundary, so no build gate can refuse it.
>
> The decisive tell was in my own screenshot and I read past it: **MISSENSE Z (+0.70) and LOEUF
> (1.18) render from that same fetch.** The fetch succeeded. ACOT9 therefore genuinely has no gnomAD
> v2 RMC block covering residue 272 — "No gnomAD blocks" is a *true measurement*, not a blank.
>
> What the gate does kill is the **population-frequency** path (`core-data-fetcher.ts:159-162`),
> which is a different field feeding PM2/BA1/BS1, not the REGIONAL O/E gauge.
>
> Retracted because "one tag explains every blank in the viewport" was the kind of elegant
> generalisation that feels like a finished diagnosis. The rest of the chain above stands; this
> corroboration did not exist.

### The provenance panel actively denies the root cause

`src/components/inspector/EvidenceInspector.tsx:307` — the "Evidence Lineage" panel on the right of
the same screenshot:

```tsx
<span className="text-cs-text-secondary">Genome Assembly:</span>
<span className="font-mono font-bold text-cs-text-primary">GRCh38 / hg38</span>
```

Hardcoded. It certifies the build as **GRCh38** for a variant whose own header chip, 900px to the
left, reads **HG19** — and the build *is* the root cause. Anyone debugging this panel by opening
the lineage box is told the opposite of the truth, in bold, in the one field that would have
settled it. `VariantHeader.tsx:462-466` states the correct contract in a comment — *"The build is
NOT ours to assume"* — and reads the real value (`:467-469`); the inspector was never given the
same treatment.

This is why the symptom survived as long as it did: the two facts that would have met in the middle
are on opposite sides of the screen and one of them is a string literal.

### Aggravating side effect — permanent SQLite cache invalidation

`server/services/orchestration/analysis-orchestrator.ts:52-62`:

```ts
const hasAlphaGenomeKey = Boolean(context?.alphagenomeApiKey || … );
if (hasAlphaGenomeKey) {
  const isAlreadyQueriedUnindexed = Boolean(cons.alphagenome?.message?.includes("not indexed"));
  const alphaMissing = !cons.alphagenome || (!isAlreadyQueriedUnindexed && (cons.alphagenome.status !== "live" || …));
  if (alphaMissing) return true;   // stale → recompute
}
```

`cons.alphagenome` is `null` at step 5, so `alphaMissing` is permanently true. **Configuring the
key is precisely what turns this on**: every view of every GRCh37-fallback variant now discards
its persisted payload and re-runs the whole analysis (VEP, ClinVar, gnomAD, structure,
conservation) forever, and the recompute can never satisfy the predicate. The panel is not just
mislabelled — it is slow because of it.

Timeline, which is the actual mechanism of the regression:

- `a444bc5` (2026-09-14) — *feat(alphagenome): … persistent cache invalidation …* added the
  predicate above, on the assumption "key configured ⇒ a live AVI is obtainable".
- `3154683` (2026-09-17) — *feat(assembly): carry the genome build through the pipeline and gate
  build-pinned sources* made that assumption false.

The invalidation predicate was never revisited when the gate landed.

### Two more places the same false cause is asserted

- `src/components/PredictorSpecialistPanels.tsx:379` — "Frontier foundation model in standby.
  Configure an API key in Settings → Connections". Same wrong attribution, second surface.
- `src/shared/thresholds/concordance.ts:174-182` — comment *"e.g. AlphaGenome without API
  key/endpoint"* drives a rule that **suppresses AlphaGenome from `unavailable[]` entirely**. The
  clinical vote is safe (an `unavailable` signal is excluded from `nPathogenic/nBenign/nVus`, so
  the classification is not biased), but the one surface that could have reported "a major
  evidence source was skipped" deliberately stays silent.

Net effect: the reason appears nowhere in the product, while a false reason appears in three
places.

### The fix was already designed and left unwired

*Recorded as found at 18:20. Two of the three have since been wired — see §0.*

- `src/shared/assembly.ts:142-148` — `describeAssemblyRefusal()` produces exactly the honest
  sentence ("*alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not
  scored*"). It is exported, tested, and **called only by its own unit test**. Its in-file NOTE
  admits it: *"The production gate composes `sourceSupportsAssembly` directly because refusal
  reasons are not yet surfaced in the UI. Wire this in — or delete it — when that surface
  lands."* The test describing it is named *"absence must be explained, not silent"*.
  → **Wired** (`conservation-orchestrator.ts:796-801` → `conservationData.assemblyRefusals` →
  `SplicingTab.tsx:359/369/568`, `SplicingInspector.tsx:311`). The NOTE at `assembly.ts:139-141`
  now says so. **Not consumed by `AlphaGenomeTab.tsx`.**
- `src/shared/engineStatus.ts:307-359` already contains the correct vocabulary, built for the ΔΔG
  engines: `not-covered` = *"the engine holds no data for this protein (**not fixable, by
  design**)"* vs `not-installed` = *"(operator-fixable)"*, and `EngineProblem` distinguishes
  `coverage-miss` from `not-configured` (`:380-387`). `:318` even records that `no-result` exists
  because *"the UI previously said 'Standby' (which implies waiting)"*. The AlphaGenome panel
  bypasses this contract and re-commits the exact error the contract was created to retire.
  → **Adopted at `SplicingTab.tsx:369`** (F-14), independently. Still bypassed by
  `AlphaGenomeTab.tsx`.
- `assembly.ts:30-32` declares policy #2 — *"Coordinates are LIFTED to the canonical build when
  the input build differs, and the lift is REVERSE-VERIFIED"* — and defines `LiftedCoordinate`
  (`:124-131`). **No liftover is implemented anywhere**: the only references to
  `LiftedCoordinate` / `reverseVerified` / `liftover` in the tree are `assembly.ts` itself and its
  test. So the declared recovery path does not exist, and every fallback-path variant
  permanently loses the whole GRCh38-only block: AlphaGenome, PopEVE, GPN-Star, local dbNSFP,
  Genos, dbnsfp.org, splice-proximity and gnomAD regional.
  → **Implemented** as `server/services/translation/liftover.ts:140` (F-3), forward map + exact
  reverse round-trip + GRCh38 REF check, applied at both coordinate producers. The claim above was
  true when written and is false now; §0 has the detail.

### One correction to a plausible-looking theory

`X-23723975-C-A` is **not** a mis-parsed locus. ACOT9 really is at [chrX:Xp22.11,
chrX:23,699,396-23,766,475 (GRCh38)](https://informatics.jax.org/marker/MGI:1928939), so the
chromosome is right and the alleles are right. Only the *build* is wrong for the GRCh38-only
sources. Likewise the SHAP key mapping is sound: `AVI_FEATURE_KEYS` / `AVI_FEATURE_DISPLAY_MAP`
(`alphagenome-client.ts:93-114`) agree with `MODALITY_DEFINITIONS[].aliases`, so a live payload
would populate all 18 cards. Neither is a defect.

---

## 2. UI/UX audit — the AlphaGenome panel

`src/components/evidence/AlphaGenomeTab.tsx` (1251 lines), plus the two other surfaces that
repeat its false cause.

**Verification method.** Source review only. The dev server is not running (0 node processes, no
listening port), and `ALPHAGENOME_API_KEY` is absent from `.env` — the key is a browser-only
transient credential (`src/components/settings/defaults.ts:58-59`, restored into
`SettingsContext.tsx:191-192` from `sessionStorage`), so the live path cannot be reproduced from
here. Hover / focus / active states and motion were **not verified in a browser**. The screenshot
supplied with the request was used as evidence of rendered state.

### A. Copy asserts states the code cannot support

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `AlphaGenomeTab.tsx:776` | `"Awaiting API key for exact rank"` | reason derived from `result.predictorData?.gnomadVariantAssembly` via `describeAssemblyRefusal("alphagenome", …)` | The panel names a cause it has no evidence for, and here that cause is provably false — `:654` says "Key Configured" and `:598-602` shows a green `296ms (22 Scorers)` in the same row. A user who believes it will re-paste the key, which is exactly the loop observed. |
| HIGH | `AlphaGenomeTab.tsx:462`, `:508-513`; `alphagenome-client.ts:22-24` | `acmgStrength ?? "indeterminate"`, and `calculateAlphaGenomeAcmgStrength(null)` also returns `"indeterminate"` → both render `"Indeterminate / Standby"` | separate "Not assessed" from "Assessed, mid-range" | **The most dangerous finding here.** "Never queried" and "queried, landed between the BP4 and PP3 bands" are the *same value*, so the ClinGen SVI card cannot be read. Absence of evidence and evidence of no effect collapse into one badge in a clinical report. |
| HIGH | `AlphaGenomeTab.tsx:1013`, `:867`, `:879`, `:207-215` | `hasScore = isLive && shapValue !== 0`; `extractModalityShap` returns `0` for a missing key | return `null` for absent; render `0.000` as a real value | A measured SHAP of exactly 0.000 means "this biological layer contributed nothing" — a substantive negative result. It renders as `"Standby"`, i.e. as if unmeasured. Zero is a measurement. |
| HIGH | `AlphaGenomeTab.tsx:803`, `:809`, `:814` | `{topModality \|\| "Multi-Modal"}`, `"Unified consensus"`, `"Primary biological regulatory disruption"` | "Not assessed" + no supporting claim | Absence is rendered as a positive-sounding finding, in the card's headline slot, in the accent colour. "Multi-Modal" reads as *all layers contributed*; it means *no layer reported*. |
| MEDIUM | `AlphaGenomeTab.tsx:595`, `:654`, `:598-602` | three badges, two of them contradictory ("Standby" amber, "22 Scorers" green, "Key Configured") | split **transport health** from **evidence availability**; only the first is what the test measures | Two different facts welded into one status row, currently in open disagreement. The user cannot tell which of the three they are being asked to act on. |
| MEDIUM | `AlphaGenomeTab.tsx:911-913`, `:1041`, `:1053` | "Decomposition of 9,440 functional tracks into human-interpretable biological regulatory drivers." / "9,440 Assays" while all 18 cards read Standby | gate the claim on `isLive`, or state "not computed for this variant" | Section headers assert a completed computation that did not run for this variant. |
| MEDIUM | `AlphaGenomeTab.tsx:891` | `$\Delta\Delta G$` inside the Protocol Safety Mandate | `ΔΔG` | Raw LaTeX renders literally — visible in the screenshot as `($\Delta\Delta G$ / structural impact)` in a panel that states a clinical mandate. |
| MEDIUM | `AlphaGenomeTab.tsx:227-318`, `:1129-1149` | `REFERENCE_ASSAY_SCHEMA` — ten fabricated rows (`"-84% ChIP Peak Disruption"`, `"HNF4A / FOXA2 Core Motif"`) in a 5-column grid with a live text filter (`:1067-1074`) and six tissue chips (`:1078-1091`) | keep, but demote the affordances or upgrade the disclosure | Disclosed honestly at `:1055-1057` ("Reference Schema (Illustrative)") and `:1100`, so this is **not** a lie — but a 10px badge is the weakest possible disclosure attached to the strongest possible data affordance. Filtering and tissue-switching fabricated rows feels like exploring measurement. |
| MEDIUM | `PredictorSpecialistPanels.tsx:379` | "Frontier foundation model in standby. Configure an API key in Settings → Connections" | same derived reason as above | The identical false cause in a second surface. Fixing only the AlphaGenome tab leaves the lie in place one tab away. |
| HIGH | `inspector/EvidenceInspector.tsx:687-703` | static fallback box asserting "Deep-dive domain calibrations and metrics are populated dynamically from live backend microservices" for the `alphagenome` tab | state the actual provenance, or say the panel carries no per-tab telemetry yet | **A placeholder that claims to be a feature.** `:687`'s own comment calls it a "Baseline fallback for tabs under subsequent evaluation", and it fires for `alphagenome`. Nothing in the box is dynamic — only `{activeEvidenceTab}` is interpolated — and for this variant the metrics are emphatically *not* populated from a live service. It sits in the panel labelled "Evidence Lineage", i.e. the surface a user reads to judge provenance, in the same viewport as two other false claims. |
| MEDIUM | `inspector/EvidenceInspector.tsx:696` | renders the raw internal tab id: "…telemetry for **alphagenome**" | use the display label ("AlphaGenome Atlas") already defined at `ViewInspector.tsx:100` | Internal identifier leaked into clinical UI copy, in lower case, while `ViewInspector.tsx:100` already holds the correct human label for the same key. |
| MEDIUM | `thresholds/concordance.ts:174-182` | comment *"e.g. AlphaGenome without API key/endpoint"* drives suppression of AlphaGenome from `unavailable[]` | keep the suppression (the vote is correctly unharmed) but surface "not assessed" in the coverage line | The one surface positioned to report a skipped evidence source stays silent, on the same false-cause assumption. |

### B. Visual polish

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `:770`, `:715` | `"Standby"` at `text-2xl font-bold`, `"—"` at `text-3xl font-black` — both in the KPI headline slot | absence gets a smaller, muted, non-headline treatment | Concentric-hierarchy failure of *weight*: the empty state is styled with more typographic authority than the label that would explain it. The largest text in the card is the word saying there is no value. |
| MEDIUM | `:563`(p-4), `:847`(p-5), `:898`(p-6), `:1043`(p-6), `:1159`(p-6) wrapping `:863`, `:875`, `:957`, `:989`, `:1113`, `:1180` (`rounded-xl`) | outer `rounded-2xl` (16) around inner `rounded-xl` (12) with 16-24px padding | outer radius = inner radius + padding | Concentric border radius — the systematic one. All five sections nest a 12px card inside a 16px container with 20px of padding between, so every inner corner visibly fights its parent. |
| MEDIUM | `:741`, `:996`, `:1015`, `:1030` (9px); `:701`, `:759`, `:1006`, `:1117` (10px) | `text-[9px]`, and 10px with `uppercase tracking-wider` | ≥ 10px for anything decorative, 11px for load-bearing text | 9px monospace is below readable, and it carries the gauge axis labels (`0 (Benign)`, `25 (Mod)`, `50 (Deleterious)`), the `SHAP` unit, and the per-modality assay names — the text needed to interpret the bar directly above it. |
| MEDIUM | `:736-739` | four 2px threshold ticks explained only by `title=` | visible micro-labels or a legend row | Title-only information is invisible to keyboard and touch. Four unmarked ticks on a clinical severity gauge, where the distinction between PP3-Supporting and PP3-Moderate is the whole point of the card. |
| MEDIUM | `:918-937`, `:1078-1091` | segmented control and tissue chips with no `role` / `aria-pressed` | add `aria-pressed` (or `role="radiogroup"` + `aria-checked`) | Assistive tech cannot tell which sort or filter is active; visually the active state is colour-only against a tinted surface. |
| MEDIUM | `:595`, `:730`, `:797`, `:866`, `:1055` | amber used for degraded state, moderate pathogenicity, the AlphaMissense modality hue, a decorative icon, and the illustrative-data badge | reserve one hue per semantic axis; give "degraded" a non-pathogenicity colour | Colour-semantics overload in a single viewport. In a tool where amber-on-the-gauge means "moderately pathogenic", amber-in-the-header must not also mean "this is broken". |
| LOW | `:529-533`, `:918-928` | "Sort by Impact" is default-active and sorts by `\|SHAP\|`, which are all 0 while refused | disable the control, or show the applied ordering's basis | The control appears functional and is a no-op — it reorders nothing while signalling that it ranks by biological impact. |
| LOW | `:629`, `:640`, `:649`, `:988`, `:1023`, `:1082`, `:1178`, `:1202`, `:1226` | `transition-all` | name the exact properties (`transition-colors`, `transition-[width]`) | `better-ui`: never `transition-all`. On the modality cards it animates `border-color` *and* layout on hover; on the bars it animates `background` alongside `width`. |
| LOW | `:940-949`, `:1079-1091`, `:613-620` | `p-1.5` and `py-1` controls | ≥ 44px hit area | Sub-30px targets for the Assay Guide toggle, tissue chips and Copy. |
| LOW | `:560` | `animate-fade-in` on the whole panel, every tab switch (0.18s, `styles/animations.css:20`) | drop it, or stagger per section on first mount only | Motion restraint: a container-wide animation on a high-frequency interaction, where the useful cue is already the tab's selected state. |

### C. Developer & agent experience

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `energeticsLabels.guard.test.ts:29-36` | `GUARDED_SURFACES` omits `AlphaGenomeTab.tsx` and `PredictorSpecialistPanels.tsx` | add both after Fix 1 | The retired label `"Standby"` (`engineStatus.ts:954`) is policed by a real-file scanner that simply never looks at the largest offender. The guard's own comment at `:32-35` records that `SplicingTab` escaped for exactly this reason — the omission is the known failure mode, repeated. |
| MEDIUM | `AlphaGenomeTab.tsx` (whole file) | no component test exists anywhere in the repo | pin the empty-state copy per cause | 1251 lines, zero render assertions. The panel that states an unestablished cause is the one panel where nothing checks what it says — which is why a three-day-old gate change could break its only user-visible contract silently. |
| MEDIUM | `assembly.ts:136-140` | `describeAssemblyRefusal` exported, tested, never called; NOTE says "Wire this in — or delete it" | wire it (Fix 1) | A public helper whose own comment admits it is unwired is a trap for the next reader: it looks like the capability exists, and it does, except at the one place it is needed. |
| MEDIUM | `assembly.ts:30-32` vs the tree | module header states coordinates "are LIFTED to the canonical build … REVERSE-VERIFIED"; no implementation exists | implement, or correct the header to state the current policy is refuse-only | The documented contract and the shipped behaviour disagree. An agent or human reading `assembly.ts` will believe liftover protects them. It does not. |

### D. Surrounding surfaces — header, left nav, provenance panel

Delegated pass over `VariantHeader.tsx`, `MasterSidebar.tsx`, `EvidenceInspector.tsx` /
`ViewInspector.tsx`. **Scope note:** the live left nav is `MasterSidebar.tsx`;
`src/components/EvidenceSidebar.tsx` is dead code (zero imports) — do not spend fixes on it.

I independently re-verified every HIGH row and the three most consequential MEDIUMs by reading the
files myself; the rest are reported as found, with the auditor's own "Not verified" retained.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `inspector/EvidenceInspector.tsx:307` | `Genome Assembly: GRCh38 / hg38` hardcoded | read `predictorData.gnomadVariantAssembly` (`contracts.ts:507`) and render via `ASSEMBLY_LABELS` (`assembly.ts:52-55`) | *Verified by me.* Denies the root cause in the provenance panel — see §1. **Upgraded from the auditor's MEDIUM**: for this variant it is not a cosmetic inconsistency, it is a false statement about the exact fact the outage turns on, delivered in the field a debugger would check last. |
| HIGH | `MasterSidebar.tsx:233-241` vs `:253-264` | collapsed state exposes only a `<div … cursor-pointer onClick>` with a `title`; the real `<button aria-label="Collapse sidebar">` renders only when `!isCollapsed` | render the toggle in both states, or make the logo a `<button aria-label="Expand sidebar">` | *Verified by me.* Keyboard users who collapse the sidebar are **stranded** — no focusable route back. Breaks an interaction outright, which is HIGH by definition. |
| HIGH | `MasterSidebar.tsx:119-135` | "progress" = amber spinner (`animate-spin`); "degraded" = static amber dot, same hue, 8px vs 10px | distinct hue or glyph, plus a static cue that survives a still frame | "Wait" and "service broken" need opposite user actions and are separated only by motion. Both strings come from `workflowStatus.ts:3`, not the canonical `engineStatus.ts`. |
| MEDIUM | `shared/workflowStatus.ts:52-53`, `:66-67`, `:82-83`, `:89-100` | `dynamut2Status` / `ddmutStatus` are accepted and folded into `p`, but the destructuring at `:89-100` **omits both** — never read anywhere in the body; `:237-244` returns `status:"complete"` from value presence alone | derive the dot from `buildEngineOutcomes()` + `summarizeCoverage()` (`engineStatus.ts:729`, `:836`) | *Verified by me.* The sidebar paints "Complete" while both remote engines report `unavailable` — degraded coverage indistinguishable from 6-of-6. This is the silent-degradation defect `engineStatus.ts:14-15` exists to kill. |
| MEDIUM | `shared/workflowStatus.ts:238-239` | `ΔΔG = ${ddgVal.toFixed(2)} kcal/mol` over raw `foldx ?? dynamut2 ?? ddmut ?? thermompnn` | `toCanonicalDdg()` + `formatDdg()` (`engineStatus.ts:207`, `:218`) | DynaMut2 and DDMut are negative-destabilizing (`engineStatus.ts:126`, `:135`), so one label can print a destabilizing variant as negative — i.e. as *stabilizing*. Violates "NO surface may format a ΔΔG itself". |
| MEDIUM | `VariantSearchPanel.tsx:539`, compared at `:1080` | `progress: "In Progress"` | canonical `running` label | *Verified by me.* `"In Progress"` is in `LEGACY_ENGINE_LABELS` (`engineStatus.ts:957`) — a banned string, live in a shipped surface, because the guard does not cover this file either. |
| MEDIUM | `inspector/EvidenceInspector.tsx:688-703` | static fallback asserting metrics "are populated dynamically from live backend microservices"; prints raw tab id `alphagenome` (`:696`) | render `conservationData.alphagenome.status` + `.message`, via `describeAssemblyRefusal` for the build case; use the display label from `ViewInspector.tsx:100` | *Verified by me.* A placeholder that claims to be a feature, on the one tab where the pipeline refused upstream — and it leaks an internal identifier into clinical copy. |
| MEDIUM | `inspector/EvidenceInspector.tsx:161`, `:393`, `:451` | "STRING-db v12.0"; "E-Fetch API"; "gnomAD v4.0.0 (Genomes & Exomes)" | "STRING-db (species 9606)"; "E-utilities esearch/esummary"; "gnomAD r4" | Provenance rows assert versions and a mechanism the code does not establish: `string.ts:31` neither pins nor reads a version; `clinvar.ts:99`, `:117` call `esearch`/`esummary`, never `efetch`; `gnomad.ts:68` pins `gnomad_r4` with no patch reported. Same class as the AlphaGenome credential copy. |
| MEDIUM | `inspector/EvidenceInspector.tsx:76-92` (badge `:535-537`) | "Moderate-Risk Concordance (Pathogenic Support)" fires on `(revel ≥ 0.5) \|\| (ddG ≥ 0.5)` (`:84`) while the copy says "> 0.5" (`:87`), thresholds inline | rename to what is tested, or require both arms; pull cuts from `THRESHOLDS` | "Concordance" asserts agreement an OR never checks — a single indicator certifies a "concordant" badge. Plus a `>` vs `≥` boundary mismatch. |
| MEDIUM | `VariantHeader.tsx:386`, `:541`, `:562`, `:576`, `:586` | ClinGen PP2 reasoning, numbering `basisNote`, transcript/build/UniProt explanations live only in `title` on non-focusable `<li>`/`<span>` | visible line or accessible popover; `title` as enhancement only | Invisible to touch and keyboard. `vh-sr-only` (`:423`) covers screen readers, so sighted touch users are the ones left out — and the 9.5px `HG19` tag (`layout.css:388-395`) is the only *visible* build cue while its meaning sits in a hover tooltip. |
| MEDIUM | `layout.css:390` (9.5px), `:651` (9px); `EvidenceInspector.tsx:129-137`, `:392`, `:585` | decision-changing tokens at 9-9.5px: the build tag, track threshold numerals (2.0 / 3.09), confidence tiers | ≥10.5-11px for anything that changes a decision | The genome-build tag is the safety-critical token in the header — per `VariantHeader.tsx:462-466`'s own warning — and it is the smallest, lowest-contrast text in the row. |
| MEDIUM | `MasterSidebar.tsx:429-441`, `:515-527` vs parent `:328` | sub-items are plain buttons with no `aria-current`/`aria-selected`; parent "Evidence" keeps a full clay box while its child is also clay | `aria-current` on the active child; demote the parent to rail + text colour when a child is active | The double highlight visible in the screenshot. Active child is colour/weight-only to AT, and the parent's stronger box reads as the actual destination. |
| MEDIUM | `MasterSidebar.tsx:568-576` | 4px `w-1` resize div, `onMouseDown` only, no `role`/`tabIndex`/keyboard | adopt the right panel's own pattern at `ViewInspector.tsx:371-384` (`role="separator"`, `tabIndex=0`, arrow keys, 6px) | The app already fixed exactly this on the right panel, whose comment says *"resizing must not be mouse-only"* (`ViewInspector.tsx:217-219`). The left sidebar never got it. |
| MEDIUM | `layout.css:277`, `:289`; `VariantHeader.tsx:172`; `MasterSidebar.tsx:122`, `:131`; `EvidenceInspector.tsx:86`, `:332`, `:340` | amber means: moderate pathogenicity, in-progress, service-degraded, non-canonical transcript, transcript warning | reserve amber for clinical severity; give lifecycle states their own treatment | One hue answers "how bad is this variant?" and "is the software working?" — the two questions a clinician must never be made to disambiguate by context. Same overload I found inside the AlphaGenome panel (§B). |
| MEDIUM | `MasterSidebar.tsx:257`, `:314`, `:436`, `:521`; `ViewInspector.tsx:333` | `transition-all` on nav buttons, sub-items, toggle, collapsed aside | name `background-color`, `border-color`, `transform`; `transition-[width]` on the aside | Never `transition-all`. On the aside it also smears every colour on theme switch. |
| MEDIUM | `VariantHeader.tsx:563`, `:577`, `:587`, `:609`; `:371` | chip icons `strokeWidth={1.75}` beside 600-weight values; Copy `2` → Check `2.5` in one button | 2px beside semibold; one stroke per button | Hairline icon beside bold reads as a different icon family; the copy→confirm swap visibly thickens. |
| MEDIUM | `MasterSidebar.tsx:122` vs `:485` | amber spinner on zone rows, indigo spinner on evidence sub-items | one in-progress treatment | Same state, two colours, one component. |
| LOW | `MasterSidebar.tsx:235` (`active:scale-95`), `:314` (`scale-[0.98]`), `:436`, `:521` (none) | three press treatments | 0.96 uniformly, or none | `better-ui`: always 0.96. |
| LOW | `MasterSidebar.tsx:115`, `:122`, `:131`, `:140`, `:148`, `:406`, `:485` | hardcoded Tailwind palette (`bg-emerald-500/90`, `border-slate-400 dark:border-slate-600`) beside `var(--cs-*)` used at `:217-218` | map status dots onto `--cs-*` tokens | Two colour systems in one component; the slate ring won't track theme changes the rest of the sidebar does. |
| LOW | `MasterSidebar.tsx:486-487` | `title`/`aria-label` = "Streaming in background" | "Loading in background" | These flags are `isBiophysicalLoading` fetch state (`:471-480`); the SSE stream (`useJobPoller.ts:60-63`) covers ΔΔG jobs only. Names a transport the code does not use here. *Not verified whether biophysics ever arrives via SSE.* |

Checked, **no violation** (worth recording so the next pass does not re-litigate them): concentric
radius on the header chips (flat type, no nested surfaces); `.vh-icon-btn` hit area (18px + 24px
`::after`, `layout.css:441-466`); hover-revealed copy buttons correctly gated behind
`(hover: hover) and (pointer: fine)` (`:477-485`) so touch keeps them visible; `vh-alert-pulse`
carries static colour + label cues and a reduced-motion off-switch (`:435-438`).

One gap from that pass I closed directly: it flagged `gnomad.ts:300` → `hasRegionalData` →
`VariantHeader.tsx:261-272` turning a single boolean into the biological claim "no gnomAD
constraint blocks", but had not read `core-data-fetcher.ts:159-162`. I did — that is exactly the
gnomAD build gate quoted in §1, so "No gnomAD blocks" and "skipped because GRCh37" are
indistinguishable in the header by construction.

**Block** — eight HIGH findings remain. Seven are one defect seen from seven surfaces — **the UI
states a cause or a condition it has not established** — and the eighth is a straight interaction
break.

The panel cannot currently be read as evidence. It names a missing key where the truth is a build
refusal (`AlphaGenomeTab.tsx:776`); collapses "not assessed" with "inconclusive" in the ClinGen SVI
card (`:508-513`); renders absence as a positive finding (`:803`); discards a measured zero as
missing data (`:1013`); the provenance box beside it claims its filler is live telemetry
(`EvidenceInspector.tsx:687-703`); the line above that certifies **GRCh38** for a GRCh37 variant
(`:307`); and the nav dot distinguishes "wait" from "broken" by spinning (`MasterSidebar.tsx:119-135`).
Separately, collapsing the sidebar strands a keyboard user with no route back
(`MasterSidebar.tsx:233-264`).

The seven are worth treating as one work item, not seven: each is a status string hand-written at
the point of render instead of derived from the state the pipeline actually holds. `engineStatus.ts`
already encodes that discipline for the ΔΔG engines — including the `not-covered` vs `not-installed`
distinction these panels are missing — and `assembly.ts:142` already words the refusal. The audit's
central recommendation is to make surfaces consume those, and to extend the existing
`GUARDED_SURFACES` scanner so a hand-written status string fails CI rather than shipping.

---

## 3. Recommended fix

Three changes, in order of value. Only the first is required to stop the wrong diagnosis.

> **Status after reconciliation (§0): Fix 2 and Fix 3 are implemented; Fix 1 is implemented for the
> splicing surfaces only.** Read §0 before actioning anything here — the remaining work is narrower
> than what follows, and now has a precedent to copy rather than a design to invent.

### First: what to try right now, no code change — superseded

The refusal is driven entirely by the build tag on the coordinate, and that tag records *which
resolution path ran*. Re-querying so the primary Ensembl VEP path resolves the coordinate directly
— rather than falling through to the MyVariant.info hg19 fallback — makes
`gnomadVariantAssembly` come back as `GRCh38` (`vep-orchestrator.ts:262`), and the gate opens.

Concretely: search by genomic HGVS with an explicit build annotation instead of by protein
notation, confirm the header chip flips from `HG19` to `hg38`, then press **Re-evaluate Variant** —
unlike Test Connection, that path actually crosses the gate. The app supports inline build
annotations (`src/shared/contracts.ts:242-246`, exercised as `chr1(GRCh37):g.25484258G>A` in
`VariantSearchPanel.test.tsx:540`).

Caveat, stated honestly: I could not run this. The dev server is not up and the key is a
browser-only transient credential, so this is a code-trace prediction, not a verified remedy. The
fallback fires whenever VEP returns incomplete data (`vep-orchestrator.ts:70`), so re-querying may
still land on the hg19 path. If the chip stays `HG19`, that is why — and only Fix 3 resolves it.

**Superseded:** F-1 replaced the guess-and-fallback ladder with a coordinate-first VEP query, and F-3
lifts the hg19 coordinate automatically at the producer (`vep-orchestrator.ts:260`, `:330`), so the
manual re-query is no longer the intended route. Both are uncommitted.

### Fix 1 — surface the real reason ⚠️ PARTLY DONE (F-13/F-14): splicing surfaces yes, AlphaGenome panel no

The client **already receives the fact needed**: `predictorData.gnomadVariantAssembly`
(`src/shared/contracts.ts:507`), read today by `VariantHeader.tsx:468`. `assembly.ts` is a shared
module imported by both `src/` and `server/`, and `describeAssemblyRefusal()` already writes the
sentence. So:

1. Add one helper that, given `alphagenome` + `gnomadVariantAssembly`, returns the canonical
   state — mirroring `engineStatus.ts`'s existing distinction between `not-covered`
   (*"not fixable, by design"*, `:313`) and `not-installed` (*"operator-fixable"*, `:312`), and
   its `EngineProblem` split of `coverage-miss` vs `not-configured` (`:380-387`).
2. Render it at `AlphaGenomeTab.tsx:776`, `:595`, `:510`, `:803`, `:1013`;
   `PredictorSpecialistPanels.tsx:379`; `EvidenceInspector.tsx:687-703`; and — for the build line
   specifically — replace the hardcoded `GRCh38 / hg38` at `EvidenceInspector.tsx:307` with
   `ASSEMBLY_LABELS[predictorData.gnomadVariantAssembly]`. That last one is the same derived fact as
   Fix 1 and is the single highest-value line change in this document: it is one string literal, and
   it is currently denying the diagnosis on the screen you look at to make the diagnosis.

This retires dead code the project explicitly asked to be wired in (`assembly.ts:136-140`),
aligns a panel that bypassed the canonical status contract, and gives the user the one thing they
can act on — *nothing, for this variant* — instead of sending them to Settings forever.

**Do not** fabricate a `status: "unavailable"` object to carry the reason.
`src/shared/splicingEvidence.ts:84-90` documents that exact trap: object-presence vs status
already made "Standby / Unconfigured" unreachable once. "Never asked" must stay distinguishable
from "asked and unavailable".

**Enforcement already exists — it just does not cover this file.**
`src/components/__tests__/energeticsLabels.guard.test.ts` scans *real source files* for
`LEGACY_ENGINE_LABELS` (which includes `"Standby"`, `engineStatus.ts:954`) using the string-aware
`findLegacyLabels` scanner, over an explicit list at `:29-36`:

```ts
const GUARDED_SURFACES = [
  "src/components/EnergeticsView.tsx",
  "src/components/inspector/EnergeticsInspector.tsx",
  // A surface this change modified that renders engine status: it still carried the literal
  // "Standby / Unconfigured", which is in LEGACY_ENGINE_LABELS, and it sat outside the guard
  // precisely because it had never been added here.
  "src/components/evidence/SplicingTab.tsx",
] as const;
```

`AlphaGenomeTab.tsx` is not in that list — so the word the project already retired appears six
times in it (`:510`, `:595`, `:770`, `:867`, `:879`, `:1013`), with `"Standby"` also live in
`PredictorSpecialistPanels.tsx` (`:357`, `:367`, `:440`, `:484`, `:530`, `:591`, `:598`),
`PerturbationTab.tsx` (`:327`, `:330`, `:403`), `StructureTab.tsx` (`:18`, `:281`),
`ResidueShiftInspector.tsx` (`:383`), `PerturbationModelCards.tsx` (`:92`, `:159`) and
`GenomicSaturationHeatmap.tsx` (`:341`, `:345`) — and nothing fails. The guard's own comment records
that this is how it happened for `SplicingTab`. Adding the two files to `GUARDED_SURFACES` after
Fix 1 is what stops the next panel re-introducing the same lie, and the guard instructs the
failure path explicitly (`:22-23`: *"do not add the label to the allow-list — render the canonical
state instead"*).

Note also that **`AlphaGenomeTab.tsx` has no component test at all** — 1251 lines, no render or
copy assertions anywhere in the repo. The panel that asserts an unestablished cause is the one
panel with nothing pinning what it says.

### Fix 2 — stop the permanent cache thrash ✅ DONE (RCA-Fix2)

`analysis-orchestrator.ts:52-62` already honours a known-unaskable case via
`isAlreadyQueriedUnindexed` (the `"not indexed"` message). Extend the same treatment to a build
the source cannot serve, so the predicate stops demanding a result the pipeline is refusing to
compute. Without this, Fix 1 leaves the panel honest but still re-running every analysis on every
view.

### Fix 3 — implement the liftover the contract already promises ✅ DONE (F-3)

`assembly.ts:30-32` declares it; `LiftedCoordinate` (`:124-131`) models it with
`reverseVerified: true` so an unverified lift cannot be expressed; nothing implements it. Building
it recovers AlphaGenome, gnomAD regional constraint, PopEVE, GPN-Star, local dbNSFP, Genos,
dbnsfp.org and splice-proximity for **every** variant that resolves through the VEP fallback —
which is the actual data-loss bug. Fixes 1 and 2 make the current behaviour legible; only Fix 3
makes this variant go live.

Cheaper interim option for the same population: make the *primary* VEP path succeed more often, or
have the fallback re-request coordinates from Ensembl in GRCh38 rather than adopting the hg19
`_id`. That addresses the symptom's frequency rather than the missing capability.

### Fix 4 — the two interaction breaks, so they do not get lost under the copy work

Neither is a wording problem, and neither will be caught by a copy review:

- `MasterSidebar.tsx:233-264` — render the collapse toggle in both states, or make the logo a real
  `<button aria-label="Expand sidebar">`. A keyboard user who collapses the nav cannot get out.
- `MasterSidebar.tsx:119-135` — give "degraded" a static cue that survives a still frame, and stop
  sourcing nav status from `workflowStatus.ts` in favour of `engineStatus.ts` (which also fixes the
  `:237-244` "complete while two engines are unavailable" row).

## 4. What this audit did not establish

Stated so the next reader does not mistake silence for clearance.

- **The tree moved during the audit, and the audit did not notice.** Two load-bearing claims here —
  "no liftover is implemented anywhere" and "`describeAssemblyRefusal` is dead code" — were true when
  read and false three hours later. Both came from `grep`, and a grep is a snapshot with no timestamp
  attached. The tell was in plain sight: `git status` early on showed exactly one dirty file
  (`layout.css`); at reconciliation it showed 22 plus 4 untracked. Any finding phrased as "X exists
  nowhere in the tree" should be re-run before being acted on, and should record the HEAD and
  dirty-state it was checked against.
- **One claim was simply wrong**, not stale: the REGIONAL O/E attribution, retracted in §1. It was
  wrong instructively — it made the diagnosis more elegant by folding a second blank into the same
  cause, and the counter-evidence (MISSENSE Z and LOEUF rendering from that same fetch) was visible in
  the very screenshot I was citing as corroboration.
- **Nothing was run.** No server, no browser, no test. The dev server is down (0 node processes, no
  listening port) and `ALPHAGENOME_API_KEY` is absent from `.env` — the key is a browser-only
  transient credential (`settings/defaults.ts:58-59` → `SettingsContext.tsx:191-192`), so the live
  gRPC path cannot be reproduced from this checkout. Every claim here is a source read plus the
  rendered state visible in the supplied screenshot.
- Consequently: **hover, focus, active and loading states are unverified**, and no motion was
  replayed at 10%. The `better-ui` verification step that requires a browser was not performed.
- The prediction in §3 ("re-query so VEP tags GRCh38") is a code-trace inference, not a tested
  remedy.
- `workflowStatus.ts:239`'s sign claim rests on `engineStatus.ts:126`/`:135` recording DynaMut2 and
  DDMut as negative-destabilizing. The engine-level conversion is correct and tested; the defect is
  that this one surface bypasses `toCanonicalDdg()`. Whether a live payload currently reaches that
  line with a mismatched sign is **not verified**.
- `src/components/EvidenceSidebar.tsx` was excluded as dead code (zero imports). Worth confirming
  independently before deleting, and worth deleting deliberately rather than leaving as a decoy —
  it is the file a reader would otherwise audit by mistake.
- **The working tree is dirty:** `src/styles/layout.css` has an uncommitted change to `.vh-scale`
  geometry (20px→24px, bar/tick/marker re-centring, asserted by `tools/header-geometry/check.mjs`).
  That is someone else's in-flight work on the header gauges. Any fix pass touching `layout.css`
  rows in §D — `.vh-chip-key` at `:390`, `.vh-axis-label` at `:651` — should stage explicit paths
  and not assume those line numbers after their change lands.

---

## 5. Remediation applied

### The decision

This audit found eight HIGH issues across five surfaces, and seven were the *same* defect: a status
string hand-written at the point of render, naming a cause the pipeline had not established. Fixing
seven strings would have been seven edits that regrow.

So the change is one abstraction plus its adoption, chosen for compounding effect across all three
axes rather than the shortest path to green copy:

| | What the single move buys |
| --- | --- |
| **UX** | Absence is stated once, at the source, with the real reason — replacing ~25 scattered "Standby" strings that read as 25 separate problems. A user is sent to Settings only when a credential is genuinely what is missing. |
| **DX** | One vocabulary, already existing: every label is `ENGINE_STATE_LABELS[...]`. No surface can invent a status word again without the guard failing, and the guard now covers the largest surface that was escaping it. |
| **AX** | The lie is *unnameable*, not discouraged. `resolveEvidenceAvailability` has no input that yields `action: "configure-credentials"` while a build refusal is recorded — so an agent adding a 19th evidence source gets the correct distinction by construction and cannot express the wrong one. |

The design principle: **absence was not a typed concept.** Each surface could render *some* absence
word without ever being asked which absence it meant. Strings are individually fixable and re-grow;
a missing distinction is not.

### What was built

`src/shared/evidenceAvailability.ts` — classifies why a source has no value into
`available | pending | not-covered | not-configured | upstream-error | no-result`, returning
`{state, label, reason, tone, userActionable, action, hasValue}`.

Three properties are load-bearing and documented in-file:

1. **Branch order is the design.** A value outranks everything (and a measured `0` is a value); then
   pending; then refusal — *before* configuration, because a credential cannot fix a build.
   Reordering those two is exactly how the original false cause was produced.
2. **No new vocabulary.** Labels come from `engineStatus.ts`, so the two cannot drift and the
   legacy-label guard keeps its force through this layer.
3. **`configured` is tri-state.** `undefined` means the caller does not know, and the resolver then
   never infers `not-configured` — guessing at configuration is the original sin.

### Where it was adopted

| Surface | Before | After |
| --- | --- | --- |
| `AlphaGenomeTab.tsx` | `"Awaiting API key for exact rank"`; one amber badge conflating transport with evidence; `{topModality \|\| "Multi-Modal"}`; `"Indeterminate / Standby"`; `extractModalityShap` returning `0` for absent | resolver-driven state; two independent axes (evidence availability / channel health); em-dash for absence; the SVI badge branches on `isAssessed` so "Indeterminate" is reachable only from a real mid-band score; `number \| null` distinguishes `0.000` from unmeasured |
| `SplicingTab.tsx` | inline `refusal ? not-covered : not-installed` — right about the one case F-14 hit, wrong about provider errors and unindexed variants | same resolver; three distinct absences now get three distinct labels |
| `PredictorSpecialistPanels.tsx` | "Frontier foundation model in standby. Configure an API key in Settings → Connections" for every absence | reason from the payload; the Settings button renders only when `action === "configure-credentials"` |
| `EvidenceInspector.tsx` | hardcoded `Genome Assembly: GRCh38 / hg38`; filler box claiming metrics "are populated dynamically from live backend microservices" | real `gnomadVariantAssembly` via `ASSEMBLY_LABELS`; the box says it is a placeholder and lists the refusals the server actually recorded |
| `MasterSidebar.tsx` | collapsed state had only a `<div onClick>` — keyboard users stranded | real `<button aria-label="Expand sidebar">` when collapsed |

Plus the AlphaGenome tab polish pass: `transition-all` → named properties, `active:scale-[0.96]`,
`aria-pressed` / `role="group"` / `aria-expanded`, sub-10px text raised, a visible gauge-tick legend
replacing `title`-only thresholds, nested card radii, and raw LaTeX `$\Delta\Delta G$` → ΔΔG.

### Enforcement

`energeticsLabels.guard.test.ts` now scans `AlphaGenomeTab.tsx` for retired labels. The guard's own
comment records why it had escaped — the identical omission that let `SplicingTab` through — and the
file is green under all three of its assertions.

### Verification

| Layer | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `node scripts/check-boundaries.ts` | 0 violations (the new module stays inside `src/shared/`) |
| `npx vitest run` — full suite | **1557 passed · 5 skipped · 0 failed**, 144 files |
| `src/shared/__tests__/evidenceAvailability.test.ts` | 15 tests, including a negative control against the rule it replaces |
| `scratch/verify-evidence-availability.mjs` | 14/14 via Node type-stripping, for environments where vitest cannot start |
| `scratch/verify-label-guard.mjs` | guard green, with two mutation controls proving the scanner still *sees* a violation and still ignores a comment |

vitest cannot start under the confined sandbox (`esbuild` bundles `vite.config.ts` over a named pipe
→ `spawn EPERM`, errno `-4048`). The real runner was executed after a one-time, justified escalation;
the harnesses are belt-and-braces, not the primary evidence.

### Deliberately not done

- **`PredictorSpecialistPanels.tsx`'s remaining structural-model labels** — a second engineer was
  converting those concurrently, and one of my edits to that file was correctly refused as stale.
- **`workflowStatus.ts`'s unread status props and raw ΔΔG formatting**, and `VariantSearchPanel.tsx`'s
  banned `"In Progress"` — real MEDIUM findings, but they are the energetics sign-convention problem,
  not the availability problem; folding them in would have made this change about two things.
- **The fabricated reference-assay table** — kept. It is honestly labelled illustrative; the fix for
  its over-strong affordance is a design decision, not a correctness one.

### Concurrency, recorded because it changed the outcome twice

1. A `tsc` error appeared in `server/services/translation/liftover.ts` — a file I never opened — when
   another session widened `buildCoordinateLiftKey` in `cache-keys.ts` to six arguments. I left it
   alone; they fixed it within minutes. While it existed it was the only type error in the tree, and
   my own files were clean.
2. An edit to `PredictorSpecialistPanels.tsx` was **refused by the editor's stale-read check** because
   the file had changed since I read it. The other engineer had fixed that same line 21 seconds
   earlier. That refusal was the correct outcome and is worth stating plainly: the tooling prevented
   a clobber I would otherwise have caused.

**Lesson for the next reader:** in a shared checkout, re-run any check whose result you intend to
publish, immediately before publishing it. Every number above was re-measured after the last
external edit.

---

## 6. Adversarial review outcome — what broke, and what it did to §5

Four independent senior reviews were commissioned on §5's change: an adversarial attack on the
resolver, a React/type review of the AlphaGenome panel, a clinical-truthfulness review of the call
sites, and a verification-quality audit that mutation-tested the module against its own tests.

**All four found real defects; two found defects that falsified §5's central claim.** §5's test count
and its `hasValue` contract description are superseded here.

### The two CRITICALs — each reproduced before being fixed

**1. The false cause returned from the opposite direction.** The resolver tested the client-side
`configured === false` flag *before* the provider's own "variant not indexed" statement, so
`{configured:false, message:"Variant not indexed in AlphaGenome Atlas."}` yielded
`not-configured` + a Settings action, and the panel rendered:

> *Variant not indexed in AlphaGenome Atlas. **Add or check the AlphaGenome credential in Settings,
> then re-evaluate.***

A Settings prompt welded to the sentence proving Settings cannot help. Reachable because the server
reads `process.env.ALPHAGENOME_API_KEY` while `configured` came from browser-only transient storage;
the two are never reconciled. **Fix:** evidence strength is now ordered *value → pending → recorded
refusal → provider coverage statement → provider credential statement → local flag → provider fault →
no result.* A remote fact outranks a local belief.

**2. The headline guarantee was falsifiable through the module's own public API.**
`refusalReasonFor(refusals, source: string)` took a free string, so a mis-cased `"AlphaGenome"`
returned `null`, the resolver saw no refusal, and fell through to a credential verdict — making
*"no input combination yields a Settings call-to-action for a build refusal"* false for the very call
surfaces were told to use. The helper's docstring claimed to end "a lookup whose key spelling was
free"; it had relocated it. **Fix:** `source: AssemblyRefusalSource`, already exported by
`assembly.ts` — the typo is now a compile error.

### Five more real defects, all fixed

| Finding | Fix |
| --- | --- |
| An expired key or `PERMISSION_DENIED` became `upstream-error` + **retry** — a loop that can never succeed | A credential-fault branch maps the provider's actual strings to `not-configured` + Settings |
| The "not indexed" matcher was a broad regex over arbitrary provider text: `"no record of this job id yet, poll again"` read as **permanent**, and it disagreed with the server's narrower `includes("not indexed")` — re-opening the cache thrash | Matched to the server's exact predicate, with a test proving agreement across eight messages |
| A bare `status:"unavailable"` (a **zod default**) was reported as "Provider error" — a third-party fault asserted on no evidence | Requires an actual message; otherwise `no-result` |
| `status:"live"` plus any message became `upstream-error`, contradicting the module's own value-outranks-flag rule | A live answer with no value is `no-result` |
| `hasValue: boolean` left "what counts as a value" to each caller — and **the two call sites already disagreed**, so one payload read `available` in one panel and `upstream-error` in another | Contract changed to `value: number \| null \| undefined`, `NaN` rejected. The disagreement is unrepresentable |

The last is the one to learn from: the module's headline rule ("a measured 0 is a value") was
**unenforceable under its own first contract**, because a boolean meant the module never saw the 0.
The verification audit proved it — mutating `value !== 0` was undetectable under the old signature and
is caught under the new one.

### Panel and call-site findings, also fixed

- `configured` was a **definite boolean from browser-only settings** at three call sites → now
  `key ? true : undefined`, honouring the resolver's own tri-state contract.
- **Live-but-unattributed:** `alphagenome-client.ts` emits `featureAttributions: null` on live
  results, so the panel said "assessed" above eighteen unexplained em-dashes under a heading claiming
  a completed decomposition. Attribution is now a **separate axis** with its own sentence.
- `"AVI assessed"` was a hand-written status word — and the guard **structurally cannot see positive
  states**, only retired absence labels. Now `ENGINE_STATE_LABELS.computed`.
- Amber still doubled as "degraded software" and "PP3-moderate pathogenicity" 200px apart →
  infrastructure moved to indigo; amber reserved for clinical severity.
- `text-emerald-500`/`text-amber-500` at 11px measured ≈2.5:1 / ≈2.15:1 on light surfaces — below AA.
  Now the project's own AA-safe `cs-badge-*` primitives, which `layout.css:248-251` documents as
  existing for exactly this reason.
- `active:scale-[0.96]` was paired with `transition-colors`, which omits `transform` — the press
  snapped instead of releasing.
- A measured `aviQuantile` of `0` rendered as "—" **one line below** the fix for the same bug.
- `describeAssemblyRefusal`'s sentence begins with the internal key (`"alphagenome covers…"`); it was
  reaching clinical prose at four surfaces. Humanised once, inside `refusalReasonFor`.
- `GenomicSaturationHeatmap` rendered "Regional Saturation **Standby**" and asserted queries
  "require an active AlphaGenome service connection" — a cause its route never establishes (no build
  gate, no refusal path). Now reports the server's message, or records that no cause exists.
- Dead `?? ENGINE_STATE_LABELS["no-result"]` fallbacks removed; `NaN` guard in `extractModalityShap`;
  Copy hit area raised; icon-tile radius; two stale comments rewritten.

### What the verification audit said about my own evidence

- **My harness's negative control was a tautology:** `configured ? "not-installed" : "not-installed"`
  ignored its own argument, so `wrong.length === 3` was self-fulfilling and passed against a module
  wrong about everything. Corrected, plus a **meta-control** that mutates branch order and asserts the
  suite catches it.
- It then caught **my corrected expectation being stale** — the old rule mislabels 4 of 4, not 3. The
  harness found that, not I.
- **Five surviving mutants named untested behaviour:** `tone` had literally zero coverage;
  `status:"pending"` was untested while `frequencyEvidence.ts` depends on it live; plus
  `refusalReasonFor` exact-match, `describeAbsence` for three states, and upstream-error
  `userActionable`. All five now asserted — the file went **15 → 34 tests**.
- The tautological assertion was **deleted from the durable test** rather than repaired, with a
  comment recording why: a test that cannot fail is not documentation, it is a liability that reads as
  coverage.
- One §5 claim was over-stated — *"no surface can invent a status word again without the guard
  failing."* True for absence labels; **false for positive states**, which the guard does not scan.
  The code now uses the canonical label; the claim is qualified rather than left standing.

### Closed after this section was first written

The four items below were deferred when §6 was drafted and have since been done, so the record is
corrected rather than left claiming they are outstanding.

- **`concordance.ts` coverage line — done.** A skipped source is now named with its recorded reason
  instead of being silently dropped. The suppression was not simply removed: the resolver separates
  the two cases the old blanket rule conflated, so a deployment with no AlphaGenome credential stays
  silent (nothing is skipped for this variant, and a warning would be noise) while a source that
  *declined this coordinate* is reported as `ALPHAGENOME — NOT ASSESSED: <reason>`. The vote is
  untouched, exactly as before. `criteria.ts` passes `assemblyRefusals` through; because the field is
  optional, the consensus degrades to today's behaviour if that wiring is ever absent.
- **A component test for `AlphaGenomeTab.tsx` — done.** Ten render assertions now pin the claims
  review proved the panel could get wrong: the refusal renders as the canonical label *and never*
  as a credential ask; a rejected key offers Settings and not a retry; a provider fault offers a
  retry and not Settings; a bare `status:"unavailable"` is not reported as a provider error; the
  positive state uses the canonical word; a live score with no attributions is explained rather
  than shown as eighteen bare dashes; a measured quantile of `0` renders as a value; and mounting
  without a result is a clean no-op through the new hook-free wrapper.
- **The early `return null` above ten hooks — done.** The guard moved into a wrapper that declares
  no hooks of its own, so the Rules-of-Hooks violation is now unrepresentable rather than merely
  unreached. It was pre-existing, but the host's comment records the identical pattern already
  crashing once and this repo has no eslint to catch a repeat.
- **Two more §2D leftovers — done.** `workflowStatus` now canonicalises a ΔΔG through
  `toCanonicalDdg`/`formatDdg` instead of printing a raw pick across engines with opposite sign
  conventions, and `VariantSearchPanel` retired the banned "In Progress" literal — moving its
  status checks onto the underlying state so a display label is no longer load-bearing as an
  identifier.

### Still not fixed

- **The illustrative reference-assay table** stays: honestly labelled, and the finding is that its
  filter and tissue chips are measurement-grade affordances on fabricated rows. A design judgement,
  not a correctness defect.
- **`MasterSidebar`'s motion-only "degraded" cue**, the header's `title`-only reasoning, and the
  9.5px build tag are unaddressed. They sit in files another session is actively rewriting
  (`VariantHeader.tsx`, `layout.css`), so touching them now risks clobbering concurrent work. They
  remain recorded in §2D and §6.

### Final verification

`tsc --noEmit` clean · `check-boundaries.ts` 0 violations · **1697 passed · 5 skipped · 0 failed**
across 153 files · `evidenceAvailability.test.ts` 34 tests · `AlphaGenomeTab.test.tsx` 10 tests.

Committed as `895d0bd`, alongside the shared module already landed in `2a4ac13`. The remaining
dirty files belong to the concurrent session and were deliberately not staged.

### Net effect

**The original diagnosis is unchanged and now better-evidenced.** The API key was never the problem;
a GRCh38-only build gate refused a GRCh37 coordinate, and five surfaces stated a credential cause the
pipeline had not established. What the reviews changed is the *fix*: the first resolver could still
produce the same false cause from two directions, and its own suite could not see it.
