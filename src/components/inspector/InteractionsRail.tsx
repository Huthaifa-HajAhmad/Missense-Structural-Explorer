import React from "react";
import { BookOpen, Database, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import type { PpiBindingData, PpiBindingShift } from "../../shared/contracts";
import { STRING_CONFIDENCE_BANDS } from "../../shared/thresholds";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { stringConfidenceTier } from "../../shared/thresholds/evaluators";
import { DDMUT_PPI_PERFORMANCE, INTERACTIONS_SOURCES, buildInteractionsEvidence } from "../../shared/interactionsEvidence";

/**
 * InteractionsRail — the Evidence Lineage inspector for the Protein interactions tab.
 *
 * The column says WHAT the partners, sites and binding change are; the rail says HOW they were
 * reached: a trace (curation → sites → solved structures → variant → network → binding → engine),
 * the cut-points actually in play (STRING's published bands; none for ΔΔG_bind), the caveats a
 * curator needs, and the sources the payload names.
 *
 * It replaced three tinted boxes: prose crediting "OpenBind-0" with computing steric clashes and
 * electrostatics for a model that never ran, a STRING tier legend in benign green, a hard-coded
 * "STRING v12.0 · OpenBind-0 Tier 1 · JapanFold" provenance box, and an indigo Tailwind link.
 *
 * Built from the same `buildInteractionsEvidence` object as the column.
 */
export function InteractionsRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const ppi = ((analysisResult as any).ppiBindingData ?? null) as PpiBindingData | null;
  const shift = ((analysisResult as any).ppiBindingShift ?? null) as PpiBindingShift | null;
  const md: any = (analysisResult as any).metadata ?? {};
  const ppiForVariant = ppi && ppi.gene === md.gene && ppi.variant === md.variant ? ppi : null;
  const shiftForVariant = shift && shift.gene === md.gene && shift.variant === md.variant ? shift : null;
  const ev = buildInteractionsEvidence({
    result: analysisResult,
    ppi: ppiForVariant,
    ppiStatus: ppiForVariant ? "ready" : "loading",
    shift: shiftForVariant,
    shiftLoading: false,
  });

  // Which STRING bands this partner set occupies, counted.
  const bandCounts = new Map<string, number>();
  for (const p of ev.partners) {
    const tier = p.string ? stringConfidenceTier(p.string.score) : null;
    if (tier) bandCounts.set(tier, (bandCounts.get(tier) ?? 0) + 1);
  }

  const sources: Array<[string, string]> = [];
  if (ev.uniprotId) sources.push(["Curation", `UniProtKB ${ev.uniprotId} · SUBUNIT, IntAct, sites`]);
  if (ev.sections.pdbe.state === "ok" || ev.sections.pdbe.state === "empty") sources.push(["Solved interfaces", "PDBe-KB"]);
  if (ev.sections.string.state === "ok") sources.push(["Network", "STRING, Homo sapiens (9606)"]);
  if (ev.binding.state === "ok" && ev.binding.wildType) {
    sources.push(["Wild-type model", ev.binding.wildType.provenance]);
    sources.push(["Binding change", ev.binding.predictor]);
  }

  return (
    <div className="itx-rail" data-testid="interactions-rail">
      <section className="itx-rsec" aria-labelledby="itx-rail-trace">
        <h3 className="eyebrow" id="itx-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Trace
        </h3>
        {!ppiForVariant && (
          <p className="itx-rail__note">{ENGINE_STATE_LABELS["no-result"]}: the lookups have not answered for this variant yet.</p>
        )}
        <ol className="itx-steps" data-testid="interactions-trace">
          {ev.trace.map((s, i) => (
            <li key={s.label} className="itx-step" data-state={s.warn ? "warn" : "done"}>
              <span className="itx-step__n" aria-hidden="true">{i + 1}</span>
              <div className="itx-step__body">
                <span className="itx-step__label">{s.label}</span>
                <span className="itx-step__value">
                  {s.value}
                  {s.warn && <span className="itx-step__warn">{s.warn}</span>}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="itx-rsec" aria-labelledby="itx-rail-cuts">
        <h3 className="eyebrow" id="itx-rail-cuts">
          <Ruler className="w-3.5 h-3.5" />
          Cut-points
        </h3>
        <ul className="itx-cuts" data-testid="string-bands">
          {STRING_CONFIDENCE_BANDS.map(band => {
            const n = bandCounts.get(band.id) ?? 0;
            return (
              <li key={band.id} className="itx-cut" data-active={n > 0 || undefined}>
                <span className="itx-cut__rule">≥ {band.min.toFixed(3)}</span>
                <span className="itx-cut__label">STRING {band.label.toLowerCase()}</span>
                {n > 0 && <span className="itx-cut__here">{n} {n === 1 ? "partner" : "partners"}</span>}
              </li>
            );
          })}
          <li className="itx-cut">
            <span className="itx-cut__rule">ΔΔG_bind</span>
            <span className="itx-cut__label">None published</span>
          </li>
        </ul>
        <p className="itx-rail__note">
          STRING's own bands for its combined score. DDMut-PPI reports a continuous value, so no mark is drawn on it.
        </p>
      </section>

      <section className="itx-rsec" aria-labelledby="itx-rail-notes">
        <h3 className="eyebrow" id="itx-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="itx-notes" open>
          <summary>Association is not binding</summary>
          <ul>
            <li>
              STRING's default network is functional: co-expression, shared pathways and text mining raise a score without any
              physical contact. A partner known only from STRING is listed apart from curated binders.
            </li>
          </ul>
        </details>
        <details className="itx-notes">
          <summary>Mapped sites are what curators recorded</summary>
          <ul>
            <li>
              UniProt maps a site when a paper located it ("Interaction with UBA3"). A variant outside every mapped site can
              still touch a partner; solved structures, where they exist, are the direct check.
            </li>
            <li>Contact is not disruption. Whether binding changes is the separate DDMut-PPI estimate.</li>
          </ul>
        </details>
        <details className="itx-notes">
          <summary>ΔΔG_bind needs a wild-type complex</summary>
          <ul>
            <li>
              DDMut-PPI substitutes the residue in a wild-type complex. The Multimer tab's model already carries the variant,
              so the same chains are modelled again, all wild type, with Boltz-2.
            </li>
            <li>Negative is weaker binding, in DDMut-PPI's convention. {DDMUT_PPI_PERFORMANCE}</li>
            <li>A predicted complex, not a solved one: read the value with the wild-type model's ipTM beside it.</li>
          </ul>
        </details>
      </section>

      <section className="itx-rsec" aria-labelledby="itx-rail-sources">
        <h3 className="eyebrow" id="itx-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        {sources.length > 0 && (
          <dl className="itx-kv">
            {sources.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="itx-refs">
          {INTERACTIONS_SOURCES.map(s => (
            <li key={s.citation}>
              {s.citation}{" "}
              {s.doi ? (
                <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer">{s.doi}</a>
              ) : s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer">link</a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
