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
 * TYPOGRAPHY — the project's declared scale, nothing else
 *   screen title 18 · stat value 20 (tabular) · eyebrow 10 mono · card title 12 uppercase ·
 *   dataset label 11 · row label 12 · caption 12 · micro 10
 * Every size here is a `--cs-font-size-*` tier. The previous revision used 9px, 10px, 10.5px and
 * 12px for the same three jobs, which is why the cards read as three different components.
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
 * The first revision gave this its own 13px uppercase rank, which sat 1px from the 12px uppercase
 * row labels beneath it and read as one rank while competing with the rail's 10px eyebrow and
 * `GuidelinesTab`'s 11px header. Reusing the project's primitive removes the invented rank.
 */
function CardHeader({ title, meta }: { title: string; meta?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--cs-border-subtle)" }}>
      <span className="metric-card-label">{title}</span>
      {meta && (
        <span className="font-mono text-[11px] shrink-0" style={{ color: "var(--cs-text-muted)" }}>
          {meta}
        </span>
      )}
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

/** `AC 8 · AN 1,459,156`, or whichever half the source reported. */
function countLine(observation: FrequencyObservation): string | null {
  const parts: string[] = [];
  if (observation.ac !== null) parts.push(`AC ${formatCount(observation.ac)}`);
  if (observation.an !== null) parts.push(`AN ${formatCount(observation.an)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ObservationRow({ observation }: { observation: FrequencyObservation }) {
  const { availability } = observation;
  const counts = countLine(observation);

  return (
    <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--cs-border-subtle)" }}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium" style={{ color: "var(--cs-text-secondary)" }}>
          {observation.label}
        </span>
        <StateChip observation={observation} />
      </div>

      {/*
        * A frequency is a figure; counts are supporting detail. Both are rendered from what the row
        * actually holds, so a source that reports an allele count but no denominator — which has no
        * frequency — still shows its count instead of vanishing into an absence sentence.
        */}
      {availability.hasValue && observation.af !== null ? (
        <div className="flex flex-col">
          <span className="metric-card-label">Allele frequency</span>
          <span className="metric-card-value tabular-nums">{formatAlleleFrequency(observation.af)}</span>
          {counts && <span className="metric-card-desc tabular-nums">{counts}</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
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
            <span className="font-mono text-[12px] tabular-nums" style={{ color: "var(--cs-text-muted)" }}>
              {counts}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The verdict chip.
 *
 * Shows the criterion the ENGINE recorded. When the payload carries no engine criteria the
 * supported criterion is shown as such, and when the engine recorded none while the frequency
 * supports one, that disagreement is named rather than papered over.
 */
function VerdictChip({ criterion, applied }: { criterion: FrequencyCriterion; applied: FrequencyApplication }) {
  const shown = applied.known ? applied.code : criterion.code;
  /**
   * Tone is chosen so amber means ONE thing on this screen: a run fault, already carried by the
   * fault banner. `withheld` was given the provider-error tone, which put a third amber on the tab
   * beside the ClinVar likely-pathogenic badge and the banner — and a withheld criterion caused by a
   * build refusal is not a fault at all. `no-result`'s own tone is deliberately overridden here for
   * the same reason: the resolver maps it to `warn`, which would paint a healthy "no record" chip as
   * a failure.
   */
  const tone =
    applied.suppressed ? STATE_TONE["not-covered"]
    : shown === "PM2" ? { fg: "var(--cs-text-danger-on-soft)", bg: "var(--cs-bg-danger)", border: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)" }
    : shown === "BS1" || shown === "BA1" ? STATE_TONE.available
    : STATE_TONE["no-result"];
  /**
   * `withheld` is not a criterion the frequency supports — it is the statement that nothing was
   * classified — so it keeps its own word rather than taking the `?` that marks an unconfirmed
   * criterion. The `?` means "the frequency supports this, and this payload cannot confirm the
   * engine agreed", which is a different claim from "no classification was made".
   */
  const text =
    applied.known
      ? (applied.code ?? "No criterion")
      : criterion.code === "none" ? "No criterion"
      : criterion.code === "unknown" ? "Not classified"
      : criterion.code === "withheld" ? "Withheld"
      : `${criterion.code}?`;
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-lg border font-mono font-bold text-[11px] tracking-wide shrink-0"
      style={{ color: tone.fg, background: tone.bg, borderColor: tone.border }}
      title={
        applied.known
          ? "The ACMG frequency criterion this run recorded"
          : "The criterion the frequency supports — this payload carries no engine criteria to confirm it against"
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
                * below is supporting detail for this one value.
                */}
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[20px] font-semibold tabular-nums leading-tight" style={{ color: "var(--cs-text-primary)" }}>
                  {findingLead}
                </span>
                {criterion.af !== null && (
                  <span className="text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>
                    {criterionSourceLabel(evidence)}
                  </span>
                )}
              </span>
            </div>
            <VerdictChip criterion={criterion} applied={applied} />
          </div>

          <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            {criterion.statement}
          </p>

          {/*
            * The engine can legitimately decline to apply the criterion the frequency supports: the
            * ACMG weighting is user-selectable and suppresses PM2 under `strict-structural`, and under
            * `conservative` when ClinVar is not pathogenic (`criteria.ts:77`). Showing only the
            * supported criterion would report a pathogenic finding the engine withheld.
            */}
          {applied.suppressed && (
            <p
              className="text-[12px] m-0 leading-relaxed"
              style={{ color: "var(--cs-text-warning-on-soft)" }}
            >
              The engine applied no frequency criterion for this run
              {applied.weighting ? ` (ACMG weighting: ${applied.weighting})` : ""}. The frequency above meets{" "}
              {criterion.code}, so the weighting is what withheld it.
            </p>
          )}
          {!applied.known && criterion.code !== "none" && criterion.code !== "unknown" && criterion.code !== "withheld" && (
            <p className="text-[12px] m-0 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
              This payload carries no engine criteria, so the criterion shown is what the frequency supports
              rather than a confirmed engine decision.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[12px]" style={{ borderTop: "1px solid var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
            {/*
              * "Source readings", not "Sources contributing". The count is of observations that
              * rendered a value, which is a fact about the cards below; "contributing" claimed these
              * were the sources the criterion was drawn from, and the two differ — a payload can carry
              * a grouped maximum with both per-dataset readings empty, giving "0 contributing" beside
              * "gnomAD global maximum" in the headline.
              */}
            <span>
              Source readings:{" "}
              <span className="font-mono tabular-nums" style={{ color: "var(--cs-text-secondary)" }}>
                {evidence.contributing.length}
              </span>
            </span>
            {criterion.fallback && (
              <span className="font-mono">global-maximum fallback — population too small to report</span>
            )}
          </div>
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
          <CardHeader title="ClinVar" meta="NCBI" />
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
          <CardHeader title="All of Us" meta="cohort" />
          <div className="flex flex-col">
            {aouRow && <ObservationRow observation={aouRow} />}
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
