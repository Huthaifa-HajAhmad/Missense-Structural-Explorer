import React from "react";
import { Database, Gauge, Info } from "lucide-react";
import { TabComponentProps } from "./types";
import {
  buildFrequencyEvidence,
  formatAlleleCounts,
  formatAlleleFrequency,
  formatCount,
  frequencySourceLabel,
  populationReading,
  observationAbsence,
  type FrequencyApplication,
  type FrequencyCriterion,
  type FrequencyObservation,
} from "../../shared/frequencyEvidence";
import type { EvidenceAvailabilityState } from "../../shared/evidenceAvailability";
import { THRESHOLDS } from "../../shared/thresholds";

/**
 * Population Data.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * One question: *has anyone seen this variant, and how often?* The answer is a count against a
 * denominator — 17 alleles in 1,461,892 exome alleles — and that is what the rows lead with. The
 * allele FREQUENCY each source also reports is carried underneath it as fine print: it is the value
 * the ACMG rule engine thresholds on, so it must stay traceable, but a rare-disease reading is done
 * with counts, not by dividing them.
 *
 * A source that reports no counts at all — a ClinVar submission, gnomAD's ancestry-grouped maximum —
 * leads with its frequency, because for that row the frequency is all there is.
 *
 * FOUR THINGS IT DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * 1. **It does not word an absence.** Every empty source renders `observationAbsence`: the canonical
 *    engine label plus the reason the pipeline actually recorded. A gnomAD timeout says "Provider
 *    error", not "Absent … (rare/novel variant)" — the claim that made this screen assert the
 *    opposite of the truth during an outage.
 * 2. **It does not recompute the engine's decision.** `evidence.criterion` is what the frequency
 *    supports; `evidence.applied` is what the engine recorded (`criteria.ts` gates PM2 on the
 *    user-selectable `acmgWeighting`). The verdict shown is the engine's, and a suppressed criterion
 *    is stated rather than silently substituted.
 * 3. **It does not carry its own copy of the cut-points.** They come from
 *    `THRESHOLDS.populationFrequency`, the same constant the server's classifier branches on.
 * 4. **It does not hide a count because a frequency is missing.** A source that reports an allele
 *    count but no denominator has no frequency to show and its count still leads.
 *
 * TYPOGRAPHY — the ramp lives in `styles/typography-tables.css` and is shared with the Evidence
 * Lineage rail: 22 governing figure · 18 screen title · 14 per-source read-out · 13 sentences ·
 * 12 card titles and row subjects · 11 chips and fine print · 10 section eyebrows. The ranks a
 * reader scans are ≥4px apart; the quiet ones are told apart by family and case, not by 1px.
 */

/** Eyebrow above a group — `.eyebrow`, the same rank the Evidence Lineage rail's labels carry. */
function Eyebrow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="eyebrow">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </span>
  );
}

/** Card shell: one surface, one hairline border. Rows are separated by hairlines, not by boxes. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border flex flex-col overflow-hidden"
      style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
    >
      {children}
    </div>
  );
}

/**
 * Card title, on the `.card-title` rank the Evidence Lineage rail's cards use.
 *
 * `trailing` lets a card whose single row would otherwise repeat its title (All of Us) carry that
 * row's state chip in the header instead of printing the same words twice in one card.
 */
function CardHeader({ title, meta, trailing }: { title: string; meta?: string | null; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--cs-border-subtle)" }}>
      <span className="card-title text-cs-text-secondary">{title}</span>
      {trailing ?? (meta ? (
        <span className="readout-note text-cs-text-muted">{meta}</span>
      ) : null)}
    </div>
  );
}

/**
 * Per-state chip tone, on the workspace's `.ev-tier` tones.
 *
 * Keyed on `availability.state`, not on the resolver's `tone`, because this screen must not let a
 * variant fact and a run fault share a colour: `resolveEvidenceAvailability` maps `no-result` to
 * `warn`, so keying on tone painted a *healthy* "no record" chip the same amber as "Provider error"
 * — and amber already means "likely pathogenic" in the ClinVar badge on this same screen.
 */
const STATE_TONE: Record<EvidenceAvailabilityState, string> = {
  available: "good",
  "no-result": "neutral",
  "not-covered": "muted",
  "not-configured": "muted",
  "upstream-error": "warning",
  pending: "neutral",
};

/**
 * Every chip on this screen is `.ev-tier` — one padding, one radius, one 11px/600 voice, one token
 * set that already carries both themes and the print pass. Before this, the state chip, the verdict
 * chip and the "Used for classification" chip each carried their own box geometry, family and
 * hand-written `color-mix()` triple, which is what made the right-hand edge of a card read as three
 * unrelated widgets.
 */
function StateChip({ observation }: { observation: FrequencyObservation }) {
  const { label, state } = observation.availability;
  /*
   * A source that reported counts but no denominator has a PARTIAL reading, and the canonical
   * "No result" chip sat directly above its own `AC 12` denying it. The override is confined to
   * states that are not a run fault: a timed-out row that still carries stale counts must keep
   * saying "Provider error", because that is a fact about the run the reader cannot infer from a
   * frequency line going missing.
   */
  const faulted = state === "upstream-error" || state === "pending"
    || state === "not-covered" || state === "not-configured";
  const partial = !faulted && observation.af === null
    && (observation.ac !== null || observation.an !== null);
  // `available` has no canonical label by design, so the surface supplies the neutral word.
  const text = partial ? "No frequency" : label ?? "Measured";
  return (
    <span className="ev-tier shrink-0" data-tone={STATE_TONE[state] ?? "neutral"}>
      {text}
    </span>
  );
}

/**
 * The allele frequency as fine print.
 *
 * Every row on this screen answers "how many copies, out of how many alleles" first; this is the
 * quotient the ACMG thresholds are written against, kept one rank below it and labelled `AF` so a
 * reader who wants it knows what they are looking at and one who does not can skip the line. The
 * value is its own element rather than text after the prefix, so the figure stays addressable.
 */
function FrequencyNote({ af, source }: { af: number; source?: string }) {
  return (
    <span className="readout-note flex items-baseline gap-x-1.5 flex-wrap" style={{ color: "var(--cs-text-muted)" }}>
      <span>
        AF <span>{formatAlleleFrequency(af)}</span>
      </span>
      {source && <span>· {source}</span>}
    </span>
  );
}

/**
 * One source row.
 *
 * THE ROW GRAMMAR
 * ------------------------------
 *   card title        `.card-title`      12 sans 500 uppercase — structure
 *   row subject       `.row-subject`     12 sans 500 secondary — what this row is
 *   counts            `.readout`         14 mono 600 tabular   — the row's answer
 *   frequency         `.readout-note`    11 mono 400 muted     — the rule's input, demoted
 *   absence sentence  `.detail-prose`    13 sans 400
 *   state chip        `.ev-tier`         11 sans 600
 *
 * The subject is one size BELOW its own figure and set in secondary colour. It used to be 13px in
 * ink, sitting directly above a 13px label and a 20px number, so three voices in one row all claimed
 * to be the point. The counts lead because they are what a rare-disease reading is actually done
 * with; the frequency they divide into stays visible because PM2/BS1/BA1 are written against it.
 *
 * `showSubject={false}` is for a card whose header already IS the subject (All of Us), so the row
 * does not print the same words twice in one card.
 */
function ObservationRow({ observation, showSubject = true }: { observation: FrequencyObservation; showSubject?: boolean }) {
  const { availability } = observation;
  const counts = formatAlleleCounts(observation);

  return (
    <div className="px-4 py-3 flex flex-col gap-1" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
      {showSubject && (
        <div className="flex items-start justify-between gap-3">
          <span className="row-subject" style={{ color: "var(--cs-text-secondary)" }}>
            {observation.label}
          </span>
          <StateChip observation={observation} />
        </div>
      )}

      {counts !== null ? (
        <>
          {/* No sr-only label: `AC` and `AN` are the visible tokens, and a hidden expansion of them
              mislabelled a row that reported only one half. */}
          <span className="readout" style={{ color: "var(--cs-text-primary)" }} title="Allele count · allele number">
            {counts}
          </span>
          {/* The frequency when the row has one; the reason it does not, when it has counts but no
              denominator to divide them by. */}
          {observation.af !== null ? (
            <FrequencyNote af={observation.af} />
          ) : (
            availability.reason && (
              <p className="detail-prose" style={{ color: "var(--cs-text-secondary)" }}>
                {observationAbsence(observation)}
              </p>
            )
          )}
        </>
      ) : observation.af !== null ? (
        /* No counts exist for this source — a ClinVar submission, or gnomAD's grouped maximum — so
           the frequency is the reading rather than a derivation from one. */
        <span className="readout" style={{ color: "var(--cs-text-primary)" }} title={`Allele frequency in ${observation.label}`}>
          {formatAlleleFrequency(observation.af)}
        </span>
      ) : (
        /*
          * A row that reported neither counts nor a frequency still has to say so. The old code
          * printed `availability.reason` alone, and the resolver records no reason for a query that
          * is merely still running — which left that row rendering a subject and a chip over an
          * empty body. `observationAbsence` is bounded to what is known and never claims absence.
          */
        <p className="detail-prose" style={{ color: "var(--cs-text-secondary)" }}>
          {availability.reason ?? "No allele counts or frequency reported by this source."}
        </p>
      )}
    </div>
  );
}

/**
 * The verdict chip. Three states, one visual grammar each:
 *
 *  - CONFIRMED — the engine recorded this criterion: solid border, verdict colour.
 *  - SUPPORTED, UNCONFIRMED — the frequency meets a criterion but this payload carries no engine
 *    record to check it against: the code alone behind a DASHED clay border. "Suggested" is a
 *    visual state, not a punctuation mark — the previous revision printed "PM2?" and then spent a
 *    two-line paragraph explaining the "?", one fact in two voices. The qualifier lives in the
 *    accessible name and the hover title instead.
 *  - NOTHING — no criterion, withheld, or the engine recorded none while the frequency supports
 *    one (that disagreement is the suppression note's job, not the chip's).
 *
 * Tone is chosen so amber means ONE thing on this screen: a run fault, already carried by the
 * fault banner. `no-result`'s resolver tone is deliberately overridden here: the resolver maps it
 * to `warn`, which would paint a healthy "no record" chip as a failure.
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

  // An ACMG code is an identifier, so it takes the mono voice it has in the rail's criteria list;
  // the words that stand in for a code ("No criterion", "Withheld") stay in the prose family.
  const isCode = /^[A-Z]+\d+$/.test(text);

  return (
    <span
      className={`ev-tier shrink-0${isCode ? " chip-code" : ""}`}
      data-tone={tone}
      /* The ONLY thing distinguishing a supported-but-unconfirmed criterion from a recorded one is
         this dash — the qualifier deliberately has no visible punctuation and no second sentence. */
      style={unconfirmed ? { borderStyle: "dashed" } : undefined}
      title={
        applied.known
          ? "The ACMG frequency criterion this run recorded"
          : unconfirmed
            ? `${criterion.code} is what the frequency supports — this payload carries no engine record to confirm it against`
            : "No frequency criterion was applied"
      }
      aria-label={
        unconfirmed ? `${criterion.code}, supported by the frequency, unconfirmed by the engine record` : undefined
      }
    >
      {text}
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
  const gnomadRows = evidence.observations.filter(o => o.id.startsWith("gnomad"));
  const aouRow = evidence.observations.find(o => o.id === "all-of-us");
  const clinvarFrequencyRows = evidence.observations.filter(o => o.id === "clinvar-submissions");
  const gnomadMeta = gnomadRows[0]?.dataset ?? null;
  const clinvarClassification = clinvar.classification;

  /**
   * The governing value, when it is one no card shows.
   *
   * `groupMaxAF` is the maximum across gnomAD's ancestry groups, which is rarely equal to a dataset's
   * global AF — for CNNM2 p.Ser489Cys it is 0.031% against 1.16e-5 and 1.97e-5. Without a row of its
   * own the headline is a number the reader cannot find anywhere below it. Rendered as a DERIVED
   * value, not as a source reading: it belongs to no single dataset.
   */
  const groupedMaxAf = criterion.usedGroupMax ? criterion.af : null;

  /**
   * The screen's figure and the rule's input, as two labelled lines.
   *
   * The figure is the busiest cohort's counts, because that is the reading a rare-disease review
   * actually works from. The frequency PM2/BS1/BA1 threshold on is printed beneath it WITH its own
   * label, because the two are usually different populations: the rule reads gnomAD's ancestry-grouped
   * maximum, which has no allele count anywhere in the payload. Stacking them unlabelled implies the
   * second divides out of the first — for CNNM2 p.Ser489Cys that implied quotient is 1.2e-5 against a
   * stated 0.031%, a 26× gap that moves the variant between PM2 and no criterion at all.
   */
  const reading = populationReading(evidence);
  const leadFigure = reading.mostCopies
    ? reading.mostCopies.counts
    : reading.ruleAf !== null ? formatAlleleFrequency(reading.ruleAf)
    : "No reading";
  const leadLabel = reading.mostCopies
    ? `${reading.mostCopies.label} · most copies in any one cohort`
    : reading.ruleAf !== null ? reading.ruleSource
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Population Data</h1>
        <p className="screen-tab-description">
          Allele counts and allele numbers from gnomAD, All of Us and ClinVar, the frequency each one
          divides into, and what the ACMG rule engine made of it.
        </p>
      </div>

      {/* ── The finding: what was observed, and which criterion that supports ── */}
      <Card>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <Eyebrow icon={Gauge}>ACMG population-frequency evidence</Eyebrow>
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className="figure-headline"
                  style={{ color: "var(--cs-text-primary)" }}
                  title={reading.mostCopies ? "Allele count · allele number" : "The frequency the ACMG rule read"}
                >
                  {leadFigure}
                </span>
                {leadLabel && (
                  <span className="prose-meta" style={{ color: "var(--cs-text-muted)" }}>
                    {leadLabel}
                  </span>
                )}
              </span>
              {/* Only when the figure is counts: if the figure already IS the frequency, naming its
                  source above is enough and a second copy of it would be noise. */}
              {reading.mostCopies && reading.ruleAf !== null && (
                <span className="readout-note flex items-baseline gap-x-1.5 flex-wrap" style={{ color: "var(--cs-text-muted)" }}>
                  <span>AF the rule read</span>
                  <span title={reading.ruleSource}>{formatAlleleFrequency(reading.ruleAf)}</span>
                  <span>· {reading.ruleSource}</span>
                </span>
              )}
            </div>
            <VerdictChip criterion={criterion} applied={applied} />
          </div>

          {/*
            * The prose states the FINDING, not the number again: the lead above is the value, and
            * the previous revision printed it a second time inside the sentence ("Extremely rare:
            * 0.031% is at or below…") and a third time in the gnomAD card below. `headline` +
            * `predicate` are the module's value-free halves of the same sentence it composes for
            * surfaces (the rail) that show no figure — so the two renderings cannot disagree.
            */}
          <p className="detail-prose" style={{ color: "var(--cs-text-secondary)" }}>
            {criterion.headline !== null && criterion.predicate !== null ? (
              <>
                <span className="font-medium" style={{ color: "var(--cs-text-primary)" }}>{criterion.headline}</span>
                {" — "}
                {criterion.predicate}.
              </>
            ) : (
              criterion.statement
            )}
          </p>

          {/*
            * The engine can record no frequency criterion while the frequency supports one. The
            * chip ("No criterion") and the prose ("Extremely rare — …PM2 ceiling…") then read as a
            * contradiction, so a bridge sentence is required — but it states only the engine's
            * decision and its CAUSE, never the value or threshold the prose already carries.
            * Only a weighting that actually suppresses frequency evidence may be named as the
            * reason: a `standard` run that records no PM2 has some other cause, and claiming
            * "the weighting withheld it" there would be inventing one.
            */}
          {applied.suppressed && (
            <p
              className="detail-prose"
              style={{ color: "var(--cs-text-warning-on-soft)" }}
            >
              The engine recorded no frequency criterion for this run
              {applied.withheldByWeighting
                ? ` — the ${applied.weighting} weighting is what withholds it.`
                : applied.weighting
                  ? ` (ACMG weighting: ${applied.weighting}).`
                  : "."}
            </p>
          )}

          {/*
            * The footer carries only what the rest of the card cannot: the grouped-maximum fallback,
            * a fact about HOW the value was derived. The dataset list that used to sit here
            * ("Datasets reporting a frequency: Exomes · Genomes") duplicated the Measured chips on
            * the cards below, and the unconfirmed-criterion paragraph duplicated the dashed chip —
            * both removed rather than reworded.
            */}
          {criterion.fallback && (
            <div className="detail-prose flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-2" style={{ borderTop: "1px solid var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
              <span>
                grouped maximum fell back to the global maximum — no ancestry group reached {formatCount(THRESHOLDS.populationFrequency.groupMinAn)} alleles
              </span>
            </div>
          )}
        </div>

        {/*
          * A source that failed is a fact about the run, not about the variant, so it is stated once,
          * in its own colour, above the readings rather than being folded into a card that would
          * otherwise read as "nothing found". `role="status"` because it can appear after the first
          * paint, as the pipeline settles.
          */}
        {(evidence.hasProviderFault || evidence.hasPendingSource) && (
          <div
            role="status"
            className="px-4 py-2.5 flex items-start gap-2 detail-prose"
            style={{ background: "var(--cs-bg-warning)", color: "var(--cs-text-warning-on-soft)", borderTop: "1px solid var(--cs-border-subtle)" }}
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {evidence.hasProviderFault
                ? "At least one source did not deliver a reading for this run, so the figures above may be incomplete."
                : "At least one source is still being queried, so the figures above may be incomplete."}{" "}
              The affected rows are marked below.
            </span>
          </div>
        )}
      </Card>

      <Eyebrow icon={Database}>Source readings</Eyebrow>

      {/*
        * `items-start`: the three sources carry different amounts of evidence — gnomAD reports two
        * cohorts plus the grouped maximum, while a variant absent from ClinVar and unqueried in All of
        * Us reports one sentence each. Stretched to the tallest card, those two rendered as a line of
        * text floating in a few hundred pixels of white, which reads as a broken panel rather than as
        * "this source had nothing to say".
        */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* ── ClinVar interpretation ── */}
        <Card>
          {/* The "NCBI" meta was decoration — the rail's provenance row already names the source
              and mechanism; gnomAD's meta ("v4") survives because it is data the payload carries. */}
          <CardHeader title="ClinVar" />
          {/*
            * Routed through the module's `clinvarAvailability`: ClinVar is a source like any other
            * and its fetch carries a status, so an outage must not render as "no submitter has
            * classified it" — a negative clinical result manufactured from a failed request.
            */}
          {!clinvar.availability.hasValue ? (
            <div className="flex flex-col">
              <div className="px-4 py-3">
                <p className="detail-prose" style={{ color: "var(--cs-text-secondary)" }}>
                  {clinvar.availability.reason ??
                    "No classification in ClinVar is available for this variant."}
                </p>
              </div>
              {clinvarFrequencyRows.map(row => (
                <ObservationRow key={row.key} observation={row} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="px-4 py-3 flex flex-col gap-2">
                <span className="metric-card-label">Classification</span>
                <span
                  className="ev-tier ev-tier--lg self-start"
                  data-tone={classificationTone(clinvarClassification ?? "")}
                >
                  {clinvarClassification}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 detail-prose" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Review status</span>
                <span className="text-right" style={{ color: "var(--cs-text-primary)" }}>{result.clinvar?.reviewStatus || "Not reported"}</span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 detail-prose" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span className="shrink-0" style={{ color: "var(--cs-text-muted)" }}>Associated trait</span>
                <span className="text-right" style={{ color: "var(--cs-text-primary)" }}>
                  <span className="sr-only">Associated trait: </span>
                  <span className="block truncate" title={result.clinvar?.trait ?? undefined}>
                    {result.clinvar?.trait || "Not reported"}
                  </span>
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 detail-prose" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Last evaluated</span>
                <span className="readout-note" style={{ color: "var(--cs-text-primary)" }}>
                  {result.clinvar?.lastEvaluated && !isNaN(new Date(result.clinvar.lastEvaluated).getTime())
                    ? new Date(result.clinvar.lastEvaluated).toLocaleDateString()
                    : "Not reported"}
                </span>
              </div>

              {clinvarFrequencyRows.map(row => (
                <ObservationRow key={row.key} observation={row} />
              ))}
            </div>
          )}
        </Card>

        {/* ── gnomAD ── */}
        <Card>
          <CardHeader title="gnomAD" meta={gnomadMeta} />
          <div className="flex flex-col">
            {gnomadRows.map(row => (
              <ObservationRow key={row.key} observation={row} />
            ))}

            {/*
              * The value the criterion used, when it is a grouped maximum rather than either
              * dataset's global AF. Without this the headline is a number the reader cannot find
              * anywhere on the screen. The AN floor is READ from the shared constant the server's
              * query filters on — the copy used to hard-code "2,000", which is a number that
              * drifts the day the server's floor changes.
              */}
            {groupedMaxAf !== null && (
              <div className="px-4 py-3 flex flex-col gap-1" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="row-subject" style={{ color: "var(--cs-text-secondary)" }}>
                    Ancestry-grouped maximum
                  </span>
                  <span className="ev-tier shrink-0" data-tone="accent">
                    Used for classification
                  </span>
                </div>
                <span
                  className="readout"
                  style={{ color: "var(--cs-text-primary)" }}
                  title="Allele frequency — highest across gnomAD ancestry groups"
                >
                  <span className="sr-only">Allele frequency: </span>
                  {formatAlleleFrequency(groupedMaxAf)}
                </span>
                <p className="detail-prose" style={{ color: "var(--cs-text-muted)" }}>
                  No counts reported — gnomAD gives this as a frequency alone, taken from ancestry
                  groups of ≥ {formatCount(THRESHOLDS.populationFrequency.groupMinAn)} alleles.
                </p>
              </div>
            )}

            {evidence.gnomadHomozygotes !== null && evidence.gnomadHomozygotes > 0 && (
              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 detail-prose" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                {/* Neutral: homozygotes in a reference cohort argue AGAINST a severe dominant variant,
                    so colouring the count as danger inverted the inference it carries. */}
                <span style={{ color: "var(--cs-text-muted)" }}>Homozygotes observed</span>
                <span className="readout-inline" style={{ color: "var(--cs-text-primary)" }}>
                  {formatCount(evidence.gnomadHomozygotes)}
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* ── All of Us ── */}
        <Card>
          {/*
            * The card's single row would otherwise print "All of Us" twice — once as the header,
            * once as the row subject — so the row's state chip moves up into the header and the
            * row renders bare. The "cohort" meta that used to sit here was decoration, not data:
            * gnomAD's meta ("v4") is a release the payload establishes.
            */}
          <CardHeader
            title="All of Us"
            trailing={aouRow ? <StateChip observation={aouRow} /> : undefined}
          />
          <div className="flex flex-col">
            {aouRow && <ObservationRow observation={aouRow} showSubject={false} />}
            {aouRow && (aouRow.heterozygotes !== null || aouRow.homozygotes !== null) && (
              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 detail-prose" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Heterozygotes · homozygotes</span>
                <span className="readout-inline" style={{ color: "var(--cs-text-primary)" }}>
                  {formatCount(aouRow.heterozygotes)} · {formatCount(aouRow.homozygotes)}
                </span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * ClinVar classification → `.ev-tier` tone, by explicit match rather than substring.
 *
 * `/pathogenic/i` matches "Conflicting interpretations of **pathogenic**ity", so the previous chain
 * rendered a conflicting (VUS-class) record with the pathogenic red. The order below tests the
 * downgraded and conflicting labels first, and matches whole words for the rest.
 */
function classificationTone(classification: string): string {
  const lower = classification.toLowerCase();
  if (/conflicting|uncertain|not provided|no assertion/.test(lower)) return "neutral";
  if (/likely pathogenic/.test(lower)) return "warning";
  if (/\bpathogenic\b/.test(lower)) return "danger";
  if (/likely benign/.test(lower) || /\bbenign\b/.test(lower)) return "good";
  return "neutral";
}

export default ClinicalTab;
