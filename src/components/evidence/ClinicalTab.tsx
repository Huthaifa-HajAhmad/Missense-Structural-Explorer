import React from "react";
import { AlertTriangle, Database, ExternalLink, Gauge, Search, RotateCw, Scale, Star } from "lucide-react";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { TabComponentProps } from "./types";
import {
  buildFrequencyEvidence,
  formatAlleleCounts,
  formatAlleleFrequency,
  formatCount,
  populationReading,
  observationAbsence,
  type FrequencyApplication,
  type FrequencyCriterion,
  type FrequencyObservation, frequencyEvidenceInputFromResult, summariseReadings } from "../../shared/frequencyEvidence";
import type { EvidenceAvailabilityState } from "../../shared/evidenceAvailability";
import { THRESHOLDS } from "../../shared/thresholds";
import { FrequencyScale, type ScaleReading } from "./population/FrequencyScale";
import { classificationTone, formatClinicalDate, reviewStars } from "./population/populationFormat";

/**
 * Population Data.
 *
 * ONE QUESTION: has anyone seen this variant, how often, and what did the ACMG frequency rule make of
 * it? The screen answers in three tiers, top to bottom:
 *
 *   1. THE FINDING — the verdict chip, the busiest cohort's counts as the headline figure, the finding
 *      sentence, and a log-scale ruler placing the rule's input against the cut-points it was tested
 *      on. The frequency the rule read is its own labelled fact: it is usually gnomAD's
 *      ancestry-grouped maximum, which is NOT the quotient of the headline counts.
 *   2. SOURCE READINGS — one table, every dataset a row, AC · AN · AF in aligned columns. It replaced
 *      three cards of different heights, which made the most common view (a variant nobody has seen)
 *      a row of mostly-empty boxes and put the numbers a reviewer compares in three different places.
 *   3. CLINICAL ASSERTION — the ClinVar record. It is not a frequency source and no longer shares a
 *      grid slot with them; its submitted frequencies are rows of the table like any other reading.
 *
 * INVARIANTS KEPT FROM THE PREVIOUS REVISION (each pinned in ClinicalTab.test.tsx):
 *   • absence is never worded here — every empty source renders `observationAbsence`;
 *   • the engine's decision is read, not recomputed (`applied` vs `criterion`), and a suppression
 *     is stated rather than silently substituted;
 *   • cut-points come from `THRESHOLDS.populationFrequency`;
 *   • a count is never hidden because its frequency is missing.
 */

/** State chip tones. Keyed on the state, not the resolver's tone, so "no record" is never amber. */
const STATE_TONE: Record<EvidenceAvailabilityState, string> = {
  available: "good",
  "no-result": "neutral",
  "not-covered": "muted",
  "not-configured": "muted",
  "upstream-error": "warning",
  pending: "neutral",
};

function isFaulted(state: EvidenceAvailabilityState) {
  return state === "upstream-error" || state === "pending" || state === "not-covered" || state === "not-configured";
}

function StateChip({ observation }: { observation: FrequencyObservation }) {
  const { label, state } = observation.availability;
  // Counts without a denominator are a PARTIAL reading; "No result" above "AC 12" would deny it.
  const partial = !isFaulted(state) && observation.af === null && (observation.ac !== null || observation.an !== null);
  const text = partial ? "No frequency" : label ?? "Measured";
  return (
    <span className="ev-tier shrink-0" data-tone={partial ? "neutral" : STATE_TONE[state] ?? "neutral"}>
      {text}
    </span>
  );
}

/**
 * The verdict chip.
 *  - recorded by the engine: solid border, verdict colour;
 *  - supported by the frequency but no engine record in the payload: DASHED clay border (the dash is
 *    the whole qualifier; it is spelled out in the accessible name and title);
 *  - otherwise the words that stand in for a code.
 */
function VerdictChip({ criterion, applied }: { criterion: FrequencyCriterion; applied: FrequencyApplication }) {
  const supportsCode = criterion.code === "PM2" || criterion.code === "BS1" || criterion.code === "BA1";
  const unconfirmed = !applied.known && supportsCode;

  const text = applied.known
    ? (applied.code ?? "No criterion")
    : criterion.code === "none" ? "No criterion"
    : criterion.code === "unknown" ? "Not classified"
    : criterion.code === "withheld" ? "Withheld"
    : criterion.code;

  const tone =
    applied.suppressed ? "muted"
    : unconfirmed ? "accent"
    : applied.known && applied.code === "PM2" ? "danger"
    : applied.known && (applied.code === "BS1" || applied.code === "BA1") ? "good"
    : "neutral";

  const isCode = /^[A-Z]+\d+$/.test(text);

  return (
    <span
      className={`ev-tier pop-verdict shrink-0${isCode ? " chip-code" : ""}`}
      data-testid="verdict-chip"
      data-tone={tone}
      style={unconfirmed ? { borderStyle: "dashed" } : undefined}
      title={
        applied.known
          ? "The ACMG frequency criterion this run recorded"
          : unconfirmed
            ? `${criterion.code} is what the frequency supports — this payload carries no engine record to confirm it against`
            : "No frequency criterion was applied"
      }
      aria-label={unconfirmed ? `${criterion.code}, supported by the frequency, unconfirmed by the engine record` : undefined}
    >
      {text}
    </span>
  );
}


/**
 * SOURCE READINGS — two parts, because they answer two different questions.
 *
 *   OBSERVED   "who saw it, how often" — one row per source that reported a figure, three columns:
 *              Source · AC / AN · AF. The allele count and number share one cell ("8 / 1,459,156"),
 *              which is how the pair is read and how gnomAD itself prints it; two half-empty columns
 *              of dashes were most of the old table's ink.
 *   NO READING "who didn't, and why" — a quiet list, one line per source: its name and the recorded
 *              reason. A chip appears only when the reason is a fault or a coverage gap, so a plain
 *              "no record" (the usual rare-disease answer) carries no chrome at all.
 *
 * No group-header rows: the source name carries its database ("gnomAD exomes", "ExAC via ClinVar").
 * The value the ACMG rule used is marked with the same clay dot as the scale's marker.
 */
interface SourceLine {
  observation: FrequencyObservation;
  name: string;
  qualifier?: string;
  source: "gnomad" | "all-of-us" | "clinvar-submissions";
  note?: React.ReactNode;
  ruleInput?: boolean;
}

function hasFigure(o: FrequencyObservation) {
  return o.ac !== null || o.an !== null || o.af !== null;
}

function RuleDot() {
  return <span className="pop-rule-dot" role="img" aria-label="Used for classification" title="The value the ACMG frequency rule used" />;
}

function SourceRow({ line }: { line: SourceLine }) {
  const { observation: o, name, qualifier, note, ruleInput = false } = line;
  const measured = o.availability.state === "available" && o.af !== null;
  const reason = o.af === null ? observationAbsence(o) : null;
  const counts = o.ac !== null || o.an !== null ? `${formatCount(o.ac)} / ${formatCount(o.an)}` : null;
  return (
    <tr data-testid={`reading-${o.key}`} data-source={line.source} data-rule-input={ruleInput || undefined}>
      <th scope="row" className="pop-subject">
        <span className="pop-subject__line">
          <span className="pop-subject__name">{name}</span>
          {qualifier && <span className="pop-dim">{qualifier}</span>}
          {!measured && <StateChip observation={o} />}
        </span>
        {reason && <span className="pop-subject__note">{reason}</span>}
        {note && <span className="pop-subject__note">{note}</span>}
      </th>
      <td className="pop-num" title="Allele count / allele number">
        {counts ?? <span className="pop-dim">—</span>}
      </td>
      <td className="pop-num pop-num--af" data-rule-input={ruleInput || undefined} title="Allele frequency">
        {ruleInput && <RuleDot />}
        {o.af !== null ? formatAlleleFrequency(o.af) : <span className="pop-dim">—</span>}
      </td>
    </tr>
  );
}

function NoReadingItem({ line }: { line: SourceLine }) {
  const { observation: o, name, qualifier } = line;
  const quiet = o.availability.state === "no-result";
  return (
    <li className="pop-noread__item" data-testid={`reading-${o.key}`} data-source={line.source}>
      <span className="pop-noread__name">
        {name}
        {qualifier && <span className="pop-dim"> {qualifier}</span>}
      </span>
      {!quiet && <StateChip observation={o} />}
      <span className="pop-noread__reason">{observationAbsence(o)}</span>
    </li>
  );
}

function Stars({ count }: { count: number }) {
  return (
    <span className="pop-stars" aria-label={`${count} of 4 review stars`} title={`${count} of 4 review stars`}>
      {[0, 1, 2, 3].map(i => (
        <Star key={i} className="w-3 h-3" data-filled={i < count || undefined} aria-hidden="true" />
      ))}
    </span>
  );
}

export function ClinicalTab({ analysisState, onNavigateToView }: TabComponentProps) {
  const requestRerun = useVariantAnalysisStore(s => s.requestRerun);
  const setCustomGene = useVariantAnalysisStore(s => s.setCustomGene);
  const setShowCustomInputs = useVariantAnalysisStore(s => s.setShowCustomInputs);
  const result = analysisState.result;
  if (!result) return null;

  const provideAllele = () => {
    // Keep the current notation and gene context; never choose or submit a candidate allele.
    if (result.metadata?.gene) setCustomGene?.(result.metadata.gene);
    setShowCustomInputs?.(true);
    onNavigateToView?.("search");
  };

  const evidence = buildFrequencyEvidence(frequencyEvidenceInputFromResult(result));

  const { criterion, applied, clinvar } = evidence;
  const FREQ = THRESHOLDS.populationFrequency;
  const gnomadRows = evidence.observations.filter(o => o.id.startsWith("gnomad"));
  const aouRow = evidence.observations.find(o => o.id === "all-of-us");
  const clinvarFrequencyRows = evidence.observations.filter(o => o.id === "clinvar-submissions");
  // Only a release the payload names; "release not reported" is not worth a line of its own.
  const gnomadRelease = gnomadRows[0]?.dataset && gnomadRows[0].dataset !== "release not reported"
    ? gnomadRows[0].dataset
    : null;
  const groupedMaxAf = criterion.usedGroupMax ? criterion.af : null;
  const ruleClinvarAf = criterion.sourceId === "clinvar-submissions" ? criterion.af : null;

  const reading = populationReading(evidence);

  // The headline figure: the busiest cohort's counts; the rule's frequency when no cohort has counts;
  // and for a recorded absence, the words — a bare "0" read as a measured frequency of zero.
  const leadFigure = reading.mostCopies
    ? reading.mostCopies.counts
    : criterion.absent ? "Not observed"
    : reading.ruleAf !== null ? formatAlleleFrequency(reading.ruleAf)
    : "No reading";
  const leadLabel = reading.mostCopies
    ? `${reading.mostCopies.label} · most copies in any one cohort`
    : criterion.absent ? "in gnomAD — no record of this variant"
    : reading.ruleAf !== null ? reading.ruleSource
    : null;


  const scaleReadings: ScaleReading[] = evidence.observations
    .filter(o => o.af !== null && o.af > 0 && o.availability.state === "available")
    .map(o => ({
      key: o.key,
      label: o.id.startsWith("gnomad") ? `gnomAD ${o.label.toLowerCase()}` : o.label,
      af: o.af as number,
    }));
  if (groupedMaxAf !== null && groupedMaxAf > 0) {
    scaleReadings.push({ key: "gnomad-group", label: "gnomAD ancestry-grouped maximum", af: groupedMaxAf });
  }

  const cv = result.clinvar;
  const stars = reviewStars(cv?.reviewStatus);
  const lastEvaluated = formatClinicalDate(cv?.lastEvaluated);
  const clinvarUid = cv?.uid != null ? String(cv.uid) : null;
  const clinvarVcv = clinvarUid ? (clinvarUid.startsWith("VCV") ? clinvarUid : `VCV${clinvarUid.padStart(9, "0")}`) : null;
  const bs2 = evidence.homozygoteCriterion.recorded;

  // Every source as one display line, in reading order: gnomAD, All of Us, ClinVar submissions.
  const gnomadLines: SourceLine[] = gnomadRows.map(o => ({
    observation: o,
    name: o.id === "gnomad-local" ? o.label : `gnomAD ${o.label.toLowerCase()}`,
    source: "gnomad",
  }));
  const groupedLine: SourceLine | null = groupedMaxAf !== null
    ? {
        observation: {
          key: "gnomad-group", id: "gnomad-exomes", label: "Ancestry-grouped maximum", dataset: gnomadRelease ?? "",
          af: groupedMaxAf, ac: null, an: null, homozygotes: null, heterozygotes: null,
          availability: { ...(gnomadRows[0]?.availability ?? {}), state: "available", label: null, reason: null, hasValue: true } as FrequencyObservation["availability"],
        },
        name: "gnomAD grouped maximum",
        source: "gnomad",
        ruleInput: true,
        note: <>Frequency only, across ancestry groups of ≥ {formatCount(FREQ.groupMinAn)} alleles</>,
      }
    : null;
  const aouLine: SourceLine | null = aouRow
    ? {
        observation: aouRow,
        name: "All of Us",
        source: "all-of-us",
        note: aouRow.heterozygotes !== null || aouRow.homozygotes !== null
          ? <span className="pop-mono">{formatCount(aouRow.heterozygotes)} het · {formatCount(aouRow.homozygotes)} hom</span>
          : undefined,
      }
    : null;
  const clinvarLines: SourceLine[] = clinvarFrequencyRows.map(o => ({
    observation: o,
    name: o.label,
    qualifier: "via ClinVar",
    source: "clinvar-submissions",
    ruleInput: ruleClinvarAf !== null && o.af === ruleClinvarAf,
  }));
  const allLines = [
    ...gnomadLines,
    ...(groupedLine ? [groupedLine] : []),
    ...(aouLine ? [aouLine] : []),
    ...clinvarLines,
  ];
  const observedLines = allLines.filter(l => hasFigure(l.observation));
  const noReadingLines = allLines.filter(l => !hasFigure(l.observation));
  const readingsHaveRuleDot = observedLines.some(l => l.ruleInput);
  const readingsSummary = summariseReadings(evidence.observations);

  return (
    <div className="pop-screen @container">
      <header>
        <h1 className="screen-title">Population Data</h1>
        <p className="screen-tab-description">
          How often this allele has been seen in gnomAD, All of Us and ClinVar submissions — and which
          ACMG frequency criterion that supports.
        </p>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="pop-card pop-hero" aria-labelledby="pop-finding-title" data-testid="population-finding">
        <div className="pop-hero__body">
          <div className="pop-hero__top">
            <span className="eyebrow" id="pop-finding-title">
              <Gauge className="w-3.5 h-3.5" />
              ACMG population-frequency evidence
            </span>
            <VerdictChip criterion={criterion} applied={applied} />
          </div>

          <div className="pop-hero__figure">
            <span
              className="figure-headline pop-figure"
              data-absent={criterion.absent && !reading.mostCopies ? true : undefined}
              title={reading.mostCopies ? "Allele count · allele number" : "The frequency the ACMG rule read"}
            >
              {leadFigure}
            </span>
            {leadLabel && <span className="pop-hero__figure-label">{leadLabel}</span>}
          </div>

          <p className="detail-prose pop-hero__finding">
            {criterion.headline !== null && criterion.predicate !== null ? (
              <>
                <strong>{criterion.headline}</strong>
                {" — "}
                {criterion.predicate}.
              </>
            ) : (
              criterion.statement
            )}
          </p>

          {applied.suppressed && (
            <p className="pop-callout" data-tone="warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                The engine recorded no frequency criterion for this run
                {applied.withheldByWeighting
                  ? ` — the ${applied.weighting} weighting is what withholds it.`
                  : applied.weighting
                    ? ` (ACMG weighting: ${applied.weighting}).`
                    : "."}
              </span>
            </p>
          )}
        </div>

        {criterion.af !== null && (
          <div className="pop-hero__scale">
            <FrequencyScale
              criterion={criterion}
              readings={scaleReadings}
              ruleSource={`${reading.ruleSource}${gnomadRelease && reading.ruleSource.startsWith("gnomAD") ? ` · ${gnomadRelease}` : ""}`}
            />
          </div>
        )}


        {criterion.fallback && (
          <p className="pop-hero__footnote">
            grouped maximum fell back to the global maximum — no ancestry group reached{" "}
            {formatCount(FREQ.groupMinAn)} alleles
          </p>
        )}

        {(evidence.hasProviderFault || evidence.hasPendingSource || evidence.recoveryAction === "provide-allele") && (
          <div role="status" className="pop-callout pop-callout--banner" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {evidence.recoveryAction === "provide-allele"
                ? "Coordinate-based evidence needs the original nucleotide allele before it can be queried."
                : evidence.hasProviderFault
                ? "At least one source did not deliver a reading for this run, so the figures above may be incomplete."
                : "At least one source is still being queried, so the figures above may be incomplete."}{" "}
              The affected rows are marked below.
            </span>
            {/* Offered only when another attempt could change the answer, never for a coverage fact. */}
            {evidence.recoveryAction === "provide-allele" && onNavigateToView && (
              <button type="button" className="pop-callout__action" onClick={provideAllele}>
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                Provide nucleotide allele
              </button>
            )}
            {evidence.recoveryAction === "retry" && !evidence.hasPendingSource && (
              <button type="button" className="pop-callout__action" onClick={requestRerun}>
                <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                Re-run analysis
              </button>
            )}
          </div>
        )}
      </section>

      <div className="pop-lower">
        {/* ── 2. Source readings ──────────────────────────────────────────────────────────── */}
        <section className="pop-section" aria-labelledby="pop-readings-title">
          <h2 className="eyebrow" id="pop-readings-title">
            <Database className="w-3.5 h-3.5" />
            Source readings
            {gnomadRelease && <span className="pop-eyebrow-meta">gnomAD {gnomadRelease}</span>}
          </h2>
          <div className="pop-card pop-card--split pop-readings" data-testid="population-readings">
            {observedLines.length > 0 ? (
              <div className="pop-table-wrap">
                <table className="pop-table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col" className="pop-num" title="Allele count / allele number — copies of the allele, out of alleles genotyped">AC / AN</th>
                      <th scope="col" className="pop-num" title="Allele frequency (AC ÷ AN)">AF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observedLines.map(line => <SourceRow key={line.observation.key} line={line} />)}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="pop-card__head pop-card__head--cols">
                  <span className="pop-card__head-label">Source</span>
                  <span className="pop-card__head-label">Reading</span>
                </div>
                {/* Bounded to what was actually asked: "reported nothing" only for sources that answered. */}
                <p className="pop-readings__empty" data-kind={readingsSummary?.kind}>
                  <span className="pop-readings__empty-mark" aria-hidden="true" />
                  <strong>{readingsSummary?.text ?? "No source reported this allele."}</strong>
                </p>
              </>
            )}

            {noReadingLines.length > 0 && (
              <div className="pop-noread">
                {/* With nothing observed, the summary line above already says it. */}
                {observedLines.length > 0
                  ? <h3 className="pop-noread__title">No reading</h3>
                  : <h3 className="sr-only">No reading</h3>}
                <ul className="pop-noread__list">
                  {noReadingLines.map(line => <NoReadingItem key={line.observation.key} line={line} />)}
                </ul>
              </div>
            )}

            {/* Always present, so its bottom edge matches the ClinVar card's foot beside it. */}
            <div className="pop-card__foot">
              {readingsHaveRuleDot ? (
                <span className="pop-readings__key"><RuleDot /> Value the ACMG rule used</span>
              ) : (
                <span>gnomAD{gnomadRelease ? ` ${gnomadRelease}` : ""} · All of Us · ClinVar submissions</span>
              )}
                {/* BS2 is the other population criterion; the homozygote count is its input. */}
                {evidence.gnomadHomozygotes !== null && (
                  <span className="pop-readings__hom">
                    gnomAD homozygotes <span className="pop-mono pop-strong">{formatCount(evidence.gnomadHomozygotes)}</span>
                    {bs2 !== null && (
                      <span
                        className="ev-tier chip-code"
                        data-tone={bs2 ? "good" : "muted"}
                        title={bs2 ? "The engine recorded BS2 for this run" : "The engine did not record BS2 for this run"}
                      >
                        {bs2 ? "BS2" : "No BS2"}
                      </span>
                    )}
                  </span>
                )}
            </div>
          </div>
        </section>

        {/* ── 3. Clinical assertion ───────────────────────────────────────────────────────── */}
        <section className="pop-section" aria-labelledby="pop-clinvar-title">
          <h2 className="eyebrow" id="pop-clinvar-title">
            <Scale className="w-3.5 h-3.5" />
            Clinical assertion
          </h2>
          <div className="pop-card pop-card--split pop-clinvar" data-testid="clinvar-panel">
            <div className="pop-card__head">
              <span className="pop-card__head-label">ClinVar</span>
              {clinvarVcv && (
                <a
                  className="pop-link"
                  href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(clinvarUid ?? "")}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {clinvarVcv}
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </div>

            {!clinvar.availability.hasValue ? (
              <div className="pop-clinvar__empty">
                <p className="pop-clinvar__empty-title">
                  {clinvar.availability.state === "no-result" ? "No classification" : clinvar.availability.label ?? "Not available"}
                </p>
                <p className="pop-clinvar__empty-body">
                  {clinvar.availability.reason ?? "No classification in ClinVar is available for this variant."}
                </p>
              </div>
            ) : (
              <dl className="pop-clinvar__rows">
                <div>
                  <dt>Classification</dt>
                  <dd>
                    <span className="ev-tier ev-tier--lg" data-tone={classificationTone(clinvar.classification ?? "")}>
                      {clinvar.classification}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>
                    {stars !== null && <Stars count={stars} />}
                    <span>{cv?.reviewStatus || "Not reported"}</span>
                  </dd>
                </div>
                <div>
                  <dt>Condition</dt>
                  <dd title={cv?.trait ?? undefined}>{cv?.trait || "Not reported"}</dd>
                </div>
              </dl>
            )}

            <div className="pop-card__foot">
              <span>NCBI ClinVar</span>
              {clinvar.availability.hasValue && (
                <span>
                  Last evaluated <span className="pop-mono pop-strong">{lastEvaluated ?? "not reported"}</span>
                </span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default ClinicalTab;
