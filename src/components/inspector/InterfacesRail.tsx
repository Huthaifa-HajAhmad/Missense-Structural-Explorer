import React from "react";
import { BookOpen, Database, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import type { MultimerData, PpiBindingData, PpiBindingShift } from "../../shared/contracts";
import { THRESHOLDS, STRING_CONFIDENCE_BANDS } from "../../shared/thresholds";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import {
  DDMUT_PPI_PERFORMANCE,
  DDMUT_PPI_RMSE,
  INTERFACES_SOURCES,
  IPTM_BAND_LABEL,
  buildInterfacesEvidence,
  isStaleAssembly,
  isStalePpi,
  type IptmBand,
} from "../../shared/interfacesEvidence";
import { useInterfacesLive } from "../evidence/interfaces/interfacesLive";

/**
 * InterfacesRail — the Evidence Lineage inspector for the Interfaces & PPI tab.
 *
 * The column says WHAT the interface, partners and binding change are; the rail says HOW they were
 * reached: one trace (curation → solved structures → variant → model → partners → STRING → binding →
 * engine), the cut-points actually in play (ipTM reading guide, STRING's bands, none for ΔΔG_bind but
 * its error), the caveats a curator needs, and the sources the payloads name, with STRING's release.
 *
 * Built from the same `buildInterfacesEvidence` object as the column, so the two never disagree.
 */
export function InterfacesRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const r = analysisResult as any;
  const md = r.metadata ?? {};
  const live = useInterfacesLive();
  const key = md.gene && md.variant ? `${md.gene}|${md.variant}` : null;
  const liveForVariant = key !== null && live.key === key;

  const ppi = (r.ppiBindingData ?? null) as PpiBindingData | null;
  const shift = (r.ppiBindingShift ?? null) as PpiBindingShift | null;
  const ppiForVariant = ppi && ppi.gene === md.gene && ppi.variant === md.variant ? ppi : null;
  const shiftForVariant = shift && shift.gene === md.gene && shift.variant === md.variant ? shift : null;
  const storedAsm = (r.multimerData ?? null) as MultimerData | null;

  // The tab's `useInterfacesData` publishes the LIVE status it renders from; the rail reads the same
  // source, so it never says "Running" when the tab's data has landed, and never says "Running" for
  // a lookup that failed (a failure is not written to the store). With no live status (rail rendered
  // alone, e.g. in tests) it falls back to the stored result, applying the tab's staleness rules.
  const assemblyStatus = liveForVariant ? live.assemblyStatus : storedAsm && !isStaleAssembly(storedAsm) ? "ready" : "loading";
  const ppiStatus = liveForVariant ? live.ppiStatus : ppiForVariant && !isStalePpi(ppiForVariant) ? "ready" : "loading";
  const ev = buildInterfacesEvidence({
    result: analysisResult,
    assembly: storedAsm,
    assemblyStatus,
    assemblyError: liveForVariant ? live.assemblyError : null,
    modelRequested: liveForVariant ? live.modelRequested : false,
    ppi: ppiForVariant,
    ppiStatus,
    ppiError: liveForVariant ? live.ppiError : null,
    shift: shiftForVariant,
    shiftLoading: liveForVariant ? live.shiftLoading : false,
    shiftError: liveForVariant ? live.shiftError : null,
  });
  const assemblyPending = assemblyStatus === "loading";
  const lookupsPending = ppiStatus === "loading";
  const C = THRESHOLDS.complexConfidence;
  const bands: Array<{ key: IptmBand; rule: string }> = [
    { key: "confident", rule: `> ${C.iptmConfident}` },
    { key: "grey", rule: `${C.iptmLow} to ${C.iptmConfident}` },
    { key: "low", rule: `< ${C.iptmLow}` },
  ];
  const bandCount = new Map(ev.string.bands.map(b => [b.id, b.count]));

  const sources: Array<[string, string]> = [];
  if (ev.uniprotId) sources.push(["Curation", `UniProtKB ${ev.uniprotId} · SUBUNIT, INTERACTION, features`]);
  if (ev.observed.availability.state === "ok" || ev.observed.availability.state === "empty") {
    sources.push(["Solved interfaces", "PDBe-KB"]);
    sources.push(["Entry kinds", ev.observed.fibrilsChecked ? "RCSB PDB keywords, titles and assemblies" : "RCSB PDB not read"]);
  }
  if (ev.sections.intact.state === "ok") sources.push(["Methods and studies", "IntAct (PSICQUIC)"]);
  if (ev.sections.stringPhysical.state === "ok" || ev.sections.stringPhysical.state === "empty") sources.push(["Network", `STRING${ev.string.version ? ` ${ev.string.version}` : ""}, Homo sapiens`]);
  if (ev.model.state === "built" && ev.model.provenance) sources.push(["Complex model", ev.model.provenance]);
  if (ev.binding.state === "ok" && ev.binding.wildType) {
    sources.push(["Wild type", ev.binding.wildType.provenance]);
    sources.push(["Binding change", "DDMut-PPI"]);
  }

  return (
    <div className="ifc-rail" data-testid="interfaces-rail">
      <section className="ifc-rsec" aria-labelledby="ifc-rail-trace">
        <h3 className="eyebrow" id="ifc-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Trace
        </h3>
        {(assemblyPending || lookupsPending) && (
          <p className="ifc-rail__note">
            {ENGINE_STATE_LABELS.running}: {assemblyPending ? "the assembly and solved structures" : "the partner lookups"} are being read for this variant.
          </p>
        )}
        <ol className="ifc-steps" data-testid="interfaces-trace">
          {ev.trace.map((s, i) => (
            <li key={s.label} className="ifc-step" data-state={s.state}>
              <span className="ifc-step__n" aria-hidden="true">{i + 1}</span>
              <div className="ifc-step__body">
                <span className="ifc-step__label">
                  {s.label}
                  {s.state === "pending" && <span className="ifc-step__pending">Reading…</span>}
                </span>
                <span className="ifc-step__value">{s.value}</span>
                {s.sub && <span className="ifc-step__sub">{s.sub}</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="ifc-rsec" aria-labelledby="ifc-rail-cuts">
        <h3 className="eyebrow" id="ifc-rail-cuts">
          <Ruler className="w-3.5 h-3.5" />
          Cut-points
        </h3>
        <p className="ifc-rail__head">ipTM · AlphaFold-Multimer reading guide</p>
        <ul className="ifc-cuts" data-testid="iptm-bands">
          {bands.map(b => {
            const active = ev.model.state === "built" && ev.model.band === b.key;
            return (
              <li key={b.key} className="ifc-cut" data-active={active || undefined}>
                <span className="ifc-cut__rule">{b.rule}</span>
                <span className="ifc-cut__label">{IPTM_BAND_LABEL[b.key]}</span>
                {active && <span className="ifc-cut__here">this model</span>}
              </li>
            );
          })}
        </ul>
        <p className="ifc-rail__head">STRING combined score · physical partners</p>
        <ul className="ifc-cuts" data-testid="string-bands">
          {STRING_CONFIDENCE_BANDS.map(band => {
            const n = bandCount.get(band.label) ?? 0;
            return (
              <li key={band.id} className="ifc-cut" data-active={n > 0 || undefined}>
                <span className="ifc-cut__rule">≥ {band.min.toFixed(3)}</span>
                <span className="ifc-cut__label">{band.label}</span>
                {n > 0 && <span className="ifc-cut__here">{n} {n === 1 ? "partner" : "partners"}</span>}
              </li>
            );
          })}
        </ul>
        <ul className="ifc-cuts">
          <li className="ifc-cut">
            <span className="ifc-cut__rule">ΔΔG_bind</span>
            <span className="ifc-cut__label">None published; error ± {DDMUT_PPI_RMSE} kcal/mol</span>
          </li>
        </ul>
        <p className="ifc-rail__note">
          The ipTM marks are the authors&apos; reading guide, not a calibration; Boltz-2 publishes none of its own. Solved-structure
          support is shown as a fraction and never banded.
        </p>
      </section>

      <section className="ifc-rsec" aria-labelledby="ifc-rail-notes">
        <h3 className="eyebrow" id="ifc-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="ifc-notes" open>
          <summary>Reading an interface</summary>
          <ul>
            <li>
              PDBe-KB lists, for each residue, the solved structures in which it is at the interface. A residue seen in one of eight
              structures is a conformation- or construct-dependent contact; the support is shown, not hidden behind &ldquo;at an interface&rdquo;.
            </li>
            <li>
              Amyloid fibril structures (RCSB keyword &ldquo;protein fibril&rdquo;, or &ldquo;amyloid&rdquo; or &ldquo;fibril&rdquo; in the title) are read apart:
              in a fibril every chain stacks on the next, so most of the core touches another copy. That contact is not the native interface,
              is never the verdict, and is never a wild type for the binding change.
            </li>
            <li>
              Interfaces with fusion or crystallisation tags (maltose-binding protein, T4 lysozyme …), antibodies and nanobodies, and chains
              with no UniProt record are not biological partners and are not counted. A partner from another species is named with it.
            </li>
            <li>Contact is not disruption. Whether binding changes is the separate DDMut-PPI estimate.</li>
          </ul>
        </details>
        <details className="ifc-notes">
          <summary>Partners and association</summary>
          <ul>
            <li>
              UniProt&apos;s &ldquo;experiments&rdquo; count is assay runs, often several versions in one paper. IntAct&apos;s methods and
              studies are shown instead; a pair seen only by two-hybrid in one study is grouped as a binary screen.
            </li>
            <li>
              STRING&apos;s physical sub-network scores evidence that two proteins bind or share a complex; its functional network adds
              co-expression, pathways and text mining. Neither score is a binding strength.
            </li>
            <li>A partner UniProt names as a family (&ldquo;other K-Cl cotransporters&rdquo;) is shown unresolved, never matched to genes by guessing.</li>
          </ul>
        </details>
        <details className="ifc-notes">
          <summary>The complex model and the binding change</summary>
          <ul>
            <li>
              Boltz-2 runs only on request. Chain A carries the variant and every other chain is wild type: for a homomer that is one
              mutant copy, closer to a heterozygous carrier than a homozygous one. ipTM scores all interfaces together.
            </li>
            <li>
              DDMut-PPI substitutes the residue in a wild-type complex. It was trained on experimental structures, so a solved
              complex with the residue at the interface is used first (author numbering), and a Boltz-2 model only when none exists.
            </li>
            <li>Negative is weaker binding, in DDMut-PPI&apos;s convention. {DDMUT_PPI_PERFORMANCE}</li>
          </ul>
        </details>
      </section>

      <section className="ifc-rsec" aria-labelledby="ifc-rail-sources">
        <h3 className="eyebrow" id="ifc-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        {sources.length > 0 && (
          <dl className="ifc-kv">
            {sources.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="ifc-refs">
          {INTERFACES_SOURCES.map(s => (
            <li key={s.citation}>
              {s.citation}{" "}
              <a href={s.doi ? `https://doi.org/${s.doi}` : s.url} target="_blank" rel="noopener noreferrer">
                {s.doi ? `doi:${s.doi}` : "link"}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default InterfacesRail;
