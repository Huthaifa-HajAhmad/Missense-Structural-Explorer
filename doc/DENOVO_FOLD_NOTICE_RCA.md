# The de novo folding notice — RCA and the changes that followed

**Status:** implemented. Every claim below was read out of this tree before the change and is pinned
by a test after it.
**Scope:** one report from a live run — the structure inspector's bottom banner, on a `GZF1`
`p.Arg591Trp` analysis whose ESMFold-2 generation had just failed:

> ℹ️ **ESMFold-2 Token Notice:** Protein exceeds public 400 aa threshold. Sovereign JapanFold inference
> engine configured in Settings is used for de novo folding.

The report was "critique this banner". The banner turned out to be wrong in four independent ways, and
the two panels beside it were telling a third and fourth story about the same run.

---

## 1. It claimed an engine and a setting that do not exist

The sentence names "Sovereign JapanFold inference engine configured in Settings". There is no engine
selector in Settings and never has been. `src/components/settings/sections/ConnectionsSection.tsx`
offers exactly six credentials — Gemini, the lab server token, the EvolutionaryScale (Forge) /
`biohubApiToken`, Hugging Face, AlphaGenome and Tamarind — and a repo-wide search for "Sovereign" finds
only a capability *label* (`server/routes/capabilities.ts`), a telemetry *name*
(`LiveTelemetryPanel.tsx`) and a code comment about the local Kuhlman-Lab sidecar
(`server/services/stability/energy-models.ts`).

The folder is not chosen in Settings at all: the de novo path is selected by the `active3dModelTab` tab,
and the tier waterfall lives on the server. So the banner sent the reader to a screen where nothing they
needed exists — the same dead end the neighbouring card's own "Configure API Key" button already
produces.

## 2. The routing rule it described does not exist, and its direction was inverted

`server/services/structure/esmfold.ts` attempts Tier-1 JapanFold ESMFold-2 **first, at every length up
to 1,024 aa**. Length does not select it. The 400 aa figure is the ceiling of the *keyless public ESM
Atlas fallback*, and crossing it does not unlock a sovereign engine — it **deletes the last fallback**,
so a Tier-1 failure becomes a hard error:

```
// esmfold.ts, after the Tier-1 and sidecar attempts
if (seqLen > ESM_ATLAS_PUBLIC_MAX_AA) {
  throw new Error(esmAtlasFallbackExceededMessage(seqLen));   // "…Tier-1 JapanFold ESMFold-2 was unavailable."
}
```

So the banner read "> 400 aa ⇒ a sovereign engine is used" where the code says "> 400 aa ⇒ if Tier-1
fails, there is nothing left". The banner was the one panel on screen that never mentioned the
consequence, and it was the panel describing a working engine.

## 3. It asserted success above a card reporting failure

The rose card in the same panel read "ESMFold-2 Generation Failed". The banner, below it, asserted that
folding "is used". Both rendered, because the banner's branch was a pure function of an integer — it
never read the error, the settings, or which tier had actually run:

```tsx
{analysisResult?.metadata?.mutatedSequence && (
  analysisResult.metadata.mutatedSequence.length > 768 ? (…)
  : analysisResult.metadata.mutatedSequence.length > 400 ? (… the banner …)
  : null)}
```

## 4. The number it withheld is why nobody noticed the screen disagreeing with itself

The canvas reported **`PROTEIN LENGTH: 51 AA`** for the same protein. The banner reasoned about a
sequence "> 400 aa". Both were on screen at once, 14× apart, and neither looked wrong.

Two separate defects produced that:

- `MolstarViewer` computed its length as `parseReportedSequenceLength(error) || landscapeData.length`.
  `landscapeData` is a residue-level scan **window** around the variant, so the only path that can
  produce 51 there is the window fallback — printed under the label "Protein Length". The loose
  `/(\d+)\s*aa/i` parse made it worse in general: it can mine a number out of text that is not about
  length at all.
- The banner's own branch **omitted its residue count**. Its sibling (`> 768`) interpolated the number;
  the `> 400` branch — the common one — did not. A reader had no way to see the disagreement.

The inspector's two branches also disagreed with the server about which ceiling belonged to which
engine: the UI said "JapanFold / ESM Atlas **768** aa limit" (that 768 is the *stability pipeline's*
`ESMFoldEngine` gate, `folding-engines.ts`) where the de novo path's Tier-1 ceiling is **1,024 aa**.

## 5. The failure it sat under was the client's own clock, naming a cause it could not see

The 45 s in `src/api/structureApi.ts` was a whole-call budget (see `fetchWithAuth`'s
`watchdogDeadlineAt`), and the server is permitted `CONFIG.timeouts.japanfoldFoldingMs` = **60 s** on
Tier-1 alone. The client therefore aborted *first* on every slow provider, and the UI then explained its
own abort as "timed out due to high GPU cluster load" / "High-throughput cloud GPUs are experiencing high
queue depth" — neither of which an `AbortError` can attest. `src/shared/timeouts.ts` documents this exact
defect class twice already, for FoldX and for the NDJSON stream; the de novo path had the same shape and
nothing failed when the numbers drifted.

---

## The fix

### One module owns the ceilings and the sentences

`src/shared/foldingLimits.ts` holds `ESM_ATLAS_PUBLIC_MAX_AA` (400),
`JAPANFOLD_ESMFOLD2_MAX_AA` (1,024) and `STABILITY_ESMFOLD_ENGINE_MAX_AA` (768), the server's error
messages, the reader-facing copy, and the two readers that interpret a failure
(`parseReportedSequenceLength` — strict, canonical shapes only — and `isFoldingLengthLimitError` /
`isFoldingTimeoutError`). The arithmetic and the prose are now the same source, so a number cannot change
in one place and stay stale in the other. Consumers: `esmfold.ts`, `folding-engines.ts`,
`useStructuralFolding.ts`, `StructureInspector.tsx`, `MolstarViewer.tsx`.

The banner is now `describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(n))`, which:

- interpolates the residue count in **every** branch;
- states the real consequence — past 400 aa the *fallback* is gone, and past 1,024 aa nothing can fold it;
- never mentions a Settings engine, because there is none to mention;
- is `tone: "info"` when only the fallback is gone and `tone: "warning"` when no de novo model is
  possible. The two used to share one amber style, so "benign advisory" and "we cannot do this" were
  visually identical.

### It is suppressed while a failure is on screen

`StructureInspector` returns `null` from the notice when `isEsmMode && (esmFoldingError ||
foldingStatus === "failed")`: the notice describes what the app *will* do, and the rose card reports that
it did not happen. It still renders in AlphaFold2 mode, where it is the panel that points a reader at a
full-length model.

### One length, labelled honestly

`readProteinLength(metadata)` is the single reader (mutant translation, then canonical sequence, never a
window). `MolstarViewer` labels it "Protein Length" and, only when the scan window is a genuinely
different number, shows a second chip labelled "Scan Window" with a tooltip — so the 51 aa information is
still on screen, correctly named.

### The client budget now nests

`CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS` = 240 s replaces the 45 s literal, and the server's own per-tier
budgets (`CONFIG.timeouts.esmfoldSidecarMs`, `CONFIG.timeouts.esmAtlasMs`) replace the literals that were
inside `esmfold.ts`. Worst case per request is two sequential folds × (Tier-1 60 s + sidecar 30 s + ESM
Atlas 15 s) = 210 s.

### The timeout copy hedges

Both surfaces now render `describeDeNovoFoldTimeout(...)`, which offers the queue-depth explanation as
the *usual cause* and says the provider's load is not visible from here. Uniform wording is deliberate:
the three panels disagreeing was part of the defect.

---

## What is asserted now

| Test | Pins |
| --- | --- |
| `src/shared/__tests__/foldingLimits.test.ts` | the constants and their ordering; the **frozen** server strings the 422 contract depends on; that no notice branch matches `/settings/i`, `/sovereign/i` or "is used for de novo folding"; that past 400 aa the copy says a fallback is *unavailable*; that the timeout copy never asserts provider load; that the length parser refuses `"Request timed out after 240000ms"` |
| `src/components/inspector/__tests__/StructureInspectorFoldingLimits.test.tsx` | the rendered banner: names its own number, says nothing at ≤ 400 aa, warns above 1,024 aa, takes the length from the mutant translation, is **absent** when the failure card is up, and never prints 768 |
| `server/tests/denovo-fold-timeout-budget.test.ts` | the nesting: client budget > 2 × (Tier-1 + sidecar + ESM Atlas), and > one Tier-1 attempt; that every consumer imports the shared module; that `esmfold.ts` keeps no bare `> 1024` / `> 400` / `AbortSignal.timeout(<literal>)` |

## Deliberately not changed

1. **`STABILITY_ESMFOLD_ENGINE_MAX_AA` still gates at 768.** It bounds the stability pipeline's folding
   step, not the de novo model, and its behaviour is unchanged — only its number is now named and its
   docstring says why it is not the number to quote. Whether the stability path *should* accept up to
   1,024 (the folder under it does) is a real question, and loosening a gate during a messaging fix would
   hide whatever made 768 deliberate.
2. **The provider's load is still unknown.** Nesting the budgets removes the client-abort misdiagnosis,
   but a genuine Tier-1 timeout remains indistinguishable from a genuine Tier-1 queue. That needs a
   provider-side signal, not better copy.
3. **`queryEsmfold2` still swallows its errors and returns `null`** (`japanfold-client.ts`), so the
   server's own log cannot distinguish "Tier-1 failed" from "Tier-1 timed out". The messages this module
   builds remain literally accurate ("Tier-1 JapanFold ESMFold-2 was unavailable"), which is why the
   phrasing was left alone.

## Note for the next reader

Unrelated to this change: `src/shared/thresholds/*`, `server/services/prediction/acmg/criteria.ts`,
`EvidenceInspector.tsx` and the predictors rail were being edited by a concurrent writer in this tree
during this work, and 25 tests in the thresholds/ACMG/guidelines suites failed because of it — verdict
mismatches (`expected 'benign' to be 'vus'`) inside those uncommitted edits. They are not caused by, and
are not fixed by, anything in this document.
