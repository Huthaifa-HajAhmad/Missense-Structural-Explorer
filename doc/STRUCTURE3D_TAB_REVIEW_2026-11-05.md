# 3D Structure tab — multi-dimensional review (2026-11-05)

Scope: the uncommitted 3D-tab refactor, 10 files, ~890 added lines.

- `src/components/MolstarViewer.tsx`
- `src/components/inspector/StructureInspector.tsx`
- `src/components/molstar/StructureGuideCard.tsx`
- `src/components/molstar/StructureLegend.tsx`
- `src/components/molstar/StructureToolbar.tsx`
- `src/components/molstar/useMolstarStructure.ts`
- `src/styles/molstar.css`
- `src/styles/structure3d.css`
- `src/components/__tests__/Structure3dView.test.tsx`
- `src/components/molstar/__tests__/StructureGuideCard.test.tsx`

Method: three independent read-only reviews (scientific integrity/correctness; UI/UX, accessibility and CSS; engineering quality/performance/tests), then a consolidation pass that re-read the called-into code, re-ran the tests, and rejected one false positive. No source or test file was edited. Review posture follows `.agents/rules/code-review.md` and `.agents/rules/review-posture.md`: findings only, bounded to the reviewed surface.

## Verdict

**The premise is partly met — not yet achieved.**

The structural work is sound: the Mol* chrome collision is genuinely removed, the HUD is bounded, the inspector gains a real queried-site/selection distinction, the pair swatch is truthful in the normal superposition path, and the new camera helpers use the Mol* 5.10 API correctly. What blocks the premise is concentrated in three places:

1. **State coupling:** the headline "Reset view" control can undo itself when Close-up is active, and it silently changes state the label does not mention.
2. **Truthfulness at edge states:** the "Queried site" badge, the "Template" noun and the "±15 fit" pill can each assert something the data does not support.
3. **Narrow-width composition:** the new guide and legend do not agree on width, and the guide collides with the pocket panel under ~660 px.

Fix the P1 and P2 items and the premise holds.

## Verification (read-only)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 diagnostics |
| `npx vitest run` on `Structure3dView`, `StructureGuideCard`, `structureSelection`, `structure3dEvidence` | 4 files, 82/82 passed |
| The two reviewed test files only | 30/30 passed |
| `scripts/check-focus-indicators.mjs` | passes |

Green tests do not cover the two new Mol* mutations (`resetCamera`, `focusResidues`) or the row-body click, so they do not contradict the P1/P2 findings.

## P1 — blocks the premise

### P1.1 Reset view can cancel itself and changes undocumented state

**Where:** `src/components/MolstarViewer.tsx:313-316`, `src/components/molstar/useMolstarStructure.ts:250-256,269,416,443,743`

```tsx
onResetCamera={() => {
  if (siteCloseUp) setSiteCloseUp(false);
  structure.resetCamera();
}}
```

```ts
const visualStructureKey = JSON.stringify({ ..., closeUpActive });
const cameraSnapshot = visualOnly ? plugin.canvas3d?.camera?.getSnapshot() : null;
if (cameraSnapshot) plugin.canvas3d?.camera?.setState(cameraSnapshot, 0);
```

**Why it is wrong.** The handler does two things. `setSiteCloseUp(false)` changes `visualStructureKey` and forces a visual-only rebuild in the same task. That rebuild snapshots the camera *before* Mol*'s reset tick is applied, then restores the stale close-up snapshot at duration 0. The one state in which a reader most wants Reset — zoomed into the 5 Å shell — is the state in which the reset can be undone or visibly bounce. The hook's `resetCamera()` also runs `plugin.managers.structure.selection.clear()`, so "Reset camera view" additionally wipes Mol*'s selection state while the app's own selection component survives; the label and docstring say camera only.

**Fix.** Reset the camera only. Do not toggle Close-up from this control; leave it to its own `aria-pressed` toggle. Drop `selection.clear()` from the reset path (nothing in the app selection depends on it), and update the docstring to say camera only. If product wants "reset and exit close-up", make that an explicitly named second action and defer the camera reset until after the rebuild settles (`readyVersion` bump or a frame), skipping the `cameraSnapshot` restore while a reset is pending.

**Tests to add.** A hook-level stub asserting `camera.reset` is the last camera command, including when `siteCloseUp` flips.

## P2 — should fix inside this change

### P2.1 Inspector "Return to variant" bypasses the canonical return flow

**Where:** `src/components/inspector/StructureInspector.tsx:200`, `src/components/inspector/ViewInspector.tsx:511-515`, `src/components/AppViews.tsx:237-239,359-365`

```tsx
onClick={() => useVariantAnalysisStore.getState().setSelectedResidueIndex(site.position)}
```

**Why it is wrong.** The app's canonical return (`handleReturnToVariant`) sets `landscapeSelection` to `kind: "substitution"` and clears `selectedGenomicVariant`. This button writes only `selectedResidueIndex`, so position 116 is selected while the Landscape still points at the inspected residue (e.g. 200). It is also the only inspector control that mutates the global store directly instead of using the prop/action seam, and the inspector is fed the hover *preview* selection, so clicking while the pointer is over the canvas leaves the card showing the preview residue — the click looks inert. With `autoZoomOnSelect` defaulting to false, the camera also does not move.

**Fix.** Add `onReturnToVariant?: () => void` to `StructureInspectorProps`, thread it through `ViewInspector` from `AppViews`, and reuse `handleReturnToVariant`. Clear `hoveredResidueIndex` before selecting, and either focus the site explicitly or reword to "Select the queried site".

### P2.2 "Queried site" badge and "Return to <substitution>" overstate unverified states

**Where:** `src/components/inspector/StructureInspector.tsx:180,194-205`; `src/shared/structureSelection.ts:34,45-54`; `src/shared/structure3dEvidence.ts:1192`

```tsx
const isAtVariantSite = Boolean(selection?.position && site.position && selection.position === site.position);
```

**Why it is wrong.** A matching residue *number* is treated as the queried site. `buildStructureSelection` keeps `position` for `unmapped` and `missing`, and `site.check.state` can be `absent`/`unknown` while `canAddressVariantSite` is false. In exactly those states the toolbar says the site is unmapped, the canvas draws no site, and the site row disappears — yet the rail prints "Queried site", suppresses the caveat line, and names the UniProt substitution on a button that addresses an entry-numbered residue.

**Fix.** Gate on the canvas predicate: `site.canAddressVariantSite && selection.state === "available" && selection.position === site.position`. When false, keep the muted "measurements remain tied to the queried substitution" note and label the action `Return to position ${site.position}` without a substitution.

### P2.3 The neutral selection treatment is dead CSS

**Where:** `src/styles/structure3d.css:79-83`; state union at `src/shared/structureSelection.ts:34`

```css
.s3d-selection[data-state="unmodelled"],
.s3d-selection[data-state="none"] { ... }
```

**Why it is wrong.** The actual union is `empty | unmapped | missing | available`. No rendered state can ever match `unmodelled` or `none`, so every selection — including an untrusted-numbering selection — gets the clay variant treatment and looks verified.

**Fix.** Target `[data-state="empty"], [data-state="unmapped"], [data-state="missing"]`, or invert so only `[data-state="available"]` gets the clay treatment.

### P2.4 The selected-residue guide row can announce a selection the canvas does not draw

**Where:** `src/components/MolstarViewer.tsx:216,243-252`; `src/components/molstar/useMolstarStructure.ts:608,709`

**Why it is wrong.** `selectedShown` does not require `model.site.canAddressVariantSite`, but the canvas only draws the selection inside `if (selectedResidue && selectedResidue !== variantPosition && canAddressVariantSite)`, and `focusResidue` returns immediately when that flag is false. With the queried residue unmodelled, a selection elsewhere is `available` and gets a guide row whose crosshair is a silent no-op.

**Fix.** Gate the row on `model.site.canAddressVariantSite` (as the toolbar already does), or keep it informational without a frame action.

### P2.5 The ±15 fit pill certifies the requested scope, not the measured fit

**Where:** `src/components/molstar/StructureToolbar.tsx:51`; `src/shared/structure3dEvidence.ts:1005-1008,1534-1536`

```tsx
const activeScopeBadge = model.alignment.scopeToggle && model.alignment.scope === "local"
  ? `±${LOCAL_ALIGNMENT_FIT_WINDOW} fit`
  : null;
```

**Why it is wrong.** `alignment.scope` is the requested scope. The drawn pair and readings use `measuredScope` (`metrics?.alignmentScope ?? scope`), which trails the toggle while a fit runs and falls back to whole-chain when a local fit has too few pairs. The pill can therefore certify a ±15 fit over a whole-chain drawing.

**Fix.** Expose `measuredScope` on `model.alignment` and drive the pill from it; when it differs from the requested scope, show the applied scope or a "refitting…" state.

### P2.6 "Template + variant sticks" is wrong for de novo superposition

**Where:** `src/components/MolstarViewer.tsx:217,233-234`; `src/shared/structure3dEvidence.ts:952-953`

**Why it is wrong.** `isSuperposed` is also true for ESMFold/de novo superposition, where the second structure is an aligned wild-type *prediction*, not a template. The legend already says `Wild type` when `!isAf`. The new callout invents a template relationship and sits on the same row as the pLDDT provenance, so it reads as "the variant was built on this".

**Fix.** Derive the noun from the pair's provenance (the same source the legend uses), or add a `pairLabels` field to the evidence model so guide and legend cannot drift.

### P2.7 One action, two hit targets; the large one is mouse-only

**Where:** `src/components/molstar/StructureGuideCard.tsx:118-147`; `src/styles/structure3d.css:344`

```tsx
<div className="s3d-guide__body" onClick={i.onClick} role={i.onClick ? "presentation" : undefined}>
```

**Why it is wrong.** The row body is a second activation target with the same action as the adjacent crosshair. It has `role="presentation"` and no keyboard handler, so AT ignores it and keyboard users get only the 22 px icon (under the 24 px target minimum, 2 px from Clear). Dragging across the pLDDT text to copy it fires a camera flight; a stray tap while scrolling on touch reframes the structure. `.s3d-guide__row-btn` is styled but never rendered — the intended row-level button was dropped mid-refactor.

**Fix.** Keep one target. Either make the body a real `<button>` with the row text as its accessible name and delete the crosshair, or remove the body handler and keep the icon as the only action. Remove the dead `.s3d-guide__row-btn` rule and add `.s3d-guide__toggle:focus-visible` to the ring list (its current absence is why the new collapse control falls back to the UA outline).

### P2.8 Collapsed mini dots discard shape, pair and null-colour semantics

**Where:** `src/components/molstar/StructureGuideCard.tsx:79-88`; `src/styles/structure3d.css:877-888`

**Why it is wrong.** The dots are the only preview of the collapsed card, but they cap at four while the count badge says N, never emit `data-shape`, paint a `pair` item with only `--swatch`, and paint a null-colour item (Selected residue, Close-up) as a solid grey dot that reads as a colour channel. `.s3d-guide__mini-dot[data-shape="dashes"]` is therefore dead.

**Fix.** Emit `data-shape` and `--swatch-2`, mirror the expanded swatch rules (dashed ring, two-tone pair, transparent outline for null), and either render all items like the legend mini-bar or show four plus a `+N`.

### P2.9 The inspector head cannot hold its contents at the default rail width

**Where:** `src/components/inspector/StructureInspector.tsx:191-207`; `src/styles/structure3d.css:84-117`

**Why it is wrong.** At the default 320 px rail, the head has ~248 px of content width. `Return to p.Arg175His` is ~130 px and cannot shrink; `Selected residue · 175` needs ~139 px. The heading wraps to two or three lines with the action vertically centred beside it, at the *default* width, before any long substitution.

**Fix.** `flex-wrap: wrap` the head (or put the action on its own row, matching `.review-selection__actions`), and give the `h3` `flex: 1 1 auto; min-width: 0`.

### P2.10 The guide and legend disagree on width

**Where:** `src/styles/structure3d.css:401-404,834-835`

**Why it is wrong.** `.s3d-legend` keeps `width: min(312px, calc(100% - 24px))`, but inside the overlay column `100%` now resolves against the column, not the stage: 288 px for the legend versus 312 px for the guide. Two stacked cards get a 24 px ragged edge, and the two-column key loses enough width that `Template (wild type)` sits within ~1 px of ellipsis. The added `.s3d-legend__label` class has no rule; the label is still styled via `nth-child(2)`.

**Fix.** Inside the column: `.s3d-overlay-col > .s3d-legend { width: 100%; max-width: none; }`; style `.s3d-legend__label` directly.

### P2.11 The guide collides with the pocket panel on narrow stages

**Where:** `src/styles/structure3d.css:828-834`; pocket panel at `:534-536`

**Why it is wrong.** The guide moved from `top: 52px` to `top: 12px`, the same band as the pocket panel (z-index 5 vs 4). Under ~660 px the 312 px guide and 320 px pocket overlap; the pocket covers the guide's header and row actions while open.

**Fix.** Below the container breakpoint, make the two mutually exclusive (hide/collapse the guide while the pocket is open) or move the pocket to a full-width sheet.

### P2.12 Status pills conflate benign absence with identity failure

**Where:** `src/styles/structure3d.css:814-823`; `src/shared/structure3dEvidence.ts:1192`

**Why it is wrong.** `mismatch` disables variant-site addressing; `absent` is merely "not built in this model" and is benign for experimental entries. Both are amber. Conversely `match` — the strongest verification — is painted in the variant/accent clay, the same signal as the variant marker.

**Fix.** Amber for `mismatch` only; neutral (or dashed) for `absent`; plain ink or a check glyph for `match`.

### P2.13 Tests pin plumbing, not the new behaviour

**Where:** `src/components/__tests__/Structure3dView.test.tsx:325-408`; `src/components/molstar/__tests__/StructureGuideCard.test.tsx:75-128`

**Why it is wrong.** The reset test passes if `resetCamera()` were `{}`; the guide test never clicks the row body, never exercises pocket/contacts/selected clears, and the inspector test locks in the divergent store-only return. `focusResidues`, the pocket-open side effect, the collapsed legend and the failure paths have no coverage.

**Fix.** Add a hook harness with a stub plugin (`focusLoci`, `camera.reset`, `selection.clear` spies). Add tests for: reset ordering while closing close-up; companion/pocket focus bounds; row-body and every `onClear`; pocket row opening the panel; collapsed legend; inspector return parity (`landscapeSelection.kind === "substitution"`); badge absence for `unmapped`/`missing`/`canAddressVariantSite: false`.

## P3 — polish and follow-ups

| # | Finding | Where | Fix |
|---|---|---|---|
| 1 | Mol* hide-list has contradictory/dead selectors and removes feedback | `src/styles/molstar.css:16-30` | Delete the duplicate `justify-content` rules and the four `msp-layout-region-*` selectors; decide explicitly whether `.msp-highlight-toast-wrapper` should be hidden, and route load/selection failures to the app log if it is. |
| 2 | Reset view is enabled with no structure and crowds the header at ≤520 px | `StructureToolbar.tsx:127-138` | Disable while loading/without a primary; move Reset beside the camera chips or into Display, keeping Guide/fullscreen on the first row. |
| 3 | `labelAll` contract holes | `StructureGuideCard.tsx:47-48,64-68,173` | Use `labelled != null`; make `labelAll` and its handler atomic or no-op/disable when the handler is absent. |
| 4 | "Frame variant residue" frames the 5 Å shell when polar contacts are on | `useMolstarStructure.ts:714-718`; `MolstarViewer.tsx:241` | Give `focusResidue` an explicit `scope: "residue" \| "neighbourhood"` argument. |
| 5 | Pair swatch derives from the model, not the drawn tree | `MolstarViewer.tsx:217`; `useMolstarStructure.ts:507,569` | Expose a `drawnPair` flag from the hook; render single-colour sticks if the second structure is not in the tree. |
| 6 | Null-colour swatch depends on React omitting an empty `style` | `StructureGuideCard.tsx:106-110`; `structure3d.css:987` | Pass `undefined` when both colours are absent, or select on `data-colour="none"`. |
| 7 | Dead hooks and formatting noise | `data-is-site`, `data-tone="site"`, `.s3d-guide__row-btn`, `/* /* Status pill`, blank runs, extra EOF lines, `hex` churn | Wire or delete; fix the comment; compact the diff. |
| 8 | New CSS uses literals instead of the file's token contract | `structure3d.css:91,124,134,419,853` | Use `--cs-font-size-prose`, `--cs-font-size-badge`, `--cs-font-weight-semibold`. |
| 9 | `100vw`/`58vh` units | `structure3d.css:837,839` | `width: min(312px, 100%)`; `max-height: min(58dvh, 430px)` with a `vh` fallback. |
| 10 | Blur + layout transition not covered by reduced motion | `structure3d.css:409-413,845-849,797-800` | Add both cards to the reduced-motion block; gate blur behind `prefers-reduced-transparency` with an opaque fallback. |
| 11 | HUD collapse toggles lack `aria-controls`/region | `StructureGuideCard.tsx:93-101`; `StructureLegend.tsx:38-46` | Match the Display disclosure's `aria-controls` + `role="region"` pattern. |
| 12 | Print block still shows live-looking controls | `structure3d.css:1023-1028` | Hide the guide icon buttons, count and inspector return in print. |

## Claims checked and rejected

- **"ESM3 superposition shows a two-colour swatch for a one-colour drawing."** Rejected. `representation === "esm3"` sets `colour.secondary: null`, and the hook only creates the second structure inside `if (comparePdbData && colour.secondary)`. ESM3 is also not offered in superimposed mode. The single swatch is truthful.
- **"`overflow: visible` on the overlay column lets the legend spill."** Rejected as stated. The guide is its own scroll container with an automatic minimum of 0, so it absorbs the shortfall before the legend overflows, and the viewer clips the remainder. The real narrow-stage defect is the guide/pocket collision (P2.11).

## Premise scorecard

| Premise item | Verdict | Reason |
|---|---|---|
| Callout cards upgraded | **Partly** | Real gains (badges, pair swatch, per-row actions, collapsed pill, tokenised surfaces); undermined by the duplicate mouse-only target, misleading mini dots, missing focus ring, legend/guide misalignment and pocket collision. |
| Inspector rail improved | **Partly** | Queried-site distinction, substitution meta, mono measurement and suppressed caveat are genuine wins; badge overreach, dead neutral states, head collision and pill semantics block it. |
| Toolbar improved | **Partly** | Reset is the right replacement for the hidden Mol* control and the filter pill is truthful; the reset race, requested-vs-measured scope pill and no-structure enabled state remain. |
| Viewport clarity | **Met** | Mol* chrome collision removed; single left column; guide starts in a genuinely free band. Narrow-stage overlap is the remaining defect. |
| 3D navigation | **Partly** | `focusResidues` and `camera.reset` are API-correct; reset can undo itself, selected focus can be a no-op, the variant action can frame the shell, and Return to variant does not move the camera by default. |
| Colour-channel transparency | **Partly** | Pair swatch and legend share `PAIR_COLOURS` and 5 Å matches what is drawn; the collapsed dot and the failure branch can still misreport. |
| Scientific integrity | **Partly** | Every core invariant (drawn colours, provenance rows, 5 Å radius, companion semantics, site-vs-selection separation) holds; the "Queried site" chip, the "Template" noun and the ±15 pill outrun the data. |
| Provenance | **Partly** | Coordinate identities and notices are untouched; one wrong noun and one premature alignment status were introduced. |

## Recommended fix order

1. **P1.1** reset semantics (camera only, no coupling, no `selection.clear`).
2. **Truthfulness:** P2.2 badge gating, P2.5 measured scope, P2.6 pair noun, P2.1 canonical return, P2.4 selected-row gate.
3. **Interaction/a11y:** P2.7 single target + focus ring, P2.8 mini dots.
4. **Layout:** P2.9 head, P2.10 width, P2.11 pocket collision, P2.3/P2.12 state colours.
5. **Tests:** P2.13 harness and parity tests.
6. **P3:** hygiene, tokens, motion, print.

P1 + P2 is a bounded bug-hunt inside the reviewed surface; P3 items 1, 5 and 11 touch shared Mol* chrome and should be decided explicitly rather than swept.
