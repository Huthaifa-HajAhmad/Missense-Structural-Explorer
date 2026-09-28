import React, { useCallback, useState } from "react";
import { ArrowRight, Check, ChevronDown, Copy, Dna, ExternalLink, Info, Layers, RefreshCw, Settings2, TriangleAlert } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { useApiClient } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import {
  AVI_GROUP_LABEL,
  AVI_GROUP_NOTE,
  buildAlphaGenomeEvidence,
  compositionSentence,
  fmtPercent,
  fmtShare,
  fmtSigned,
  type AlphaGenomeEvidence,
  type AviFeatureReading,
} from "../../shared/alphagenomeEvidence";

/**
 * AlphaGenome.
 *
 * ONE QUESTION: how does AlphaGenome's variant-impact score (AVI) rank this nucleotide change, and
 * what is that score made of? Three tiers, top to bottom — the same shape as Population Data and
 * Predictors:
 *
 *   1. THE FINDING — the rank among all possible hg38 SNVs, drawn on a decade ruler; one sentence
 *      on what drove it; the standing caveat that it is a rank, not a pathogenicity call; four facts.
 *      When there is no score, the reason and the one remedy that can fix it, in the same place.
 *   2. WHAT THE SCORE IS MADE OF — the 18 SHAP contributions in one table, grouped as the Atlas
 *      groups them, each with a diverging bar and its share of the total.
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
  { phred: 50, top: "0.001%" },
];

function RankRuler({ phred, topPercent }: { phred: number; topPercent: number | null }) {
  const off = phred > RULER_MAX;
  const at = (Math.max(0, Math.min(phred, RULER_MAX)) / RULER_MAX) * 100;
  const desc = `Phred ${phred.toFixed(1)}${topPercent !== null ? ` — top ${fmtPercent(topPercent)} of all possible SNVs` : ""}${off ? " (beyond the drawn range)" : ""}`;
  return (
    <figure className="ag-rank" aria-label={`Genome-wide rank: ${desc}`} data-testid="avi-rank-ruler">
      <div className="ag-rank__track">
        <span className="ag-rank__fill" style={{ width: `${at}%` }} aria-hidden="true" />
        {RULER_LABELS.slice(1, -1).map(l => (
          <span key={l.phred} className="ag-rank__tick" style={{ left: `${(l.phred / RULER_MAX) * 100}%` }} aria-hidden="true" />
        ))}
        <span
          className="ag-rank__marker"
          style={{ left: `${at}%` }}
          data-off-scale={off || undefined}
          title={desc}
          aria-hidden="true"
        />
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
      <figcaption className="ag-rank__caption">
        Upper row: share of all possible SNVs scoring at least this high. Lower row: the Phred value.
      </figcaption>
    </figure>
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

function Diverging({ shap, max }: { shap: number; max: number }) {
  const width = max > 0 ? (Math.abs(shap) / max) * 50 : 0;
  if (shap === 0) return <div className="ag-diverge" aria-hidden="true" />;
  return (
    <div className="ag-diverge" aria-hidden="true">
      <span className="ag-diverge__bar" data-side={shap > 0 ? "up" : "down"} style={{ width: `${width}%` }} />
    </div>
  );
}

function FeatureRow({ row, max }: { row: AviFeatureReading; max: number }) {
  const has = row.shap !== null;
  return (
    <tr data-testid={`avi-feature-${row.id}`}>
      <th scope="row" className="ag-feature">
        <span className="ag-feature__name">{row.name}</span>
        <span className="ag-feature__note">{row.description}</span>
      </th>
      <td className="ag-num">{has ? fmtSigned(row.shap as number) : <span className="ag-dim">—</span>}</td>
      <td title={has ? `${row.name}: ${fmtSigned(row.shap as number)} (${(row.shap as number) >= 0 ? "raises" : "lowers"} the score)` : `${row.name}: not attributed`}>
        {has ? <Diverging shap={row.shap as number} max={max} /> : <span className="ag-dim">Not attributed</span>}
      </td>
      <td className="ag-num ag-num--share">{row.share !== null ? fmtShare(row.share) : <span className="ag-dim">—</span>}</td>
    </tr>
  );
}

/** Rows below this share of the summed |contribution| fold behind a per-group "more" row. */
const MINOR_SHARE = 0.02;

function Contributions({ ev }: { ev: AlphaGenomeEvidence }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!ev.groups) {
    return (
      <div className="ag-card">
        <p className="ag-empty" data-testid="avi-no-attribution">
          The score arrived without its feature contributions, so none are shown. A dash is not a zero — the
          Atlas did not report them for this variant.
        </p>
      </div>
    );
  }
  const max = Math.max(0, ...ev.groups.flatMap(g => g.rows.map(r => (r.shap === null ? 0 : Math.abs(r.shap)))));
  return (
    <div className="ag-card">
      <div className="ag-table-wrap">
        <table className="ag-table" data-testid="avi-contributions">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col" className="ag-num" title="SHAP contribution, in the units of the raw AVI score">Contribution</th>
              <th scope="col" className="ag-bar-col">Direction</th>
              <th scope="col" className="ag-num" title="|contribution| as a share of the summed |contributions|">Share</th>
            </tr>
          </thead>
          {ev.groups.map(g => {
            // Rows carrying ≥ 2% of the attribution are always shown; the rest fold behind one row
            // per group, so the table leads with what moved the score. Nothing is dropped — the
            // fold states how many rows it holds and opens in place.
            const open = expanded[g.group] ?? false;
            const major = g.rows.filter(r => r.share !== null && r.share >= MINOR_SHARE);
            const minor = g.rows.filter(r => !(r.share !== null && r.share >= MINOR_SHARE));
            const visible = open || major.length === 0 && minor.length <= 1 ? g.rows : major;
            const hidden = g.rows.length - visible.length;
            const unattributed = minor.filter(r => r.shap === null).length;
            return (
            <tbody key={g.group} data-group={g.group}>
              <tr className="ag-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ag-group__line">
                    <span>
                      <span className="ag-group__title">{AVI_GROUP_LABEL[g.group]}</span>
                      <span className="ag-group__note">{AVI_GROUP_NOTE[g.group]}</span>
                    </span>
                    <span className="ag-group__share">{g.share !== null ? `${fmtShare(g.share)} of total` : "not attributed"}</span>
                  </span>
                </th>
              </tr>
              {visible.map(r => <FeatureRow key={r.id} row={r} max={max} />)}
              {(hidden > 0 || open) && minor.length > 0 && !(major.length === 0 && minor.length <= 1) && (
                <tr className="ag-fold">
                  <td colSpan={4}>
                    <button
                      type="button"
                      className="ag-link"
                      aria-expanded={open}
                      onClick={() => setExpanded(s => ({ ...s, [g.group]: !open }))}
                    >
                      <ChevronDown className="w-3.5 h-3.5 ag-fold__icon" aria-hidden="true" />
                      {open
                        ? "Show fewer"
                        : `${hidden} more — each under ${MINOR_SHARE * 100}% of the total${unattributed ? `, ${unattributed} not attributed` : ""}`}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
            );
          })}
        </table>
      </div>
      <div className="ag-table-foot">
        <span><i className="ag-key" data-side="up" />Raises the score</span>
        <span><i className="ag-key" data-side="down" />Lowers it</span>
        <span>Bar length relative to the largest contribution · the 18 contributions sum to the raw score</span>
      </div>
    </div>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────────────────────────

function AlphaGenomeTabBody({
  result,
  onOpenSettings,
  onTabChange,
}: TabComponentProps & { result: NonNullable<TabComponentProps["analysisState"]["result"]> }) {
  const { settings, openSettingsTab } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const [copied, setCopied] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [reevalError, setReevalError] = useState<string | null>(null);

  // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
  const ev = buildAlphaGenomeEvidence({ result, configured: settings.alphagenomeApiKey?.trim() ? true : undefined });
  const { availability } = ev;
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
      const res = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene, variant, uniprotId: result.metadata?.uniprotId || undefined }),
      });
      if (!res.ok) throw new Error(`The analysis service answered HTTP ${res.status}.`);
      const data = await res.json();
      const store = useVariantAnalysisStore.getState();
      if (data?.conservationData) store.updateAnalysisResultSlice("conservationData", data.conservationData, variant);
      if (data?.ruleBasedInsights) store.updateAnalysisResultSlice("ruleBasedInsights", data.ruleBasedInsights, variant);
    } catch (err: any) {
      setReevalError(err?.message || "The re-run failed.");
    } finally {
      setIsReevaluating(false);
    }
  }, [fetchWithAuth, gene, variant, result.metadata?.uniprotId]);

  const composition = compositionSentence(ev);
  const spliceShap = ev.splicing?.shap ?? null;

  return (
    <div className="ag-screen @container" data-testid="alphagenome-screen">
      <header>
        <h1 className="screen-title">AlphaGenome</h1>
        <p className="screen-tab-description">
          How Google DeepMind&apos;s AlphaGenome variant-impact score (AVI) ranks this nucleotide change among all
          possible SNVs in the genome, and which features the score is built from.
        </p>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="ag-card" aria-labelledby="ag-finding-title" data-testid="avi-finding">
        <div className="ag-hero__body">
          <div className="ag-hero__top">
            <span className="eyebrow" id="ag-finding-title">
              <Dna className="w-3.5 h-3.5" aria-hidden="true" />
              Variant impact score (AVI)
            </span>
            <span className="ag-hero__chips">
              <span
                className="ev-tier"
                data-tone={ev.assessed ? "good" : availability.tone === "danger" ? "danger" : "muted"}
                data-testid="avi-status"
              >
                {ev.assessed ? ENGINE_STATE_LABELS.computed : availability.label}
              </span>
              <span className="ev-tier" data-tone="neutral" title="Informational: not counted toward PP3/BP4 or any ACMG criterion">
                Not counted for ACMG
              </span>
            </span>
          </div>

          {ev.assessed && ev.phred !== null ? (
            <>
              <div className="ag-figure">
                <span className="ag-figure__value" data-testid="avi-headline">
                  {ev.topPercent !== null ? `Top ${fmtPercent(ev.topPercent)}` : `Phred ${ev.phred.toFixed(1)}`}
                </span>
                <span className="ag-figure__label">
                  of all ~9 billion possible hg38 SNVs
                  {ev.oneIn !== null ? ` · about 1 in ${ev.oneIn.toLocaleString("en-GB")}` : ""}
                  {" · "}AVI Phred <span className="ag-mono">{ev.phred.toFixed(1)}</span>
                </span>
              </div>

              <RankRuler phred={ev.phred} topPercent={ev.topPercent} />

              {composition && (
                <p className="ag-prose" data-testid="avi-composition">{composition}</p>
              )}

              <p className="ag-note" data-testid="avi-caveat">
                <Info className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  A rank, not a probability of pathogenicity. The model was trained to tell rare gnomAD variants from
                  common ones, and it has no ClinGen calibration — so it is not counted toward PP3/BP4.
                </span>
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-2" data-testid="avi-absence">
              <p className="ag-prose">
                <strong>No AVI score for this variant.</strong>{" "}
                {availability.reason ?? `The Atlas returned nothing (${availability.label}).`}
              </p>
              <p className="ag-prose ag-dim">
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
                  <button type="button" className="ag-btn" onClick={handleReevaluate} disabled={isReevaluating}>
                    <RefreshCw className={`w-3.5 h-3.5 ${isReevaluating ? "animate-spin" : ""}`} aria-hidden="true" />
                    {isReevaluating ? "Re-evaluating…" : "Re-evaluate"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {ev.assessed && ev.phred !== null && (
          <dl className="ag-facts" data-testid="avi-facts">
            <Fact label="Genome-wide rank" sub={ev.quantile !== null ? <>quantile <span className="ag-mono">{ev.quantile.toFixed(5)}</span></> : "quantile not reported"}>
              <span className="ag-mono">Phred {ev.phred.toFixed(1)}</span>
            </Fact>
            <Fact
              label="Largest contribution"
              sub={ev.largest ? AVI_GROUP_LABEL[ev.largest.group] : ev.groups ? "every contribution is zero" : "not attributed"}
            >
              {ev.largest ? (
                <span>{ev.largest.name} <span className="ag-mono">{fmtSigned(ev.largest.shap as number)}</span></span>
              ) : (
                <span className="ag-dim">—</span>
              )}
            </Fact>
            <Fact
              label="Splicing feature"
              sub={
                onTabChange ? (
                  <button type="button" className="ag-link" onClick={() => onTabChange("splicing")}>
                    Splice-specific evidence
                    <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                ) : "see the RNA splicing tab"
              }
            >
              {spliceShap !== null ? <span className="ag-mono">{fmtSigned(spliceShap)}</span> : <span className="ag-dim">—</span>}
            </Fact>
            <Fact label="ACMG use" sub="informational only">
              Not counted
            </Fact>
          </dl>
        )}

        {reevalError && (
          <p role="alert" className="ag-note ag-note--banner" data-tone="warning">
            <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Re-evaluation failed: {reevalError}</span>
          </p>
        )}
      </section>

      {/* ── 2. What the score is made of ───────────────────────────────────────────────────── */}
      {ev.assessed && (
        <section className="ag-section" aria-labelledby="ag-contrib-title">
          <h2 className="eyebrow" id="ag-contrib-title">
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            What the score is made of
            <span className="ag-eyebrow-meta">SHAP contributions of the 18 features</span>
          </h2>
          <Contributions ev={ev} />
        </section>
      )}

      {/* ── 3. The Atlas ───────────────────────────────────────────────────────────────────── */}
      <section className="ag-section" aria-labelledby="ag-atlas-title">
        <h2 className="eyebrow" id="ag-atlas-title">
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          Open in the AlphaGenome Atlas
        </h2>
        <div className="ag-card" data-testid="avi-atlas">
          {ev.atlas ? (
            <>
              <div className="ag-atlas__coord">
                <span>
                  GRCh38 <span className="ag-mono">{ev.atlas.label}</span>
                </span>
                <button
                  type="button"
                  className="ag-btn ag-btn--quiet"
                  onClick={() => handleCopy(ev.atlas!.urls.variantStr)}
                  aria-label="Copy the GRCh38 variant"
                >
                  {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <ul className="ag-atlas__list">
                {[
                  { href: ev.atlas.urls.variantUrl, name: "Variant page", desc: "The Atlas's own summary of this change." },
                  { href: ev.atlas.urls.trackPredictionsUrl, name: "Track predictions", desc: "The per-assay, per-biosample predictions behind the features." },
                  { href: ev.atlas.urls.locusUrl, name: "Locus view, ±20 kb", desc: "The genomic window around this position." },
                ].map(l => (
                  <li key={l.name}>
                    <a className="ag-atlas__item" href={l.href} target="_blank" rel="noopener noreferrer">
                      <span>
                        <span className="ag-atlas__name">{l.name}</span>
                        <span className="ag-atlas__desc">{l.desc}</span>
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ul className="ag-atlas__list">
              <li>
                <a className="ag-atlas__item" href={ev.atlasSearchUrl} target="_blank" rel="noopener noreferrer">
                  <span>
                    <span className="ag-atlas__name">Search the Atlas for {gene || "this gene"}</span>
                    <span className="ag-atlas__desc">
                      No GRCh38 coordinate is known for this variant, so no direct link is built — the Atlas indexes
                      GRCh38 only, and another build&apos;s position would open a different locus.
                    </span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export const AlphaGenomeTab = React.memo(AlphaGenomeTabComponent);
