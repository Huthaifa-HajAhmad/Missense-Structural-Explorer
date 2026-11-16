import React from "react";
import type { LandscapeContext } from "../../shared/contracts";
import { clinvarIsQuery } from "../../shared/landscapeEvidence";
import { isRegionFeatureType, regionsAt, REGION_KIND_LABEL, type RegionFeature } from "../../shared/residueRegions";

interface ContextRow {
  label: string;
  value: string;
  source?: string;
  records?: string[];
  recordsLabel?: string;
}


export function LandscapeLocalContext({ context: ctx, features, position, target }: {
  context: LandscapeContext | null;
  features?: RegionFeature[];
  position: number;
  target: { pos: number | null; mut: string };
}) {
  const hits = regionsAt(features?.filter(f => isRegionFeatureType(f.type)), position);
  const annotations: ContextRow = { label: "UniProt · residue", value: !features ? "Domain annotation not loaded" : hits.length
    ? hits.map(h => `${REGION_KIND_LABEL[h.kind]}: ${h.label} (${h.start}–${h.end})`).join("; ")
    : "Outside displayed UniProt domains and regions; this does not establish disorder or lack of function." };
  const rows = ctx ? contextRows(ctx, position, target) : [{ label: "Local context", value: "ClinVar, gnomAD and regional context not loaded" }];
  return <section aria-label="Local evidence for selected residue" className="lsr-kv">
    {[annotations, ...rows].map(r => <div key={r.label} className="lsr-kv__row">
      <span className="lsr-kv__label">{r.label}</span><div className="lsr-kv__value">
        <span>{r.value}</span>
        {!!r.records?.length && <details className="lsr-context-source"><summary>{r.recordsLabel}</summary>
          <ul>{r.records.map((record, index) => <li key={index}>{record}</li>)}</ul></details>}
        {r.source && <details className="lsr-context-source"><summary>Source details</summary><p>{r.source}</p>
          <p>O/E is the observed-to-expected ratio for missense variation in this region, not a score for this substitution.</p>
          <p>This protein interval is exploratory context. The header reads the queried variant at its verified genomic locus and transcript; it can be unavailable while this interval is shown. No header evidence is assigned from this track.</p>
        </details>}
      </div>
    </div>)}
  </section>;
}

function contextRows(ctx: LandscapeContext, position: number, target: { pos: number | null; mut: string }): ContextRow[] {
    const out: ContextRow[] = [];
    const cv = ctx.clinvar?.filter((c) => c.pos === position) ?? [];
    if (ctx.clinvar) {
      const own = cv.filter(c => clinvarIsQuery(c, target.pos ? { pos: target.pos, mut: target.mut } : null));
      const others = cv.filter(c => !own.includes(c));
      out.push({
        label: "ClinVar",
        value: own.length
          ? own.map(c => `${c.hgvsp} ${c.significance} (queried)`).join("; ")
          : cv.length ? `${cv.length} missense record${cv.length === 1 ? "" : "s"} at this residue` : "no missense here",
        records: others.map(c => `${c.hgvsp} ${c.significance}`),
        // "other" only makes sense when the queried record is already on screen.
        recordsLabel: `${others.length}${own.length ? " other" : ""} substitution record${others.length === 1 ? "" : "s"}`
      });
    }
    const gn = ctx.gnomad?.find((x) => x.pos === position);
    if (ctx.gnomad) out.push({ label: "gnomAD", value: gn ? `${gn.variants} missense, max AC ${gn.maxAc}` : "no missense here" });
    const region = ctx.regions?.find((r) => position >= r.start && position <= r.end);
    if (ctx.regions) out.push({
      label: "Regional O/E",
      value: region ? `${region.oe ?? "Not reported"} across residues ${region.start}–${region.end}` : "Outside released regional intervals; this does not establish tolerance",
      source: region ? `${ctx.regionsBasis}${region.pValue !== null ? `; p ${region.pValue}` : ""}` : undefined
    });

  if (ctx.clinvar === null) out.push({ label: "ClinVar", value: "Not loaded" });
  if (ctx.gnomad === null) out.push({ label: "gnomAD", value: "Not loaded" });
  if (ctx.regions === null) out.push({ label: "Regional O/E", value: ctx.regionsStatus === "withheld-mapping"
    ? "Withheld: transcript-to-protein mapping not verified" : "Not loaded" });
  return out;
}

export function LandscapeDomainNavigation({ features, onPick }: {
  features?: RegionFeature[];
  onPick: (pos: number) => void;
}) {
  const domains = features?.filter(f => isRegionFeatureType(f.type)) ?? [];
  if (!domains.length) return null;
  return <details className="lsr-sources"><summary>Go to domain or region · {domains.length}</summary>
    <div className="lsr-domain-navigation">{domains.map((d, i) => <button type="button" key={i} onClick={() => onPick(d.start)}>
      <span>{d.description || d.type}</span><span>{d.start}–{d.end}</span>
    </button>)}</div>
  </details>;
}
