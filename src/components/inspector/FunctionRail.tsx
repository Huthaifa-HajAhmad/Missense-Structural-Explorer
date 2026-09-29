import React from "react";
import { BookOpen, Database, GitBranch, Layers, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { buildFunctionEvidence } from "../../shared/functionEvidence";
import { EVIDENCE_LEVEL_CODES, EVIDENCE_LEVEL_LABEL, PM1_EVIDENCE_LEVELS } from "../../shared/functionalSites";
import { functionEvidenceInputFrom } from "../evidence/function/functionInput";

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
  const ev = buildFunctionEvidence(functionEvidenceInputFrom(analysisResult));
  const levelsHere = new Set(ev.rows.filter((r) => r.evidence !== "match").map((r) => r.evidence));

  return (
    <div className="fnd-rail" data-testid="function-rail">
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
          Evidence levels · UniProt ECO tags
        </h3>
        <ul className="fnd-cuts" data-testid="evidence-levels">
          {EVIDENCE_LEVEL_CODES.map((l) => (
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
        <details className="fnd-notes" open>
          <summary>How to read this tab</summary>
          <ul>
            <li>
              PM1 asks for a mutational hot spot or a well-established functional domain without benign variation. Only the site
              reading is tested (active site, binding site, metal binding, disulfide cysteine), and benign variation in the region
              is not checked.
            </li>
            <li>PP3 and PM1 together are capped at Strong (Pejaver 2022). PM1 is withheld when PP3 alone already reaches Strong.</li>
            <li>A disulfide bond covers its two cysteines, not the residues between them.</li>
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
