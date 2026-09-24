import React from "react";
import { Database, Gauge, Info } from "lucide-react";
import { TabComponentProps } from "./types";
import {
  buildFrequencyEvidence,
  formatAlleleFrequency,
  formatCount,
  observationAbsence,
  type FrequencyApplication,
  type FrequencyCriterion,
  type FrequencyEvidence,
  type FrequencyObservation,
} from "../../shared/frequencyEvidence";
import { THRESHOLDS } from "../../shared/thresholds";

/**
 * Population Frequencies.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * One question: *is this variant rare enough to support a pathogenic classification?* The answer is
 * a single number — the allele frequency the ACMG rule engine classified on — and until now the
 * screen did not show it. It showed raw allele counts, which answer a different question, and left
 * the reader to divide them.
 *
 * So the screen leads with what the engine did with the frequency and the value it did it from,
 * then shows the per-source readings that value was drawn from.
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
 *    count but no denominator has no AF and still has an AC; the row shows what it holds and says
 *    what is missing.
 *
 * TYPOGRAPHY — one scale, each tier with exactly one job (see `ObservationRow` for the row grammar)
 *   screen title 18 · headline figure 20/600 tabular · row subject & counts 13 · prose, detail
 *   rows and card field labels 12 · chips and meta 11 · section eyebrows 10 mono
 * Every size is a declared `--cs-font-size-*` tier and every weight is on the 400/500/600 scale —
 * no 700, no off-scale px. The revision before this one labelled every figure, which put three
 * label voices (11/12/13px) within one row and made the field labels louder than the row subjects
 * they described; the labels are gone and the words live in `title`/sr-only instead.
 */

/** Eyebrow above a group — the same 10px mono grammar the Evidence Lineage rail uses. */
function Eyebrow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--cs-text-muted)" }}>
      <Icon className="w-3.5 h-3.5 text-cs-accent-clay" />
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
 * Card title, on the same rank as every other stat card in the app (`.metric-card-label`).
 *
 * `trailing` lets a card whose single row would otherwise repeat its title (All of Us) carry that
 * row's state chip in the header instead of printing the same words twice in one card.
 */
function CardHeader({ title, meta, trailing }: { title: string; meta?: string | null; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--cs-border-subtle)" }}>
      <span className="metric-card-label">{title}</span>
      {trailing ?? (meta ? (
        <span className="font-mono text-[11px] shrink-0" style={{ color: "var(--cs-text-muted)" }}>
          {meta}
        </span>
      ) : null)}
    </div>
  );
}

/**
 * Per-state tone.
 *
 * Keyed on `availability.state`, not on the resolver's `tone`, because this screen must not let a
 * variant fact and a run fault share a colour: `resolveEvidenceAvailability` maps `no-result` to
 * `warn`, so keying on tone painted a *healthy* "no record" chip the same amber as "Provider error"
 * — and amber already means "likely pathogenic" in the ClinVar badge on this same screen.
 */
const STATE_TONE: Record<string, { fg: string; bg: string; border: string }> = {
  available: { fg: "var(--cs-text-good-on-soft)", bg: "var(--cs-bg-success)", border: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)" },
  "no-result": { fg: "var(--cs-text-secondary)", bg: "var(--cs-surface-2)", border: "var(--cs-border)" },
  "not-covered": { fg: "var(--cs-text-muted)", bg: "var(--cs-surface-2)", border: "var(--cs-border)" },
  "not-configured": { fg: "var(--cs-text-muted)", bg: "var(--cs-surface-2)", border: "var(--cs-border)" },
  "upstream-error": { fg: "var(--cs-text-warning-on-soft)", bg: "var(--cs-bg-warning)", border: "color-mix(in srgb, var(--cs-text-warning) 30%, transparent)" },
  pending: { fg: "var(--cs-text-secondary)", bg: "var(--cs-surface-2)", border: "var(--cs-border)" },
};

function StateChip({ observation }: { observation: FrequencyObservation }) {
  const { label, state } = observation.availability;
  // `available` has no canonical label by design, so the surface supplies the neutral word.
  const tint = STATE_TONE[state] ?? STATE_TONE["no-result"];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium shrink-0"
      style={{ color: tint.fg, background: tint.bg, borderColor: tint.border }}
    >
      {label ?? "Measured"}
    </span>
  );
}

/** `AC 17 · AN 1,461,892`, or whichever half the source reported. */
function countLine(observation: FrequencyObservation): string | null {
  const parts: string[] = [];
  if (observation.ac !== null) parts.push(`AC ${formatCount(observation.ac)}`);
  if (observation.an !== null) parts.push(`AN ${formatCount(observation.an)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * One source row.
 *
 * THE TYPE SYSTEM OF THIS SCREEN
 * ------------------------------
 *   card title        12 uppercase muted   (`.metric-card-label`) — structure
 *   row subject       13/500 ink           (Exomes, Genomes)      — what this row is
 *   frequency figure  20/600 tabular ink                           — the row's answer
 *   counts line       13/500 tabular secondary (AC · AN)           — the sanity check
 *   absence sentence  12/400 secondary
 *   chips / meta      11
 *
 * The previous revision labelled every figure ("ALLELE FREQUENCY", "ALLELE COUNT / NUMBER" in 12px
 * uppercase) — three label voices in 11-13px, and the field labels LOUDER than the row subject
 * beneath which they sat. On a screen titled Population Frequencies the frequency figure needs no
 * label: "Exomes / 1.16e-5 / AC 17 · AN 1,461,892" reads, and the AC/AN abbreviations are the same
 * ones gnomAD and ClinVar themselves print. The words survive as `title` attributes and the sr-only
 * text, so nothing is lost to a screen reader or a hover.
 *
 * `showSubject={false}` is for a card whose header already IS the subject (All of Us), so the row
 * does not print the same words twice in one card.
 */
function ObservationRow({ observation, showSubject = true }: { observation: FrequencyObservation; showSubject?: boolean }) {
  const { availability } = observation;
  const counts = countLine(observation);

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
      {showSubject && (
        <div className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
            {observation.label}
          </span>
          <StateChip observation={observation} />
        </div>
      )}

      {/*
        * Both figures, from what the row actually holds: a source that reports an allele count but
        * no denominator — which has no frequency — still shows its count rather than vanishing into
        * an absence sentence.
        */}
      {availability.hasValue && observation.af !== null ? (
        <>
          <span
            className="text-[20px] font-semibold tabular-nums leading-tight"
            style={{ color: "var(--cs-text-primary)" }}
            title={`Allele frequency in ${observation.label}`}
          >
            <span className="sr-only">Allele frequency: </span>
            {formatAlleleFrequency(observation.af)}
          </span>
          {counts && (
            <span className="text-[13px] font-medium tabular-nums" style={{ color: "var(--cs-text-secondary)" }} title="Allele count · allele number">
              <span className="sr-only">Allele count </span>
              {counts}
            </span>
          )}
        </>
      ) : (
        <>
          {/*
            * The reason, not the label. `observationAbsence` falls back to the canonical state label
            * when the pipeline recorded no reason — but the chip above already shows that label, so
            * rendering it again produced a row reading "Running" under a chip reading "Running".
            */}
          {availability.reason && (
            <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
              {observationAbsence(observation)}
            </p>
          )}
          {counts && (
            <span className="text-[13px] font-medium tabular-nums" style={{ color: "var(--cs-text-secondary)" }} title="Allele count · allele number">
              {counts}
            </span>
          )}
        </>
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
    applied.suppressed ? STATE_TONE["not-covered"]
    : unconfirmed ? { fg: "color-mix(in srgb, var(--cs-accent-clay) 75%, var(--cs-text-primary))", bg: "transparent", border: "color-mix(in srgb, var(--cs-accent-clay) 45%, transparent)" }
    : applied.known && applied.code === "PM2" ? { fg: "var(--cs-text-danger-on-soft)", bg: "var(--cs-bg-danger)", border: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)" }
    : applied.known && (applied.code === "BS1" || applied.code === "BA1") ? STATE_TONE.available
    : STATE_TONE["no-result"];

  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] tracking-wide shrink-0"
      style={{ color: tone.fg, background: tone.bg, border: `${unconfirmed ? "1px dashed" : "1px solid"} ${tone.border}` }}
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

/** Where the governing frequency came from, named so the number can be traced to a dataset. */
function criterionSourceLabel(evidence: FrequencyEvidence): string {
  const { sourceId, usedGroupMax, fallback } = evidence.criterion;
  if (sourceId === "gnomad-group") {
    const base = usedGroupMax ? "gnomAD ancestry-grouped maximum" : "gnomAD global maximum";
    return fallback ? `${base} (fell back to the global maximum)` : base;
  }
  if (sourceId === "clinvar-submissions") return "ClinVar-submitted frequency";
  return "No source";
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
   * own the headline is a number the reader cannot find anywhere below it, which is what made the
   * summary card hard to reconcile with the cards. Rendered as a DERIVED value, not as a source
   * reading: it belongs to no single dataset.
   */
  const groupedMaxAf = criterion.usedGroupMax ? criterion.af : null;

  /** The one-line finding: what the engine did, and the value it did it on. */
  const findingLead = (() => {
    if (criterion.af === null) return "No frequency available";
    return formatAlleleFrequency(criterion.af);
  })();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Population Frequencies</h1>
        <p className="screen-tab-description">
          The allele frequency the ACMG rule engine classified on, with the ClinVar interpretation and the
          gnomAD and All of Us allele counts it was derived from.
        </p>
      </div>

      {/* ── The finding: what the engine read, and which criterion it satisfies ── */}
      <Card>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <Eyebrow icon={Gauge}>ACMG population-frequency evidence</Eyebrow>
              {/*
                * The screen's headline number, and the largest thing on it: every per-source reading
                * below is supporting detail for this one value. The attribution beside it is 11px
                * muted — a qualifier of the figure, not a second statement competing with it.
                */}
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[20px] font-semibold tabular-nums leading-tight" style={{ color: "var(--cs-text-primary)" }}>
                  {findingLead}
                </span>
                {criterion.af !== null && (
                  <span className="text-[11px]" style={{ color: "var(--cs-text-muted)" }}>
                    {criterionSourceLabel(evidence)}
                  </span>
                )}
              </span>
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
          <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
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
              className="text-[12px] m-0 leading-relaxed"
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
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-2 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
              <span className="font-mono">
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
            className="px-4 py-2.5 flex items-start gap-2 text-[12px]"
            style={{ background: "var(--cs-bg-warning)", color: "var(--cs-text-warning-on-soft)", borderTop: "1px solid var(--cs-border-subtle)" }}
          >
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {evidence.hasProviderFault
                ? "At least one source did not deliver a reading for this run, so the frequency above may be incomplete."
                : "At least one source is still being queried, so the frequency above may be incomplete."}{" "}
              The affected rows are marked below.
            </span>
          </div>
        )}
      </Card>

      <Eyebrow icon={Database}>Source readings</Eyebrow>

      {/* `items-stretch` (the default) so the three cards share one hairline grid, like PredictorsTab. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
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
                  className="inline-flex self-start px-2.5 py-1 rounded-lg border text-[13px] font-medium"
                  style={classificationTone(clinvarClassification ?? "")}
                >
                  {clinvarClassification}
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Review status</span>
                <span className="text-right" style={{ color: "var(--cs-text-primary)" }}>{result.clinvar?.reviewStatus || "Not reported"}</span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span className="shrink-0" style={{ color: "var(--cs-text-muted)" }}>Associated trait</span>
                <span className="text-right" style={{ color: "var(--cs-text-primary)" }}>
                  <span className="sr-only">Associated trait: </span>
                  <span className="block truncate" title={result.clinvar?.trait ?? undefined}>
                    {result.clinvar?.trait || "Not reported"}
                  </span>
                </span>
              </div>

              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Last evaluated</span>
                <span className="font-mono tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
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
              <div className="px-4 py-3 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
                    Ancestry-grouped maximum
                  </span>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium shrink-0"
                    style={{
                      color: "color-mix(in srgb, var(--cs-accent-clay) 70%, var(--cs-text-primary))",
                      background: "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)",
                      borderColor: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)",
                    }}
                  >
                    Used for classification
                  </span>
                </div>
                <span
                  className="text-[20px] font-semibold tabular-nums leading-tight"
                  style={{ color: "var(--cs-text-primary)" }}
                  title="Allele frequency — highest across gnomAD ancestry groups"
                >
                  <span className="sr-only">Allele frequency: </span>
                  {formatAlleleFrequency(groupedMaxAf)}
                </span>
                <p className="text-[11px] m-0 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                  Derived from ancestry groups with ≥ {formatCount(THRESHOLDS.populationFrequency.groupMinAn)} alleles — not one dataset's figure.
                </p>
              </div>
            )}

            {evidence.gnomadHomozygotes !== null && evidence.gnomadHomozygotes > 0 && (
              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                {/* Neutral: homozygotes in a reference cohort argue AGAINST a severe dominant variant,
                    so colouring the count as danger inverted the inference it carries. */}
                <span style={{ color: "var(--cs-text-muted)" }}>Homozygotes observed</span>
                <span className="font-mono tabular-nums font-medium" style={{ color: "var(--cs-text-primary)" }}>
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
              <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
                <span style={{ color: "var(--cs-text-muted)" }}>Heterozygotes · homozygotes</span>
                <span className="font-mono tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
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
 * ClinVar classification → tone, by explicit match rather than substring.
 *
 * `/pathogenic/i` matches "Conflicting interpretations of **pathogenic**ity", so the previous chain
 * rendered a conflicting (VUS-class) record with the red danger badge. The order below tests the
 * downgraded and conflicting labels first, and matches whole words for the rest.
 */
function classificationTone(classification: string): React.CSSProperties {
  const neutral: React.CSSProperties = { color: "var(--cs-text-secondary)", background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" };
  const lower = classification.toLowerCase();
  if (/conflicting|uncertain|not provided|no assertion/.test(lower)) return neutral;
  if (/likely pathogenic/.test(lower)) {
    return { color: "var(--cs-text-warning-on-soft)", background: "var(--cs-bg-warning)", borderColor: "color-mix(in srgb, var(--cs-text-warning) 30%, transparent)" };
  }
  if (/\bpathogenic\b/.test(lower)) {
    return { color: "var(--cs-text-danger-on-soft)", background: "var(--cs-bg-danger)", borderColor: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)" };
  }
  if (/likely benign/.test(lower)) {
    return { color: "var(--cs-text-good-on-soft)", background: "var(--cs-bg-success)", borderColor: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)" };
  }
  if (/\bbenign\b/.test(lower)) {
    return { color: "var(--cs-text-good-on-soft)", background: "var(--cs-bg-success)", borderColor: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)" };
  }
  return neutral;
}

export default ClinicalTab;
