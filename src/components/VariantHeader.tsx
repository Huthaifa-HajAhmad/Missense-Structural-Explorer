import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, RotateCw, Search } from "lucide-react";
import { AnalysisResult } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { constraintSourceLabel, releaseTag, type ConstraintMetricKey } from "./header/constraintMetrics";
import { MiniTrack } from "./header/ConstraintTrack";
import { ConstraintCard } from "./header/ConstraintCard";
import { focusConstraintChip } from "./header/constraintFocus";
import { useVariantHeaderModel, type VariantHeaderModel } from "./header/variantHeaderModel";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
  onProvideAllele?: () => void;
}

/** Must match `.vcs-card`'s inline size in layout.css; used to keep the card inside the strip. */
const CARD_WIDTH = 360;
const CARD_EDGE = 8;

/** Keyboard focus opens a card; a pointer focus does not (the click that follows decides). */
function isKeyboardFocus(el: HTMLElement): boolean {
  if (el.dataset.quietFocus) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * The variant CONTEXT strip: one 44px line under the top bar.
 *
 * The variant's identity — including its splice proximity, now the identity bar's last chip —
 * moved into the top bar (`header/VariantIdentity.tsx`); what stays here is context that applies
 * to every evidence page:
 *
 *   GENE CONSTRAINT gnomAD v4.1.2  [Missense Z +1.09 ━●━ Not constrained] [LOEUF …] [Regional O/E … v4.1.1]   … numbering · run state
 *
 * - Each reading is a button with a micro-track: same axis, direction and bands as the full track.
 *   Values are ink; the verdict and the dot carry the tone, so each reading is coloured once.
 * - A reading whose release differs from the group's (Regional O/E is v4.1.1) carries its own tag.
 * - Keyboard focus or a click opens that reading's CARD (`header/ConstraintCard.tsx`): its full track,
 *   cut-point origin and facts. The card's "Open in inspector" hands the reading to the right rail
 *   (`inspector/ConstraintInspector.tsx`) through the store's `constraintFocus`, and the chip stays
 *   marked as inspected while the rail shows it. Escape or a click outside closes the card.
 * - The notes slot carries the numbering basis, then the run state.
 * - The RUN STATE slot is fixed at the strip's end, so a degraded run (a fallback locus, a gnomAD
 *   outage) can never look like a clean one, and offers the re-run when one could help.
 *
 * Replaced the "Details" dropdown, which opened ~900px from its button and covered the page.
 */
function VariantHeader({ gene, variant, uniprotId, analysisResult, onProvideAllele }: VariantHeaderProps) {
  const model = useVariantHeaderModel({ gene, variant, uniprotId, analysisResult });
  const requestRerun = useVariantAnalysisStore((s) => s.requestRerun);
  const inspected = useVariantAnalysisStore((s) => s.constraintFocus);
  const setConstraintFocus = useVariantAnalysisStore((s) => s.setConstraintFocus);
  const [openKey, setOpenKey] = useState<ConstraintMetricKey | null>(null);
  const [cardLeft, setCardLeft] = useState(0);
  const baseId = useId();
  const stripRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  const chipRefs = useRef<Partial<Record<ConstraintMetricKey, HTMLButtonElement | null>>>({});

  const openCard = useCallback((key: ConstraintMetricKey) => {
    const chip = chipRefs.current[key];
    const strip = stripRef.current;
    if (chip && strip) {
      const offset = chip.getBoundingClientRect().left - strip.getBoundingClientRect().left;
      setCardLeft(Math.max(CARD_EDGE, Math.min(offset, strip.clientWidth - CARD_WIDTH - CARD_EDGE)));
    }
    setOpenKey(key);
  }, []);

  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;
  const closeCard = useCallback((returnFocus: boolean) => {
    const key = openKeyRef.current;
    setOpenKey(null);
    if (returnFocus && key) focusConstraintChip(key);
  }, []);

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCard(true);
    };
    const onPointer = (e: MouseEvent) => {
      const item = chipRefs.current[openKey]?.closest("li");
      if (!item?.contains(e.target as Node)) closeCard(false);
    };
    // The card is placed from the chip's position; a resize or a sideways scroll of the chip row
    // would leave it pointing at the wrong reading, so it closes instead of drifting.
    const onMove = () => closeCard(false);
    const chips = chipsRef.current;
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", onMove);
    chips?.addEventListener("scroll", onMove);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", onMove);
      chips?.removeEventListener("scroll", onMove);
    };
  }, [openKey, closeCard]);

  // A new variant starts with no card open and the inspector back on the page's own rail.
  useEffect(() => {
    setOpenKey(null);
    setConstraintFocus(null);
  }, [gene, variant, setConstraintFocus]);

  const { metrics } = model;
  const source = constraintSourceLabel(analysisResult);

  return (
    <div ref={stripRef} className="variant-header" role="region" aria-label="Variant context">
      {metrics.length > 0 && (
        <>
          <span className="vcs-title">
            Gene constraint <span className="vcs-source">{source}</span>
          </span>
          {/* Explicit role: `list-style: none` drops list semantics in WebKit. */}
          <ul ref={chipsRef} className="vcs-chips" role="list" aria-label={`Gene constraint, ${source}`}>
            {metrics.map((m) => {
              const open = openKey === m.key;
              const cardId = `${baseId}-card-${m.key}`;
              const isInspected = inspected === m.key;
              const tag = releaseTag(m, source);
              return (
                <li
                  key={m.key}
                  className="vcs-chip"
                  onBlur={(e) => {
                    // Focus left the chip and its card for somewhere else: the card goes with it.
                    if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpenKey(null);
                  }}
                >
                  <button
                    ref={(el) => {
                      chipRefs.current[m.key] = el;
                    }}
                    type="button"
                    className="vcs-chip-btn"
                    aria-expanded={open}
                    aria-controls={open ? cardId : undefined}
                    data-constraint-chip={m.key}
                    data-inspected={isInspected || undefined}
                    onFocus={(e) => {
                      if (!open && isKeyboardFocus(e.currentTarget)) openCard(m.key);
                    }}
                    onClick={() => (open ? setOpenKey(null) : openCard(m.key))}
                  >
                    <span className="vcs-chip-label">{m.label}</span>
                    <span className="vcs-chip-value" data-tone={m.tone}>
                      {m.value}
                    </span>
                    <MiniTrack metric={m} />
                    <span className="vcs-chip-verdict" data-tone={m.tone}>
                      {m.verdict}
                    </span>
                    {tag && <span className="vcs-chip-release">{tag}</span>}
                    {isInspected && <span className="vh-sr-only">, shown in the inspector</span>}
                  </button>
                  {open && (
                    <ConstraintCard
                      metric={m}
                      id={cardId}
                      left={cardLeft}
                      onInspect={() => {
                        setOpenKey(null);
                        setConstraintFocus(m.key);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Notes model={model} onRerun={requestRerun} onProvideAllele={onProvideAllele} />
    </div>
  );
}

/** The strip's right end: the numbering basis, then the fixed run-state slot. */
function Notes({ model, onRerun, onProvideAllele }: { model: VariantHeaderModel; onRerun: () => void; onProvideAllele?: () => void }) {
  const { modelledBasis, runState } = model;
  if (!modelledBasis && !runState) return null;
  return (
    <div className="vcs-notes">
      {modelledBasis && (
        <span className="variant-header-numbering-basis" data-testid="modelled-basis" title={modelledBasis.note ?? undefined}>
          modelled as {modelledBasis.modelled}
        </span>
      )}
      {runState && (
        <span className="vcs-runstate" role="status" title={runState.detail} data-testid="run-state" data-recovery-action={runState.recoveryAction ?? undefined}>
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span className="vcs-runstate-label">{runState.label}</span>
          <span className="vh-sr-only">. {runState.detail}</span>
          {runState.recoveryAction === "provide-allele" && onProvideAllele && (
            <button type="button" className="vcs-runstate-action" onClick={onProvideAllele} aria-label="Provide nucleotide allele">
              <Search size={12} aria-hidden="true" />
              <span className="vcs-runstate-action-label" aria-hidden="true">Provide nucleotide allele</span>
              <span className="vcs-runstate-action-short" aria-hidden="true">Enter allele</span>
            </button>
          )}
          {runState.recoveryAction === "retry" && (
            <button type="button" className="vcs-runstate-action" onClick={onRerun}>
              <RotateCw size={12} aria-hidden="true" />
              Re-run
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export default React.memo(VariantHeader);
