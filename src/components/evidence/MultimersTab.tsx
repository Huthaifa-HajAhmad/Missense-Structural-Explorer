import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Boxes, Download, ListChecks, MapPin, RefreshCw, Waypoints } from "lucide-react";
import { TabComponentProps } from "./types";
import type { MultimerData } from "../../types";
import { useApiClient, extractErrorMessage } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { getDeduplicatedPromise } from "../../variantAnalysisUtils";
import { setCachedVariant } from "../../services/pipeline/variantCache";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { IPTM_BAND_LABEL, buildMultimerEvidence, type MultimerEvidence } from "../../shared/multimerEvidence";
import { AssemblyDiagram } from "./multimer/AssemblyDiagram";
import { InterfaceTrack } from "./multimer/InterfaceTrack";
import { IptmRuler } from "./multimer/IptmRuler";

/**
 * Multimer assembly.
 *
 * ONE QUESTION: does this protein work as part of a complex, and does the variant residue sit at a
 * subunit interface? Three tiers, the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — the stated assembly as the headline, one sentence on the interface, a
 *      schematic of the chains with the variant placed, and a fact strip ending in the engine record.
 *   2. WHERE THE INTERFACES ARE — one sequence axis with the modelled interface and each solved
 *      partner interface, the variant ruled across all of them.
 *   3. READINGS — one table: curation, prediction, observation; then the contacts the residue makes.
 *
 * It replaced a panel that called every protein "a single-chain monomer" (the SUBUNIT text was read
 * from a field UniProt does not use), showed heteromers as a red failure, claimed "directly disrupts
 * inter-chain contacts" for any contact within ±4 residues in sequence, coloured any ipTM green, and
 * named OpenFold3, a 4.5 Å cut-off and "Tenstorrent superclusters", none of which the code used.
 * doc/MULTIMER_TAB_REVIEW.md lists each finding.
 *
 * INVARIANTS
 *   • Every sentence, state and number comes from `buildMultimerEvidence`; this file decides nothing.
 *   • Nothing here is an ACMG input, and the fact strip says so.
 *   • A contact in the variant model is never called a lost or disrupted contact.
 */

function useMultimerData(result: TabComponentProps["analysisState"]["result"]) {
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;
  const stored = (result?.multimerData ?? null) as MultimerData | null;
  const { fetchWithAuth } = useApiClient();
  const [data, setData] = useState<MultimerData | null>(stored);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (signal?: AbortSignal, fresh = false) => {
      if (!gene || !variant || !uniprotId) return;
      setIsLoading(true);
      setError(null);
      const key = `multimer_${gene}_${variant}_${uniprotId}${fresh ? `_${Date.now()}` : ""}`;
      try {
        // `signal` is the request's IDENTITY, not only the fetch's: the pipeline's own multimer
        // pre-fetch shares this key, and without it an entry doomed by the other caller's abort could
        // be handed to this tab and swallowed as an empty panel.
        const next: MultimerData = await getDeduplicatedPromise(key, async () => {
          const response = await fetchWithAuth("/api/v1/structure/multimer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gene, variant, uniprotId }),
            signal,
          });
          if (!response.ok) throw new Error(await extractErrorMessage(response, "The assembly service did not answer."));
          return response.json();
        }, signal);
        if (!next) return;
        setData(next);
        const current = useVariantAnalysisStore.getState().analysisState;
        const meta = current?.result?.metadata;
        if (meta?.gene === gene && meta?.variant === variant) {
          useVariantAnalysisStore.getState().setAnalysisState((prev: any) =>
            prev?.result ? { ...prev, result: { ...prev.result, multimerData: next } } : prev
          );
          if (current?.result) setCachedVariant(gene, variant, uniprotId, { analysisResult: { ...current.result, multimerData: next } });
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") setError(err?.message || "The assembly service did not answer.");
      } finally {
        setIsLoading(false);
      }
    },
    [gene, variant, uniprotId, fetchWithAuth]
  );

  useEffect(() => {
    // A payload without `assembly` was written by the earlier service, which misread every SUBUNIT
    // record as absent. It is not rendered; a fresh one is requested.
    if (stored?.assembly) {
      setData(stored);
      setIsLoading(false);
      return;
    }
    setData(stored);
    setError(null);
    if (!gene || !variant || !uniprotId) return;
    const controller = new AbortController();
    run(controller.signal);
    return () => controller.abort();
  }, [gene, variant, uniprotId, stored, run]);

  return { data, isLoading, error, rerun: () => run(undefined, true) };
}

function InterfaceChip({ ev }: { ev: MultimerEvidence }) {
  const tone = ev.interface.verdict === "at-interface" ? "neutral" : "muted";
  return (
    <span className="ev-tier mlt-verdict" data-tone={tone} data-testid="interface-verdict">
      {ev.interface.label}
    </span>
  );
}

function downloadModel(pdb: string, name: string) {
  const blob = new Blob([pdb], { type: "chemical/x-pdb" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StateCell({ label, reason }: { label: string | null; reason: string | null }) {
  return (
    <>
      <td className="mlt-reason" colSpan={2}>{reason}</td>
      <td className="mlt-status">
        {label && <span className="ev-tier" data-tone={label === ENGINE_STATE_LABELS.running ? "neutral" : "muted"}>{label}</span>}
      </td>
    </>
  );
}

export function MultimersTab({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  const { data, isLoading, error, rerun } = useMultimerData(result);
  if (!result) return null;

  const ev = buildMultimerEvidence({ result, data, isLoading, error });
  const { assembly: asm, model, experimental: exp } = ev;
  const pdb = data?.complexPdb ?? null;
  const partnerNames = asm.partners.map(p => p.gene).join(", ");
  // The provider does not say which partner chain a contact is on; with one partner it is that chain.
  const partnerChain = ev.chains.length === 2 ? `${ev.chains[1].id} ${ev.chains[1].label}` : "another copy";

  return (
    <div className="mlt-screen @container">
      <header className="mlt-header">
        <div>
          <h1 className="screen-title">Multimer assembly</h1>
          <p className="screen-tab-description">
            Whether this protein works as part of a complex, and whether the variant residue sits at a subunit interface.
          </p>
        </div>
        {ev.canRequestModel && (
          <button type="button" className="mlt-button" onClick={rerun} disabled={isLoading}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {ev.status === "idle" || ev.status === "stale" ? "Evaluate assembly" : "Run again"}
          </button>
        )}
      </header>

      {/* ── 1. The finding ───────────────────────────────────────────────────────────────── */}
      <section className="mlt-card mlt-hero" aria-labelledby="mlt-finding-title" data-testid="multimer-finding">
        <div className="mlt-hero__body">
          <div className="mlt-hero__text">
            <div className="mlt-hero__top">
              <span className="eyebrow" id="mlt-finding-title">
                <Boxes className="w-3.5 h-3.5" />
                Quaternary context · not an ACMG input
              </span>
              <InterfaceChip ev={ev} />
            </div>
            <div className="mlt-hero__figure">
              <span className="mlt-figure" data-empty={asm.kind === "unstated" || undefined}>{asm.label}</span>
              <span className="mlt-hero__figure-label">
                {asm.composition}
                {asm.subunitText ? " · UniProt SUBUNIT" : ""}
              </span>
            </div>
            <p className="mlt-hero__finding" data-testid="multimer-finding-sentence">
              <strong>{ev.finding.headline}</strong> {ev.finding.predicate}.
            </p>
          </div>
          <figure className="mlt-hero__diagram">
            <AssemblyDiagram ev={ev} />
            <figcaption>
              {model.state === "built" ? "Modelled" : ev.chains.length > 1 ? "As stated · not modelled" : asm.kind === "monomer" ? "As stated" : "Single chain shown"}
            </figcaption>
          </figure>
        </div>

        {(ev.status === "stale" || ev.status === "error" || model.state === "failed") && (
          <div role="status" className="mlt-callout mlt-callout--banner" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{ev.status === "stale" ? model.reason : model.reason ?? "The assembly service did not answer."}</span>
          </div>
        )}

        <dl className="mlt-facts">
          <div className="mlt-fact">
            <dt>Assembly</dt>
            <dd>{asm.label}</dd>
            <span className="mlt-fact__sub">{asm.subunitText ? "UniProt SUBUNIT, curated" : "No SUBUNIT record"}</span>
          </div>
          <div className="mlt-fact">
            <dt>{asm.kind === "heteromer" || asm.kind === "complex" ? "Partner" : "Copies"}</dt>
            <dd className={partnerNames ? "mlt-mono" : undefined}>
              {asm.kind === "heteromer" || asm.kind === "complex" ? partnerNames || "Not resolved" : asm.copies ?? "Not stated"}
            </dd>
            <span className="mlt-fact__sub mlt-mono">
              {asm.partners.map(p => p.accession).filter(Boolean).join(", ") || (asm.homoAssumed ? "identical chains assumed" : asm.kind === "homomer" ? "identical chains" : " ")}
            </span>
          </div>
          <div className="mlt-fact">
            <dt>Interface</dt>
            <dd>{ev.interface.label}</dd>
            <span className="mlt-fact__sub">{ev.interface.source}</span>
          </div>
          <div className="mlt-fact">
            <dt>Engine record</dt>
            <dd>None</dd>
            <span className="mlt-fact__sub">No ACMG code is drawn from this tab</span>
          </div>
        </dl>
      </section>

      {/* ── 2. Where the interfaces are ───────────────────────────────────────────────────── */}
      <section className="mlt-section" aria-labelledby="mlt-track-title">
        <h2 className="eyebrow" id="mlt-track-title">
          <MapPin className="w-3.5 h-3.5" />
          Where the interfaces are
        </h2>
        <div className="mlt-card">
          <InterfaceTrack ev={ev} />
          <div className="mlt-foot" aria-label="Legend">
            <span className="mlt-legend__item"><i className="mlt-key" data-kind="predicted" />Predicted interface</span>
            <span className="mlt-legend__item"><i className="mlt-key" data-kind="solved" />Seen in a solved structure</span>
            <span className="mlt-legend__item"><i className="mlt-key" data-kind="variant" />{ev.residueLabel}</span>
          </div>
        </div>
      </section>

      {/* ── 3. Readings ─────────────────────────────────────────────────────────────────── */}
      <section className="mlt-section" aria-labelledby="mlt-readings-title">
        <h2 className="eyebrow" id="mlt-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          Readings
        </h2>
        <div className="mlt-card mlt-table-wrap">
          <table className="mlt-table" data-testid="multimer-readings">
            <thead>
              <tr>
                <th scope="col">Reading</th>
                <th scope="col">Detail</th>
                <th scope="col" className="mlt-num">Value</th>
                <th scope="col" className="mlt-status">Status</th>
              </tr>
            </thead>

            <tbody data-group="curation">
              <tr className="mlt-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="mlt-group__inner">
                    <span className="mlt-group__title">Curated assembly</span>
                    <span className="mlt-group__meta">UniProtKB{ev.uniprotId ? ` ${ev.uniprotId}` : ""}</span>
                  </span>
                </th>
              </tr>
              <tr data-rule-input={asm.subunitText ? "" : undefined}>
                <th scope="row" className="mlt-subject">
                  <span className="mlt-subject__name">SUBUNIT record</span>
                  <span className="mlt-subject__note">{asm.subunitText ? "decided the assembly" : "curated assembly statement"}</span>
                </th>
                {asm.subunitText ? (
                  <>
                    <td className="mlt-quote" colSpan={2}>
                      &ldquo;{asm.subunitText}&rdquo;
                      {asm.alsoStated.length > 0 && (
                        <span className="mlt-subject__note">Also stated: {asm.alsoStated.join(", ")}. The first assembly named is used.</span>
                      )}
                    </td>
                    <td className="mlt-status"><span className="ev-tier" data-tone="neutral">{asm.label}</span></td>
                  </>
                ) : (
                  <StateCell label={ENGINE_STATE_LABELS["no-result"]} reason="UniProt has no SUBUNIT record for this protein. That is not evidence of a monomer." />
                )}
              </tr>
              {asm.partners.map(p => (
                <tr key={p.gene}>
                  <th scope="row" className="mlt-subject">
                    <span className="mlt-subject__name">Partner {p.gene}</span>
                    <span className="mlt-subject__note">
                      {p.resolvedBy === "interaction"
                        ? "resolved by UniProt's curated interactions"
                        : p.resolvedBy === "swissprot"
                        ? "resolved by a reviewed human gene search"
                        : "named, not resolved yet"}
                    </span>
                  </th>
                  <td className="mlt-reason">Named in the SUBUNIT record</td>
                  <td className="mlt-num">{p.accession ?? "—"}</td>
                  <td className="mlt-status" />
                </tr>
              ))}
            </tbody>

            <tbody data-group="model">
              <tr className="mlt-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="mlt-group__inner">
                    <span className="mlt-group__title">Predicted complex</span>
                    <span className="mlt-group__meta">
                      {model.provenance && model.state === "built" ? model.provenance : "Boltz-2 via JapanFold"}
                      {ev.chains.length > 1 && model.state === "built" ? ` · chains ${ev.chains.map(c => `${c.id} ${c.label}`).join(", ")} · variant on A` : ""}
                    </span>
                  </span>
                </th>
              </tr>
              {model.state === "built" ? (
                <>
                  <tr>
                    <th scope="row" className="mlt-subject">
                      <span className="mlt-subject__name">Interface confidence</span>
                      <span className="mlt-subject__note">ipTM, all interfaces together</span>
                    </th>
                    <td className="mlt-scale">{model.iptm !== null && <IptmRuler value={model.iptm} band={model.band} />}</td>
                    <td className="mlt-num">{model.iptm !== null ? model.iptm.toFixed(2) : "—"}</td>
                    <td className="mlt-status">
                      {model.band ? <span className="ev-tier" data-tone="neutral">{IPTM_BAND_LABEL[model.band]}</span> : <span className="ev-tier" data-tone="muted">{ENGINE_STATE_LABELS["no-result"]}</span>}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="mlt-subject">
                      <span className="mlt-subject__name">Complex confidence</span>
                      <span className="mlt-subject__note">pTM, the whole complex</span>
                    </th>
                    <td className="mlt-reason">How well the overall arrangement is predicted, interfaces and chains together</td>
                    <td className="mlt-num">{model.ptm !== null ? model.ptm.toFixed(2) : "—"}</td>
                    <td className="mlt-status" />
                  </tr>
                  <tr data-rule-input="">
                    <th scope="row" className="mlt-subject">
                      <span className="mlt-subject__name">Contacts from {ev.residueLabel}</span>
                      <span className="mlt-subject__note">decided the interface call</span>
                    </th>
                    <td className="mlt-reason">
                      {model.variantContacts.length
                        ? `Nearest ${model.variantContacts[0].distance.toFixed(1)} Å, listed below`
                        : model.nearestInterfaceGap !== null
                        ? `None; nearest interface residue ${model.nearestInterfaceGap} away in sequence`
                        : "None"}
                    </td>
                    <td className="mlt-num">{model.variantContacts.length}<span className="mlt-unit">of {model.contactsTotal}</span></td>
                    <td className="mlt-status">
                      <span className="ev-tier" data-tone={model.variantContacts.length ? "neutral" : "muted"}>
                        {model.variantContacts.length ? "At interface" : "No contact"}
                      </span>
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <th scope="row" className="mlt-subject">
                    <span className="mlt-subject__name">Complex model</span>
                    <span className="mlt-subject__note">ipTM, pTM and contacts</span>
                  </th>
                  <StateCell label={model.stateLabel} reason={model.reason} />
                </tr>
              )}
            </tbody>

            <tbody data-group="solved">
              <tr className="mlt-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="mlt-group__inner">
                    <span className="mlt-group__title">Solved structures</span>
                    <span className="mlt-group__meta">PDBe-KB interface residues, UniProt numbering</span>
                  </span>
                </th>
              </tr>
              {exp.state === "ok" ? (
                exp.partners.map(p => (
                  <tr key={p.accession} data-rule-input={p.variantAtInterface ? "" : undefined}>
                    <th scope="row" className="mlt-subject">
                      <span className="mlt-subject__name">{p.label}</span>
                      <span className="mlt-subject__note mlt-mono">{p.accession}{p.homomeric ? " · same protein" : ""}</span>
                    </th>
                    <td className="mlt-reason">
                      {p.pdbEntries.length ? `${p.pdbEntries.length} PDB entr${p.pdbEntries.length === 1 ? "y" : "ies"}: ${p.pdbEntries.slice(0, 4).map(e => e.toUpperCase()).join(", ")}${p.pdbEntries.length > 4 ? "…" : ""}` : "PDB entries not listed"}
                    </td>
                    <td className="mlt-num">{p.residues.length}<span className="mlt-unit">residues</span></td>
                    <td className="mlt-status">
                      <span className="ev-tier" data-tone={p.variantAtInterface ? "neutral" : "muted"}>
                        {p.variantAtInterface ? `${ev.residueLabel} included` : "Not included"}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <th scope="row" className="mlt-subject">
                    <span className="mlt-subject__name">Interfaces in the PDB</span>
                    <span className="mlt-subject__note">observed, not predicted</span>
                  </th>
                  <StateCell label={exp.stateLabel} reason={exp.reason} />
                </tr>
              )}
            </tbody>
          </table>
          <div className="mlt-foot">
            <span>Nothing on this tab changes the classification.</span>
            <span>ipTM marks are AlphaFold-Multimer&apos;s guidance; Boltz-2 has none of its own.</span>
          </div>
        </div>
      </section>

      {/* ── 4. Contacts the residue makes ─────────────────────────────────────────────────── */}
      {model.state === "built" && (
        <section className="mlt-section" aria-labelledby="mlt-contacts-title">
          <h2 className="eyebrow" id="mlt-contacts-title">
            <Waypoints className="w-3.5 h-3.5" />
            Contacts made by {ev.residueLabel}
          </h2>
          <div className="mlt-card">
            {model.variantContacts.length ? (
              <table className="mlt-table mlt-table--compact" data-testid="variant-contacts">
                <thead>
                  <tr>
                    <th scope="col">Variant chain</th>
                    <th scope="col">Partner residue</th>
                    <th scope="col" className="mlt-num">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {model.variantContacts.map((c, i) => {
                    // resA is on chain A (the variant's). In a homomer the variant's position can also be
                    // resB: a wild-type copy of the same residue touching chain A.
                    const onA = c.resA === ev.position;
                    return (
                      <tr key={i}>
                        <td className="mlt-mono mlt-ink">A · {onA ? ev.residueLabel : c.resA}</td>
                        <td className="mlt-mono mlt-ink">{onA ? `${partnerChain} · ${c.resB}` : `${partnerChain} · ${ev.residueLabel} (wild type)`}</td>
                        <td className="mlt-num">{c.distance.toFixed(1)} Å</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mlt-empty">
                <strong>No contact.</strong> {ev.residueLabel} is not within the provider&apos;s contact distance of any other chain in this model.
              </p>
            )}
            <div className="mlt-foot">
              <span><span className="mlt-mono mlt-ink">{model.contactsTotal}</span> interface contacts in the model</span>
              <span>Variant model only; no wild-type complex is compared, so no contact is reported as lost.</span>
              {pdb && (
                <button
                  type="button"
                  className="mlt-link"
                  onClick={() => downloadModel(pdb, `${ev.gene}_${(result.metadata?.variant ?? "variant").replace(/[^A-Za-z0-9]+/g, "")}_complex.pdb`)}
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  Download model
                </button>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default MultimersTab;
