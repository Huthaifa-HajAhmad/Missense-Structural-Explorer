import React, { useState } from "react";
import { AlertTriangle, ArrowRight, Info, ListChecks, MapPin, Scissors } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { ModelKnowledgeModal } from "../modals/ModelKnowledgeModal";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { THRESHOLDS, formatEvidenceCode } from "../../shared/thresholds";
import {
  SPLICE_GROUP_LABEL,
  SPLICE_GROUP_NOTE,
  buildSplicingEvidence,
  groupSpliceReadings,
  splicingFinding,
  type SpliceReading,
  type SplicingEvidence,
} from "../../shared/splicingEvidence";
import { SpliceRuler } from "./splicing/SpliceRuler";
import { JunctionDiagram } from "./splicing/JunctionDiagram";

/**
 * RNA splicing.
 *
 * ONE QUESTION: is this variant predicted to change pre-mRNA splicing, and what would the ClinGen
 * splicing rule (Walker 2023) make of it? Three tiers, the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — what the splicing rule supports (drawn dashed: the engine does not apply it),
 *      SpliceAI's max Δ on its bands, the finding sentence, and the engine's own in-silico record
 *      beside it with any tension between the two stated in words.
 *   2. READINGS — one table: SpliceAI, its four channels, then the context that is never counted
 *      (dbscSNV on its authors' cut-point, AlphaGenome's splicing attribution).
 *   3. WHERE IT SITS — the junction to scale, with dbscSNV's real window and the canonical
 *      dinucleotide, and the transcript facts behind it.
 *
 * It replaced five KPI cards, a "mechanistic etiology" verdict that declared pathogenicity "driven by
 * protein misfolding" from a FoldX/REVEL/AlphaMissense OR-rule (with splicing unassessed), a
 * PP3/BP4 badge the engine never recorded, and a red "±5 bp critical junction zone" with no source.
 * doc/SPLICING_TAB_REVIEW.md lists each finding.
 *
 * INVARIANTS
 *   • Every number, call and sentence comes from `buildSplicingEvidence`; this file tests no score.
 *   • The splicing code is never presented as the engine's: it is dashed and says "not applied".
 *   • Absence is always a sentence with its reason.
 */

function RuleChip({ ev }: { ev: SplicingEvidence }) {
  const { rule } = ev;
  if (rule.state === "pending") {
    return <span className="ev-tier spl-verdict" data-tone="neutral">{ENGINE_STATE_LABELS.running}</span>;
  }
  if (rule.code) {
    return (
      <span
        className="ev-tier chip-code spl-verdict spl-verdict--unapplied"
        data-tone="accent"
        data-testid="splicing-verdict"
        title="What the ClinGen splicing rule supports. The ACMG engine does not apply splicing criteria, so this is not a recorded code."
        aria-label={`${rule.code} for splicing impact, supported by the splicing rule, not applied by the engine`}
      >
        {rule.code} · splicing
      </span>
    );
  }
  return (
    <span className="ev-tier spl-verdict" data-tone="neutral" data-testid="splicing-verdict">
      {rule.state === "no-score" ? "Rule not applied" : "No splicing criterion"}
    </span>
  );
}

function EngineFact({ ev }: { ev: SplicingEvidence }) {
  const { engine } = ev;
  const tone = (code: string) => (code.startsWith("PP3") ? "danger" : "good");
  if (engine.known) {
    return engine.code ? (
      <span className="ev-tier chip-code" data-tone={tone(engine.code)}>{formatEvidenceCode(engine.code)}</span>
    ) : (
      <span>No PP3 / BP4</span>
    );
  }
  if (engine.voteCode) {
    return (
      <span className="spl-engine">
        <span className="ev-tier chip-code spl-verdict--unapplied" data-tone="accent" title="The missense vote supports this; the payload carries no engine record to confirm it">
          {engine.voteCode}
        </span>
        <span className="spl-dim">unconfirmed</span>
      </span>
    );
  }
  return <span>Not in payload</span>;
}

function Callouts({ ev }: { ev: SplicingEvidence }) {
  const S = THRESHOLDS.spliceai;
  const code = ev.engine.known ? ev.engine.code : ev.engine.voteCode;
  return (
    <>
      {ev.referenceMismatch && (
        <p className="spl-callout" data-tone="warning" data-testid="reference-mismatch">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            <strong>AlphaGenome rejected this coordinate:</strong> its reference base does not match the genome.
            SpliceAI Lookup checks the reference base too, which would explain the missing score. Check the
            variant&apos;s genomic alleles before reading the absence as a result.
          </span>
        </p>
      )}
      {ev.relation === "conflict" && (
        <p className="spl-callout" data-tone="warning" data-testid="relation-callout">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            <strong>SpliceAI supports PP3 for splicing, but the engine&apos;s in-silico code is {code}.</strong>{" "}
            That BP4 comes from the missense vote alone; the engine does not read splicing. BP4 asserts
            computational evidence of no impact, and a predicted splicing change is evidence of impact — review it
            before accepting BP4.
          </span>
        </p>
      )}
      {ev.relation === "bp4-unchecked" && (
        <p className="spl-callout" data-tone="neutral" data-testid="relation-callout">
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            The engine&apos;s in-silico code is {code}, from the missense vote. SpliceAI has no score for this
            variant, so nothing here checks the splicing side of that {code}.
          </span>
        </p>
      )}
      {ev.relation === "same-pp3" && (
        <p className="spl-callout" data-tone="neutral" data-testid="relation-callout">
          <Info className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            The missense vote already supports PP3. PP3 is applied once, whichever prediction supports it; SpliceAI
            at ≥ {S.splicingPp3.toFixed(1)} does not add a second.
          </span>
        </p>
      )}
    </>
  );
}

function ReadingRow({
  reading,
  onKnowledge,
  onTabChange,
}: {
  reading: SpliceReading;
  onKnowledge: (key: string) => void;
  onTabChange?: (tab: string) => void;
}) {
  const has = reading.score !== null;
  const pending = reading.availability.state === "pending";
  const isChannel = reading.group === "channels";
  return (
    <tr data-testid={`splice-${reading.key}`} data-channel={isChannel || undefined}>
      <th scope="row" className="spl-subject">
        <span className="spl-subject__line">
          <span className="spl-subject__name">{reading.name}</span>
          {reading.knowledgeKey && (
            <button
              type="button"
              className="spl-info"
              onClick={() => onKnowledge(reading.knowledgeKey as string)}
              aria-label={`About ${reading.name}`}
              title="Model details and citation"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
        {!isChannel && <span className="spl-subject__note">{reading.description}</span>}
        {reading.note && <span className="spl-subject__note spl-subject__fact">{reading.note}</span>}
        {reading.link && onTabChange && (
          <button type="button" className="spl-link" onClick={() => onTabChange(reading.link!.tab)}>
            {reading.link.label}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </th>
      <td className="spl-num">
        {has ? (
          <>
            {reading.scoreText}
            {reading.sub && <span className="spl-unit">{reading.sub}</span>}
          </>
        ) : (
          <span className="spl-dim">—</span>
        )}
      </td>
      {has ? (
        <td className="spl-scale">
          {reading.scale ? (
            <>
              <SpliceRuler reading={reading} />
              {reading.scaleSource && <span className="spl-scale__source">{reading.scaleSource}</span>}
            </>
          ) : (
            <span className="spl-reason">{isChannel ? "" : "A share of an attribution — no axis to place it on."}</span>
          )}
        </td>
      ) : (
        <td className="spl-reason spl-scale">
          {pending ? <span className="spl-dim">Still being computed for this variant.</span> : reading.availability.reason ?? "No score reached this variant."}
        </td>
      )}
      <td className="spl-status">
        {has ? (
          reading.call ? (
            <span className={`ev-tier${reading.call.isCode ? " chip-code" : ""}`} data-tone={reading.call.tone}>
              {reading.call.label}
            </span>
          ) : null
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : "muted"}>
            {pending ? ENGINE_STATE_LABELS.running : reading.availability.label ?? ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </td>
    </tr>
  );
}

export function SplicingTab({ analysisState, isBiophysicalLoading, onTabChange }: TabComponentProps) {
  const { settings } = useSettings();
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  const result = analysisState.result;
  if (!result) return null;

  const ev = buildSplicingEvidence({
    result,
    isLoading: Boolean(analysisState.isLoading || isBiophysicalLoading),
    // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const finding = splicingFinding(ev);
  const { geometry: g, rule } = ev;
  const spliceRow = ev.readings.find(r => r.key === "spliceai")!;
  const dbsc = ev.dbscsnv;
  const agRow = ev.readings.find(r => r.key === "alphagenome-splicing")!;
  const positionText = g.position !== null ? `${g.position > 0 ? "+" : "−"}${Math.abs(g.position)}` : null;

  return (
    <div className="spl-screen @container">
      {knowledgeKey && <ModelKnowledgeModal isOpen modelKey={knowledgeKey} onClose={() => setKnowledgeKey(null)} />}

      <header>
        <h1 className="screen-title">RNA splicing</h1>
        <p className="screen-tab-description">
          Whether this variant is predicted to change pre-mRNA splicing, and what the ClinGen splicing rule
          would make of it.
        </p>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="spl-card spl-hero" aria-labelledby="spl-finding-title" data-testid="splicing-finding">
        <div className="spl-hero__body">
          <div className="spl-hero__top">
            <span className="eyebrow" id="spl-finding-title">
              <Scissors className="w-3.5 h-3.5" />
              Splicing impact · PP3 / BP4 for splicing
            </span>
            <RuleChip ev={ev} />
          </div>

          <div className="spl-hero__figure">
            <span className="spl-figure" data-empty={rule.maxDs === null || undefined}>
              {rule.maxDs !== null ? rule.maxDs.toFixed(2) : "—"}
            </span>
            <span className="spl-hero__figure-label">
              SpliceAI max Δ{spliceRow.sub ? ` · ${spliceRow.sub}` : ""}
              {rule.maxShift !== null ? ` at ${rule.maxShift > 0 ? "+" : "−"}${Math.abs(rule.maxShift)} bp` : ""}
            </span>
          </div>

          <p className="spl-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </p>

          {rule.maxDs !== null && (
            <div className="spl-hero__ruler">
              <SpliceRuler reading={spliceRow} size="hero" />
            </div>
          )}

          <Callouts ev={ev} />

          <dl className="spl-facts">
            <div className="spl-fact">
              <dt>Position</dt>
              <dd>
                {positionText ? (
                  <>
                    <span className="spl-mono">{positionText}</span>&nbsp;from the {g.junction}
                  </>
                ) : g.distance !== null ? (
                  <><span className="spl-mono">{g.distance} bp</span>&nbsp;from a boundary</>
                ) : (
                  "Not resolved"
                )}
              </dd>
              <span className="spl-fact__sub">{g.exonLabel}{g.regionType ? ` · ${g.regionType}` : ""}</span>
            </div>
            <div className="spl-fact">
              <dt>dbscSNV</dt>
              <dd>
                {dbsc.max !== null ? (
                  <span className="spl-mono">{dbsc.max.toFixed(3)}</span>
                ) : g.inDbscsnvWindow === false ? (
                  "Outside its window"
                ) : (
                  ENGINE_STATE_LABELS["no-result"]
                )}
              </dd>
              <span className="spl-fact__sub">Authors&apos; cut-point {THRESHOLDS.dbscsnv.spliceAltering} · not counted</span>
            </div>
            <div className="spl-fact">
              <dt>AlphaGenome splicing</dt>
              <dd>{agRow.score !== null ? <span className="spl-mono">{agRow.scoreText}</span> : agRow.availability.label}</dd>
              <span className="spl-fact__sub">{agRow.score !== null ? "of the AVI attribution" : "Informational"}</span>
            </div>
            <div className="spl-fact">
              <dt>Engine record</dt>
              <dd><EngineFact ev={ev} /></dd>
              <span className="spl-fact__sub">Missense vote · splicing not read</span>
            </div>
          </dl>
        </div>

        {ev.pending && (
          <div role="status" className="spl-callout spl-callout--banner" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>SpliceAI is still running for this variant; the reading below will fill in.</span>
          </div>
        )}
      </section>

      {/* ── 2. Readings ────────────────────────────────────────────────────────────────────── */}
      <section className="spl-section" aria-labelledby="spl-readings-title">
        <h2 className="eyebrow" id="spl-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          Splice readings
        </h2>
        <div className="spl-card spl-table-wrap">
          <table className="spl-table" data-testid="splicing-readings">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col" className="spl-num">Score</th>
                <th scope="col" title="The score on its 0–1 axis, with its bands or cut-points drawn by source">Position on scale</th>
                <th scope="col" className="spl-status">Reading</th>
              </tr>
            </thead>
            {groupSpliceReadings(ev.readings).map(({ group, rows }) => (
              <tbody key={group} data-group={group}>
                <tr className="spl-group">
                  <th colSpan={4} scope="rowgroup">
                    <span className="spl-group__inner">
                      <span className="spl-group__title">{SPLICE_GROUP_LABEL[group]}</span>
                      <span className="spl-group__meta">{SPLICE_GROUP_NOTE[group]}</span>
                    </span>
                  </th>
                </tr>
                {rows.map(r => (
                  <ReadingRow key={r.key} reading={r} onKnowledge={setKnowledgeKey} onTabChange={onTabChange} />
                ))}
              </tbody>
            ))}
          </table>
          <div className="spl-table-foot" aria-label="Legend">
            <span className="spl-legend__item"><i className="spl-legend__band" data-side="path" />PP3 (splicing) ≥ {THRESHOLDS.spliceai.splicingPp3.toFixed(1)}</span>
            <span className="spl-legend__item"><i className="spl-legend__band" data-side="benign" />BP4 (splicing) &lt; {THRESHOLDS.spliceai.splicingBp4Below.toFixed(1)}</span>
            <span className="spl-legend__item"><i className="spl-legend__tick" />Authors&apos; cut-point</span>
            <span className="spl-legend__item"><i className="spl-legend__marker" />This variant</span>
          </div>
        </div>
      </section>

      {/* ── 3. Where it sits ───────────────────────────────────────────────────────────────── */}
      <section className="spl-section" aria-labelledby="spl-geometry-title">
        <h2 className="eyebrow" id="spl-geometry-title">
          <MapPin className="w-3.5 h-3.5" />
          Where the variant sits
        </h2>
        <div className="spl-card spl-geo">
          {g.position !== null ? (
            <>
              <p className="spl-geo__lead">
                <strong>{positionText} from the {g.junction}</strong> — {g.positionPhrase}.{" "}
                {g.isCanonicalDinucleotide
                  ? "This is the canonical splice dinucleotide: a change here is assessed under PVS1, not PP3."
                  : g.inDbscsnvWindow
                  ? "Inside dbscSNV's window."
                  : "Outside dbscSNV's window and the canonical dinucleotide."}{" "}
                Distance from a junction is context; it is not evidence for or against a splicing effect.
              </p>
              <div className="spl-geo__figure">
                <JunctionDiagram geometry={g} />
              </div>
              <div className="spl-geo__legend" aria-hidden="true">
                <span><i className="spl-key" data-kind="exon" />Exon</span>
                <span><i className="spl-key" data-kind="window" />dbscSNV window</span>
                <span><i className="spl-key" data-kind="canonical" />Canonical dinucleotide</span>
                <span><i className="spl-key" data-kind="variant" />This variant</span>
              </div>
            </>
          ) : (
            <p className="spl-geo__lead" data-testid="geometry-absent">
              {g.distance === null
                ? ev.pending
                  ? "Junction geometry is still being resolved."
                  : g.refusal ?? "The splice resolver returned no junction distance, region or exon bounds for this variant, so nothing is drawn. The SpliceAI score above does not depend on it."
                : g.junction === "terminal"
                ? `The nearest boundary, ${g.distance} bp away, is a transcript terminus, not a splice junction, so no splice-site position applies.`
                : `The variant is ${g.distance} bp from an exon boundary whose orientation was not resolved, so no splice-site position or window is drawn.`}
            </p>
          )}

          <dl className="spl-kv" data-testid="geometry-facts">
            <div><dt>Transcript</dt><dd className="spl-mono" title={g.ensemblTranscriptId && g.ensemblTranscriptId !== g.transcriptId ? `Ensembl: ${g.ensemblTranscriptId}` : undefined}>{g.transcriptId ?? "Not resolved"}</dd></div>
            <div><dt>Exon</dt><dd>{g.exonLabel}{g.exonLength !== null ? <span className="spl-dim"> · {g.exonLength.toLocaleString()} bp</span> : null}</dd></div>
            <div><dt>Adjacent intron</dt><dd>{g.intronLabel}</dd></div>
            <div><dt>Strand</dt><dd>{g.strandLabel}</dd></div>
            <div><dt>Nearest boundary</dt><dd>{g.junctionLabel}</dd></div>
            {g.exonStart !== null && g.exonEnd !== null && (
              <div><dt>Exon bounds</dt><dd className="spl-mono">{g.exonStart.toLocaleString()}–{g.exonEnd.toLocaleString()}</dd></div>
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}

export default SplicingTab;
