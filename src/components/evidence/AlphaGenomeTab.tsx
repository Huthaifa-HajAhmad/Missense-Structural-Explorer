import React, { useCallback, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, RefreshCw, Settings2, TriangleAlert } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { useApiClient } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { EvidenceViewTabs, EvidencePanel, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { buildAttributionComparison, formatAttributionValue } from '../../shared/evidenceComparison';
import { AlphaGenomeGuide } from './AlphaGenomeGuide';
const EvidenceComparison = React.lazy(() => import('./EvidenceComparison'));
import {
  AVI_FEATURES,
  AVI_GROUP_LABEL,
  AVI_GROUP_NOTE,
  AVI_GROUP_SHORT,
  AVI_ORIGIN,
  AVI_ORIGIN_LABEL,
  AVI_ORIGIN_NOTE,
  aviFinding,
  buildAlphaGenomeEvidence,
  fmtPercent,
  fmtShare,
  type AlphaGenomeEvidence,
  type AviFeatureReading,
} from "../../shared/alphagenomeEvidence";
import { isConservationCompositePending, mergeAlphaGenomeReevaluation } from "../../shared/conservationProgress";

/**
 * AlphaGenome.
 *
 * ONE QUESTION: how does AlphaGenome's variant-impact score (AVI) rank this change, and how much of
 * that rank is new evidence rather than scores this workspace already reads? Three cards, top to
 * bottom, in the flat card style of Population Data and Predictors (tint on head and foot bars only):
 *
 *   1. THE FINDING — the rank among all possible hg38 SNVs on a decade ruler; a bold sentence saying
 *      where the score comes from; a bar splitting it into new (AlphaGenome's molecular predictions)
 *      and already-read (AlphaMissense, conservation); four facts ending in the engine record; the
 *      standing caveat as the card's foot. When there is no score, the reason and the one remedy
 *      that can fix it, in the same card.
 *   2. WHAT THE SCORE IS MADE OF — the 18 SHAP contributions in one table, banded by origin, each
 *      with a bar on a zero line placed by the data, its value and its share of the total.
 *   3. THE ATLAS — deep links to this variant, built only from a GRCh38 coordinate.
 *
 * Method, provenance, the Phred arithmetic and the connection test live in the inspector
 * (AlphaGenomeRail). Every number comes from `buildAlphaGenomeEvidence`, which both panes share.
 *
 * What this screen replaced, and why (doc/ALPHAGENOME_TAB_REVIEW.md):
 *   • a "ClinGen SVI Evidence: PP3 (Moderate) · 4.33:1 odds · calibrated against ClinGen SVI" card —
 *     no ClinGen calibration of the AVI exists;
 *   • a "Calibrated AVI Phred / 50.0 · −10 log10(P_benign)" gauge with PP3/BP4 ticks — the Phred is a
 *     rank among all possible SNVs, has no ceiling at 50, and is not P(benign);
 *   • a ten-row "reference track schema" of invented magnitudes in a filterable data grid;
 *   • feature cards describing AlphaMissense as "3D fold / steric contacts" and printing SHAP × 100
 *     as "% Rel".
 * And, in the second pass (doc/ALPHAGENOME_TAB_REVIEW.md, "Second pass"):
 *   • a finding that only called the score "not independent" when AlphaMissense led it, so a
 *     conservation-led score never said most of it was evidence the Predictors tab already reads;
 *   • a green "Computed" chip (green means benign here), "Not counted for ACMG" said four times, and
 *     a description, ruler and caveat capped at a third of the column, leaving the rest blank;
 *   • a ruler filled like a progress bar, and contribution bars that started at the column's centre,
 *     so with positive values the left half of the column was always empty.
 */

function AlphaGenomeTabComponent(props: TabComponentProps) {
  const result = props.analysisState.result;
  if (!result) return null;
  return <AlphaGenomeTabBody {...props} result={result} />;
}

// ── Rank ruler ──────────────────────────────────────────────────────────────────────────────────

const RULER_MAX = 50;
const RULER_LABELS: Array<{ phred: number; top: string }> = [
  { phred: 0, top: "all SNVs" },
  { phred: 10, top: "top 10%" },
  { phred: 20, top: "top 1%" },
  { phred: 30, top: "top 0.1%" },
  { phred: 40, top: "top 0.01%" },
  { phred: 50, top: "top 0.001%" },
];

function RankRuler({ phred, topPercent }: { phred: number; topPercent: number | null }) {
  const off = phred > RULER_MAX;
  const at = (Math.max(0, Math.min(phred, RULER_MAX)) / RULER_MAX) * 100;
  const desc = `Phred ${phred.toFixed(1)}${topPercent !== null ? `, top ${fmtPercent(topPercent)} of all possible SNVs` : ""}${off ? " (beyond the drawn range)" : ""}. Axis: genome-wide rank from all SNVs to the top 0.001%.`;
  return (
    <figure className="ag-rank" role="img" aria-label={`Genome-wide rank: ${desc}`} data-testid="avi-rank-ruler">
      <div className="ag-rank__track" aria-hidden="true">
        {RULER_LABELS.slice(1, -1).map(l => (
          <span key={l.phred} className="ag-rank__tick" style={{ left: `${(l.phred / RULER_MAX) * 100}%` }} />
        ))}
        <span className="ag-rank__marker" style={{ left: `${at}%` }} data-off-scale={off || undefined} title={desc} />
      </div>
      <div className="ag-rank__axis" aria-hidden="true">
        {RULER_LABELS.map((l, i) => (
          <span
            key={l.phred}
            className="ag-rank__label"
            style={{ left: `${(l.phred / RULER_MAX) * 100}%` }}
            data-edge={i === 0 ? "start" : i === RULER_LABELS.length - 1 ? "end" : undefined}
          >
            <span className="ag-rank__top">{l.top}</span>
            <span className="ag-rank__phred">{l.phred}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

// ── Where the score comes from ──────────────────────────────────────────────────────────────────

/** A 100% bar: shares of the summed |contribution| ARE a proportion, so a filled bar is honest here. */
function OriginSplit({ ev }: { ev: AlphaGenomeEvidence }) {
  if (!ev.groups || !ev.totalAbs) return null;
  // New first, then the reused groups largest first; slivers under 0.5% are left out of the bar.
  const parts = ev.groups
    .filter(g => g.share !== null && g.share >= 0.005)
    .sort((a, b) => (AVI_ORIGIN[a.group] === AVI_ORIGIN[b.group] ? (b.share as number) - (a.share as number) : AVI_ORIGIN[a.group] === "new" ? -1 : 1));
  if (!parts.length) return null;
  const words = parts.map(g => `${fmtShare(g.share as number)} ${AVI_GROUP_SHORT[g.group]}`).join(", ");
  return (
    <div className="ag-split" data-testid="avi-origin-split">
      <span className="ag-split__name">
        Where the score comes from
        <span className="ag-split__sub">share of the 18 contributions</span>
      </span>
      <div className="ag-split__viz">
        <div className="ag-split__bar" role="img" aria-label={`Where the score comes from: ${words}.`}>
          {parts.map(g => (
            <i key={g.group} data-origin={AVI_ORIGIN[g.group]} data-group={g.group} style={{ flexGrow: g.share as number }} />
          ))}
        </div>
        <div className="ag-split__labels" aria-hidden="true">
          {parts.map(g => (
            <span key={g.group} data-origin={AVI_ORIGIN[g.group]} style={{ flexGrow: g.share as number }}>
              {fmtShare(g.share as number)} {AVI_GROUP_SHORT[g.group]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Facts ───────────────────────────────────────────────────────────────────────────────────────

function Fact({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="ag-fact">
      <dt className="ag-fact__label">{label}</dt>
      <dd className="ag-fact__value">
        {children}
        {sub && <span className="ag-fact__sub">{sub}</span>}
      </dd>
    </div>
  );
}

// ── Contributions ───────────────────────────────────────────────────────────────────────────────

function FeatureRow({ row }: { row: AviFeatureReading }) {
  const has = row.shap !== null;
  const origin = AVI_ORIGIN[row.group];
  const note = origin === "new" ? row.description : `${AVI_GROUP_LABEL[row.group]} · ${AVI_GROUP_NOTE[row.group]}`;
  return (
    <tr data-testid={`avi-feature-${row.id}`}>
      <th scope="row" className="ag-feature">
        <span className="ag-feature__name"><InspectReadingButton tab="alphagenome" readingKey={row.id}>{row.name}</InspectReadingButton></span>
        <span className="ag-feature__note">{note}</span>
      </th>
      <td>{has ? row.shap === 0 ? 'Zero contribution' : (row.shap as number) > 0 ? 'Raises score' : 'Lowers score' : 'Not attributed'}</td>
      <td className="ag-num ag-num--share">{row.share !== null ? fmtShare(row.share) : <span className="ag-dim">—</span>}</td>
    </tr>
  );
}

/** Rows below this share of the summed |contribution| fold behind a per-band "more" row. */
const MINOR_SHARE = 0.02;

function Contributions({ ev }: { ev: AlphaGenomeEvidence }) {
  const workspace = useEvidenceWorkspace('alphagenome');
  const head = (
    <div className="ag-card__head">
      <h2 className="ag-card__label" id="ag-contrib-title">
        What the score is made of
        <span className="ag-card__meta">
          Feature contributions (SHAP)
          {ev.raw !== null && ev.origins && (
            <> · reported raw score <span className="ag-mono">{ev.raw.toFixed(4)}</span></>
          )}
          {ev.origins && (
            <> · {ev.origins.flatMap(o => o.rows).filter(r => r.shap !== null).length} of {AVI_FEATURES.length} contributions returned</>
          )}
        </span>
      </h2>
    </div>
  );
  if (!ev.origins) {
    return (
      <section className="ag-card" aria-labelledby="ag-contrib-title">
        {head}
        <div className="ag-statement" data-testid="avi-no-attribution">
          <p className="ag-statement__title">No contributions reported</p>
          <p className="ag-statement__body">
            The score arrived without its feature contributions, so none are shown. A dash is not a zero: the Atlas did
            not report them for this variant.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="ag-card" aria-labelledby="ag-contrib-title">
      {head}
      <div className="ag-table-wrap">
        <table className="ag-table" data-testid="avi-contributions">
          <colgroup>
            <col className="ag-col-feature" />
            <col />
            <col className="ag-col-share" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col">Direction</th>
              <th scope="col" className="ag-num" title="|value| as a share of the summed |values|">Share</th>
            </tr>
          </thead>
          {ev.origins.map(o => {
            // Rows carrying ≥ 2% of the attribution are always shown; the rest fold behind one row
            // per band, so the table leads with what moved the score. Nothing is dropped — the fold
            // says how many rows it holds and opens in place.
            const open = workspace.expanded.includes(o.origin);
            const major = o.rows.filter(r => r.share !== null && r.share >= MINOR_SHARE);
            const minor = o.rows.filter(r => !(r.share !== null && r.share >= MINOR_SHARE));
            const foldable = minor.length > 1 || (major.length > 0 && minor.length > 0);
            const visible = open || !foldable ? o.rows : major;
            const hidden = o.rows.length - visible.length;
            const unattributed = minor.filter(r => r.shap === null).length;
            return (
              <tbody key={o.origin} data-origin={o.origin}>
                <tr className="ag-group">
                  <th colSpan={3} scope="rowgroup">
                    <span className="ag-group__line">
                      <span>
                        <span className="ag-group__title">{AVI_ORIGIN_LABEL[o.origin]}</span>
                        <span className="ag-group__note">{AVI_ORIGIN_NOTE[o.origin]}</span>
                      </span>
                      <span className="ag-group__share" data-origin={o.origin}>
                        {o.share !== null ? fmtShare(o.share) : "not attributed"}
                      </span>
                    </span>
                  </th>
                </tr>
                {visible.map(r => <FeatureRow key={r.id} row={r} />)}
                {foldable && (hidden > 0 || open) && (
                  <tr className="ag-fold">
                    <td colSpan={3}>
                      <button
                        type="button"
                        className="ag-link"
                        aria-expanded={open}
                        onClick={() => workspace.toggleGroup(o.origin)}
                      >
                        <ChevronDown className="w-3.5 h-3.5 ag-fold__icon" aria-hidden="true" />
                        {open
                          ? "Show fewer"
                          : `${hidden} more, each under ${MINOR_SHARE * 100}% of the total${unattributed ? `, ${unattributed} not attributed` : ""}`}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="ag-card__foot">
        <span><i className="ag-key" data-origin="new" />New evidence</span>
        <span><i className="ag-key" data-origin="reused" />Read elsewhere</span>
        <span>Right of the line raises the score, left lowers it · share = |value| over the summed |values|</span>
      </div>
    </section>
  );
}

/** The run's own identity, as the payload metadata carries it beyond its declared type. */
interface RunIdentity {
  uniprotId?: string | null;
  assembly?: "GRCh37" | "GRCh38" | null;
  genomicCoordinates?: string | null;
  liftedGenomicCoordinates?: string | null;
  resolvedAssembly?: "GRCh37" | "GRCh38" | null;
  numberingBasis?: string | null;
}

// ── Screen ──────────────────────────────────────────────────────────────────────────────────────

function AlphaGenomeTabBody({
  result,
  onOpenSettings,
  onTabChange,
  isBiophysicalLoading = false,
}: TabComponentProps & { result: NonNullable<TabComponentProps["analysisState"]["result"]> }) {
  const workspace = useEvidenceWorkspace('alphagenome');
  const { settings, openSettingsTab } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const [copied, setCopied] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [reevalError, setReevalError] = useState<string | null>(null);

  // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
  const aviConfigured = settings.alphagenomeApiKey?.trim() ? true : undefined;
  const ev = useMemo(
    () => buildAlphaGenomeEvidence({ result, configured: aviConfigured, isLoading: isBiophysicalLoading }),
    [result, aviConfigured, isBiophysicalLoading]
  );
  const attributionModel = useMemo(() => buildAttributionComparison(ev, workspace.filter), [ev, workspace.filter]);
  const { availability } = ev;
  // A re-run written while the composite still streams would be overwritten by its next snapshot.
  const compositeStreaming = isConservationCompositePending(result, isBiophysicalLoading);
  const gene = result.metadata?.gene || "";
  const variant = result.metadata?.variant || "";

  const openConnections = () => (onOpenSettings ? onOpenSettings() : openSettingsTab("connections"));

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleReevaluate = useCallback(async () => {
    setIsReevaluating(true);
    setReevalError(null);
    try {
      /**
       * The SAME identity the run used: build, submitted and verified coordinates, and weighting.
       * Without them the re-run resolved the locus from protein notation alone, which for a GRCh37
       * or lift-verified input is not the allele this screen describes.
       */
      const md: RunIdentity = (result.metadata ?? {}) as RunIdentity;
      const res = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene,
          variant,
          uniprotId: md.uniprotId || undefined,
          ...(settings.acmgWeighting ? { acmgWeighting: settings.acmgWeighting } : {}),
          ...(md.assembly ? { assembly: md.assembly } : {}),
          ...(md.genomicCoordinates && md.assembly ? { genomicCoordinates: md.genomicCoordinates } : {}),
          ...(md.liftedGenomicCoordinates ? { liftedGenomicCoordinates: md.liftedGenomicCoordinates } : {}),
          ...(md.resolvedAssembly ? { resolvedAssembly: md.resolvedAssembly } : {}),
          // The parser accepts a protein-only reading as canonical only when the reader confirmed it.
          ...(md.numberingBasis === "canonical" ? { numberingBasis: "canonical" } : {}),
        }),
      });
      if (!res.ok) throw new Error(`The analysis service answered HTTP ${res.status}.`);
      const data = await res.json();
      const fresh = data?.conservationData;
      if (fresh) {
        /**
         * Only the AlphaGenome reading is replaced. Swapping the whole composite (and the verdict)
         * for a second run's let REVEL, SpliceAI and the ACMG classification change under a button
         * labelled for AlphaGenome — and a core-only verdict replaced one the structural stage had
         * already refined. The AVI counts toward no criterion, so the verdict is unaffected.
         */
        const store = useVariantAnalysisStore.getState();
        store.updateAnalysisResultSlice(
          "conservationData",
          mergeAlphaGenomeReevaluation(store.analysisState.result?.conservationData ?? null, fresh),
          variant
        );
      }
    } catch (err: any) {
      setReevalError(err?.message || "The re-run failed.");
    } finally {
      setIsReevaluating(false);
    }
  }, [fetchWithAuth, gene, variant, result.metadata, settings.acmgWeighting]);

  const finding = aviFinding(ev);
  const scored = ev.assessed && ev.phred !== null;
  const lm = ev.largestMolecular;

  return (
    <div data-evidence-screen className="ag-screen @container" data-testid="alphagenome-screen" data-comparison={workspace.comparison || undefined}>
      <header>
        <h1 className="screen-title">AlphaGenome</h1>
        <p className="screen-tab-description">
          Explore this DNA change’s genome-wide rank and the inputs behind its predicted impact.
        </p>
      </header>
      <EvidenceViewTabs tab="alphagenome" comparisonLabel="Understand the score" />
      <EvidencePanel tab="alphagenome">
      {/* Mounted before its text changes, so assistive technology announces the transition. */}
      <p className="sr-only" role="status" aria-live="polite">
        {availability.state === "pending" ? "AlphaGenome is still scoring this variant." : ""}
      </p>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="ag-card" aria-labelledby="ag-finding-title" data-testid="avi-finding">
        <div className="ag-card__head">
          <h2 className="ag-card__label" id="ag-finding-title">
            Variant impact score (AVI)
            <span className="ag-card__meta">Genome-wide rank · informational</span>
          </h2>
          {scored ? (
            <span className="ev-tier" data-tone="muted" title="No ClinGen calibration exists; counted toward no ACMG criterion">
              Not counted for ACMG
            </span>
          ) : (
            <span className="ev-tier" data-tone={availability.tone === "danger" ? "danger" : "muted"} data-testid="avi-status">
              {availability.label ?? ENGINE_STATE_LABELS["no-result"]}
            </span>
          )}
        </div>

        {scored ? (
          <div className="ag-hero__body">
            <div className="ag-figure">
              <span className="figure-headline ag-figure__value" data-testid="avi-headline">
                {ev.topPercent !== null ? `Top ${fmtPercent(ev.topPercent)}` : `Phred ${(ev.phred as number).toFixed(1)}`}
              </span>
              <span className="ag-figure__label">
                of all ~9 billion possible hg38 SNVs
                {ev.oneIn !== null ? ` · about 1 in ${ev.oneIn.toLocaleString("en-GB")}` : ""}
              </span>
            </div>

            {finding && (
              <p className="ag-prose" data-testid="avi-composition">
                <strong>{finding.headline}</strong> {finding.detail}
              </p>
            )}

            {!workspace.comparison && <RankRuler phred={ev.phred as number} topPercent={ev.topPercent} />}
            {!workspace.comparison && <OriginSplit ev={ev} />}
          </div>
        ) : availability.state === "pending" ? (
          <div className="ag-statement" data-testid="avi-pending">
            <p className="ag-statement__title">Scoring this variant</p>
            <p className="ag-statement__body">
              The AlphaGenome request is still running. The score appears here as soon as it answers; other evidence does not wait for it.
            </p>
          </div>
        ) : (
          <div className="ag-statement" data-testid="avi-absence">
            <p className="ag-statement__title">No AVI score for this variant</p>
            <p className="ag-statement__body">
              {availability.reason ?? `The Atlas returned nothing (${availability.label ?? ENGINE_STATE_LABELS["no-result"]}).`}{" "}
              {availability.action === "retry"
                ? "Re-evaluate the variant to ask the Atlas again."
                : availability.action === "configure-credentials"
                ? "Add or check the AlphaGenome credential in Settings, then re-evaluate."
                : availability.state === "not-covered"
                ? "No setting changes this."
                : "No cause was recorded for this absence."}
            </p>
            {(availability.action === "retry" || availability.action === "configure-credentials") && (
              <div className="ag-actions">
                {availability.action === "configure-credentials" && (
                  <button type="button" className="ag-btn" onClick={openConnections}>
                    <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Open connection settings
                  </button>
                )}
                <button
                  type="button"
                  className="ag-btn"
                  onClick={handleReevaluate}
                  disabled={isReevaluating || compositeStreaming}
                  aria-describedby={compositeStreaming ? "ag-reeval-wait" : undefined}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isReevaluating ? "animate-spin" : ""}`} aria-hidden="true" />
                  {isReevaluating ? "Re-evaluating…" : "Re-evaluate"}
                </button>
                {compositeStreaming && (
                  <span className="ag-dim" id="ag-reeval-wait">Available once the running analysis has finished.</span>
                )}
              </div>
            )}
          </div>
        )}

        {scored && !workspace.comparison && (
          <dl className="ag-facts" data-testid="avi-facts">
            <Fact label="Genome-wide rank" sub={ev.quantile !== null ? <>quantile <span className="ag-mono">{ev.quantile.toFixed(5)}</span></> : "quantile not reported"}>
              <span className="ag-mono">Phred {(ev.phred as number).toFixed(1)}</span>
            </Fact>
            <Fact label="New from AlphaGenome" sub={ev.origins ? "its 10 molecular predictions" : "not attributed"}>
              {ev.newShare !== null ? <>{fmtShare(ev.newShare)} of reported magnitude</> : <span className="ag-dim">—</span>}
            </Fact>
            <Fact
              label="Largest molecular contribution"
              sub={
                lm?.id === "MERGED_SPLICING" ? (
                  onTabChange ? (
                    <button type="button" className="ag-link" onClick={() => onTabChange("splicing")}>
                      Compare with RNA splicing
                      <ArrowRight className="w-3 h-3" aria-hidden="true" />
                    </button>
                  ) : "compare with the RNA splicing tab"
                ) : lm ? "attribution to the raw AVI score" : ev.origins ? "no non-zero molecular contribution returned" : "not attributed"
              }
            >
              {lm ? (
                <span>{lm.name} <span className="ag-mono">{formatAttributionValue(lm.shap as number)}</span></span>
              ) : (
                <span className="ag-dim">{ev.origins ? "None" : "—"}</span>
              )}
            </Fact>
            <Fact label="Engine record" sub="no ClinGen calibration">
              No ACMG code
            </Fact>
          </dl>
        )}

        {reevalError && (
          <p role="alert" className="ag-note ag-note--banner" data-tone="warning">
            <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Re-evaluation failed: {reevalError}</span>
          </p>
        )}

        {scored && (
          <p className="ag-card__foot" data-testid="avi-caveat">
            <span>
              <strong>A rank, not a probability of pathogenicity.</strong> Trained to separate rare from common gnomAD
              variants, so it overlaps with PM2/BS1. Missense changes tend to rank high genome-wide, partly because
              AlphaMissense is one of the inputs.
            </span>
          </p>
        )}
      </section>

      {/* ── 2. What the score is made of ───────────────────────────────────────────────────── */}
      {workspace.comparison && <>
        <React.Suspense fallback={<p>Loading feature contributions…</p>}><EvidenceComparison tab="alphagenome" model={attributionModel} title="What contributes to this score?" description="Each mark is one input’s contribution to the raw AVI score. Molecular predictions are clay; other inputs are grey. Select a feature to understand it." /></React.Suspense>
        <AlphaGenomeGuide evidence={ev} />
      </>}
      {!workspace.comparison && ev.assessed && <Contributions ev={ev} />}

      {/* ── 3. The Atlas ───────────────────────────────────────────────────────────────────── */}
      <section className="ag-card" aria-labelledby="ag-atlas-title" data-testid="avi-atlas">
        <div className="ag-card__head">
          <h2 className="ag-card__label" id="ag-atlas-title">
            Open in the AlphaGenome Atlas
            {ev.atlas && (
              <span className="ag-card__meta">
                GRCh38 <span className="ag-mono ag-strong">{ev.atlas.label}</span>
              </span>
            )}
          </h2>
          {ev.atlas && (
            <button
              type="button"
              className="ag-btn ag-btn--quiet"
              onClick={() => handleCopy(ev.atlas!.urls.variantStr)}
              aria-label="Copy the GRCh38 variant"
            >
              {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        <ul className="ag-atlas__list">
          {(ev.atlas
            ? [
                { href: ev.atlas.urls.variantUrl, name: "Variant page", desc: "The Atlas's own summary of this change." },
                { href: ev.atlas.urls.trackPredictionsUrl, name: "Track predictions", desc: "Which assays and tissues drive each molecular feature." },
                { href: ev.atlas.urls.locusUrl, name: "Locus view, ±20 kb", desc: "The genomic window around this position." },
              ]
            : [
                {
                  href: ev.atlasSearchUrl,
                  name: `Search the Atlas for ${gene || "this gene"}`,
                  desc: "No GRCh38 coordinate is known for this variant, so no direct link is built: the Atlas indexes GRCh38 only, and another build's position would open a different locus.",
                },
              ]
          ).map(l => (
            <li key={l.name}>
              <a className="ag-atlas__item" href={l.href} target="_blank" rel="noopener noreferrer">
                <span className="ag-atlas__name">{l.name}</span>
                <span className="ag-atlas__desc">{l.desc}</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      </EvidencePanel>
    </div>
  );
}

export const AlphaGenomeTab = React.memo(AlphaGenomeTabComponent);
