import React, { useState, useEffect, useCallback } from "react";
import { variantContacts } from "../../shared/multimerAssembly";
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Zap,
  MapPin,
  Network,
  ExternalLink,
  HelpCircle,
  ArrowRight,
  type LucideIcon
} from "lucide-react";
import { TabComponentProps } from "./types";
import { PpiBindingData } from "../../types";
import { useApiClient, extractErrorMessage } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import {
  STRING_CONFIDENCE_CUTS,
  THRESHOLDS,
  stringConfidenceLabel,
  stringConfidenceTier
} from "../../shared/thresholds";

/**
 * Copy for the OpenBind-0 interface classification. The enum is a machine value;
 * "INTERFACE_DISRUPTIVE" is not what a reader wants to be shown.
 */
const CLASSIFICATION_COPY: Record<string, { label: string; tone: string }> = {
  INTERFACE_DISRUPTIVE: { label: "Interface disruptive", tone: "danger" },
  ALLOSTERIC_PERTURBATION: { label: "Allosteric perturbation", tone: "warning" },
  SURFACE_NEUTRAL: { label: "Surface neutral", tone: "good" },
  UNKNOWN: { label: "Unclassified", tone: "neutral" }
};

/**
 * The one shape a section uses when it has no table or list to show — in flight,
 * failed, or settled and genuinely empty. "We have not looked yet" and "we looked
 * and there is nothing" are different claims about the protein, so they get
 * different words rather than sharing one empty state.
 *
 * The spinner carries no `motion-reduce:animate-none`: `primitives.css` exempts
 * `.animate-spin` from its global reduced-motion kill switch on purpose, to keep
 * feedback for in-flight work. The title text is the static cue.
 */
function PanelState({
  icon: Icon,
  title,
  note,
  spinning = false
}: {
  icon: LucideIcon;
  title: string;
  note: React.ReactNode;
  spinning?: boolean;
}) {
  return (
    <div className="ev-empty">
      <Icon className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} aria-hidden="true" />
      <div className="min-w-0">
        <span className="ev-empty-title">{title}</span>
        <p className="ev-empty-note">{note}</p>
      </div>
    </div>
  );
}

/**
 * One PPI request, tagged with the `(gene, variant)` pair it was issued for.
 *
 * The tab used to track this with a bare `isLoading` boolean and an unkeyed
 * payload, which made "we have not asked yet" indistinguishable from "we asked
 * and there is nothing" in three reachable ways:
 *
 *  - An ABORTED request's `finally` cleared the flag its successor had just set.
 *    React runs an effect's cleanup and its replacement in one synchronous pass,
 *    and the aborted fetch's rejection microtask drains afterwards — so while the
 *    new request was still in flight both `pending` and `unavailable` were false
 *    and the tab printed settled-absence copy for a query it had not finished.
 *  - `isLoading` starts `false`, and passive effects run after paint, so the
 *    first painted frame of every variant asserted absence.
 *  - The payload was not keyed to the variant, so a result swap that does not
 *    pass through `result === null` (the in-session cache hit) painted the
 *    previous variant's partners and interface chip under the new header.
 *
 * Keying the request fixes all three by construction: a response may only write
 * state for the key it was issued for, and render reads state only for the key
 * it is currently showing.
 */
type PpiRequest = {
  key: string;
  status: "loading" | "ready" | "error";
  data: PpiBindingData | null;
  message?: string;
};

export function InteractionsTab({ analysisState, formatDdGValue, energyUnit, onTabChange }: TabComponentProps) {
  const result = analysisState.result;
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;
  const complexPdb = result?.multimerData?.complexPdb;
  const chainIds = result?.multimerData?.chainIds;
  const chainA = (chainIds && chainIds.length > 0 && chainIds[0]) ? chainIds[0] : "A";
  const chainB = (chainIds && chainIds.length > 1 && chainIds[1]) ? chainIds[1] : "B";

  const ppiKey = gene && variant ? `${gene}|${variant}` : null;

  const { fetchWithAuth } = useApiClient();
  const [ppi, setPpi] = useState<PpiRequest | null>(null);

  /**
   * A stored payload counts as this variant's only if it says it is: the payload
   * carries its own `gene`/`variant`, and the tab used to ignore them.
   */
  const storedPpi = result?.ppiBindingData ?? null;
  const storedForVariant =
    storedPpi && gene && variant && storedPpi.gene === gene && storedPpi.variant === variant
      ? storedPpi
      : null;

  const fetchPpiData = useCallback(async (signal?: AbortSignal) => {
    if (!gene || !variant || !ppiKey) return;
    const key = ppiKey;
    // Keep the previous payload for the SAME key: uniprotId and complexPdb land
    // progressively during an analysis and re-issue this query, and blanking the
    // table on each one made the reader lose rows they could still use.
    setPpi(prev => ({ key, status: "loading", data: prev?.key === key ? prev.data : null }));
    try {
      const response = await fetchWithAuth("/api/v1/ppi/binding-affinity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene,
          variant,
          uniprotId,
          wtPdb: complexPdb || null,
          // Zero synthetic fallbacks protocol: never pass identical WT coordinates as mutant.
          // Live interface energy calculation requires a genuinely modeled mutant multimer complex.
          mutPdb: null,
          chainA,
          chainB
        }),
        signal
      });
      // A superseded request writes nothing at all. This is the guard the old
      // `finally { setIsLoading(false) }` did not have.
      if (signal?.aborted) return;
      if (response.ok) {
        const data = await response.json();
        if (signal?.aborted) return;
        setPpi({ key, status: "ready", data });
        useVariantAnalysisStore.getState().setAnalysisState((prev: any) => {
          if (!prev?.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              ppiBindingData: data
            }
          };
        });
      } else {
        const message = await extractErrorMessage(response, "Failed to fetch PPI binding data");
        setPpi({ key, status: "error", data: null, message });
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) return;
      setPpi({
        key,
        status: "error",
        data: null,
        message: err?.message || "Network error loading PPI data"
      });
    }
  }, [gene, variant, ppiKey, uniprotId, complexPdb, chainA, chainB, fetchWithAuth]);

  // Synchronize on variant change and abort in-flight queries
  useEffect(() => {
    if (!gene || !variant || !ppiKey) return;
    if (storedForVariant) {
      setPpi({ key: ppiKey, status: "ready", data: storedForVariant });
      return;
    }
    const controller = new AbortController();
    fetchPpiData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [gene, variant, ppiKey, storedForVariant, fetchPpiData]);

  if (!result) return null;

  // ── Request state, read only for the variant on screen ─────────────────────
  const active = ppi && ppi.key === ppiKey ? ppi : null;
  const ppiData = active?.data ?? storedForVariant ?? null;
  const requestInFlight = active?.status === "loading";
  /**
   * Both false only when a settled answer exists for THIS key. Note the initial
   * render satisfies `ppiPending` even before the effect runs, which is the point:
   * `active` is null, not "we have an empty answer".
   */
  const ppiPending = !ppiData && active?.status !== "error";
  const ppiUnavailable = !ppiData && active?.status === "error";
  const ppiErrorMessage = active?.status === "error" ? active.message ?? null : null;

  /**
   * The endpoint reports an EMPTY ARRAY for every non-answer, so an empty list is
   * not on its own evidence of absence: `lookups` records whether the lookup
   * actually ran. Absent `lookups` means the payload predates the field, which is
   * UNKNOWN — not an empty answer, because the old API could not have expressed
   * the difference.
   */
  const stringLookup = ppiData?.lookups?.stringPartners ?? null;
  const interfaceLookup = ppiData?.lookups?.interfaceResidues ?? null;

  /** Curated SUBUNIT annotation, quoted back under whichever note precedes it. */
  const withSubunitQuote = (lead: React.ReactNode) => (
    <>
      {lead}
      {subunitComment && (
        <span className="ev-quote">
          <span className="ev-quote-label">Curated SUBUNIT annotation</span>
          {subunitComment}
        </span>
      )}
    </>
  );

  // `ppiData` decides the partner list, not array truthiness: an empty array from
  // a settled response is a real answer and must not fall back to the pipeline's.
  const stringPartners = ppiData ? ppiData.stringPartners : result.stringInteractions ?? [];
  const bindingShift = ppiData?.bindingShift;
  const interfaceResidues = ppiData?.interfaceResidues ?? [];

  // Multimer & Quaternary Assembly context
  const multimerData = result?.multimerData;
  const multimerContacts = multimerData?.interfaceContacts || [];
  const oligomericState = multimerData?.oligomericState;
  const subunitComment = multimerData?.subunitComment || result?.uniprotFeatures?.subunitComment;
  const variantPos = result?.metadata?.residueIndex || 0;

  const isExplicitMonomer = multimerData?.status === "monomeric" ||
    (oligomericState ? oligomericState.toLowerCase().trim() === "monomer" : false);
  const isExplicitMultimer = multimerData?.status === "success" || (multimerData?.chainCount ?? 0) > 1;

  const isMonomeric = isExplicitMonomer || (
    !isExplicitMultimer &&
    Boolean(subunitComment && /^monomer(\.|\b)/i.test(subunitComment.trim()))
  );

  // The variant residue ITSELF in a modelled contact — the one rule the Multimer tab uses too. This was
  // "any contact within ±4 residues in sequence", which a sequence neighbour satisfies without the
  // variant touching the partner; `resB` is only the variant's numbering when the chains are identical.
  const hasDirectComplexContact = variantContacts(
    multimerContacts,
    variantPos,
    multimerData?.assembly ? multimerData.assembly.kind === "homomer" : (multimerData?.chainCount ?? 0) <= 2
  ).length > 0;
  const hasCuratedInterface = interfaceResidues.some(r => r.isVariantPosition);
  const hasCuratedInterfaceAny = interfaceResidues.length > 0;

  const ddgBind = bindingShift?.ddgBind;
  const hasDdgBind = Number.isFinite(ddgBind);

  // ── ΔΔG_bind: value, tone and the note that says why it is absent ──────────
  const ddgValue = hasDdgBind
    ? formatDdGValue(ddgBind!, energyUnit)
    : isMonomeric
      ? "N/A"
      : "Pending";
  // Cut-points come from THRESHOLDS.openBind, which the server's fallback
  // classification reads too: as two hand-written copies, the value's colour and
  // the chip's word could disagree about the same number.
  const ddgTone = hasDdgBind
    ? ddgBind! >= THRESHOLDS.openBind.disruptive
      ? "danger"
      : ddgBind! >= THRESHOLDS.openBind.allosteric
        ? "warning"
        : "good"
    : "muted";
  const ddgNote = hasDdgBind
    ? bindingShift?.distanceToInterface != null
      ? `Interface distance: ${bindingShift.distanceToInterface.toFixed(1)} Å`
      : "Binding free energy shift across the interface"
    : isMonomeric
      ? "Monomer: no inter-chain interface to score"
      : requestInFlight
        ? "Evaluating interface binding shift..."
        : "No multimer complex available yet";

  // ── Quaternary assembly ───────────────────────────────────────────────────
  const classificationCopy = bindingShift?.classification
    ? CLASSIFICATION_COPY[bindingShift.classification] ?? CLASSIFICATION_COPY.UNKNOWN
    : null;
  const assemblyLabel = classificationCopy
    ? classificationCopy.label
    : isMonomeric
      ? "Monomer"
      : oligomericState || "Uncharacterized";
  const assemblyTone = classificationCopy
    ? classificationCopy.tone
    : "neutral";
  const assemblyNote = classificationCopy
    ? "Predicted impact on complex stability"
    : isMonomeric
      ? "Curated physiological single-chain state"
      : oligomericState
        ? "Reported oligomeric assembly"
        : "Assembly state not reported";

  // ── Residue interface proximity ───────────────────────────────────────────
  // One colour carries one meaning here: danger only where the variant actually
  // sits at an interface. Everything else is neutral ink, so the eye is drawn to
  // the single case that matters instead of to four equally coloured chips.
  const proximity = isMonomeric
    ? { label: "Intramolecular", tone: "neutral", Icon: ShieldCheck, note: "Residue is internal to the single-chain structure" }
    : (hasDirectComplexContact || (bindingShift?.distanceToInterface != null && bindingShift.distanceToInterface <= 5.0))
      ? {
          label: bindingShift?.distanceToInterface != null
            ? `Direct contact (${bindingShift.distanceToInterface.toFixed(1)} Å)`
            : "Direct contact < 5 Å",
          tone: "danger",
          Icon: AlertTriangle,
          note: "Residue sits in a modelled quaternary contact"
        }
      : hasCuratedInterface
        ? { label: "Interface residue", tone: "danger", Icon: AlertTriangle, note: "Residue is a curated subunit interface site" }
        : hasCuratedInterfaceAny
          ? { label: "Distal to site", tone: "neutral", Icon: ShieldCheck, note: "Outside the curated interface residues" }
          : multimerContacts.length > 0
            ? { label: "Distal residue", tone: "neutral", Icon: ShieldCheck, note: "Beyond 5 Å of every modelled contact" }
            : { label: "Uncharacterized", tone: "neutral", Icon: HelpCircle, note: "No interface coordinates available" };

  /**
   * The sentence that says what the three metrics above it add up to. Rendered
   * for every state: the "N/A (Monomer)" case previously carried no explanation
   * at this level, so the reader had to infer why ΔΔG_bind could not be scored.
   */
  const predictorName = bindingShift?.provenance || "OpenBind-0";
  const distanceSuffix = bindingShift?.distanceToInterface != null
    ? ` (distance to interface: ${bindingShift.distanceToInterface.toFixed(1)} Å)`
    : "";
  const bindingFootnote = hasDdgBind
    ? `${predictorName} predicts an interface binding shift of ${formatDdGValue(ddgBind!, energyUnit)}${distanceSuffix}. A positive ΔΔG means the substitution weakens complex affinity; a negative value means it tightens it.`
    : isMonomeric
      ? `${gene} is curated as a single-chain monomer, so there is no inter-chain interface to score and ΔΔG_bind is not applicable to this variant.`
      : requestInFlight
        ? `Computing interface binding shift for ${gene}...`
        : `No modelled mutant complex or multimer coordinates are available for ${gene}, so the interface shift cannot be computed.`;

  const showMultimerCta = !hasDdgBind && !isMonomeric && Boolean(onTabChange);

  // The lowest band STRING publishes, read rather than typed, so the sentence and
  // the classifier cannot disagree.
  const lowestBand = THRESHOLDS.stringDb.low.toFixed(3);

  /**
   * What each section shows in place of a table or list. Every branch below
   * distinguishes a real empty answer from a lookup that never happened — the
   * distinction the endpoint could not previously express, and which the section
   * used to paper over by asserting absence either way.
   */
  const interfacePlaceholder: React.ComponentProps<typeof PanelState> = (() => {
    if (ppiPending) {
      return {
        icon: RefreshCw,
        spinning: true,
        title: "Checking curated interface annotations…",
        note: <>Querying UniProt for subunit interface features on <strong>{gene}</strong>.</>
      };
    }
    if (ppiUnavailable) {
      return {
        icon: AlertTriangle,
        title: "Curated sites not retrieved",
        note: <>The query failed, so no interface annotation could be checked for <strong>{gene}</strong>. This is not evidence that none exists.</>
      };
    }
    if (interfaceLookup === "failed") {
      return {
        icon: AlertTriangle,
        title: "Curated sites not retrieved",
        note: <>The UniProt lookup failed, so no interface annotation could be checked for <strong>{gene}</strong>. This is not evidence that none exists.</>
      };
    }
    if (interfaceLookup === "skipped") {
      return {
        icon: HelpCircle,
        title: "Interface annotations not checked",
        note: <>No UniProt accession was resolved for <strong>{gene}</strong>, so no interface annotation was requested. This is not evidence that none exists.</>
      };
    }
    if (interfaceLookup === "ok") {
      return {
        icon: ShieldCheck,
        title: "No curated interface residues",
        note: withSubunitQuote(
          <>
            Swiss-Prot records no residue-level subunit interface annotation for{" "}
            <strong>{gene}</strong>, so no interface position can be reported for this variant.
          </>
        )
      };
    }
    return {
      icon: HelpCircle,
      title: "Interface annotations not reported",
      note: withSubunitQuote(
        <>
          This response does not say whether the interface lookup ran, so no absence can be
          claimed for <strong>{gene}</strong>.
        </>
      )
    };
  })();

  const partnersPlaceholder: React.ComponentProps<typeof PanelState> = (() => {
    if (ppiPending) {
      return {
        icon: RefreshCw,
        spinning: true,
        title: "Querying STRING-db…",
        note: <>Fetching the strongest functional interaction partners for <strong>{gene}</strong>.</>
      };
    }
    if (ppiUnavailable) {
      return {
        icon: AlertTriangle,
        title: "Partners not retrieved",
        note: <>The STRING-db query failed, so no partner list is available. This is not evidence that <strong>{gene}</strong> has none.</>
      };
    }
    if (stringLookup === "failed") {
      return {
        icon: AlertTriangle,
        title: "Partners not retrieved",
        note: <>The STRING-db lookup failed, so no partner list is available for <strong>{gene}</strong>. This is not evidence that it has none.</>
      };
    }
    if (stringLookup === "ok") {
      return {
        icon: Network,
        title: "No interaction partners",
        note: <>STRING-db returns no association for <strong>{gene || "this gene"}</strong> at or above its lowest confidence band ({lowestBand}).</>
      };
    }
    return {
      icon: HelpCircle,
      title: "Partners not reported",
      note: <>This response does not say whether the STRING-db lookup ran, so no absence can be claimed for <strong>{gene}</strong>.</>
    };
  })();

  return (
    <div className="space-y-4">
      {/*
        Live regions, mounted for the whole life of the tab. A `role="alert"` node
        that is inserted already populated is not reliably announced — live regions
        report CHANGES to a region that already existed — so the error is injected
        into a container that is always in the DOM and only its styling is toggled.
      */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={ppiErrorMessage ? "ev-alert" : "sr-only"}
      >
        {ppiErrorMessage && (
          <>
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            <span>{ppiErrorMessage}</span>
          </>
        )}
      </div>

      {/* Settled outcomes only, so the region does not narrate every keystroke of
          the request lifecycle. Satisfies 4.1.3 for the results region, which had
          no live region at all. */}
      <div role="status" aria-live="polite" className="sr-only">
        {ppiPending
          ? ""
          : ppiUnavailable
            ? "Interaction data could not be retrieved."
            : `${stringPartners.length} interaction partners and ${interfaceResidues.length} curated interface residues loaded for ${gene}.`}
      </div>

      {/* Tab Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="screen-title">PPI Networks &amp; Interface Binding Affinity</h1>
          <p className="screen-tab-description">
            Functional protein–protein interaction network (STRING-db) and the structural interface
            binding-affinity shift (ΔΔG_bind, JapanFold OpenBind-0).
          </p>
        </div>
        {/*
          `aria-disabled`, not `disabled`: a disabled control leaves the tab order,
          so activating Refresh with the keyboard dropped focus to <body> and the
          next Tab restarted at the top of the document.
        */}
        <button
          type="button"
          onClick={() => {
            if (!requestInFlight) void fetchPpiData();
          }}
          aria-disabled={requestInFlight}
          aria-busy={requestInFlight}
          className="cs-btn-ghost ev-refresh shrink-0 self-start"
          title="Re-query STRING-db and OpenBind-0 for this variant"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${requestInFlight ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{requestInFlight ? "Analyzing…" : "Refresh PPI"}</span>
        </button>
      </div>

      {/* ── Section 1: interface binding affinity ─────────────────────────── */}
      <section className="ev-panel">
        <div className="ev-panel-header">
          <h2 className="ev-panel-title">
            <Zap className="w-4 h-4" aria-hidden="true" />
            Interface Binding Affinity Shift
          </h2>
          <span className="badge-data-source">
            {bindingShift?.provenance || "JapanFold OpenBind-0 (Tier 1)"}
          </span>
        </div>

        <div className="ev-panel-body">
          <div className="ev-metric-rail">
            <div className="ev-metric">
              <span className="ev-metric-label">ΔΔG_bind</span>
              <span className="ev-metric-value" data-tone={ddgTone}>{ddgValue}</span>
              <span className="ev-metric-note">{ddgNote}</span>
            </div>

            <div className="ev-metric">
              <span className="ev-metric-label">Quaternary Assembly</span>
              <span className="ev-metric-value">
                <span className="ev-tier" data-tone={assemblyTone}>{assemblyLabel}</span>
              </span>
              <span className="ev-metric-note">{assemblyNote}</span>
            </div>

            <div className="ev-metric">
              <span className="ev-metric-label">Residue Interface Proximity</span>
              <span className="ev-metric-value">
                <span className="ev-tier" data-tone={proximity.tone}>
                  <proximity.Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {proximity.label}
                </span>
              </span>
              <span className="ev-metric-note">{proximity.note}</span>
            </div>
          </div>

          <p className="ev-panel-footnote">
            {bindingFootnote}
            {showMultimerCta && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => onTabChange!("multimers")}
                  className="ev-inline-cta"
                >
                  Open Quaternary Assembly
                  <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </button>
              </>
            )}
          </p>
        </div>
      </section>

      {/* ── Section 2: UniProt curated interface sites ────────────────────── */}
      <section className="ev-panel" aria-busy={requestInFlight}>
        <div className="ev-panel-header">
          <h2 className="ev-panel-title">
            <MapPin className="w-4 h-4" aria-hidden="true" />
            Curated Interface &amp; Subunit Binding Sites
          </h2>
          <span className="badge-data-source">UniProtKB</span>
        </div>

        {interfaceResidues.length > 0 ? (
          <ul className="ev-residue-list">
            {interfaceResidues.map((item, idx) => (
              <li key={idx} className={`ev-residue${item.isVariantPosition ? " is-variant" : ""}`}>
                <div className="min-w-0">
                  <span className="ev-residue-pos">Residue {item.pos}</span>
                  <span className="ev-residue-desc">{item.description}</span>
                </div>
                {item.isVariantPosition && (
                  <span className="ev-tier" data-tone="danger">Mutation site</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <PanelState {...interfacePlaceholder} />
        )}
      </section>

      {/* ── Section 3: STRING-db functional partner network ───────────────── */}
      <section className="ev-panel" aria-busy={requestInFlight}>
        <div className="ev-panel-header">
          <h2 className="ev-panel-title">
            <Network className="w-4 h-4" aria-hidden="true" />
            Functional Interaction Partners
          </h2>
          <span className="badge-data-source">STRING-db</span>
        </div>

        {stringPartners.length > 0 ? (
          <div
            className="ev-table-scroller overflow-x-auto"
            role="region"
            aria-label={`STRING-db interaction partners for ${gene}`}
            tabIndex={0}
          >
            <table className="ev-table">
              <caption className="ev-table-caption">
                {stringPartners.length} strongest partners by combined association score (0–1),
                ranked descending · Homo sapiens (TaxID 9606)
              </caption>
              <thead>
                <tr>
                  <th scope="col">Partner</th>
                  <th scope="col" style={{ width: "40%" }}>Association Strength</th>
                  <th scope="col" style={{ width: "112px" }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {stringPartners.map((partner, pIdx) => {
                  const isScoreFinite = Number.isFinite(partner.score);
                  const tier = stringConfidenceTier(partner.score);
                  // A score below STRING's lowest band is "Unclassified", which is
                  // NOT the Low band: the classifier declines to name it, so the
                  // rail must not paint it with the Low tone.
                  const chipTone = tier ?? "neutral";
                  const fillTone = tier ?? "none";
                  const stringUrl = `https://string-db.org/network/9606.${encodeURIComponent(partner.partner || "")}`;

                  return (
                    <tr
                      key={partner.partner || pIdx}
                      onClick={(event) => {
                        // The anchor is the accessible target and keeps its own
                        // focus ring, target and rel. The row handler is a pointer
                        // convenience on top of it, which is why it bails out when
                        // the click landed on the link — otherwise the anchor would
                        // navigate and this would open a second tab.
                        if ((event.target as HTMLElement).closest("a")) return;
                        window.open(stringUrl, "_blank", "noopener,noreferrer");
                      }}
                    >
                      {/* A row header, not a data cell: this is the key the other
                          two cells describe, and it is what a screen reader
                          announces alongside them. The rank is hidden so the
                          header's name is the gene and not "1 PTP4A1". */}
                      <th scope="row">
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <span className="ev-rank" aria-hidden="true">{pIdx + 1}</span>
                          <a
                            href={stringUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ev-partner"
                            title={`Open the ${partner.partner} interaction network on STRING-db (new tab)`}
                          >
                            {partner.partner}
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        </span>
                      </th>
                      <td>
                        <span className="ev-conf">
                          <span className="ev-conf-track" aria-hidden="true">
                            <span
                              className="ev-conf-fill"
                              data-tone={fillTone}
                              style={{ width: `${isScoreFinite ? Math.max(0, Math.min(1, partner.score)) * 100 : 0}%` }}
                            />
                            {STRING_CONFIDENCE_CUTS.map((band) => (
                              <span
                                key={band.id}
                                className="ev-conf-tick"
                                style={{ left: `${band.min * 100}%` }}
                              />
                            ))}
                          </span>
                          <span className="ev-conf-value">
                            {isScoreFinite ? partner.score.toFixed(3) : "—"}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="ev-tier" data-tone={chipTone}>
                          {stringConfidenceLabel(partner.score) ?? "Unclassified"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelState {...partnersPlaceholder} />
        )}
      </section>
    </div>
  );
}

export default React.memo(InteractionsTab);
