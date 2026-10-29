import React, { useMemo } from "react";
import { BookOpen, Database, GitBranch, Layers, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { buildFunctionEvidence } from "../../shared/functionEvidence";
import { EVIDENCE_LEVEL_CODES, EVIDENCE_LEVEL_LABEL, PM1_EVIDENCE_LEVELS } from "../../shared/functionalSites";
import { functionEvidenceInputFrom } from "../evidence/function/functionInput";
import { functionReadings } from '../../shared/molecularWorkspace';
import { EvidenceReadingInspector } from './EvidenceReadingInspector';
import { buildHotspotEvidence, HOTSPOT_GRADE_LABEL, type HotspotContext } from "../../shared/hotspotEvidence";
import { hotspotInputFrom } from "../../shared/hotspotInput";
import { hotspotsSlot } from "../../shared/evidenceKeys";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import type { ContextLoad } from "../../stores/slices/evidenceContextSlice";
import { useEvidenceWorkspace } from "../evidence/EvidenceWorkspace";

/**
 * FunctionRail — the Evidence Lineage inspector for the Functional domains tab.
 *
 * The column says WHAT is annotated and whether PM1 is met; the rail says HOW: a five-step trace
 * (numbering → record → coverage → PM1 test → engine), the evidence levels with the ones PM1 counts
 * marked, the method caveats, the family-level InterPro matches the schematic does not draw, and the
 * sources with the versions the payload names.
 *
 * It replaced a colour legend for a track that no longer exists, "Inspection & Zoom Controls" help
 * text, and hard-coded "Swiss-Prot Verified" / "InterPro / Pfam" provenance lines.
 *
 * Built from the same `buildFunctionEvidence` object as the column.
 */

function Step({ n, warn, children }: { n: number; warn?: boolean; children: React.ReactNode }) {
  return (
    <li className="fnd-step" data-state={warn ? "warn" : "done"}>
      <span className="fnd-step__n" aria-hidden="true">{n}</span>
      <div className="fnd-step__value">{children}</div>
    </li>
  );
}

export function FunctionRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const ev = useMemo(() => buildFunctionEvidence(functionEvidenceInputFrom(analysisResult)), [analysisResult]);
  const readings = useMemo(() => functionReadings(ev), [ev]);
  // Natural variants are left out: ECO:0000269 on a variant is a publication reporting it, not an observation
  // of a site, and listing it as "Experimental, counts for PM1" implied the variant rows were evidence for PM1.
  const levelsHere = useMemo(() => new Set(ev.rows.filter((r) => r.evidence !== "match" && r.group !== "variants").map((r) => r.evidence)), [ev]);
  // The Hotspots view's trace: each definition with its grade and source, read from the same slot the view reads.
  const workspace = useEvidenceWorkspace("function");
  // The loader forms its slot from the result's gene or the store's (useEvidenceContext) — the rail uses
  // the same rule, or a fallback identity would leave it watching a slot nobody fills.
  const storeGene = useVariantAnalysisStore((st) => st.gene);
  const hotspotGene = analysisResult.metadata?.gene || storeGene || null;
  const slot = hotspotsSlot(hotspotGene, analysisResult.metadata?.uniprotId, analysisResult.transcriptId);
  const hotspotLoad = useVariantAnalysisStore((st) => st.extraContexts[slot]) as ContextLoad<HotspotContext> | undefined;
  const hotspots = useMemo(() => {
    if (workspace.enabled && workspace.view !== "hotspots") return null;
    const context = hotspotLoad?.status === "ready" ? hotspotLoad.data : null;
    // Same inputs and the same load state as the view. The rail used to rebuild with `loadState: "ready"`,
    // so beside a failed view it rendered nothing and beside a loading one it claimed a finished answer.
    return {
      context,
      ev: buildHotspotEvidence(hotspotInputFrom(analysisResult, ev, hotspotLoad, functionEvidenceInputFrom(analysisResult).engineCriteria)),
    };
  }, [workspace.enabled, workspace.view, hotspotLoad, ev, analysisResult]);

  return (
    <div className="fnd-rail" data-testid="function-rail">
      <EvidenceReadingInspector tab="function" rows={readings} />
      {/* In the Hotspots view the rail leads with that view's trace; the PM1 trace follows. */}
      {hotspots && (
        <section className="fnd-rsec" aria-labelledby="fnd-rail-hotspots" data-testid="function-rail-hotspots">
          <h3 className="eyebrow" id="fnd-rail-hotspots">
            <GitBranch className="w-3.5 h-3.5" />
            Hot-spot definitions
          </h3>
          <ol className="fnd-steps">
            {hotspots.ev.rungs.map((r, i) => (
              <Step key={r.key} n={i + 1} warn={r.state === "failed"}>
                <span><strong>{HOTSPOT_GRADE_LABEL[r.grade]}</strong> · {r.name}: {r.headline}</span>
              </Step>
            ))}
            <Step n={hotspots.ev.rungs.length + 1}>
              <span>{hotspots.ev.pm1Note}</span>
            </Step>
          </ol>
          {hotspots.context ? (
          <dl className="fnd-kv">
            <div><dt>Variants</dt><dd>{hotspots.context.clinvarSource}{hotspots.context.transcript ? `, ${hotspots.context.transcript}` : ""}</dd></div>
            <div><dt>Numbering</dt><dd>{hotspots.context.numbering.status === "verified" ? `Verified: ${hotspots.context.numbering.checked} HGVSp reference residues match the model` : hotspots.context.numbering.status === "mismatch" ? `${hotspots.context.numbering.mismatches} of ${hotspots.context.numbering.checked} reference residues differ from the model` : "Not checked (no model)"}</dd></div>
            {hotspots.context.spatial.model && <div><dt>Model</dt><dd className="fnd-mono"><a href={hotspots.context.spatial.model.url} target="_blank" rel="noopener noreferrer">{hotspots.context.spatial.model.entryId}{hotspots.context.spatial.model.version ? ` ${hotspots.context.spatial.model.version}` : ""}<span className="sr-only"> (opens in a new tab)</span></a></dd></div>}
            {hotspots.context.cspec.retrievedAt && <div><dt>ClinGen CSpec</dt><dd>Read {hotspots.context.cspec.retrievedAt.slice(0, 10)}</dd></div>}
            <div><dt>Published PER</dt><dd>Pérez-Palma et al. 2020; data of 2019 (dlal-group/PERs)</dd></div>
            <div><dt>3D benchmark</dt><dd>doc/HOTSPOT_3D_DECISION.md (pre-registered)</dd></div>
          </dl>
          ) : (
            <p className="fnd-note" role="status">{hotspots.ev.state === "loading" ? "Reading the hot-spot sources…" : `The sources did not answer: ${hotspots.ev.failure}`}</p>
          )}
        </section>
      )}

      <section className="fnd-rsec" aria-labelledby="fnd-rail-trace">
        <h3 className="eyebrow" id="fnd-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="fnd-steps" data-testid="function-rule-trace">
          {ev.trace.map((s, i) => (
            <Step key={i} n={i + 1} warn={s.warn}>
              {i === 1 && s.strong ? (
                <span>
                  <strong>{s.strong}</strong> {s.text}
                </span>
              ) : (
                <span>
                  {s.text}
                  {s.strong ? <strong>{s.strong}</strong> : null}
                </span>
              )}
            </Step>
          ))}
        </ol>
      </section>

      <section className="fnd-rsec" aria-labelledby="fnd-rail-levels">
        <h3 className="eyebrow" id="fnd-rail-levels">
          <Ruler className="w-3.5 h-3.5" />
          Evidence levels · in this entry
        </h3>
        <ul className="fnd-cuts" data-testid="evidence-levels">
          {EVIDENCE_LEVEL_CODES.filter((l) => levelsHere.size === 0 || levelsHere.has(l.level)).map((l) => (
            <li key={l.level} className="fnd-cut" data-present={levelsHere.has(l.level) || undefined}>
              <span className="fnd-cut__label">{EVIDENCE_LEVEL_LABEL[l.level]}</span>
              <span className="fnd-cut__rule">{l.codes}</span>
              <span className="fnd-cut__here">{PM1_EVIDENCE_LEVELS.has(l.level) ? "counts for PM1" : ""}</span>
            </li>
          ))}
        </ul>
        <p className="fnd-rail__note">A site by similarity is transferred from another protein; sequence analysis is a prediction. Neither is counted as a critical site here.</p>
      </section>

      <section className="fnd-rsec" aria-labelledby="fnd-rail-notes">
        <h3 className="eyebrow" id="fnd-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="fnd-notes">
          <summary>How to read this tab</summary>
          <ul>
            <li>
              PM1 asks for a mutational hot spot or a well-established functional domain without benign variation. Only the site
              reading is tested (active site, binding site, metal binding, disulfide cysteine), and benign variation in the region
              is not checked.
            </li>
            <li>PP3 and PM1 together are capped at Strong (Pejaver 2022). PM1 is withheld when PP3 alone already reaches Strong.</li>
            <li>A disulfide bond covers its two cysteines, not the residues between them.</li>
            <li>
              A natural variant&apos;s evidence is the publication that reports it, not a functional assay (PS3). The count of
              variants near the residue is context: PM1&apos;s hot-spot reading is not tested.
            </li>
            <li>
              InterPro&apos;s entry type decides how a match is drawn: a domain is a box, a conserved-site signature (a PROSITE
              pattern) is a tick, a family or superfamily is listed below and not drawn.
            </li>
            <li>Distances are in sequence, not in space. A residue far away in sequence can still touch a site in the fold.</li>
            <li>
              A family-level match covering most of the protein (an 80% cut) says little about one position and is not counted
              as the residue&apos;s domain.
            </li>
          </ul>
        </details>
      </section>

      {ev.familyMatches.length > 0 && (
        <section className="fnd-rsec" aria-labelledby="fnd-rail-family">
          <h3 className="eyebrow" id="fnd-rail-family">
            <Layers className="w-3.5 h-3.5" />
            Family signatures · not drawn
          </h3>
          <dl className="fnd-kv" data-testid="family-matches">
            {ev.familyMatches.map((m) => (
              <div key={m.key}>
                <dt>
                  {m.source} <span className="fnd-mono">{m.accession}</span>
                </dt>
                <dd className="fnd-mono">{m.segments.map((s) => `${s.start}–${s.end}`).join(", ")}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="fnd-rsec" aria-labelledby="fnd-rail-sources">
        <h3 className="eyebrow" id="fnd-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="fnd-kv">
          {ev.sources.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd className="fnd-mono">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.value}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  s.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export default FunctionRail;
