import React from "react";
import { EvidenceReadingInspector } from './EvidenceReadingInspector';
import { buildPopulationComparison } from '../../shared/evidenceComparison';
import { BookOpen, Database, Dna, ExternalLink, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { THRESHOLDS } from "../../shared/thresholds";
import {
  aouSourceLabel,
  formatAlleleFrequency,
  formatCutPoint,
  populationReading, frequencyEvidenceForResult } from "../../shared/frequencyEvidence";
import { gnomadGroupLabel, GRPMAX_GROUPS } from "../../shared/gnomadGroups";
import { variantNumberingView } from "../../shared/numbering";
import { ASSEMBLY_LABELS } from "../../shared/assembly";
import { acmgCriteriaView } from "../../shared/acmgCriteriaView";
import { clinvarAccessionNote, formatClinicalDate } from "../evidence/population/populationFormat";
import { buildAssemblyLiftNote } from "./assemblyLiftNote";
import { isFallbackLocus, fallbackCause, locusFailureKind, locusRecoveryAction } from "../../shared/locusResolution";

/**
 * PopulationRail — the Evidence Lineage inspector for the Population Data tab.
 *
 * The column states WHAT was found; the rail states HOW the verdict was reached, as a four-step trace
 * (input → ceiling → test → engine), then the cut-points with the one that fired marked, then the
 * variant's lineage and the sources. It is built from the same cached `frequencyEvidenceForResult`
 * object as the column, so the two panes cannot report different frequencies or criteria for one variant.
 *
 * The previous rail repeated the header's transcript facts at the top and printed the criteria as a
 * static textbook paragraph list; the trace and the marked table replace both.
 */

/** The papers the frequency rules follow, linked by DOI in the rail's Sources. */
const FREQUENCY_REFERENCES: ReadonlyArray<{ short: string; title: string; doi: string }> = [
  { short: "Richards 2015", title: "Standards and guidelines for the interpretation of sequence variants (ACMG/AMP)", doi: "10.1038/gim.2015.30" },
  { short: "Ghosh 2018 (BA1)", title: "Updated recommendation for the benign stand-alone ACMG/AMP criterion", doi: "10.1002/humu.23642" },
  { short: "Whiffin 2017 (BS1)", title: "Using high-resolution variant frequencies to empower clinical genome interpretation", doi: "10.1038/gim.2017.26" },
];

interface PopulationRailProps {
  analysisResult: AnalysisResult;
}

type StepState = "done" | "warn" | "idle";

function Step({
  n,
  label,
  state = "done",
  children,
}: {
  n: number;
  label: string;
  state?: StepState;
  children: React.ReactNode;
}) {
  return (
    <li className="rail-step" data-state={state}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <div className="rail-step__value">{children}</div>
      </div>
    </li>
  );
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rail-kv__row">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

export function PopulationRail({ analysisResult }: PopulationRailProps) {
  const FREQ = THRESHOLDS.populationFrequency;
  const clinvar = analysisResult.clinvar;

  const evidence = frequencyEvidenceForResult(analysisResult);
  const { criterion, applied } = evidence;
  const reading = populationReading(evidence);
  /** The PM2 ceiling exists on every classification with a frequency, but the engine only
   *  consulted it where PM2 was reachable: benign-side decisions (BA1/BS1) fired before any
   *  ceiling was read. "Ceiling applied" may only mark a row where that is actually true. */
  const pm2Reached = criterion.code === "PM2" || criterion.code === "none";
  const standIn = analysisResult.gnomadFrequency?.standIn ?? null;
  const releaseRaw = evidence.observations.find(o => o.id.startsWith("gnomad"))?.dataset ?? null;
  const gnomadRelease = releaseRaw && releaseRaw !== "release not reported" ? releaseRaw : null;
  const ruleFrom = reading.ruleSource.startsWith("gnomAD") && gnomadRelease
    ? `${reading.ruleSource} · ${gnomadRelease}`
    : reading.ruleSource;
  const pli = analysisResult.gnomadConstraint?.pli;
  const supportsCode = criterion.code === "PM2" || criterion.code === "BS1" || criterion.code === "BA1";

  // ── Lineage ──
  const transcriptId = analysisResult.transcriptId ?? analysisResult.predictorData?.transcriptId ?? null;
  const isManeSelect = analysisResult.isManeSelect ?? analysisResult.predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult.isManePlusClinical ?? analysisResult.predictorData?.isManePlusClinical ?? false;
  const isCanonical = analysisResult.isCanonical ?? analysisResult.predictorData?.isCanonical ?? false;
  const maneRefSeqId = analysisResult.maneRefSeqId ?? analysisResult.predictorData?.maneRefSeqId ?? null;
  const transcriptWarning = analysisResult.transcriptWarning ?? analysisResult.predictorData?.transcriptWarning ?? null;
  // The build the coordinate is expressed in — never assumed (the GRCh37 fallback exists).
  const genomicAssembly = analysisResult.predictorData?.gnomadVariantAssembly ?? null;
  /**
   * The build trail the payload carries beside that build, when it carries one.
   *
   * `assembly`/`resolvedAssembly`/`liftedGenomicCoordinates`/`coordinateLift` are declared on
   * `TranscriptMetadata` (and on the response schema), so no widening is needed: a payload from a
   * server that predates the trail simply has them `undefined`, which yields `null` here and
   * renders exactly what this rail rendered before.
   */
  const assemblyLiftNote = buildAssemblyLiftNote(analysisResult);
  /**
   * A fallback locus outranks the lift note: the lift note describes a SUBMITTED coordinate, and a
   * fallback run has none — its build is what the failed lookup left behind, which the reader must be
   * told is not the variant's.
   */
  const fallbackLocus = isFallbackLocus(analysisResult);
  const fallbackNote = fallbackLocus
    ? fallbackCause(genomicAssembly, locusRecoveryAction(analysisResult) === "retry", locusFailureKind(analysisResult) ?? undefined)
    : null;
  const aouSource = aouSourceLabel(analysisResult.aouLookup, analysisResult);
  const numbering = variantNumberingView({
    variant: analysisResult.metadata?.variant ?? "",
    uniprotId: analysisResult.metadata?.uniprotId ?? null,
    numberingRemap: (analysisResult as any).numberingRemap ?? null,
  });
  const criteria = acmgCriteriaView(analysisResult.insights?.acmgCriteria, analysisResult.ruleBasedInsights?.acmgCriteria);
  const pathCount = criteria.filter(c => c.code.toUpperCase().startsWith("P")).length;
  const benCount = criteria.filter(c => c.code.toUpperCase().startsWith("B")).length;
  const tier = isManeSelect ? "MANE Select" : isManePlusClinical ? "MANE Plus Clinical" : isCanonical ? "Ensembl Canonical" : transcriptId ? "Non-canonical" : "Unassigned";
  const tierTone = isManeSelect ? "good" : isManePlusClinical ? "accent" : isCanonical ? "warning" : "muted";

  // ── ClinVar ──
  const clinvarUid = clinvar?.uid != null ? String(clinvar.uid) : null;
  const clinvarVcv = clinvarUid ? (clinvarUid.startsWith("VCV") ? clinvarUid : `VCV${clinvarUid.padStart(9, "0")}`) : null;
  const lastEvaluated = formatClinicalDate(clinvar?.lastEvaluated);

  /*
   * The cut-point table, generated from the constant the engine branches on. PM2 has TWO ceilings and
   * each gets its own row, with the one this run applied marked: the old single row printed "≤ 0.01%"
   * and buried the 0.1% ceiling in prose, while the trace above it printed "≤ 0.100%".
   */
  const cutPoints: ReadonlyArray<{ key: string; code: "BA1" | "BS1" | "PM2"; ceiling?: number; rule: string; meaning: string; tone: string }> = [
    { key: "BA1", code: "BA1", rule: `> ${formatCutPoint(FREQ.standAloneBenign)}`, meaning: "Stand-alone benign · read on FAF95 when gnomAD reports it", tone: "good" },
    { key: "BS1", code: "BS1", rule: `> ${formatCutPoint(FREQ.tooCommonForDisorder)}`, meaning: "Greater than expected for the disorder · app-defined, not disease-specific", tone: "good" },
    { key: "PM2-low", code: "PM2", ceiling: FREQ.extremelyRare, rule: `≤ ${formatCutPoint(FREQ.extremelyRare)}`, meaning: "Supporting · lower ceiling: any curated dominant-acting inheritance, or pLI ≥ 0.9 without one", tone: "danger" },
    { key: "PM2-high", code: "PM2", ceiling: FREQ.extremelyRareRecessive, rule: `≤ ${formatCutPoint(FREQ.extremelyRareRecessive)}`, meaning: `Supporting · higher ceiling: curated autosomal recessive only, or pLI < ${FREQ.recessivePlI} without curated inheritance`, tone: "danger" },
  ];
  const inputs = criterion.inputs;
  const bs2Info = evidence.homozygoteCriterion;

  return (
    <div className="pop-rail" data-testid="population-rail">
      <EvidenceReadingInspector tab="clinical" rows={buildPopulationComparison(evidence).rows} />
      {/* ── 1. How the verdict was reached ── */}
      <section className="rail-section" aria-labelledby="rail-trace-title">
        <h3 className="eyebrow" id="rail-trace-title">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="rail-steps" data-testid="rule-trace">
          <Step n={1} label="Read from" state={criterion.af === null ? "idle" : "done"}>
            <span>{criterion.af === null ? "No frequency to read" : ruleFrom}</span>
            {reading.mostCopies && (
              <span className="rail-step__sub">
                {/* "Alleles observed" under "Read from gnomAD" credited All of Us counts to the rule's source. */}
                {reading.governs ? "Alleles observed" : "Most copies in any one cohort"}: <span className="pop-mono">{reading.mostCopies.counts}</span> · {reading.mostCopies.label}
              </span>
            )}
          </Step>
          {reading.ruleAf !== null && (
            <Step n={2} label="AF the rule read">
              {inputs && inputs.benignStatistic !== inputs.pm2Statistic ? (
                <>
                  {/* Two inputs: FAF95 for BA1/BS1 (conservative for benign), the raw grouped maximum for PM2. */}
                  <span><span className="pop-mono">{formatAlleleFrequency(inputs.benignAf)}</span> · BA1/BS1 read FAF95{criterion.faf95Population ? ` (${gnomadGroupLabel(criterion.faf95Population)})` : ""}</span>
                  <span><span className="pop-mono">{formatAlleleFrequency(inputs.pm2Af)}</span> · PM2 reads the grouped maximum{criterion.groupMaxPopulation ? ` (${gnomadGroupLabel(criterion.groupMaxPopulation)})` : ""}</span>
                </>
              ) : (
                <span className="pop-mono">{criterion.absent ? "0 — no record" : formatAlleleFrequency(reading.ruleAf)}</span>
              )}
              {criterion.usedGroupMax && (
                <span className="rail-step__sub">Highest of gnomAD&apos;s grpmax groups ({GRPMAX_GROUPS.join(", ")}) with ≥ {FREQ.groupMinAn.toLocaleString("en-GB")} alleles</span>
              )}
              {criterion.combinedCohorts && (
                <span className="rail-step__warn">
                  Exomes and genomes combined. This source has no ancestry breakdown, so the grouped maximum the rule is
                  designed for was not available; an ancestry-enriched allele can sit above this figure.
                </span>
              )}
            </Step>
          )}
          {criterion.pm2Ceiling !== null && (
            <Step n={3} label={pm2Reached ? "PM2 ceiling" : "PM2 ceiling (not reached)"}>
              <span className="pop-mono">≤ {formatCutPoint(criterion.pm2Ceiling)}</span>
              {pm2Reached ? (
                /* The engine's own reason: curated GenCC inheritance first, pLI only without it. */
                <span className="rail-step__sub" data-testid="ceiling-basis">{criterion.ceilingText ?? (typeof pli === "number" ? `pLI ${pli.toFixed(2)}` : "pLI not available")}</span>
              ) : (
                /* BA1/BS1 decided on FAF95 before any ceiling was read — say so instead of implying the ceiling contributed. */
                <span className="rail-step__sub">The benign cut-points fired before the ceiling was consulted.</span>
              )}
            </Step>
          )}
          <Step
            n={criterion.pm2Ceiling !== null ? 4 : reading.ruleAf !== null ? 3 : 2}
            label="Engine criterion"
            state={applied.suppressed || criterion.code === "withheld" ? "warn" : "done"}
          >
            <span className="rail-step__verdict">
              {applied.known ? (
                applied.code ? <span className="ev-tier chip-code" data-tone={applied.code === "PM2" ? "danger" : "good"}>{applied.code === 'PM2' ? 'PM2 · Supporting' : applied.code}</span> : "None recorded"
              ) : supportsCode ? (
                <>unconfirmed (supports {criterion.code})</>
              ) : criterion.code === "withheld" ? (
                "Withheld"
              ) : criterion.code === "none" ? (
                "No criterion — between cut-points"
              ) : (
                "Not classified"
              )}
            </span>
            {/* BS2 is the other population criterion. "None recorded" alone hid a recorded BS2. */}
            {bs2Info.recorded && (
              <span className="rail-step__sub" data-testid="bs2-recorded">
                Also recorded: <span className="ev-tier chip-code" data-tone="good">BS2</span> from{" "}
                <span className="pop-mono">{evidence.gnomadHomozygotes ?? "—"}</span> gnomAD homozygotes
              </span>
            )}
            {!bs2Info.recorded && !bs2Info.applicable && (evidence.gnomadHomozygotes ?? 0) >= 2 && (
              <span className="rail-step__sub" data-testid="bs2-not-applicable">BS2 not applied: {bs2Info.reason}.</span>
            )}
            {applied.weighting && (
              <span className="rail-step__sub">
                ACMG weighting: <span data-testid="acmg-weighting">{applied.weighting}</span>
              </span>
            )}
            {applied.suppressed && (
              <span className="rail-step__warn">
                The frequency meets {criterion.code}, but the engine recorded no frequency criterion for this run
                {applied.withheldByWeighting && applied.weighting
                  ? ` — the ${applied.weighting} weighting is what withholds it.`
                  : "."}
              </span>
            )}
            {criterion.code === "withheld" && <span className="rail-step__warn">{criterion.statement}</span>}
          </Step>
        </ol>
      </section>

      {/* ── 2. The cut-points, with the one that fired marked ── */}
      <section className="rail-section" aria-labelledby="rail-cut-title">
        <h3 className="eyebrow" id="rail-cut-title">
          <Ruler className="w-3.5 h-3.5" />
          ACMG frequency cut-points
        </h3>
        <ul className="rail-cuts" data-testid="cut-points">
          {cutPoints.map(cp => {
            const appliedCeiling = cp.ceiling !== undefined && pm2Reached && criterion.pm2Ceiling === cp.ceiling;
            const active = criterion.code === cp.code && (cp.ceiling === undefined || appliedCeiling);
            return (
              <li key={cp.key} className="rail-cut" data-active={active || undefined}>
                <span className="ev-tier chip-code" data-tone={active ? cp.tone : "muted"}>{cp.code}</span>
                <span className="rail-cut__rule pop-mono">{cp.rule}</span>
                <span className="rail-cut__meaning">
                  {cp.meaning}
                  {active && <span className="rail-cut__here"> · this variant</span>}
                  {!active && appliedCeiling && <span className="rail-cut__here"> · ceiling applied</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <details className="rail-notes">
          <summary>Method notes</summary>
          <ul>
            <li>PM2 is applied at <em>Supporting</em> strength, as the ClinGen SVI (2020) recommends; Richards 2015 had it Moderate. Absence from a database is weak evidence on its own.</li>
            <li>BS1 uses a fixed {(FREQ.tooCommonForDisorder * 100).toFixed(0)}% cut-point, not a disorder-specific maximum credible allele frequency.</li>
            <li>
              {criterion.combinedCohorts
                ? `This run read gnomAD's combined exome + genome AF from the local ingest, because ${
                    standIn === "fault"
                      ? "the gnomAD query failed"
                      : standIn === "grace"
                      ? "gnomAD did not answer within the run's grace window"
                      : "gnomAD itself was not available"
                  }. It has no ancestry groups and no FAF95, so an ancestry-enriched allele can sit above it.`
                : "BA1 and BS1 read gnomAD's filtering allele frequency (FAF95) when gnomAD reports it, as ClinGen SVI recommends; PM2 reads the raw grouped maximum, which is never lower. Without FAF95 both read the grouped maximum."}
            </li>
            <li>The grouped maximum is taken over gnomAD v4.1&apos;s grpmax groups only ({GRPMAX_GROUPS.join(", ")}), from joint exome + genome counts; founder groups (asj, fin, ami), &ldquo;remaining&rdquo; and sex splits are excluded.</li>
            <li>PM2&apos;s ceiling comes from the gene&apos;s curated GenCC inheritance (Definitive, Strong or Moderate records): autosomal recessive only gives the higher ceiling; any other mode the lower one. pLI decides only when no curated record qualifies, and pLI does not establish inheritance.</li>
            <li>BS2 is recorded from two or more gnomAD homozygotes on an autosome. It assumes full penetrance at an early age, which no source here curates, and gnomAD does not phenotype its participants.</li>
            <li>A gnomAD &ldquo;no record&rdquo; is not checked against site coverage; a poorly covered site can also return no record.</li>
          </ul>
        </details>
      </section>

      {/* ── 3. What was analysed ── */}
      <section className="rail-section" aria-labelledby="rail-lineage-title">
        <h3 className="eyebrow" id="rail-lineage-title">
          <Dna className="w-3.5 h-3.5" />
          Variant lineage
        </h3>
        <dl id="genomic-lineage-drawer" className="rail-kv">
          {numbering.remapped && (
            <>
              <Row label="Reported" testId="reported-notation">
                <span className="pop-mono">{numbering.reported}</span>
              </Row>
              <Row label="Modelled as" testId="modelled-notation">
                <span className="pop-mono">
                  {numbering.modelled}
                  {analysisResult.metadata?.uniprotId ? ` (canonical ${analysisResult.metadata.uniprotId})` : ""}
                </span>
              </Row>
            </>
          )}
          <Row label="Assembly">
            <span className="pop-mono">{genomicAssembly ? ASSEMBLY_LABELS[genomicAssembly] : "Build not reported"}</span>
            {fallbackLocus && <span className="ev-tier chip-code" data-tone="warn">fallback</span>}
          </Row>
          <Row label="Transcript">
            <span className="pop-mono">{transcriptId || "Not resolved"}</span>
            <span className="ev-tier chip-code" data-tone={tierTone}>{tier}</span>
          </Row>
          {maneRefSeqId && (
            <Row label="RefSeq">
              <span className="pop-mono">{maneRefSeqId}</span>
            </Row>
          )}
          <Row label="ACMG rules">
            <span>
              <span className="pop-mono">{pathCount}</span> pathogenic · <span className="pop-mono">{benCount}</span> benign
            </span>
          </Row>
        </dl>
        {/*
          * The build TRAIL, directly under the lineage rows it belongs to.
          *
          * The Assembly row states the build the models saw. It cannot state what the reader
          * SUBMITTED, nor whether the two are the same variant — and when a submitted GRCh37
          * coordinate could not be verified on GRCh38, that refusal is the reason the GRCh38-only
          * sources declined. Rendered only when the payload carries something to say (`null` when the
          * builds agree or the trail is absent), because a note that always rendered would be the same
          * hardcoded build claim this row was fixed for, one line lower.
          *
          * A paragraph below the `dl` rather than a row inside it: a note explaining the row above is
          * not itself a key/value pair, and `dl` admits no child that could hold one.
          */}
        {fallbackNote ? (
          <p className="rail-step__warn" role="note" data-testid="fallback-locus-note">
            {fallbackNote}
          </p>
        ) : assemblyLiftNote && (
          <p className="rail-step__sub" role="note" data-testid="assembly-lift-note">
            {assemblyLiftNote}
          </p>
        )}
        {transcriptWarning && (
          <p className="rail-step__warn" role="note">{transcriptWarning}</p>
        )}
      </section>

      {/* ── 4. ClinVar record ── */}
      <section className="rail-section" aria-labelledby="rail-clinvar-title">
        <h3 className="eyebrow" id="rail-clinvar-title">
          <BookOpen className="w-3.5 h-3.5" />
          ClinVar record
        </h3>
        <dl className="rail-kv">
          <Row label="Accession">
            {clinvarVcv ? (
              <a
                href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(clinvarUid || "")}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="pop-link"
              >
                {clinvarVcv}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-cs-text-muted">{clinvarAccessionNote(evidence.clinvar.availability)}</span>
            )}
          </Row>
          {lastEvaluated && (
            <Row label="Last evaluated">
              <span className="pop-mono">{lastEvaluated}</span>
            </Row>
          )}
        </dl>
      </section>

      {/* ── 5. Sources ── */}
      <section className="rail-section" aria-labelledby="rail-sources-title">
        <h3 className="eyebrow" id="rail-sources-title">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="rail-kv rail-kv--sources">
          <Row label="gnomAD">
            {gnomadRelease ? <span className="pop-mono">{gnomadRelease}</span> : <span>release not reported</span>}
          </Row>
          <Row label="All of Us" testId="aou-source">
            <span>{aouSource}</span>
          </Row>
          <Row label="NCBI ClinVar">
            <span className="pop-mono">E-utilities esearch/esummary</span>
          </Row>
          <Row label="Framework">
            <span>
              {FREQUENCY_REFERENCES.map((ref, i) => (
                <React.Fragment key={ref.doi}>
                  {i > 0 && " · "}
                  <a className="pop-link" href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer" title={ref.title}>
                    {ref.short}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </React.Fragment>
              ))}
            </span>
          </Row>
        </dl>
      </section>
    </div>
  );
}

export default PopulationRail;
