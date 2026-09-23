# The "Unmapping Defect" — ACOT9 splice architecture: full RCA and bug audit

Variant under audit: `ACOT9 p.Lys272Asn` · genomic `X-23723975-C-A` tagged **HG19** · `Q9Y305` ·
screenshot state: *every* row of "Variant Splice Architecture" reads **unmapped**, the schematic
nevertheless draws a junction at **0 bp**, "SpliceAI Max Delta" reads **0.702 (High Disruption
Risk)**, and the etiology verdict is **Splicing-Dominant**.

This document supersedes and extends `doc/ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md` for the
splicing surface. That document stopped at "Ensembl VEP returned incomplete data" (step 1 of its
chain). **This audit explains why it always will, for this variant and for every variant whose
amino-acid substitution has an ambiguous codon back-mapping** — and corrects one of its claims.

---

## 1. Executive summary

Three independent defects stack into the observed screen:

1. **The predictor's VEP path is structurally dead for this variant class.**
   `fetchPredictorData` queries Ensembl VEP *only by protein HGVS* (`transcript:p.Lys272Asn`).
   Ensembl REST rejects protein HGVS whenever the amino-acid change does not back-map to a
   *unique* nucleotide change — Lys→Asn never does (`aaG → aaC` **or** `aaT`). Independently,
   the query targets are the **MANE** transcripts, while the platform feeds the **canonical-numbered**
   protein substitution (the deliberate ACOT9 remap fix); MANE residue 272 is Glu, so even the
   reference check fails. Both causes are proven live in §3. All five query targets 400 → the
   MyVariant.info fallback runs → the coordinate is honestly tagged **GRCh37**.
2. **A GRCh37 coordinate is terminal, not recoverable.** `src/shared/assembly.ts` policy #2
   promises lifting to the canonical build with reverse verification (`LiftedCoordinate`), but
   **no liftover is implemented anywhere in the tree**. The build gate therefore *refuses*
   splice-proximity, AlphaGenome, PopEVE, GPN-Star, local dbNSFP, Genos, dbnsfp.org and gnomAD
   r4 — correctly refusing, permanently. SpliceAI's Broad Lookup is the one coordinate service
   with per-build endpoints, so it answers (0.702, `ds_al` at `dp = 0 bp`) while the geometry
   panel goes blank. The panel then *contradicts itself*: "Aberrant Splicing Risk" beside
   "Splice Site Proximity: Unmapped".
3. **The UI fills the honest blanks with fabricated claims.** The schematic draws an acceptor
   junction with the variant at "0 bp"; the inspector asserts "Transcript coordinates mapped";
   the dbscSNV card asserts "Outside Consensus Zone" — all three state a measurement that was
   never taken (and here, all three are provably *wrong*: VEP itself classifies the variant
   `splice_region_variant`, and SpliceAI places the acceptor shift at exactly 0 bp).

---

## 2. Causal chain (verified)

| # | Location | What happens | Evidence |
|---|---|---|---|
| 1 | `server/services/prediction/predictors/vep-orchestrator.ts:152-170` | Query targets built as `NM_…:p.Lys272Asn`, `ENST…:p.Lys272Asn` (both MANE accessions from `getTranscriptsForProtein`, which returns **only** the MANE-Select pair, `transcript-resolver.ts:43-52`), then `ACOT9:p.Lys272Asn` | code |
| 2 | `vep-orchestrator.ts:176` | All targets hit the **GRCh38** host `rest.ensembl.org/vep/human/hgvs/…` — the request's `assembly` is never consulted here | code |
| 3 | Ensembl REST | Protein HGVS rejected: (a) MANE residue 272 = **E** ≠ K (`isoform-remap.test.ts:99-102`; live 400 "GAG -> E does not match input sequence (K)"); (b) even with correct MANE numbering (`p.Lys281Asn`), "Could not uniquely determine nucleotide change" — K→N is codon-ambiguous; (c) the gene-level target is not valid HGVS protein at all | live §3.1-3.3 |
| 4 | `vep-orchestrator.ts:277-278` | Every target failed → `fetchPredictorsFallback()` (MyVariant.info) | code + rendered state |
| 5 | `vep-orchestrator.ts:106-110,132` | MyVariant `_id` is hg19 → `gnomadVariantId = X-23723975-C-A`, `gnomadVariantAssembly = "GRCh37"` (honest tag) | header chip renders exactly this (`VariantHeader.tsx:467-469`) |
| 6 | `conservation-orchestrator.ts:765-767, 812-813` | `usableBy("splice-proximity")` = false (GRCh38-only, `assembly.ts:79`) → `resolveSpliceProximity` never runs → `spliceProximity = null` | screenshot: all architecture rows unmapped |
| 7 | same gate at `:771-787` | PopEVE, GPN-Star, AlphaGenome also refused → AlphaGenome card "Not available here", SHAP "—" | screenshot |
| 8 | `conservation-orchestrator.ts:790-792` + `assembly.ts:71` | SpliceAI Lookup supports **both** builds → live Broad call on the hg19 service with the hg19 coordinate → 0.702, AL at `dp = 0 bp` | screenshot breakdown |
| 9 | `src/shared/splicingEvidence.ts:268-289, 304-338` | `distance = null` → proximity "Unmapped"; dbscSNV absent → label defaults to **"Outside Consensus Zone"** (assertion without measurement) | screenshot card 3 |
| 10 | `src/components/evidence/SplicingTab.tsx:590-619, 693-700` | `distance === null` → `pinX = 480`, `isDonor = isAcceptor = false` → schematic renders the **acceptor layout** with a marker "Splice Boundary (0 bp)" and the ±5 bp consensus zone — geometry the resolver explicitly declined to compute | screenshot diagram |
| 11 | `src/components/inspector/SplicingInspector.tsx:302-309` | The null-distance branch prints "Transcript coordinates **mapped** to Ensembl model ENST00000336430…" directly under a table where every coordinate row reads "Unmapped" | screenshot inspector |

Step 6's refusal is *correct behavior* (see `assembly.ts:20-24`: a wrong-build coordinate that
happens to share its REF allele scores a **different locus** and is attributed to this variant).
The defects are 1-5 (why the fallback is permanent here), the missing liftover (why refusal is
terminal), and 9-11 (why the UI states as fact what it failed to measure).

---

## 3. Live verification performed for this audit

1. `GET rest.ensembl.org/vep/human/hgvs/ENST00000379303.10:p.Lys272Asn` → **400**
   *"Sequence translated from reference (GAG -> E) does not match input sequence (K)"* —
   the MANE/canonical numbering collision, live.
2. `GET …/vep/human/hgvs/ENST00000379303:p.Lys281Asn` (MANE transcript, MANE numbering — the
   form the platform *could* have sent) → **400** *"Could not uniquely determine nucleotide
   change"*. Protein-HGVS queries are a dead end for K→N regardless of numbering.
3. `GET …/vep/human/hgvs/ENST00000646891:p.Val600Glu` (BRAF, unique back-map) → **200** —
   the endpoint itself is healthy; the failure is notation-specific.
4. `GET …/vep/human/hgvs/ENST00000336430:c.816G>T` (cDNA, the canonical transcript) → **200**,
   `X:23,705,858`, `missense_variant, splice_region_variant`, protein 272 K/N on strand −1.
   **The correct GRCh38 coordinate and a splicing-aware VEP consequence are one request away** —
   the platform simply never makes that request.
5. `GET rest.uniprot.org/uniprotkb/Q9Y305.json` → MANE-Select xref `ENST00000379303.10` /
   `NM_001037171.2`; canonical Ensembl xref `ENST00000336430.11` (isoform Q9Y305-1).
   `getTranscriptsForProtein` returns only the MANE pair (`transcript-resolver.ts:43-52` early
   return) — the canonical transcript the platform actually models is never queried.
6. NCBI esummary: **`NM_001031711` = ERGIC1 (chr5)**, `NM_001037171` = ACOT9 (Xp22.11). See F-12.

---

## 4. Findings

Severity scale: **CRITICAL** = wrong evidence can reach a clinical read; **HIGH** = permanent
data loss or a false claim in the UI; **MEDIUM** = latent wrongness / misattribution;
**LOW** = hygiene.

### A. Server — why the fallback (and thus the blanks) is permanent

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| F-1 | **HIGH** | `vep-orchestrator.ts:152-176` | Predictor data is fetched by **protein HGVS only**. Two independent failure modes proven live (§3.1-3.2): MANE-vs-canonical numbering mismatch for isoform-remapped genes, and Ensembl's unique-back-map requirement for ambiguous substitutions (K↔N, G↔A, R↔Q, W↔C, …). The analysis request already carries the build (`workflowOrchestrator.ts:529-541`), and the translate step already resolved the genomic/cDNA coordinate — neither is used. Fix: query `/vep/human/region/` (or cDNA HGVS) with the translated coordinate, on the host matching its build; keep protein HGVS as last resort. |
| F-2 | **HIGH** | `transcript-resolver.ts:43-52` | `getTranscriptsForProtein` early-returns the MANE pair and never exposes the **canonical** Ensembl transcript (`ENST00000336430` for Q9Y305) — the exact transcript the platform models. Even the existing protein-HGVS strategy would then hit the residue-mismatch wall (F-1b) only for ambiguous changes; for ACOT9 both bite. Fix: return `{maneEnsemblId, canonicalEnsemblId, …}` and add the canonical transcript to the target list. |
| F-3 | **HIGH** | `assembly.ts:30-32,124-131`; zero implementations | Policy #2 ("coordinates are LIFTED to the canonical build, reverse-verified") is a **type and a test, with no code**. `LiftedCoordinate`/`reverseVerified` appear nowhere else in the tree. So every GRCh37-coordinate variant permanently forfeits splice geometry, AlphaGenome, PopEVE, GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4. Fix: implement the lift (Ensembl REST `/map/human/GRCh37/{region}/{build}` round-trip, or UCSC chain) at the single point where `gnomadVariantAssembly === "GRCh37"` is stamped, and feed consumers the lifted, re-tagged coordinate. |
| F-4 | **MEDIUM** | `cache-keys.ts:98-103` | `buildPredictorsKey(gene, variant, uniprotId)` has **no build/source dimension** and a 14-day TTL, and caches the fallback outcome like the success. Where F-1 is transient (VEP outage) this pins a variant to GRCh37-fallback evidence for two weeks; where F-1 is structural (ambiguous substitution) the cache merely records reality. Fix: key on the resolved source or re-attempt the primary path after a short TTL for fallback results. |
| F-5 | **MEDIUM** | `conservation-orchestrator.ts:173-175` | The base `fetchConservationData` calls `resolveSpliceProximity(transcriptId, genomicPos)` with **no assembly gate** — the exact hazard the in-file comment at `:220-230` says it closed for PopEVE/GPN-Star ("this one remains free to score the wrong locus the moment anyone passes a coordinate in"). Dormant today (the progressive caller passes `null, null` at `:843-855`; `service-adapters.ts` passes none) but one careless caller away from rendering GRCh37-vs-GRCh38 geometry as measured. Fix: gate it with `usableBy("splice-proximity")` like its siblings, or drop the parameters. |
| F-6 | **MEDIUM** | `splice_resolver.ts:54-99,127` | `resolveSpliceProximity(transcriptId, genomicPos)` receives no contig; `fetchTranscriptExons` already parses `seq_region_name` and discards it. A position from another chromosome (F-5, or any future caller) yields a confident, meaningless distance. Fix: pass the coordinate's chrom and refuse on mismatch. |
| F-7 | **MEDIUM** | `conservation-orchestrator.ts:428` vs `:602-603` | The MyVariant conservation query never projects `dbnsfp.dbscsnv`, yet the parser reads `db.dbscsnv?.ada_score` — dbscSNV is **unfetchable by construction** on this path. The dbnsfp.org path hardcodes `dbscsnv: null` (`:415`); the local dbNSFP is disabled in this deployment (`data/dbnsfp_v5.sqlite` is 0 bytes; `isLocalDbnsfpAvailable` requires >1 KB). Net: the "dbscSNV Consensus" KPI can only ever show "—" outside Genos — while its badge asserts "Outside Consensus Zone" (F-9). Fix: add `dbnsfp.dbscsnv` to `targetFields`. |
| F-8 | **LOW** | `conservation-orchestrator.ts:478` | `const hit = matchedHit \|\| parsedData.hits[0]` — when no hit matches the substitution, `gerp`/`phylop` are read from an arbitrary variant at the same protein position (only the other fields are gated on `isExactMatch`). Wrong-variant conservation values can leak. Fix: gate gerp/phylop on `isExactMatch` too, or drop the `hits[0]` fallback. |

### B. Client — the UI states as measured what was refused

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| F-9 | **HIGH** | `splicingEvidence.ts:288-289` | `dbscLabel` defaults to **"Outside Consensus Zone"** when *no dbscSNV score exists at all* — the exact pattern the file's own comment at `:263-267` forbids for proximity ("Labels say what was measured, never what was not tested"). Here it is provably false: VEP calls the variant `splice_region_variant` and SpliceAI puts the acceptor loss at `dp = 0 bp`. Severity `unmapped` is set correctly but the visible label lies. Fix: label "No dbscSNV Data" / "Not Assessed" for `dbscSeverity === "unmapped"`. |
| F-10 | **HIGH** | `SplicingInspector.tsx:302-310` | Null-distance branch renders "Transcript coordinates **mapped** to Ensembl model ENST00000336430. Splice disruption probability is quantified across the machine learning consensus scores above." — directly beneath a table whose every coordinate row reads "Unmapped" (same pane, ~90 lines apart). Fix: say what actually happened, e.g. "Junction geometry not assessed: this coordinate is GRCh37/hg19 and the exon model is GRCh38" — `describeAssemblyRefusal()` already writes this sentence (F-13). |
| F-11 | **HIGH** | `SplicingTab.tsx:590-619, 621-640, 693-700` | With `distance === null` the schematic still draws: the **acceptor** layout (because `isDonor` is false and the ternary defaults), the "±5 bp Consensus Zone" box, and a muted marker labelled **"Splice Boundary (0 bp)"** sitting on the junction — visually placing the variant at 0 bp of an AG acceptor. For this variant the fabrication happens to be true (§3.4); for a deep-intronic or off-transcript variant with no predictor coverage it is false, and indistinguishable from a measurement. Fix: when geometry is unmapped, render a deliberately unplaced diagram (no consensus zone, no marker, dashed/greyed exon-intron bands labelled "model not resolved"). |
| F-12 | RESOLVED (misread) | `VariantHeader.tsx:459-460,561-572` | The header transcript chip was read from the low-resolution screenshot as **`NM_001031711.2`** — which is **ERGIC1's** accession (chr5), not ACOT9's MANE `NM_001037171.2` (§3.6). **Confirmed by the user as a screenshot misread.** Consistent with the code: every path traced (VEP `mane_select`, UniProt MANE-Select xref — both fetched live) produces `NM_001037171.2`, and no reachable path can yield `NM_001031711.2`. Kept in this document as a guard: if that chip ever actually renders `001031711`, treat it as a cross-gene identity leak and stop shipping. |
| F-13 | **MEDIUM** | `assembly.ts:136-141` | `describeAssemblyRefusal()` — the honest "covers GRCh38; this coordinate is GRCh37 and was not scored" sentence — is exported, tested, and **called only by its own unit test**; its in-file NOTE says "Wire this in — or delete it". Refusal reasons reach the client nowhere, which is the structural cause of F-9/F-10/F-11/F-14: each surface fills the explanation vacuum with its own guess. Fix: surface per-source refusal on the payload (as a *reason string*, not a fabricated score object — see `splicingEvidence.ts:84-90` on why presence-of-object ≠ status) and render it. |
| F-14 | **MEDIUM** | `splicingEvidence.ts:451` + `SplicingTab.tsx:345-356` | The AlphaGenome card badge falls to `ENGINE_STATE_LABELS["not-installed"]` ("Not available here") whenever `alphagenome?.status !== "live"` — including *never-queried-because-build-refused*, in a deployment where the key **is** configured (per the standby RCA, `Test Connection` passes). The engine-status contract's own vocabulary (`not-covered` vs `not-installed`, `coverage-miss` vs `not-configured`) exists for exactly this and is bypassed here, repeating the false-cause pattern already logged for `AlphaGenomeTab.tsx:776`. |
| F-15 | **MEDIUM** | `splicingEvidence.ts:495-507` | `resolveJunctionOrientation` fabricates a **donor** whenever `distance !== null` and the resolver's `junctionType` is null or `"terminal"` — a variant at a transcript terminus (resolver returns `junctionType: "terminal"`, `isNearSpliceSite: false`) is drawn as "5' Splice Donor (GT)" with "0 bp (GT Donor)" tick labels. The critical-band logic correctly excludes terminal boundaries, but the *orientation* does not. Fix: honor `"terminal"` → neutral label, no GT/AG claim. |
| F-16 | **MEDIUM** | `splicingEvidence.ts:311` + `conservation-orchestrator.ts:812-813` | When geometry *does* resolve, the transcript shown and the exons counted come from `pred.transcriptId` — the **MANE** transcript (F-2) — while the entire protein/structure side models the **canonical** transcript. For MANE≠canonical genes (ACOT9: MANE carries a 9-residue insertion → different exon structure), "Exon N of M" silently describes a different model than `p.Lys272Asn`, and the header/inspector transcript chip flips from `ENST00000336430` to the MANE id the moment geometry resolves. Fix: resolve geometry on the same transcript the platform models (canonical), or label the model per row. |

### C. Correction to the previous RCA document

`ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md:46-49` attributes the header's "REGIONAL O/E — /
No gnomAD blocks" to the same build gate. That is **not supported by the code**: regional
constraint comes from `fetchGnomadGeneConstraint` (`gnomad.ts:223-308`), a **gene-level GRCh37
query** matched to RMC blocks by **amino-acid position** (`gnomad.ts:313-344`,
`core-data-fetcher.ts:123`) — no coordinate, no gate. MISSENSE_Z and LOEUF from that same fetch
render fine in the screenshot, so the fetch succeeded and ACOT9 genuinely has no gnomAD v2 RMC
blocks (or the field was absent). The build gate does kill the **population-frequency** path
(`core-data-fetcher.ts:159-162`) — which is not the REGIONAL O/E gauge. One blank in that
viewport was misattributed; the rest of the document's chain stands.

---

## 5. Fix plan, in order of value

1. **Make the primary predictor path succeed** (F-1, F-2): query VEP by the coordinate the
   translate step already resolved (region endpoint, host per build), and add the canonical
   Ensembl transcript to any remaining protein-HGVS targets. This alone un-blanks the ACOT9
   panel and every ambiguous-substitution variant, without touching the gate.
2. **Implement the declared liftover** (F-3): lift GRCh37 coordinates to GRCh38 with the
   round-trip check `assembly.ts` already models, re-tag, and let the gate pass. This recovers
   the GRCh38-only block for genuine hg19 input — the capability the contract promises and the
   "converge on identical evidence" claim depends on.
3. **Say why evidence is absent** (F-9…F-14, F-16): wire `describeAssemblyRefusal` reasons onto
   the payload and render them in the three lying surfaces (dbscSNV label, Proximity
   Interpretation, schematic unmapped state, AlphaGenome badge). Until 1-2 land, this is what
   stops the panel from contradicting itself.
4. **Close the latent wrong-build paths** (F-5, F-6, F-15): gate the base-path splice call, add
   the contig check to the resolver, honor `"terminal"` in orientation.
5. **Data plumbing** (F-7, F-8, F-4): project `dbnsfp.dbscsnv`, gate gerp/phylop on exact match,
   make the predictor cache aware of which source answered.
6. ~~Resolve F-12~~ — closed: the `NM_001031711.2` reading was a screenshot misread (user-confirmed); the chip shows the correct ACOT9 MANE accession.

---

## 6. Fix status (implemented 2026-09-19)

All findings except F-12 (closed as misread) are fixed. Verification: substitute harnesses
(`scratch/verify-liftover.mjs`, `scratch/verify-unmapping-fixes.mjs`, 28 assertions incl.
negative controls), `tsc --noEmit` clean, boundary check clean, and the durable vitest suite
(see §7 for runner status).

| ID | Fix | Where |
|----|-----|-------|
| F-1 | Coordinate-first predictor query: VEP `/vep/human/region/` on the canonical build, REF- and position-checked, falling through to the protein ladder on any mismatch. The entered genomic coordinate now flows translate → client → analysis route → predictor. | `vep-orchestrator.ts` (`fetchPredictorsViaCoordinate`), `variant-parser.ts` (`genomicCoordinates`), `core-data-fetcher.ts`, `analysis-orchestrator.ts`, `notationService.ts`, `types.ts`, `workflowOrchestrator.ts`, `biophysicalService.ts`, `biophysicsApi.ts`, contracts |
| F-2 | `getTranscriptsForProtein` now returns `canonicalEnsemblId` (Ensembl xref of the canonical isoform), and the protein ladder queries it. | `transcript-resolver.ts`, `vep-orchestrator.ts` |
| F-3 | **Liftover implemented**: `liftCoordinateToCanonical` — single forward map + exact reverse round-trip + GRCh38 REF check; failures uncached, successes persisted. Applied at both coordinate producers (MyVariant fallback; forwarded input coordinate). | `server/services/translation/liftover.ts` (new), `cache-keys.ts`, `vep-orchestrator.ts` |
| F-4 | GRCh37-tagged predictor results are no longer cached for 14 days (`shouldCache`); a transient outage degrades one request instead of pinning the variant. | `vep-orchestrator.ts` |
| F-5 | Base-path `resolveSpliceProximity` is now build-gated like its siblings. | `conservation-orchestrator.ts` |
| F-6 | Resolver takes the variant contig and refuses on mismatch (permissive when the model names none, for older payloads). | `splice_resolver.ts` |
| F-7 | `dbnsfp.dbscsnv` added to the MyVariant projection — dbscSNV is now actually fetchable on that path. | `conservation-orchestrator.ts` |
| F-8 | `gerp`/`phylop` gated on `isExactMatch` like every other value. | `conservation-orchestrator.ts` |
| F-9 | Default dbscSNV label is now **"No dbscSNV Data"**; the inspector's flank claim survives only with a measured distance, otherwise "dbscSNV Not Assessed". | `splicingEvidence.ts`, `SplicingInspector.tsx` |
| F-10 | Null-distance Proximity Interpretation renders the recorded refusal (or honest generic wording) — the "coordinates mapped" claim is gone. | `SplicingInspector.tsx` |
| F-11 | `distance === null` now shows an "geometry not resolved" panel — no junction, no consensus zone, no 0 bp marker. Unknown orientation draws neutral model sides and TWO candidate pins (`±N bp, side not resolved`); the consensus zone draws only for real donor/acceptor junctions. | `SplicingTab.tsx` |
| F-13 | Per-source refusal reasons travel on `conservationData.assemblyRefusals` (via `describeAssemblyRefusal`, now wired in production) and are surfaced through `deriveSplicingEvidence` as `proximityRefusal` / `alphagenomeRefusal`. | `conservation-orchestrator.ts`, `contracts.ts`, `splicingEvidence.ts`, both panes |
| F-14 | AlphaGenome card badge distinguishes build-refusal (`not-covered`, reason in `title`) from deployment absence (`not-installed`). | `SplicingTab.tsx` |
| F-15 | `resolveJunctionOrientation` honours explicit `"terminal"`/`null`; the legacy donor inference survives only for payloads where `junctionType` is absent. | `splicingEvidence.ts` |
| F-16 | Splice geometry resolves on `canonicalEnsemblId` when the producer names one — "Exon N of M" now describes the model the protein numbering belongs to. | `conservation-orchestrator.ts` |
| RCA-Fix2 (related) | The AlphaGenome cache-invalidation predicate now honours a recorded build refusal, so a refused source no longer forces a full recompute on every view. | `analysis-orchestrator.ts` |

**Expected effect on the ACOT9 screen**: the entered hg19 coordinate is lifted (verified) to
`X-23705858-C-A` GRCh38 at the producer; the predictor answers via the region endpoint; the build
gate passes; splice geometry, AlphaGenome, PopEVE, GPN-Star and gnomAD r4 go live, and the header
coordinate chip re-tags to hg38 — the "unmapped" state disappears for this whole variant class.
Where a lift genuinely cannot be verified, the panel now says why, per source, instead of
asserting a measurement or inventing a cause.

## 7. Verification status

**Bound to:** HEAD `721a876`, working tree with the §6 fixes + §8 review round applied,
2026-09-19/20 session. Re-check `git status` before trusting any absence claim here — this
tree has moved under three concurrent editing sessions already.

- `tsc --noEmit`: 0 errors. `scripts/check-boundaries.ts`: 0 violations.
- **Durable vitest, real runner: 144 files — 1557 passed | 5 skipped | 0 failed**
  (`scratch/vitest-full-4.log`, 2026-09-21T23:00Z). Earlier intermediate runs in this session:
  1520 (pre-concurrent-merge), 1538 (post-merge), 1555-passing-with-2-failures (review round 1,
  both failures were test-harness issues — module-global `exonCache` ordering in the new F-5/M5
  test, and a fifth legacy label `"Endpoint Standby"` the guard correctly refused to let slip).
- Substitute harnesses (Node type-stripping; vitest cannot start in the confined sandbox —
  esbuild `spawn EPERM`): `scratch/verify-liftover.mjs` 13/13, `scratch/verify-unmapping-fixes.mjs`
  17/17, both with negative controls. The liftover harness caught a real contract bug
  (`parseSingleMapping` accepted range mappings).
- **Incident note (honesty):** the two harnesses initially ran OUTSIDE vitest's `:memory:`
  guard and `clearAllCaches(true)` deleted one regenerable `external_cache` row
  (`uniprot_isoforms_Q9Y305`) from the real `data/analyses.sqlite`. Both harnesses now set
  `ANALYSIS_DB_PATH=:memory:` + `NODE_ENV=test` before their imports; the row self-regenerates.

## 8. External review round (four senior reviewers, 2026-09-20)

Four independent read-only reviews of the working tree (genomics correctness, security/
robustness, UI correctness/honesty, test integrity), all bound to `721a876` with the tree
live-moving during review (26→32 dirty entries as the concurrent AlphaGenome-RCA session
landed `evidenceAvailability.ts` and rewrote `AlphaGenomeTab.tsx`). Verdicts: 3× REQUEST-CHANGES,
1× APPROVE-WITH-CHANGES. Every finding was independently verified against code before acting;
one reviewer claim was corrected by evidence (Ensembl xrefs DO carry `isoformId` — verified
live — but its value is `Q9Y305-1`, so the bare-accession equality was indeed dead; the
selection rule was fixed, not deleted).

| Review finding | Fix | Where |
|---|---|---|
| **H-1/H-3** (two reviewers): lift cache key omitted the alt — two SNVs at one position serve each other's allele, re-stamped GRCh38 | ref+alt in the key; durable two-allele test | `cache-keys.ts`, `liftover.ts`, `liftover.test.ts` |
| **H-2/H-1** (two reviewers): coordinate-first path never bound the locus to the requested gene+variant; neighbor-gene rows could win the `consequences[0]` fallback | three-level binding (echo → gene filter before selection → substitution/position match), fall-through on any failure; schema now carries `gene_symbol/amino_acids/protein_start`; durable + harness tests | `vep-orchestrator.ts` |
| **H2**: predictor cache key had no coordinate dimension (one poisoned request = 14 days, all users, via L2) | coord+assembly in `buildPredictorsKey` (`nocoord` pins the ladder shape); self-healer reconstructs the same key | `cache-keys.ts`, `vep-orchestrator.ts`, `self-healer.ts` |
| **M-3**: MyVariant substring hgvsp match can adopt a coincidental isoform locus — and the lift promoted it from refused to trusted | scan all hits; >1 distinct locus → refuse the coordinate outright | `vep-orchestrator.ts` |
| **M-4**: base-path AlphaGenome call ungated while its siblings were gated | `usableBy("alphagenome")` + build in the cache key | `conservation-orchestrator.ts` |
| **M-5/L-12**: base-path gate authorized `genomicPos` by the request build with nothing tying it to the tagged id | position must equal the id's parsed position | `conservation-orchestrator.ts` |
| **M1**: honoring a build refusal forever pins a transient outage's blank payload (rows have no expiry) | refusal honored for a bounded 6 h window; recovery re-attempts automatically | `analysis-orchestrator.ts` |
| **M2**: identity lift bypassed all validation before URL interpolation | identity branch runs through the same contig/single-base/position gate; URL segments encoded | `liftover.ts` |
| **M3**: auxiliary lift calls could accelerate the shared per-host breaker ejection | lift skipped while the host is breaker-ejected | `liftover.ts` |
| **M4**: worst-case stream latency widened past the client idle watchdog | 15 s `deadlineAt` budget on the coordinate prelude | `vep-orchestrator.ts`, `liftover.ts` |
| **UI#1/M-5** (two reviewers): SplicingTab's resolver call omitted `configured`/`message` — card 4 said "retry" where the AlphaGenome tab said "Settings" | both passed, same derivation as the other two surfaces | `SplicingTab.tsx` |
| **UI#2/M-7** (two reviewers): flank/perijunctional claims fired at small non-junction distances | `dbscFlankMeasurable` in the shared model; terminal/unknown prose branch; warn styling gated on a real junction | `splicingEvidence.ts`, `SplicingInspector.tsx` |
| **UI#3/#4/#5/#8**: static aria-label hid the neutral state; refusal reason hover-only; non-finite distance pinned to the junction; "returned no" asserted during load | dynamic aria-label; visible reason line; not-resolved panel covers non-finite; loading wording | `SplicingTab.tsx` |
| **UI#7**: 24 h sessionStorage bundles replayed pre-fix payloads | `CACHE_VERSION` v3.7→v3.8 | `variantCache.ts` |
| **UI#9**: guard omitted the two newly-resolver-driven panels | both added; five live legacy labels migrated (`"Standby"`×4 + `"Endpoint Standby"`, `"N/A"`) | `energeticsLabels.guard.test.ts`, `PredictorSpecialistPanels.tsx` |
| **UI#10/L-11**: resolver module claimed to have replaced the per-surface refusal lookups — it hadn't | `splicingEvidence.ts` now uses `refusalReasonFor`; claim is true | `splicingEvidence.ts` |
| **M-6**: canonical-xref selection matched `isoformId === primaryAccession` — live data says `Q9Y305-1`, so the rule was ordering-luck | match accession OR accession+`-1`; ordering fallback documented; rule-tested (fixture lists non-canonical first) | `transcript-resolver.ts`, `predictors-modules.test.ts` |
| **L-8**: per-side contig normalizers disagreed on chrM/MT | shared `normalizeContigName`/`sameContig` in `assembly.ts` | `assembly.ts`, `splice_resolver.ts`, `liftover.ts` |
| **L-1**: refusal source keys were free strings across the wire | `ASSEMBLY_REFUSAL_SOURCES` tuple, server + client | `assembly.ts` + both sides |
| **L-3/L-10**: parser accepted trailing junk and unbounded positions | exactly-4-parts + pos ≤ 4×10⁸; ordering dependency documented | `contracts.ts`, `variant-parser.ts` |
| **L-9**: refusals recorded for sources blocked by other causes too | refusal only for reachable-but-for-build sources | `conservation-orchestrator.ts` |
| **Test-integrity HIGH**: harnesses wiped real `data/analyses.sqlite` rows; §7 claims unbound | `:memory:` guard in both harnesses; every claim revision-bound (§7) | `scratch/verify-*.mjs` |
| **Test-integrity MED**: breaker reset scoped too narrowly; `transcriptMappingCache` survives `clearAllCaches` | file-level `beforeEach` resetting both | `predictors.test.ts` |
| **Missing coverage** (ranked): F-7, F-4, F-5, M-3, M-5, staleness-window, route trust guard, F-2 rule, flank gate, positive-half refusals | 19 durable tests added across 7 files | `predictors.test.ts`, `liftover.test.ts`, `splicingEvidence.test.ts`, `splice_resolver.test.ts`, `predictors-modules.test.ts`, `analysis-orchestrator.test.ts`, `variant-parser.test.ts` |

**Deferred with rationale (not forgotten):** UI#11 — `configured` was derived from browser
settings alone, so a server-env-only AlphaGenome key plus a provider outage read as "not
available here". **Closed in the concurrent session's follow-up**: the call site now passes the
tri-state `configured: settings.alphagenomeApiKey ? true : undefined`, which is strictly better
than the planned fix — this surface can attest only to a key the browser holds, and a definite
`false` would outrank the provider's own message and send a server-keyed deployment to Settings
for what may be an outage or a coverage miss.

`describeAbsence` in `evidenceAvailability.ts` is a canonical sentence formatter with no
production consumer (every surface renders badge + reason separately, two of them with richer
wording). Its status is now stated in the module itself rather than left ambiguous; deleting it
would remove the three-state assertions that pin it, so it is documented rather than removed.
**Correction:** an earlier draft of this section called that a doc/implementation drift in the
concurrent session's RCA — that was my misreading; its verification-audit note lists
`describeAbsence` among five mutants now covered by tests, which is exactly what the code does.
