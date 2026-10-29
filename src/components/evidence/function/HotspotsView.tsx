import React, { useMemo, useState } from "react";
import { Box, ExternalLink, Flame } from "lucide-react";
import { HOTSPOT_GRADE_LABEL, type HotspotEvidence, type HotspotRung, type RungKey } from "../../../shared/hotspotEvidence";
import { residueFocus, type ResidueFocus } from "../../../shared/residueFocus";
import { safeExternalHref } from "../../../shared/externalLink";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { useEvidenceWorkspace } from "../EvidenceWorkspace";
import { Prose } from "../../ui/Prose";
import { HotspotsRetry, type HotspotsRead } from "./HotspotsRetry";
import { RSA_UNIT_NOTE } from "../../../shared/hotspotEvidence";

/**
 * Hotspots — "is this residue in a germline mutational hot spot, and by whose definition?"
 *
 *   1. The finding: how many definitions place the residue inside a region, and the PM1 boundary.
 *   2. The map: ClinVar P/LP above the axis, gnomAD missense below, one lane per definition, the
 *      variant ruled through all of them. Counts only; no window is drawn that a source did not define.
 *   3. The ladder: one row per definition, its grade first, so an expert rule is never read at the
 *      weight of a statistic.
 *   4. The residues: every ClinVar P/LP residue, nearest in 3D first, each one click from the viewer.
 */

const RUNG_ORDER: RungKey[] = ["cspec", "regional", "per-published", "per-rerun", "spatial", "distribution"];
const LANE_LABEL: Partial<Record<RungKey, string>> = {
  cspec: "Expert panel",
  regional: "PP2 band",
  "per-published": "Published PER",
  "per-rerun": "PER re-run",
};
/** Full names for the map's narrow label column (shown in full as the label's title). */
const LANE_TITLE: Partial<Record<RungKey, string>> = {
  regional: "Regional missense O/E in a calibrated PP2 band (Chao et al.)",
  "per-published": "Published pathogenic-enriched region (Pérez-Palma et al. 2020)",
  "per-rerun": "Pathogenic-enriched region, the published test re-run on current data (not validated)",
};
const STATE_WORD: Record<HotspotRung["state"], string> = {
  read: "Read",
  none: "No region",
  "not-shown": "Not shown",
  failed: "Provider error",
  loading: "Running",
};
const ROWS_DEFAULT = 12;
/** Partners listed per residue before "+N more"; a hub residue would otherwise make one row a column tall. */
const INTERFACES_SHOWN = 3;

export function HotspotsView({ ev, onShow3d, read = null }: {
  ev: HotspotEvidence;
  /** Select a residue (with companions) and open the 3D viewer; null when there is no viewer. */
  onShow3d: ((index: number, focus: ResidueFocus | null) => void) | null;
  /** What to re-read when the read failed or came back incomplete; null offers no retry. */
  read?: HotspotsRead | null;
}) {
  const workspace = useEvidenceWorkspace('function');
  const [localAll, setLocalAll] = useState(false);
  // The row disclosure is a display choice like the expanded rows beside it: it survives a view switch
  // whenever the tab runs inside the workspace.
  const allRows = workspace.enabled ? workspace.hotspotAllRows === true : localAll;
  const setAllRows = (v: boolean) => { setLocalAll(v); workspace.setOptions({ hotspotAllRows: v }); };
  const rungs = useMemo(() => RUNG_ORDER.map((k) => ev.rungs.find((r) => r.key === k)).filter((r): r is HotspotRung => !!r), [ev.rungs]);

  if (ev.state !== "ready") {
    return (
      <section className="fnd-card hsp" aria-labelledby="hsp-title" data-testid="hotspots-view">
        <Head />
        <p className="hsp-state" role="status">{ev.state === "loading" ? "Reading expert rules, regional constraint, published regions and the 3D model…" : `Provider error: ${ev.failure}`}</p>
        {ev.state === "failed" && read && <div className="hsp-state-action"><HotspotsRetry read={read} /></div>}
      </section>
    );
  }

  const plpResidues = ev.rows.map((r) => r.residue);
  const canShow3d = !!onShow3d && !!ev.model;
  // Build the selection first and gate the control on it. residueFocus drops the queried residue itself
  // and returns null above MAX_FOCUS_COMPANIONS; a button that still rendered would draw one residue and
  // look like it had drawn all of them.
  const allFocus = canShow3d && plpResidues.length ? residueFocus(ev.residue, plpResidues, "") : null;
  const showAll = canShow3d && allFocus
    ? () => onShow3d!(ev.residue, { companions: allFocus.companions, label: `ClinVar P/LP missense residues, germline (${allFocus.companions.length})` })
    : null;
  const tooManyToDraw = canShow3d && !allFocus && ev.rows.length > 1;
  const rows = allRows ? ev.rows : ev.rows.slice(0, ROWS_DEFAULT);
  // A source that failed is repairable by reading again (a degraded answer is not cached server-side).
  const failedRungs = ev.rungs.filter((r) => r.state === "failed");
  const incomplete = failedRungs.length ? `${failedRungs.length} source${failedRungs.length === 1 ? "" : "s"} (${failedRungs.map((r) => r.name.toLowerCase()).join(", ")})` : null;
  const cols = ev.columns;
  const none = (c: { reason: string | null }) => c.reason ?? "Not read.";

  return (
    <section className="fnd-card hsp" aria-labelledby="hsp-title" data-testid="hotspots-view">
      <Head />
      <div className="hsp-finding">
        <Prose data-testid="hotspots-finding">
          <strong>{ev.finding.lead}</strong>
          {ev.finding.rest ? ` ${ev.finding.rest}` : ""}
        </Prose>
        <p className="hsp-pm1" data-testid="hotspots-pm1">{ev.pm1Note}</p>
        {incomplete && read && (
          <div className="hsp-state-action" data-testid="hotspots-incomplete">
            <span>{incomplete} did not answer.</span> <HotspotsRetry read={read} label="Read again" />
          </div>
        )}
      </div>

      <HotspotMap ev={ev} rungs={rungs} />

      <ol className="hsp-rungs" aria-label="Hot-spot definitions, strongest grade first">
        {rungs.map((r) => (
          <li key={r.key} className="hsp-rung" data-state={r.state} data-grade={r.grade} data-testid={`hotspot-rung-${r.key}`}>
            <div className="hsp-rung__head">
              <span className="hsp-grade" data-grade={r.grade}>{HOTSPOT_GRADE_LABEL[r.grade]}</span>
              <h3 className="hsp-rung__name">{r.name}</h3>
              {r.atVariant && <span className="hsp-at" data-at={r.atVariant}>{r.atVariant === "inside" ? `${ev.residueLabel} inside` : `${ev.residueLabel} outside`}</span>}
              <span className="hsp-state-word" data-state={r.state}>{STATE_WORD[r.state]}</span>
            </div>
            <p className="hsp-rung__headline">{r.headline}</p>
            {(r.details.length > 0 || r.source.url) && (
              <details className="hsp-rung__more">
                <summary>Method, coverage and source</summary>
                <ul>{r.details.map((d) => <li key={d}>{d}</li>)}</ul>
                <div className="hsp-rung__links">
                  {r.source.url && safeExternalHref(r.source.url) && (
                    <a href={safeExternalHref(r.source.url)!} target="_blank" rel="noreferrer">
                      {r.source.label} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                  <ResearchGuideButton topic={r.explain} label={`How to read: ${r.name}`} className="rgd-trigger hsp-guide" />
                </div>
              </details>
            )}
          </li>
        ))}
      </ol>

      <div className="hsp-residues">
        <div className="hsp-residues__bar">
          <h3 className="eyebrow">ClinVar P/LP residues · {ev.rows.length}</h3>
          <span className="hsp-residues__frame">{ev.model ? `3D distances: Cα–Cα on ${ev.model.entryId}${ev.model.version ? ` ${ev.model.version}` : ""}` : ev.modelNote ?? "No model: sequence distances only"}</span>
          <span className="hsp-residues__sort">{ev.model ? "Nearest in 3D first" : "Nearest in sequence first"}</span>
          {showAll && (
            <button type="button" className="fnd-button hsp-all3d" onClick={showAll} data-testid="hotspots-show-all-3d">
              <Box className="w-3.5 h-3.5" aria-hidden="true" /> Show all in 3D
            </button>
          )}
          {tooManyToDraw && (
            <span className="hsp-all3d__note">Too many to draw at once ({ev.rows.length}); pick residues from the table.</span>
          )}
        </div>
        {ev.rows.length ? (
          <div className="fnd-table-wrap hsp-table-wrap">
          <table className="fnd-table hsp-table" data-testid="hotspots-table">
            <thead>
              <tr>
                <th scope="col">Residue</th>
                <th scope="col" className="fnd-num">P/LP<span className="sr-only"> missense variants</span></th>
                <th scope="col" className="fnd-num" title="Distinct gnomAD v4 missense variants at the residue">gnomAD<span className="sr-only"> missense variants</span></th>
                {/* Without the model there is no 3D at all, and the sequence ordering is "nearest
                    first" — by absolute distance, so "+3, −5" and not ascending. */}
                <th scope="col" aria-sort={ev.model ? undefined : "other"} className="fnd-num" title="Residues along the sequence from the variant">Sequence<span className="sr-only"> distance</span></th>
                <th scope="col" aria-sort={ev.model ? "ascending" : undefined} className="fnd-num" title="Cα–Cα distance on the model, Å">3D<span className="sr-only"> C-alpha distance in angstroms</span></th>
                <th scope="col" className="fnd-num" title="AlphaFold pLDDT at the residue">pLDDT<span className="sr-only"> confidence</span></th>
                <th scope="col" className="fnd-num" title={cols.rsa.state === "ok" ? RSA_UNIT_NOTE : `Not measured: ${none(cols.rsa)}`}>RSA<span className="sr-only"> relative solvent accessibility, percent of the Tien 2013 maximum, on the model</span></th>
                <th scope="col" className="hsp-col-text" title={cols.sites.state === "ok" ? "UniProt sites and modifications at the residue, with their evidence level" : `Not read: ${none(cols.sites)}`}>Site</th>
                <th scope="col" className="hsp-col-text" title={cols.interface.state === "ok" ? "Native solved interfaces (PDBe-KB) that place the residue at the interface: structures with the residue at it over structures showing the pair" : `Not read: ${none(cols.interface)}`}>Interface</th>
                <th scope="col" className="fnd-num" title="PathProx score, shown only when the 3D clustering gate passed">PathProx<span className="sr-only"> score</span></th>
                <th scope="col">In regions</th>
                <th scope="col"><span className="sr-only">Show in 3D</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-here={r.residue === ev.residue || undefined} data-testid="hotspot-row">
                  <th scope="row" className="fnd-mono" title={r.changes.join(", ")}>{r.label}</th>
                  <td className="fnd-num">{r.plp}{r.maxStars !== null ? <span className="hsp-stars" title="Best ClinVar review status (gold stars)"> · {r.maxStars}★</span> : null}</td>
                  <td className="fnd-num">{r.gnomad === null ? "—" : r.gnomad}</td>
                  <td className="fnd-num">{r.sequenceDistance === 0 ? "0" : r.sequenceDistance > 0 ? `+${r.sequenceDistance}` : r.sequenceDistance}</td>
                  <td className="fnd-num">{r.residue === ev.residue ? "here" : r.distanceA === null ? "—" : `${r.distanceA.toFixed(1)} Å`}</td>
                  <td className="fnd-num">{r.plddt === null ? "—" : r.plddt.toFixed(0)}</td>
                  <td className="fnd-num" title={cols.rsa.state === "ok" ? undefined : none(cols.rsa)}>{r.rsa === null ? "—" : `${Math.round(r.rsa * 100)}%`}</td>
                  <td className="hsp-in hsp-col-text" title={cols.sites.state === "ok" ? undefined : none(cols.sites)}>
                    {cols.sites.state !== "ok" ? "—" : r.sites.length ? r.sites.map((x) => <span key={x.name} className="hsp-site">{x.name}<small> · {x.evidence}</small></span>) : "None"}
                  </td>
                  <td className="hsp-in hsp-col-text" title={cols.interface.state === "ok" ? undefined : none(cols.interface)}>
                    {cols.interface.state !== "ok" ? "—" : r.interfaceSupport.length
                      ? <>
                          {r.interfaceSupport.slice(0, INTERFACES_SHOWN).map((x) => <span key={x.label} className="hsp-site">{x.label}<small> · {x.k}/{x.n}</small></span>)}
                          {r.interfaceSupport.length > INTERFACES_SHOWN && <span className="hsp-site"><small>+{r.interfaceSupport.length - INTERFACES_SHOWN} more</small></span>}
                        </>
                      : "None"}
                  </td>
                  <td className="fnd-num">{r.pathprox === null ? "—" : `${r.pathprox >= 0 ? "+" : ""}${r.pathprox.toFixed(2)}`}</td>
                  <td className="hsp-in">{r.inRegions.length ? r.inRegions.map((k) => LANE_LABEL[k] ?? k).join(", ") : "—"}</td>
                  <td>
                    {canShow3d && (
                      <button type="button" className="hsp-row3d" title={`Show ${r.label} in the 3D viewer`} onClick={() => onShow3d!(r.residue, residueFocus(r.residue, [ev.residue], `${r.label} with the variant residue ${ev.residueLabel}`))} aria-label={`Show ${r.label} in 3D`}>
                        <Box className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="hsp-state">{ev.distribution?.status === "ok" ? "ClinVar lists no germline P/LP missense variant in this protein." : "ClinVar could not be read, so the absence of P/LP residues is not established."}</p>
        )}
        {ev.rows.length > ROWS_DEFAULT && (
          <button type="button" className="fnd-more__btn hsp-more" aria-expanded={allRows} onClick={() => setAllRows(!allRows)}>
            {allRows ? `Show the ${ROWS_DEFAULT} nearest` : `Show all ${ev.rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}

function Head() {
  return (
    <div className="hsp-head">
      <h2 className="eyebrow" id="hsp-title"><Flame className="w-3.5 h-3.5" aria-hidden="true" /> Germline hot spots</h2>
      <ResearchGuideButton topic="hotspots" label="How to read hot spots" />
    </div>
  );
}

/** The aligned map: HTML with percentage positions (crisp at any width), counts drawn as bar height. */
function HotspotMap({ ev, rungs }: { ev: HotspotEvidence; rungs: HotspotRung[] }) {
  const d = ev.distribution;
  const L = Math.max(ev.length, ev.residue, 1);
  const pct = (r: number) => ((r - 1) / Math.max(1, L - 1)) * 100;
  const w = Math.max(100 / L, 0.15);
  const maxPlp = Math.max(1, ...(d?.plp.map((p) => p.n) ?? []));
  const maxGn = Math.max(1, ...(d?.gnomad.map((g) => g.variants) ?? []));
  const lanes = rungs.filter((r) => LANE_LABEL[r.key] && r.state === "read" && r.bands.length);
  const spatial = rungs.find((r) => r.key === "spatial" && r.state === "read");
  const scores = spatial ? ev.rows : [];
  // The density shape is the figure's claim, and its bars are aria-hidden with mouse-only titles. A screen
  // reader gets the peaks in words; the totals already appear on the distribution rung.
  const peaks = (rows: { pos: number; n: number }[] | undefined, unit: string) =>
    [...(rows ?? [])].sort((a, b) => b.n - a.n).slice(0, 5).map((p) => `${p.pos} (${p.n} ${unit})`).join(", ");
  const plpPeaks = peaks(d?.plp, "P/LP");
  const gnPeaks = peaks(d?.gnomad.map((g) => ({ pos: g.pos, n: g.variants })), "gnomAD");
  return (
    <figure className="hsp-map" aria-label={`Germline variants along ${L} residues with hot-spot definitions; the variant at ${ev.residue}`}>
      <div className="hsp-map__plot">
        <div className="hsp-map__variant" style={{ left: `calc(var(--hsp-label) + (100% - var(--hsp-label)) * ${pct(ev.residue) / 100})` }}><span>{ev.residueLabel}</span></div>
        <div className="hsp-map__row hsp-map__row--up" aria-hidden="true">
          <span className="hsp-map__label" title="ClinVar P/LP missense per residue (germline)">ClinVar P/LP</span>
          <div className="hsp-map__lane">
            {d?.plp.map((p) => <i key={p.pos} style={{ left: `${pct(p.pos)}%`, width: `${w}%`, height: `${(p.n / maxPlp) * 100}%` }} title={`${p.pos}: ${p.n} P/LP`} />)}
          </div>
        </div>
        <div className="hsp-map__row hsp-map__row--down" aria-hidden="true">
          <span className="hsp-map__label" title="gnomAD v4 missense variants per residue">gnomAD</span>
          <div className="hsp-map__lane">
            {d?.gnomad.map((g) => <i key={g.pos} style={{ left: `${pct(g.pos)}%`, width: `${w}%`, height: `${(g.variants / maxGn) * 100}%` }} title={`${g.pos}: ${g.variants} gnomAD missense`} />)}
          </div>
        </div>
        {lanes.map((r) => (
          <div key={r.key} className="hsp-map__row" data-lane={r.key}>
            <span className="hsp-map__label" title={LANE_TITLE[r.key] ?? LANE_LABEL[r.key]}>{LANE_LABEL[r.key]}</span>
            <div className="hsp-map__lane" role="img" aria-label={`${LANE_LABEL[r.key]} (${HOTSPOT_GRADE_LABEL[r.grade]}${r.grade === "method-unvalidated" ? ", not validated here" : ""}): ${r.bands.map((b) => `${b.start}–${b.end}`).join(", ")}`}>
              {r.bands.map((b) => <span key={`${b.start}-${b.end}`} className="hsp-map__band" data-hit={b.hit || undefined} style={{ left: `${pct(b.start)}%`, width: `${Math.max(pct(b.end + 1) - pct(b.start), w)}%` }} title={`${b.start}–${b.end} · ${b.label}`} />)}
            </div>
          </div>
        ))}
        {spatial && (
          <div className="hsp-map__row" data-lane="spatial">
            <span className="hsp-map__label" title="PathProx score at ClinVar P/LP residues; above the line favours pathogenic neighbours">PathProx</span>
            <div className="hsp-map__lane hsp-map__lane--zero" role="img" aria-label="PathProx scores at ClinVar P/LP residues; above the line favours pathogenic neighbours">
              {scores.filter((s) => s.pathprox !== null).map((s) => (
                <i key={s.residue} data-sign={s.pathprox! >= 0 ? "pos" : "neg"} style={{ left: `${pct(s.residue)}%`, width: `${w}%`, height: `${Math.min(50, Math.abs(s.pathprox!) * 50)}%` }} title={`${s.label}: PathProx ${s.pathprox!.toFixed(2)}`} />
              ))}
            </div>
          </div>
        )}
        <div className="hsp-map__axis" aria-hidden="true"><span>1</span><span>{L}</span></div>
      </div>
      <figcaption className="hsp-map__caption">Bar height is the count at each residue, scaled to this protein's maximum. Lanes show only regions a source defined; no window is drawn by this app.</figcaption>
      <p className="sr-only">{plpPeaks ? `ClinVar P/LP density is highest at residues ${plpPeaks}.` : "No ClinVar P/LP residue is plotted."} {gnPeaks ? `gnomAD missense density is highest at residues ${gnPeaks}.` : "No gnomAD missense residue is plotted."}</p>
    </figure>
  );
}
