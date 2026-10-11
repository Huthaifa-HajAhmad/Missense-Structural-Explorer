import React, { useState } from "react";
import { AlertTriangle, ArrowRight, Info, ListChecks, MapPin, Scissors } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { ModelKnowledgeModal } from "../modals/ModelKnowledgeModal";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { THRESHOLDS, formatEvidenceCode } from "../../shared/thresholds";
import {
  SPLICE_CHANNEL_CAPTION,
  SPLICE_GROUP_LABEL,
  SPLICE_GROUP_NOTE,
  buildSplicingEvidence,
  SPLICE_MAP_FLOOR,
  formatDelta,
  groupSpliceReadings,
  splicingFinding,
  type SpliceReading,
  type SplicingEvidence,
} from "../../shared/splicingEvidence";
import { SpliceRuler } from "./splicing/SpliceRuler";
import { SpliceMap } from "./splicing/SpliceMap";
import { SpliceWindowControl } from "./splicing/SpliceWindowControl";
import { Prose } from "../ui/Prose";
import { EvidencePanel, EvidenceViewTabs, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { SplicingRecords } from './splicing/SplicingRecords';
import { splicingReadings, spliceRequestIdentity } from '../../shared/splicingWorkspace';

/**
 * RNA splicing.
 *
 * ONE QUESTION: is this variant predicted to change pre-mRNA splicing, and what would the ClinGen
 * splicing rule (Walker 2023) make of it? Three tiers, the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — what the splicing rule supports (drawn dashed: the engine does not apply it),
 *      SpliceAI's max Δ on its bands, the finding sentence, and the engine's own in-silico record
 *      beside it with any tension between the two stated in words.
 *   3. READINGS — one table: SpliceAI and context that is never counted
 *      (dbscSNV on its authors' cut-point, AlphaGenome's splicing attribution).
 *   2. WHERE IT SITS — the splice map: the exon and its annotated sites on one axis from the variant,
 *      SpliceAI's predicted gains and losses at their delta positions, dbscSNV's real window, and the
 *      transcript facts behind it.
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
        // Toned by direction like the table row and the rail; the dash alone says "not applied".
        // A clay BP4 beside the red PP3 band read as pathogenic.
        data-tone={rule.code === "PP3" ? "danger" : "good"}
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

/**
 * SpliceAI's four channels as one row of four cells. They were four table rows, each a lone name
 * in a wide column and a ruler that — with no bands on it — said only what the number beside it
 * said; at the usual near-zero scores that was four identical dots. The maximum's ruler is the
 * hero's; here a shared 0-1 dot plot compares channels beside their positional map.
 */
function ChannelsList({ rows }: { rows: SpliceReading[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="spl-channels-group">
      <ul className="spl-channels" aria-label="SpliceAI delta score per channel">
        {rows.map(r => {
          const isMax = r.call?.label === "Maximum";
          return (
            <li key={r.key} className="spl-channel" data-max={isMax || undefined} data-testid={`splice-${r.key}`} title={r.score !== null ? `${r.name}: Δ ${r.score}${r.sub ? `; ${r.sub}` : ""}` : r.availability.reason ?? undefined}>
              <span className="spl-channel__name">
                <InspectReadingButton tab="splicing" readingKey={r.key}>{r.name}</InspectReadingButton>
                {isMax && <span className="ev-tier" data-tone="accent">Maximum</span>}
              </span>
              <span className="spl-channel__value">
                <span className="spl-mono">{r.scoreText}</span>
                {r.sub && <span className="spl-channel__pos">{r.sub}</span>}
              </span>
              {r.score !== null && <div className="spl-channel-plot" role="img" aria-label={`${r.name}: delta ${r.score}, on a shared 0 to 1 scale`}>
                <div className="spl-channel-plot__track"><i style={{ left: `${Math.max(0, Math.min(1, r.score)) * 100}%` }} /></div>
              </div>}
              {r.note && <span className="spl-channel__site">{r.note}</span>}
            </li>
          );
        })}
      </ul>
      {/* One scale for the four tracks, and the one caveat they share — printed once, not per card. */}
      <div className="spl-channels__axis" aria-hidden="true"><span>0</span><span>SpliceAI Δ</span><span>1</span></div>
      <p className="spl-channels__caption">{SPLICE_CHANNEL_CAPTION}</p>
    </div>
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
            <span
              className={`ev-tier${reading.call.isCode ? " chip-code" : ""}${reading.call.unapplied ? " spl-verdict--unapplied" : ""}`}
              data-tone={reading.call.tone}
              title={reading.call.unapplied ? "Supported by the splicing rule; the ACMG engine does not apply it" : undefined}
            >
              {reading.call.label}
            </span>
          ) : null
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : reading.availability.tone === "warn" ? "warning" : "muted"}>
            {pending ? ENGINE_STATE_LABELS.running : reading.availability.label ?? ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </td>
    </tr>
  );
}

/** Only what the figure draws: a legend entry for a mark that is not there is noise. */
function MapLegend({ map }: { map: NonNullable<SplicingEvidence["map"]> }) {
  return (
    <div className="spl-geo__legend" aria-hidden="true">
      <span><i className="spl-key" data-kind="exon" />Exon</span>
      <span><i className="spl-key" data-kind="site" />Annotated splice site</span>
      <span><i className="spl-key" data-kind="window" />dbscSNV window</span>
      {map.predictions.length > 0 && (
        <>
          <span><i className="spl-key" data-kind="gain" />SpliceAI gain</span>
          <span><i className="spl-key" data-kind="loss" />SpliceAI loss</span>
        </>
      )}
      {map.quiet.length > 0 && (
        <span><i className="spl-key" data-kind="no-signal" />No signal · Δ &lt; {SPLICE_MAP_FLOOR}</span>
      )}
      <span><i className="spl-key" data-kind="variant" />This variant</span>
    </div>
  );
}

/** What the figure leaves out, and what its positions mean — in words, under it. */
function MapNote({ map }: { map: NonNullable<SplicingEvidence["map"]> }) {
  const parts: string[] = [];
  const quietCount = map.quiet.length;
  if (map.predictionsNote) parts.push(map.predictionsNote);
  else if (map.predictions.length === 0 && quietCount === 0) parts.push("SpliceAI returned no score for this variant, so no predicted site is drawn.");
  else if (map.predictions.length === 0) parts.push(`No SpliceAI channel reaches ${SPLICE_MAP_FLOOR} anywhere in its window, so no predicted site is placed.`);
  if (quietCount > 0) {
    parts.push(
      `${quietCount === 1 ? "One scored channel is" : `${quietCount} scored channels are`} drawn in the no-signal row: a Δ this close to zero has no meaningful position, so ${quietCount === 1 ? "it is" : "they are"} not placed on the axis.`
    );
  }
  if (map.predictions.some(x => x.atSite)) parts.push("Coincidence with an annotated site is positional context (within 1 bp), not experimental confirmation of a splicing effect.");
  if (map.exon.start === null || map.exon.end === null) parts.push("The exon's length was not resolved, so it runs off the edge.");
  if (parts.length === 0) return null;
  return <p className="spl-geo__note" data-testid="map-note">{parts.join(" ")}</p>;
}

export function SplicingTab({ analysisState, isBiophysicalLoading, onTabChange }: TabComponentProps) {
  // Local disclosures and in-flight requests belong to this allele, including same-residue changes.
  return <SplicingContent key={spliceRequestIdentity(analysisState.result)} analysisState={analysisState} isBiophysicalLoading={isBiophysicalLoading} onTabChange={onTabChange} />;
}

function SplicingContent({ analysisState, isBiophysicalLoading, onTabChange }: Pick<TabComponentProps, 'analysisState' | 'isBiophysicalLoading' | 'onTabChange'>) {
  const { settings } = useSettings();
  const workspace = useEvidenceWorkspace('splicing');
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  const [localSmallSignals, setLocalSmallSignals] = useState(false);
  const result = analysisState.result;
  if (!result) return null;

  const base = buildSplicingEvidence({
    result,
    isLoading: Boolean(analysisState.isLoading || isBiophysicalLoading),
    // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const savedView = workspace.spliceMap?.transcript === base.geometry.transcriptId ? workspace.spliceMap : undefined;
  const mapView = savedView ?? { transcript: base.geometry.transcriptId, halfWidth: null, focusedScore: false, showSmallSignals: false };
  const showSmallSignals = workspace.enabled ? mapView.showSmallSignals : localSmallSignals;
  const setShowSmallSignals = (value: boolean) => workspace.enabled ? workspace.setOptions({ spliceMap: { ...mapView, showSmallSignals: value } }) : setLocalSmallSignals(value);
  const ev = showSmallSignals ? buildSplicingEvidence({ result, isLoading: base.pending, alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined, showSmallSignals }) : base;
  const readings = splicingReadings(ev, result);
  const finding = splicingFinding(ev);
  const { geometry: g, rule } = ev;
  const spliceRow = ev.readings.find(r => r.key === "spliceai")!;
  const map = ev.map;
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
      <EvidenceViewTabs tab="splicing" comparisonLabel="Splice map" />

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
              {rule.maxDs !== null ? formatDelta(rule.maxDs) : "—"}
            </span>
            <span className="spl-hero__figure-label">
              SpliceAI max Δ
            </span>
          </div>

          <Prose className="spl-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </Prose>

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
              <dt>SpliceAI source</dt>
              <dd>{rule.maxDs !== null ? ev.spliceai.provenance?.computedLive === false ? "Precomputed table" : ev.spliceai.provenance?.source === "broad-lookup" ? "Broad Lookup · live" : "Source not stated" : ev.spliceai.availability.label ?? ENGINE_STATE_LABELS["no-result"]}</dd>
              <span className="spl-fact__sub">
                {rule.maxDs !== null ? `${ev.spliceai.windowText} window · ${ev.spliceai.maskText.toLowerCase()} scores` : "No score to attribute"}
              </span>
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

      {workspace.enabled && <div className="spl-workspace-tools">
        <p>Pin a channel to follow its score, location and source in the inspector.</p>
        <SpliceWindowControl result={result} ev={ev} disabled={ev.pending} />
      </div>}
      <EvidencePanel tab="splicing">
      {workspace.enabled && !workspace.comparison ? <SplicingRecords rows={readings} /> : <>
      <section className="spl-section" aria-labelledby="spl-geometry-title">
        <h2 className="eyebrow" id="spl-geometry-title">
          <MapPin className="w-3.5 h-3.5" />
          Where the variant sits
        </h2>
        <div className="spl-card spl-geo">
          <div className="spl-geo__main">
            {g.position !== null ? (
              <div className="spl-geo__drawing">
                <div className="spl-geo__lead">
                  <p className="spl-geo__lead-label">Distance to nearest splice junction</p>
                  <p className="spl-geo__lead-position">
                    <strong className="spl-mono">{positionText} from the {g.junction}</strong>
                  </p>
                  <p className="spl-geo__lead-phrase">{g.positionPhrase}.</p>
                  <p className="spl-geo__lead-status">
                    {g.isCanonicalDinucleotide
                      ? "This is the canonical splice dinucleotide: a change here is assessed under PVS1, not PP3."
                      : g.inDbscsnvWindow
                      ? "Inside dbscSNV's window."
                      : "Outside dbscSNV's window and the canonical dinucleotide."}
                  </p>
                  <p className="spl-geo__lead-note">
                    Distance from a junction is context; it is not evidence for or against a splicing effect.
                  </p>
                </div>
                {map ? (
                  <>
                    <div className="spl-map-controls">
                      <span>Reporting window: {ev.spliceai.windowText}</span>
                      <label><input type="checkbox" checked={showSmallSignals} onChange={e => setShowSmallSignals(e.target.checked)} /> Show non-zero signals below {SPLICE_MAP_FLOOR}</label>
                      <span>Display filter: {showSmallSignals ? "Δ > 0" : `Δ ≥ ${SPLICE_MAP_FLOOR}`} · scores remain in the readings</span>
                    </div>
                    <div className="spl-geo__figure">
                      {/* Reset geometry-specific view state on transcript changes; re-scoring the same transcript retains it. */}
                      <SpliceMap key={g.transcriptId ?? "unresolved"} map={map} geometry={g}
                        selectedKey={workspace.selected} onSelect={workspace.enabled ? workspace.select : undefined}
                        view={workspace.enabled ? mapView : undefined}
                        onViewChange={workspace.enabled ? patch => workspace.setOptions({ spliceMap: { ...mapView, ...patch } }) : undefined} />
                    </div>
                    <MapLegend map={map} />
                    <MapNote map={map} />
                    <ChannelsList rows={ev.readings.filter(r => r.group === "channels")} />
                  </>
                ) : null}
              </div>
            ) : (
              <>
              <ChannelsList rows={ev.readings.filter(r => r.group === "channels")} />
              <p className="spl-geo__lead" data-testid="geometry-absent">
                {g.distance === null
                  ? ev.pending
                    ? "Junction geometry is still being resolved."
                    : g.refusal ?? "The splice resolver returned no junction distance, region or exon bounds for this variant, so nothing is drawn. The SpliceAI score above does not depend on it."
                  : g.junction === "terminal"
                  ? `The nearest boundary, ${g.distance} bp away, is a transcript terminus, not a splice junction, so no splice-site position applies.`
                  : `The variant is ${g.distance} bp from an exon boundary whose orientation was not resolved, so no splice-site position or window is drawn.`}
              </p>
              </>
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
        </div>
      </section>
      {workspace.enabled && <p className="spl-records-caption">The map shows location; Source records retains every exact reading, including channels with no position or no returned score.</p>}
      </>}
      </EvidencePanel>

      {!workspace.enabled &&
      <section className="spl-section" aria-labelledby="spl-readings-title">
        <div className="spl-section__head">
          <h2 className="eyebrow" id="spl-readings-title">
            <ListChecks className="w-3.5 h-3.5" />
            Splice readings
          </h2>
          <SpliceWindowControl result={result} ev={ev} disabled={ev.pending} />
        </div>
        <div className="spl-card spl-table-wrap">
          <table className="spl-table" data-testid="splicing-readings">
            <colgroup>
              <col className="spl-col-subject" />
              <col className="spl-col-score" />
              <col />
              <col className="spl-col-status" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col" className="spl-num">Score</th>
                <th scope="col" title="The score on its 0–1 axis, with its bands or cut-points drawn by source">Position on scale</th>
                <th scope="col" className="spl-status">Reading</th>
              </tr>
            </thead>
            {groupSpliceReadings(ev.readings).filter(g => g.group !== "channels").map(({ group, rows }) => (
              <tbody key={group} data-group={group}>
                <tr className="spl-group">
                  <th colSpan={4} scope="rowgroup">
                    <span className="spl-group__inner">
                      <span className="spl-group__title">{SPLICE_GROUP_LABEL[group]}</span>
                      <span className="spl-group__meta">{SPLICE_GROUP_NOTE[group]}</span>
                    </span>
                  </th>
                </tr>
                {rows.map(r => <ReadingRow key={r.key} reading={r} onKnowledge={setKnowledgeKey} onTabChange={onTabChange} />)}
              </tbody>
            ))}
          </table>
          <div className="spl-table-foot" aria-label="Legend">
            <span className="spl-legend__item"><i className="spl-legend__band" data-side="path" />PP3 · splicing ≥ {THRESHOLDS.spliceai.splicingPp3.toFixed(1)}</span>
            <span className="spl-legend__item"><i className="spl-legend__band" data-side="benign" />BP4 · splicing &le; {THRESHOLDS.spliceai.splicingBp4Below.toFixed(1)}</span>
            <span className="spl-legend__item"><i className="spl-legend__tick" />Authors&apos; cut-point</span>
            <span className="spl-legend__item"><i className="spl-legend__marker" />This variant</span>
          </div>
        </div>
      </section>}

    </div>
  );
}

export default SplicingTab;
