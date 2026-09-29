import React, { useMemo, useState } from "react";
import { Box, ExternalLink, ListTree, Microscope } from "lucide-react";
import type { TabComponentProps } from "../types";
import { buildFunctionEvidence, type AnnotationRow, type FunctionEvidence } from "../../../shared/functionEvidence";
import { DomainArchitecture } from "./DomainArchitecture";
import { functionEvidenceInputFrom } from "./functionInput";

/**
 * Functional domains.
 *
 * ONE QUESTION: what is annotated at and around the variant residue, and does it meet PM1? Three tiers,
 * the shape Population Data set:
 *
 *   1. THE FINDING — the residue as the headline, one bold sentence on what covers it, the domain
 *      architecture with the variant placed, a fact strip ending in the engine record, and caveats.
 *   2. WHAT IS ANNOTATED — one table, grouped, every row with its residues, its distance in sequence
 *      and its evidence level; a row opens to its ECO codes and citation.
 *   3. The foot names what the entry does not annotate at all, so an empty table is never read as
 *      "checked and clear".
 *
 * It replaced a zoom/pan track with seven coloured chip filters and an inspector legend, which gave
 * PM1 to every residue between two bonded cysteines, counted sites "by similarity" and predicted
 * sites as critical, painted "Interaction with UBA3" as a disordered region, and labelled the whole
 * table "Swiss-Prot Verified". doc/FUNCTIONAL_DOMAINS_TAB_REVIEW.md lists each finding.
 *
 * INVARIANTS
 *   • Every sentence, state and number comes from `buildFunctionEvidence`; this file decides nothing.
 *   • The PM1 chip is the engine's record. Without one in the payload it says "unconfirmed".
 *   • Absence is a state: nothing is called "not annotated" before the record arrives.
 */

type Zoom = "whole" | "near";
const NEAR = 50;

function VerdictChip({ ev }: { ev: FunctionEvidence }) {
  const tone = ev.verdict === "met" ? "danger" : ev.verdict === "not-assessed" ? "muted" : "neutral";
  return (
    <span
      className="ev-tier fnd-verdict"
      data-tone={tone}
      data-unconfirmed={ev.verdictUnconfirmed || undefined}
      data-testid="pm1-verdict"
      title={ev.verdictUnconfirmed ? "No engine record in this payload; the chip shows what the current rule finds." : undefined}
    >
      {ev.verdictLabel}
      {ev.verdictUnconfirmed ? " · unconfirmed" : ""}
    </span>
  );
}

function Legend({ ev }: { ev: FunctionEvidence }) {
  const has = (pred: (r: AnnotationRow) => boolean) => ev.rows.some(pred);
  const below = (r: AnnotationRow) => r.lane === "below";
  return (
    <ul className="fnd-legend" aria-label="Legend">
      <li><i className="fnd-key" data-kind="query" />This variant</li>
      {has((r) => r.disease) && <li><i className="fnd-key" data-kind="disease" />Disease variant</li>}
      {has((r) => below(r) && ["experimental", "structure", "proteomics"].includes(r.evidence)) && <li><i className="fnd-key" data-kind="experimental" />Experimental</li>}
      {has((r) => below(r) && ["similarity", "predicted", "curated"].includes(r.evidence)) && <li><i className="fnd-key" data-kind="inferred" />Inferred</li>}
      {has((r) => (below(r) || r.lane === "region") && r.evidence === "none") && <li><i className="fnd-key" data-kind="uncited" />No evidence cited</li>}
      {ev.secondaryStructure.some((e) => e.kind === "helix") && <li><i className="fnd-key" data-kind="helix" />Helix</li>}
      {ev.secondaryStructure.some((e) => e.kind === "strand") && <li><i className="fnd-key" data-kind="strand" />Strand</li>}
      {ev.structuralDomains.length > 0 && <li><i className="fnd-key" data-kind="structural" />Gene3D segment</li>}
    </ul>
  );
}

function architectureCaption(ev: FunctionEvidence): string {
  const parts: string[] = [];
  if (ev.domains.length && ev.domains[0].source !== "UniProtKB") {
    parts.push(`Domains from InterPro (${ev.domains.map((d) => `${d.source} ${d.accession}`).join(", ")})`);
  } else if (ev.domains.length) parts.push("Domains from UniProtKB");
  if (ev.structuralDomains.length) parts.push(`structural segments from ${ev.structuralDomains[0].source}`);
  if (ev.secondaryStructure.length) {
    const pdb = ev.secondaryStructure.find((e) => e.pdb)?.pdb;
    parts.push(`helices and strands from ${pdb ? `PDB ${pdb}` : "UniProtKB"}`);
  }
  let text = parts.length ? `${parts.join("; ")}.` : "";
  if (!ev.rows.some((r) => r.group === "domains" && r.type === "Domain")) {
    text += `${text ? " " : ""}UniProtKB itself annotates no domain${ev.gene ? ` for ${ev.gene}` : ""}.`;
  }
  if (ev.interproMissing) text += " InterPro could not be read in this run.";
  return text;
}

function RowDetail({
  row,
  ev,
  onShow3d,
}: {
  row: AnnotationRow;
  ev: FunctionEvidence;
  onShow3d: (() => void) | null;
}) {
  const source = row.evidence === "match" ? `InterPro member database ${row.type}` : `UniProtKB ${row.type.toLowerCase()}`;
  return (
    <tr className="fnd-detail" data-testid="annotation-detail">
      <td colSpan={4}>
        <dl className="fnd-detail__dl">
          <div>
            <dt>Source</dt>
            <dd>{source}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>
              {row.evidenceLabel}
              {row.evidenceCodes.length > 0 && <span className="fnd-mono"> · {row.evidenceCodes.join(", ")}</span>}
            </dd>
          </div>
          {row.citation && (
            <div>
              <dt>Citation</dt>
              <dd>
                {row.citation.url ? (
                  <a href={row.citation.url} target="_blank" rel="noopener noreferrer" className="fnd-link">
                    {row.citation.label}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  row.citation.label
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>Position</dt>
            <dd>
              {row.isPair ? `Cysteines ${row.residuesText}, bonded to each other` : `Residues ${row.residuesText}`}
              {row.covers ? `, includes ${ev.residue}` : `, ${Math.abs(row.distance)} from ${ev.residue} in sequence`}
            </dd>
          </div>
        </dl>
        {onShow3d && (
          <button type="button" className="fnd-button" onClick={onShow3d}>
            <Box className="w-3.5 h-3.5" aria-hidden="true" />
            Show in 3D
          </button>
        )}
      </td>
    </tr>
  );
}

export function FunctionTab({ analysisState, active3dModelTab, onSelectResidue, onNavigateToView }: TabComponentProps) {
  const result = analysisState.result;
  const [zoom, setZoom] = useState<Zoom>("whole");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const ev = useMemo(() => (result ? buildFunctionEvidence(functionEvidenceInputFrom(result)) : null), [result]);
  if (!result || !ev) return null;

  const ok = ev.availability.state === "ok";
  const win =
    zoom === "near" && Number.isFinite(ev.residue)
      ? { start: Math.max(1, ev.residue - NEAR), end: Math.min(ev.length, ev.residue + NEAR) }
      : { start: 1, end: ev.length };
  const toggle = (key: string) => setSelectedKey((prev) => (prev === key ? null : key));
  const show3d = (row: AnnotationRow) =>
    onSelectResidue && onNavigateToView
      ? () => {
          onSelectResidue(row.covers ? ev.residue : row.start);
          onNavigateToView(active3dModelTab === "esm3" ? "structure_esmfold" : "structure_alphafold");
        }
      : null;

  return (
    <div className="fnd-screen @container">
      <header className="fnd-header">
        <h1 className="screen-title">Functional domains</h1>
        <p className="screen-tab-description">
          What UniProtKB and InterPro annotate at and around the variant residue, and whether it meets PM1.
        </p>
      </header>

      {/* ── 1. The finding ───────────────────────────────────────────────────────────────── */}
      <section className="fnd-card" aria-labelledby="fnd-finding-title" data-testid="function-finding">
        <div className="fnd-hero">
          <div className="fnd-hero__top">
            <span className="eyebrow" id="fnd-finding-title">
              <Microscope className="w-3.5 h-3.5" />
              PM1 · critical functional region
            </span>
            <VerdictChip ev={ev} />
          </div>
          <div className="fnd-hero__figure">
            <span className="fnd-figure fnd-mono">{ev.headline.figure}</span>
            <span className="fnd-hero__sub">{ev.headline.sub}</span>
          </div>
          <p className="fnd-hero__finding" data-testid="function-finding-sentence" role={ok ? undefined : "status"}>
            <strong>{ev.finding.lead}</strong>
            {ev.finding.rest ? ` ${ev.finding.rest}` : ""}
            {!ok && ev.availability.reason ? ` ${ev.availability.reason}` : ""}
          </p>
        </div>

        {ok && (
          <figure className="fnd-figure-block">
            <DomainArchitecture ev={ev} win={win} selectedKey={selectedKey} onSelect={toggle} />
            <figcaption className="fnd-caption">{architectureCaption(ev)}</figcaption>
            <div className="fnd-figure-block__bar">
              <Legend ev={ev} />
              <div className="fnd-seg" role="group" aria-label="Zoom the schematic">
                <button type="button" aria-pressed={zoom === "whole"} onClick={() => setZoom("whole")}>
                  Whole protein
                </button>
                <button type="button" aria-pressed={zoom === "near"} onClick={() => setZoom("near")}>
                  {ev.residue} ± {NEAR}
                </button>
              </div>
            </div>
          </figure>
        )}

        <dl className="fnd-facts">
          {ev.facts.map((f) => (
            <div key={f.label} className="fnd-fact">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "fnd-mono" : undefined}>{f.value}</dd>
              <span className="fnd-fact__sub">{f.sub}</span>
            </div>
          ))}
        </dl>

        {ev.caveats.length > 0 && (
          <ul className="fnd-caveats" data-testid="function-caveats">
            {ev.caveats.map((c) => (
              <li key={c.lead}>
                <strong>{c.lead}</strong> {c.rest}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. What is annotated ────────────────────────────────────────────────────────── */}
      {ok && (
        <section className="fnd-section" aria-labelledby="fnd-table-title">
          <h2 className="eyebrow" id="fnd-table-title">
            <ListTree className="w-3.5 h-3.5" />
            What is annotated
          </h2>
          <div className="fnd-card fnd-table-wrap">
            {ev.groups.length ? (
              <table className="fnd-table" data-testid="annotation-table">
                <thead>
                  <tr>
                    <th scope="col">Annotation</th>
                    <th scope="col" className="fnd-num">Residues</th>
                    <th scope="col" className="fnd-num fnd-col-distance">From {ev.residue}</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                {ev.groups.map((g) => (
                  <tbody key={g.group} data-group={g.group}>
                    <tr className="fnd-group">
                      <th colSpan={4} scope="rowgroup">
                        <span className="fnd-group__title">{g.label}</span>
                        <span className="fnd-group__count">{g.rows.length}</span>
                      </th>
                    </tr>
                    {g.rows.map((row) => {
                      const open = selectedKey === row.key;
                      return (
                        <React.Fragment key={row.key}>
                          <tr data-covers={row.covers || undefined} data-selected={open || undefined} data-testid="annotation-row">
                            <th scope="row" className="fnd-subject">
                              <button type="button" className="fnd-subject__btn" aria-expanded={open} onClick={() => toggle(row.key)}>
                                <span className="fnd-subject__name">{row.name}</span>
                                {(row.note || row.covers) && (
                                  <span className="fnd-subject__note">
                                    {[row.note, row.covers ? `includes ${ev.residue}` : null].filter(Boolean).join(" · ")}
                                  </span>
                                )}
                              </button>
                            </th>
                            <td className="fnd-num">{row.residuesText}</td>
                            <td className="fnd-num fnd-col-distance">{row.distanceText}</td>
                            <td className="fnd-evidence">
                              {row.evidenceLabel}
                              {row.citation && <span className="fnd-subject__note">{row.citation.label}</span>}
                            </td>
                          </tr>
                          {open && <RowDetail row={row} ev={ev} onShow3d={show3d(row)} />}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            ) : (
              <p className="fnd-empty">UniProtKB lists no features for this protein beyond the chain itself.</p>
            )}
            {ev.notAnnotated.length > 0 && (
              <div className="fnd-foot" data-testid="not-annotated">
                <span>
                  <strong>Not annotated{ev.gene ? ` for ${ev.gene}` : ""}:</strong> {ev.notAnnotated.join(", ")}.
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default FunctionTab;
