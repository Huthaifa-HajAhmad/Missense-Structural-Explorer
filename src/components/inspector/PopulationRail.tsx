import React from "react";
import { BookOpen, Database, Dna, ExternalLink, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { THRESHOLDS } from "../../shared/thresholds";
import {
  buildFrequencyEvidence,
  formatAlleleFrequency,
  populationReading,
} from "../../shared/frequencyEvidence";
import { variantNumberingView } from "../../shared/numbering";
import { ASSEMBLY_LABELS } from "../../shared/assembly";
import { acmgCriteriaView } from "../../shared/acmgCriteriaView";
import { clinvarAccessionNote, formatClinicalDate } from "../evidence/population/populationFormat";
import { buildAssemblyLiftNote } from "./assemblyLiftNote";

/**
 * PopulationRail — the Evidence Lineage inspector for the Population Data tab.
 *
 * The column states WHAT was found; the rail states HOW the verdict was reached, as a four-step trace
 * (input → ceiling → test → engine), then the cut-points with the one that fired marked, then the
 * variant's lineage and the sources. It is built from the same `buildFrequencyEvidence` object as the
 * column, so the two panes cannot report different frequencies or criteria for one variant.
 *
 * The previous rail repeated the header's transcript facts at the top and printed the criteria as a
 * static textbook paragraph list; the trace and the marked table replace both.
 */

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

  const evidence = buildFrequencyEvidence({
    gnomadFrequency: analysisResult.gnomadFrequency ?? null,
    aouFrequency: analysisResult.aouFrequency ?? null,
    serviceStatus: analysisResult.serviceStatus ?? analysisResult.metadata?.serviceStatus ?? null,
    clinvar: clinvar ? { classification: clinvar.classification, alleleFrequencies: clinvar.alleleFrequencies } : null,
    assembly: analysisResult.predictorData?.gnomadVariantAssembly ?? null,
    pli: analysisResult.gnomadConstraint?.pli ?? null,
    engineCriteria: analysisResult.ruleBasedInsights?.acmgCriteria ?? analysisResult.insights?.acmgCriteria ?? null,
    acmgWeighting: analysisResult.metadata?.acmgWeighting ?? null,
  });
  const { criterion, applied } = evidence;
  const reading = populationReading(evidence);
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

  // The cut-point table, generated from the constant the engine branches on.
  const cutPoints: ReadonlyArray<{ code: "BA1" | "BS1" | "PM2"; rule: string; meaning: string; tone: string }> = [
    { code: "BA1", rule: `> ${(FREQ.standAloneBenign * 100).toFixed(0)}%`, meaning: "Stand-alone benign", tone: "good" },
    { code: "BS1", rule: `> ${(FREQ.tooCommonForDisorder * 100).toFixed(1)}%`, meaning: "Greater than expected for the disorder", tone: "good" },
    {
      code: "PM2",
      rule: `≤ ${(FREQ.extremelyRare * 100).toFixed(2)}%`,
      meaning: `Extremely rare — dominant; ≤ ${(FREQ.extremelyRareRecessive * 100).toFixed(1)}% when pLI < ${FREQ.recessivePlI} reads as recessive`,
      tone: "danger",
    },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="population-rail">
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
                Alleles observed: <span className="pop-mono">{reading.mostCopies.counts}</span> · {reading.mostCopies.label}
              </span>
            )}
          </Step>
          {reading.ruleAf !== null && (
            <Step n={2} label="AF the rule read">
              <span className="pop-mono">{criterion.absent ? "0 — no record" : formatAlleleFrequency(reading.ruleAf)}</span>
              {criterion.usedGroupMax && (
                <span className="rail-step__sub">Highest across ancestry groups of ≥ {FREQ.groupMinAn.toLocaleString("en-GB")} alleles</span>
              )}
            </Step>
          )}
          {criterion.pm2Ceiling !== null && (
            <Step n={3} label="PM2 ceiling">
              <span className="pop-mono">≤ {formatAlleleFrequency(criterion.pm2Ceiling)}</span>
              <span className="rail-step__sub">
                {criterion.inheritance === "unknown"
                  ? "No pLI — read as dominant/unknown"
                  : `pLI ${typeof pli === "number" ? pli.toFixed(2) : "—"} → ${criterion.inheritance}`}
              </span>
            </Step>
          )}
          <Step
            n={criterion.pm2Ceiling !== null ? 4 : reading.ruleAf !== null ? 3 : 2}
            label="Engine criterion"
            state={applied.suppressed || criterion.code === "withheld" ? "warn" : "done"}
          >
            <span className="rail-step__verdict">
              {applied.known ? (
                applied.code ? <span className="ev-tier chip-code" data-tone={applied.code === "PM2" ? "danger" : "good"}>{applied.code}</span> : "None recorded"
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
            const active = criterion.code === cp.code;
            return (
              <li key={cp.code} className="rail-cut" data-active={active || undefined}>
                <span className="ev-tier chip-code" data-tone={active ? cp.tone : "muted"}>{cp.code}</span>
                <span className="rail-cut__rule pop-mono">{cp.rule}</span>
                <span className="rail-cut__meaning">{cp.meaning}</span>
                {active && <span className="rail-cut__here">this variant</span>}
              </li>
            );
          })}
        </ul>
        <details className="rail-notes">
          <summary>Method notes</summary>
          <ul>
            <li>ClinGen SVI (2020) recommends PM2 at <em>Supporting</em> strength; this engine records it as PM2 (moderate).</li>
            <li>BS1 uses a fixed {(FREQ.tooCommonForDisorder * 100).toFixed(0)}% cut-point, not a disorder-specific maximum credible allele frequency.</li>
            <li>The rule reads gnomAD&apos;s raw grouped-maximum AF, not the filtering allele frequency (FAF95) ClinGen recommends for BA1/BS1.</li>
            <li>A gnomAD &ldquo;no record&rdquo; is not checked against site coverage; a poorly covered site can also return no record.</li>
            <li>Inheritance is inferred from pLI, which measures loss-of-function intolerance, not mode of inheritance.</li>
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
              <span className="pop-mono" style={{ color: "var(--cs-text-danger-on-soft)" }}>{pathCount}</span> pathogenic ·{" "}
              <span className="pop-mono" style={{ color: "var(--cs-text-good-on-soft)" }}>{benCount}</span> benign
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
        {assemblyLiftNote && (
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
          <Row label="All of Us">
            <span>local frequency table</span>
          </Row>
          <Row label="NCBI ClinVar">
            <span className="pop-mono">E-utilities esearch/esummary</span>
          </Row>
          <Row label="Framework">
            <span>Richards et al. 2015 · ClinGen SVI</span>
          </Row>
        </dl>
      </section>
    </div>
  );
}

export default PopulationRail;
