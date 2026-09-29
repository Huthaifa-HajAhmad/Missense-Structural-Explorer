import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, ExternalLink, Handshake, ListChecks, MapPin, RefreshCw, Zap } from "lucide-react";
import { TabComponentProps } from "./types";
import type { PpiBindingData, PpiBindingShift } from "../../shared/contracts";
import { useApiClient, extractErrorMessage } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { STRING_CONFIDENCE_CUTS } from "../../shared/thresholds";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import {
  DDMUT_PPI_PERFORMANCE,
  buildInteractionsEvidence,
  stringNetworkUrl,
  type InteractionsEvidence,
  type PartnerRow,
} from "../../shared/interactionsEvidence";
import { SiteTrack } from "./interactions/SiteTrack";
import { BindingRuler } from "./interactions/BindingRuler";

/**
 * InteractionsTab — Protein interactions: who the protein binds or works with, whether the variant
 * residue falls in a mapped binding site, and the predicted binding energy change.
 *
 * Renders `buildInteractionsEvidence` and computes nothing itself. Three tiers: the finding (site
 * verdict, fact strip ending in the engine record), where the sites are (one track row per partner),
 * the partners (one grid row per partner, a column per source), then the binding change.
 *
 * REPLACED (doc/INTERACTIONS_TAB_REVIEW.md): "Monomer · Intramolecular · ΔΔG N/A" for a heterodimer;
 * a ΔΔG coloured by OpenBind cut-points and classed by DDMut-PPI ones, with the sign read backwards;
 * "JapanFold OpenBind-0 (Tier 1)" named for a model that never ran; "Swiss-Prot records no interface"
 * when UniProt maps two UBA3 contacts; green "Highest" chips and bars on functional association.
 */

/**
 * One request, tagged with the `(gene, variant)` pair it was issued for. A response may only write
 * state for the key it was issued for, and render reads state only for the key on screen: an aborted
 * request's late answer, the first painted frame, and an in-session cache swap each used to paint the
 * previous variant's partners, or settled-absence copy for a query still in flight.
 */
type Keyed<T> = { key: string; status: "loading" | "ready" | "error"; data: T | null; message?: string };

function updateResult(patch: Record<string, unknown>) {
  useVariantAnalysisStore.getState().setAnalysisState((prev: any) =>
    prev?.result ? { ...prev, result: { ...prev.result, ...patch } } : prev
  );
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <>
      <span className="itx-dot" data-on={on || undefined} aria-hidden="true" />
      <span className="sr-only">{on ? label : `Not in ${label}`}</span>
    </>
  );
}

function siteCell(p: PartnerRow, ev: InteractionsEvidence) {
  const ranges = p.sites.map(s => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`));
  if (!ranges.length && !p.observed) {
    return <td className="itx-site"><span className="itx-site__note">None mapped</span></td>;
  }
  const hit = p.variantInSite || p.variantAtObservedInterface;
  const where = p.variantInSite ? "in a mapped site" : p.variantAtObservedInterface ? "at the solved interface" : "outside";
  return (
    <td className="itx-site" data-hit={hit || undefined}>
      <span className="itx-site__range">{ranges.length ? ranges.join(", ") : `${p.observed!.residues.length} residues`}</span>
      <span className="itx-site__note">{ev.residueLabel} {where}</span>
    </td>
  );
}

function PartnerRowView({ p, ev }: { p: PartnerRow; ev: InteractionsEvidence }) {
  return (
    <tr data-hit={p.variantInSite || p.variantAtObservedInterface || undefined}>
      <th scope="row" className="itx-subject">
        <span className="itx-subject__name">
          <a
            className="itx-partner-link"
            href={stringNetworkUrl(ev.gene, p.gene)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${ev.gene} and ${p.gene} on STRING (new tab)`}
          >
            {p.gene}
          </a>
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </span>
        <span className="itx-subject__note">{p.evidence}{p.accession ? ` · ${p.accession}` : ""}</span>
      </th>
      <td className="itx-src"><Dot on={Boolean(p.subunitSentence)} label="SUBUNIT" /></td>
      <td className="itx-src">
        <Dot on={p.intactExperiments !== null} label="IntAct" />
        {p.intactExperiments !== null && <span className="itx-count" title="IntAct experiments">{p.intactExperiments}</span>}
      </td>
      <td className="itx-src">
        <Dot on={Boolean(p.observed)} label="solved structures" />
        {p.observed && <span className="itx-count" title="PDB entries">{p.observed.pdbEntries}</span>}
      </td>
      <td className="itx-assoc">
        {p.string ? (
          <>
            <span className="itx-assoc__row">
              <span className="itx-bar" aria-hidden="true">
                <span className="itx-bar__fill" style={{ width: `${Math.max(0, Math.min(1, p.string.score)) * 100}%` }} />
                {STRING_CONFIDENCE_CUTS.map(c => (
                  <span key={c.id} className="itx-bar__tick" style={{ left: `${c.min * 100}%` }} />
                ))}
              </span>
              <span className="itx-num">{p.string.score.toFixed(3)}</span>
            </span>
            <span className="itx-assoc__band">{p.string.band ? `${p.string.band} confidence` : "Below STRING's lowest band"}</span>
          </>
        ) : (
          <span className="itx-reason">{ev.sections.string.state === "ok" ? "Not in STRING's top five" : "Not read"}</span>
        )}
      </td>
      {siteCell(p, ev)}
    </tr>
  );
}

function Statement({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="itx-statement">
      <p className="itx-statement__title">{title}</p>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function InteractionsTab({ analysisState, onTabChange }: TabComponentProps) {
  const result = analysisState.result;
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;
  const key = gene && variant ? `${gene}|${variant}` : null;
  const { fetchWithAuth } = useApiClient();

  // ── Partners and sites (lookups; run on open) ─────────────────────────────
  const [ppi, setPpi] = useState<Keyed<PpiBindingData> | null>(null);
  const stored = (result?.ppiBindingData ?? null) as PpiBindingData | null;
  // A stored payload counts only if it names this variant and was written by the current service.
  const storedForVariant =
    stored && stored.gene === gene && stored.variant === variant && stored.lookups && "uniprot" in stored.lookups ? stored : null;

  const fetchPpi = useCallback(
    async (signal?: AbortSignal) => {
      if (!gene || !variant || !key) return;
      setPpi(prev => ({ key, status: "loading", data: prev?.key === key ? prev.data : null }));
      try {
        const response = await fetchWithAuth("/api/v1/ppi/binding-affinity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gene, variant, uniprotId }),
          signal,
        });
        if (signal?.aborted) return;
        if (!response.ok) {
          setPpi({ key, status: "error", data: null, message: await extractErrorMessage(response, "The interaction lookups did not answer.") });
          return;
        }
        const data = (await response.json()) as PpiBindingData;
        if (signal?.aborted) return;
        setPpi({ key, status: "ready", data });
        updateResult({ ppiBindingData: data });
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) return;
        setPpi({ key, status: "error", data: null, message: err?.message || "The interaction lookups did not answer." });
      }
    },
    [gene, variant, key, uniprotId, fetchWithAuth]
  );

  useEffect(() => {
    if (!key) return;
    if (storedForVariant) {
      setPpi({ key, status: "ready", data: storedForVariant });
      return;
    }
    const controller = new AbortController();
    fetchPpi(controller.signal);
    return () => controller.abort();
  }, [key, storedForVariant, fetchPpi]);

  // ── Binding change (a wild-type model and a DDMut-PPI job; run on request) ──────
  const [shift, setShift] = useState<Keyed<PpiBindingShift> | null>(null);
  const storedShift = (result?.ppiBindingShift ?? null) as PpiBindingShift | null;
  const storedShiftForVariant = storedShift && storedShift.gene === gene && storedShift.variant === variant ? storedShift : null;

  if (!result) return null;

  const active = ppi && ppi.key === key ? ppi : null;
  const ppiData = active?.data ?? storedForVariant ?? (stored && stored.gene === gene && stored.variant === variant ? stored : null);
  const activeShift = shift && shift.key === key ? shift : null;

  const ev = buildInteractionsEvidence({
    result,
    ppi: ppiData,
    ppiStatus: active?.status ?? (storedForVariant ? "ready" : "loading"),
    ppiError: active?.status === "error" ? active.message ?? null : null,
    shift: activeShift?.data ?? storedShiftForVariant,
    shiftLoading: activeShift?.status === "loading",
    shiftError: activeShift?.status === "error" ? activeShift.message ?? null : null,
  });
  const b = ev.binding;
  const requestInFlight = active?.status === "loading";

  const requestShift = async () => {
    if (!key || !gene || !variant || !uniprotId || !b.canRequest || activeShift?.status === "loading") return;
    setShift({ key, status: "loading", data: null });
    try {
      const response = await fetchWithAuth("/api/v1/ppi/binding-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene, variant, uniprotId, chains: b.chains }),
      });
      if (!response.ok) {
        setShift({ key, status: "error", data: null, message: await extractErrorMessage(response, "The binding change could not be estimated.") });
        return;
      }
      const data = (await response.json()) as PpiBindingShift;
      setShift({ key, status: "ready", data });
      const meta = useVariantAnalysisStore.getState().analysisState?.result?.metadata;
      if (meta?.gene === gene && meta?.variant === variant) updateResult({ ppiBindingShift: data });
    } catch (err: any) {
      setShift({ key, status: "error", data: null, message: err?.message || "The binding change could not be estimated." });
    }
  };

  const physical = ev.partners.filter(p => p.group === "physical");
  const functional = ev.partners.filter(p => p.group === "functional");
  const anyHit = ev.partners.some(p => p.variantInSite || p.variantAtObservedInterface);
  const lookupFault = [ev.sections.uniprot, ev.sections.pdbe, ev.sections.string].filter(s => s.state === "failed");

  return (
    <div className="itx-screen @container">
      {/* Live region mounted for the tab's whole life: a region inserted already populated is not announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        {ev.status === "loading" ? "" : `${ev.finding.headline} ${ev.partners.length} partners listed.`}
      </div>

      <header className="itx-header">
        <div>
          <h1 className="screen-title">Protein interactions</h1>
          <p className="screen-tab-description">
            Which proteins {ev.gene} binds or works with, whether the variant falls in a mapped binding site, and any predicted change in binding energy.
          </p>
        </div>
        {/* `aria-disabled`, not `disabled`: a disabled control leaves the tab order and drops focus to <body>. */}
        <button
          type="button"
          className="itx-button"
          onClick={() => { if (!requestInFlight) void fetchPpi(); }}
          aria-disabled={requestInFlight}
          aria-busy={requestInFlight}
          title="Ask UniProt, PDBe and STRING again for this variant"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${requestInFlight ? "animate-spin" : ""}`} aria-hidden="true" />
          {requestInFlight ? "Reading" : "Read again"}
        </button>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────── */}
      <section className="itx-card" aria-labelledby="itx-finding-title" data-testid="interactions-finding">
        <div className="itx-hero__body">
          <div className="itx-hero__top">
            <span className="eyebrow" id="itx-finding-title">
              <Handshake className="w-3.5 h-3.5" />
              Interaction context · not an ACMG input
            </span>
            <span className="ev-tier itx-chip" data-tone="muted">Informational</span>
          </div>
          <div className="itx-hero__figure">
            <span className="itx-figure" data-empty={ev.status === "loading" || ev.finding.figure === "Not checked" || undefined}>{ev.finding.figure}</span>
            {ev.sites.length > 0 && (
              <span className="itx-hero__figure-label">
                {ev.residueLabel} against {ev.sites.length} mapped {ev.sites.length === 1 ? "site" : "sites"} · UniProt
              </span>
            )}
          </div>
          <p className="itx-hero__finding" data-testid="interactions-finding-sentence">
            <strong>{ev.finding.headline}</strong> {ev.finding.predicate}.
          </p>
        </div>

        {(lookupFault.length > 0 || ev.status === "error") && (
          <div role="status" className="itx-callout" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{ev.status === "error" ? ev.errorText ?? "The interaction lookups did not answer." : lookupFault.map(s => s.reason).join(" ")}</span>
          </div>
        )}

        <dl className="itx-facts">
          {ev.facts.map(f => (
            <div key={f.label} className="itx-fact">
              <dt>{f.label}</dt>
              <dd className={/\d/.test(f.value) ? "itx-mono" : undefined}>{f.value}</dd>
              <span className="itx-fact__sub">{f.sub}</span>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 2. Where the sites are ─────────────────────────────────────────── */}
      <section className="itx-section" aria-labelledby="itx-track-title">
        <h2 className="eyebrow" id="itx-track-title">
          <MapPin className="w-3.5 h-3.5" />
          Where partners bind
        </h2>
        <div className="itx-card">
          <SiteTrack ev={ev} />
          <div className="itx-foot" aria-label="Legend">
            <span className="itx-legend__item"><i className="itx-key" data-kind="site" />Mapped site, UniProt</span>
            <span className="itx-legend__item"><i className="itx-key" data-kind="solved" />Interface in a solved structure</span>
            <span className="itx-legend__item"><i className="itx-key" data-kind="variant" />{ev.residueLabel}</span>
            {onTabChange && (
              <button type="button" className="itx-link" onClick={() => onTabChange("multimers")}>
                Multimer assembly
                <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. Partners ────────────────────────────────────────────────────── */}
      <section className="itx-section" aria-labelledby="itx-partners-title" aria-busy={ev.status === "loading"}>
        <h2 className="eyebrow" id="itx-partners-title">
          <ListChecks className="w-3.5 h-3.5" />
          Partners
        </h2>
        <div className="itx-card">
          {ev.partners.length ? (
            <div className="itx-table-wrap" role="region" aria-label={`Interaction partners of ${ev.gene}`} tabIndex={0}>
              <table className="itx-table" data-testid="partner-grid">
                <thead>
                  <tr>
                    <th scope="col">Partner</th>
                    <th scope="col" className="itx-src">SUBUNIT</th>
                    <th scope="col" className="itx-src">IntAct</th>
                    <th scope="col" className="itx-src">Solved</th>
                    <th scope="col">STRING association</th>
                    <th scope="col" className="itx-site">Mapped site</th>
                  </tr>
                </thead>
                {physical.length > 0 && (
                  <tbody data-group="physical">
                    <tr className="itx-group">
                      <th colSpan={6} scope="rowgroup">
                        <span className="itx-group__inner">
                          <span className="itx-group__title">Curated physical interaction</span>
                          <span className="itx-group__meta">UniProtKB{ev.uniprotId ? ` ${ev.uniprotId}` : ""} SUBUNIT and IntAct, PDBe-KB</span>
                        </span>
                      </th>
                    </tr>
                    {physical.map(p => <PartnerRowView key={p.key} p={p} ev={ev} />)}
                  </tbody>
                )}
                {functional.length > 0 && (
                  <tbody data-group="functional">
                    <tr className="itx-group">
                      <th colSpan={6} scope="rowgroup">
                        <span className="itx-group__inner">
                          <span className="itx-group__title">Functional association only</span>
                          <span className="itx-group__meta">STRING, no curated binding</span>
                        </span>
                      </th>
                    </tr>
                    {functional.map(p => <PartnerRowView key={p.key} p={p} ev={ev} />)}
                  </tbody>
                )}
              </table>
            </div>
          ) : (
            <Statement title={ev.status === "loading" ? "Reading partners" : ev.sections.uniprot.state === "failed" && ev.sections.string.state === "failed" ? "Partners not retrieved" : "No partners listed"}>
              {ev.status === "loading"
                ? `Asking UniProt, PDBe and STRING about ${ev.gene}.`
                : [ev.sections.uniprot.reason, ev.sections.string.reason].filter(Boolean).join(" ")}
            </Statement>
          )}
          <div className="itx-foot">
            <span>
              STRING scores functional association (co-expression, text mining, pathways), not binding. Ticks at{" "}
              {STRING_CONFIDENCE_CUTS.map(c => c.min.toFixed(1)).reverse().join(", ")} are STRING's bands.
              {anyHit ? " Shaded rows hold the variant." : ""}
            </span>
            {ev.stringUrl && (
              <a className="itx-link" href={ev.stringUrl} target="_blank" rel="noopener noreferrer">
                Open in STRING
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── 4. Binding energy change ───────────────────────────────────────── */}
      <section className="itx-section" aria-labelledby="itx-bind-title">
        <h2 className="eyebrow" id="itx-bind-title">
          <Zap className="w-3.5 h-3.5" />
          Binding energy change
        </h2>
        <div className="itx-card" data-testid="binding-card">
          <div className="itx-bind__head">
            <span className="itx-hero__figure-label">ΔΔG_bind{b.partnerText ? ` ${b.partnerText}` : ""} · DDMut-PPI on a wild-type complex</span>
            {b.stateLabel && (
              <span className="ev-tier" data-tone={b.state === "failed" ? "warning" : b.state === "pending" || b.state === "running" ? "neutral" : "muted"}>{b.stateLabel}</span>
            )}
          </div>
          {b.state === "ok" && b.value !== null ? (
            <div className="itx-bind__body">
              <div className="itx-bind__figure">
                <span className="itx-bind__value">{b.valueText}</span>
                <span className="itx-hero__figure-label">{b.directionText} {b.partnerText}</span>
              </div>
              <BindingRuler value={b.value} />
              <p className="itx-bind__caption">
                Wild-type complex modelled by {b.wildType?.provenance ?? "Boltz-2"}
                {b.wildType?.ipTm != null ? ` (ipTM ${b.wildType.ipTm.toFixed(2)})` : ""}; {ev.residueLabel} substituted on chain A. Negative means weaker binding, in DDMut-PPI's convention. {DDMUT_PPI_PERFORMANCE}
              </p>
            </div>
          ) : (
            <Statement
              title={b.state === "pending" || b.state === "running" ? ENGINE_STATE_LABELS.running : b.state === "failed" ? "No value returned" : b.state === "ready" ? "Not measured yet" : "Not measured"}
              action={
                b.canRequest ? (
                  <button
                    type="button"
                    className="itx-button"
                    onClick={() => void requestShift()}
                    aria-disabled={b.state === "pending"}
                    aria-busy={b.state === "pending"}
                  >
                    <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                    {b.state === "running" ? "Check again" : b.state === "failed" ? "Try again" : "Estimate binding change"}
                  </button>
                ) : b.state === "needs-model" && onTabChange ? (
                  <button type="button" className="itx-link itx-link--start" onClick={() => onTabChange("multimers")}>
                    Open Multimer assembly
                    <ArrowRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                ) : undefined
              }
            >
              {b.reason}
            </Statement>
          )}
        </div>
      </section>
    </div>
  );
}

export default React.memo(InteractionsTab);
