import React from "react";
import { AlertTriangle, Database, ExternalLink, Gauge, Scale, Star } from "lucide-react";
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
  type FrequencyObservation,
} from "../../shared/frequencyEvidence";
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

/** One label · value fact in the finding's fact strip. */
function Fact({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="pop-fact">
      <dt className="pop-fact__label">{label}</dt>
      <dd className="pop-fact__value" title={title}>{children}</dd>
    </div>
  );
}

/** Numeric cell: mono, tabular, right-aligned. A missing value is an em dash, never a zero. */
function Num({ value, title }: { value: string | null; title?: string }) {
  return (
    <td className="pop-num" title={title}>
      {value ?? <span className="pop-dim">—</span>}
    </td>
  );
}

/**
 * One source reading as a table row.
 *
 * A source with neither counts nor a frequency spans its reason across the three numeric columns: a
 * row of three dashes says less than the one sentence explaining why there is nothing.
 */
function ReadingRow({
  observation,
  subject,
  ruleInput = false,
  note,
}: {
  observation: FrequencyObservation;
  subject?: string;
  ruleInput?: boolean;
  note?: React.ReactNode;
}) {
  const hasCounts = observation.ac !== null || observation.an !== null;
  const hasAf = observation.af !== null;
  const empty = !hasCounts && !hasAf;
  const reason = empty
    ? observationAbsence(observation)
    : !hasAf && observation.availability.reason
      ? observationAbsence(observation)
      : null;

  return (
    <tr data-rule-input={ruleInput || undefined} data-testid={`reading-${observation.key}`}>
      <th scope="row" className="pop-subject">
        <span className="pop-subject__name">{subject ?? observation.label}</span>
        {ruleInput && <span className="ev-tier" data-tone="accent">Rule input</span>}
        {!empty && reason && <span className="pop-subject__note">{reason}</span>}
        {note && <span className="pop-subject__note">{note}</span>}
      </th>
      {empty ? (
        <td colSpan={3} className="pop-reason">{reason}</td>
      ) : (
        <>
          <Num value={observation.ac !== null ? formatCount(observation.ac) : null} title="Allele count" />
          <Num value={observation.an !== null ? formatCount(observation.an) : null} title="Allele number" />
          <Num value={hasAf ? formatAlleleFrequency(observation.af) : null} title="Allele frequency" />
        </>
      )}
      <td className="pop-status">
        <StateChip observation={observation} />
      </td>
    </tr>
  );
}

/** A group header inside the readings table: the source, and the release when the payload names one. */
function GroupRow({ title, meta }: { title: string; meta?: string | null }) {
  return (
    <tr className="pop-group">
      <th colSpan={5} scope="rowgroup">
        <span className="pop-group__title">{title}</span>
        {meta && <span className="pop-group__meta">{meta}</span>}
      </th>
    </tr>
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

export function ClinicalTab({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  const evidence = buildFrequencyEvidence({
    gnomadFrequency: result.gnomadFrequency ?? null,
    aouFrequency: result.aouFrequency ?? null,
    serviceStatus: result.serviceStatus ?? result.metadata?.serviceStatus ?? null,
    clinvar: result.clinvar
      ? { classification: result.clinvar.classification, alleleFrequencies: result.clinvar.alleleFrequencies }
      : null,
    assembly: result.predictorData?.gnomadVariantAssembly ?? null,
    pli: result.gnomadConstraint?.pli ?? null,
    engineCriteria: result.ruleBasedInsights?.acmgCriteria ?? result.insights?.acmgCriteria ?? null,
    acmgWeighting: result.metadata?.acmgWeighting ?? null,
  });

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

  const inheritanceText =
    criterion.inheritance === "recessive" ? `recessive · pLI < ${FREQ.recessivePlI}`
    : criterion.inheritance === "dominant" ? `dominant · pLI ≥ ${FREQ.recessivePlI}`
    : "dominant/unknown · no pLI";

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
              className="figure-headline"
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
            <FrequencyScale criterion={criterion} readings={scaleReadings} />
          </div>
        )}

        <dl className="pop-facts">
          {/* An absence is already the headline and the "Read from" line; a third "0" adds nothing. */}
          {reading.ruleAf !== null && !criterion.absent && (
            <Fact label="AF the rule read" title={reading.ruleSource}>
              <span className="pop-mono">{formatAlleleFrequency(reading.ruleAf)}</span>
            </Fact>
          )}
          <Fact label="Read from">
            {reading.ruleSource}
            {gnomadRelease && reading.ruleSource.startsWith("gnomAD") ? ` · ${gnomadRelease}` : ""}
          </Fact>
          {criterion.pm2Ceiling !== null && (
            <Fact label="PM2 ceiling">
              <span className="pop-mono">≤ {formatAlleleFrequency(criterion.pm2Ceiling)}</span>
              <span className="pop-fact__sub">{inheritanceText}</span>
            </Fact>
          )}
          <Fact label="Engine record">
            {applied.known
              ? applied.code ?? "No frequency criterion"
              : "Not in payload"}
            {applied.weighting && <span className="pop-fact__sub">{applied.weighting} weighting</span>}
          </Fact>
        </dl>

        {criterion.fallback && (
          <p className="pop-hero__footnote">
            grouped maximum fell back to the global maximum — no ancestry group reached{" "}
            {formatCount(FREQ.groupMinAn)} alleles
          </p>
        )}

        {(evidence.hasProviderFault || evidence.hasPendingSource) && (
          <div role="status" className="pop-callout pop-callout--banner" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {evidence.hasProviderFault
                ? "At least one source did not deliver a reading for this run, so the figures above may be incomplete."
                : "At least one source is still being queried, so the figures above may be incomplete."}{" "}
              The affected rows are marked below.
            </span>
          </div>
        )}
      </section>

      <div className="pop-lower">
        {/* ── 2. Source readings ──────────────────────────────────────────────────────────── */}
        <section className="pop-section" aria-labelledby="pop-readings-title">
          <h2 className="eyebrow" id="pop-readings-title">
            <Database className="w-3.5 h-3.5" />
            Source readings
          </h2>
          <div className="pop-card pop-table-wrap">
            <table className="pop-table" data-testid="population-readings">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col" className="pop-num" title="Allele count — copies of the alternate allele">AC</th>
                  <th scope="col" className="pop-num" title="Allele number — alleles genotyped at this site">AN</th>
                  <th scope="col" className="pop-num" title="Allele frequency (AC ÷ AN)">AF</th>
                  <th scope="col" className="pop-status">Status</th>
                </tr>
              </thead>

              <tbody data-source="gnomad">
                <GroupRow title="gnomAD" meta={gnomadRelease} />
                {gnomadRows.map(row => (
                  <ReadingRow key={row.key} observation={row} />
                ))}
                {groupedMaxAf !== null && (
                  <tr data-rule-input data-testid="reading-gnomad-group">
                    <th scope="row" className="pop-subject">
                      <span className="pop-subject__name">Ancestry-grouped maximum</span>
                      <span className="ev-tier" data-tone="accent">Used for classification</span>
                      <span className="pop-subject__note">
                        Frequency only — gnomAD reports no counts for it; ancestry groups of ≥{" "}
                        {formatCount(FREQ.groupMinAn)} alleles.
                      </span>
                    </th>
                    <Num value={null} title="Not reported for the grouped maximum" />
                    <Num value={null} title="Not reported for the grouped maximum" />
                    <Num value={formatAlleleFrequency(groupedMaxAf)} title="Highest allele frequency across gnomAD ancestry groups" />
                    <td className="pop-status"><span className="ev-tier" data-tone="good">Measured</span></td>
                  </tr>
                )}
              </tbody>

              {aouRow && (
                <tbody data-source="all-of-us">
                  <GroupRow title="All of Us" meta="local frequency table" />
                  <ReadingRow
                    observation={aouRow}
                    subject="All ancestries"
                    note={
                      aouRow.heterozygotes !== null || aouRow.homozygotes !== null
                        ? <span className="pop-mono">{formatCount(aouRow.heterozygotes)} het · {formatCount(aouRow.homozygotes)} hom</span>
                        : undefined
                    }
                  />
                </tbody>
              )}

              {clinvarFrequencyRows.length > 0 && (
                <tbody data-source="clinvar-submissions">
                  <GroupRow title="ClinVar-submitted frequencies" />
                  {clinvarFrequencyRows.map(row => (
                    <ReadingRow
                      key={row.key}
                      observation={row}
                      ruleInput={ruleClinvarAf !== null && row.af === ruleClinvarAf}
                    />
                  ))}
                </tbody>
              )}
            </table>

            {/* BS2 is the other population criterion; the homozygote count is its input. */}
            {evidence.gnomadHomozygotes !== null && (
              <div className="pop-table-foot">
                <span>
                  gnomAD homozygotes <span className="pop-dim">(exomes + genomes)</span>
                </span>
                <span className="pop-table-foot__value">
                  <span className="pop-mono">{formatCount(evidence.gnomadHomozygotes)}</span>
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
              </div>
            )}
          </div>
        </section>

        {/* ── 3. Clinical assertion ───────────────────────────────────────────────────────── */}
        <section className="pop-section" aria-labelledby="pop-clinvar-title">
          <h2 className="eyebrow" id="pop-clinvar-title">
            <Scale className="w-3.5 h-3.5" />
            Clinical assertion
          </h2>
          <div className="pop-card pop-clinvar" data-testid="clinvar-panel">
            <div className="pop-clinvar__head">
              <span className="card-title text-cs-text-secondary">ClinVar</span>
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
              <p className="detail-prose pop-clinvar__empty">
                {clinvar.availability.reason ?? "No classification in ClinVar is available for this variant."}
              </p>
            ) : (
              <div className="pop-clinvar__body">
                <span className="ev-tier ev-tier--lg self-start" data-tone={classificationTone(clinvar.classification ?? "")}>
                  {clinvar.classification}
                </span>
                <dl className="pop-kv">
                  <div>
                    <dt>Review status</dt>
                    <dd>
                      {stars !== null && <Stars count={stars} />}
                      <span>{cv?.reviewStatus || "Not reported"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Condition</dt>
                    <dd title={cv?.trait ?? undefined}>{cv?.trait || "Not reported"}</dd>
                  </div>
                  <div>
                    <dt>Last evaluated</dt>
                    <dd className="pop-mono">{lastEvaluated ?? "Not reported"}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default ClinicalTab;
