import type { ReactNode } from "react";
import { ExternalLink, GitBranch } from "lucide-react";
import type { EnergyUnit } from "../../shared/engineStatus";
import { AGREEMENT_CHIP, absenceText, listNames, signedDdg, type EnergeticsEvidence } from "../../shared/energeticsEvidence";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: ReactNode }) {
  return (
    <li className="nrg-step" data-state={state}>
      <span className="nrg-step__n" aria-hidden="true">{n}</span>
      <div className="nrg-step__body">
        <span className="nrg-step__label">{label}</span>
        <div className="nrg-step__value">{children}</div>
      </div>
    </li>
  );
}

/** How the overall reading was reached: structure → engines → marks → summary → engine record. */
export function EnergeticsRuleTrace({ evidence, unit }: { evidence: EnergeticsEvidence; unit: EnergyUnit }) {
  const { agreement, coverage, structure, isFolding } = evidence;
  const withValue = evidence.readings.filter(r => r.ddg !== null);
  const structureWarn = structure?.repairState === "unrepaired" || structure?.repairState === "failed" || evidence.lowPlddt !== null;
  return (
      <section
        className="nrg-rsec"
        aria-labelledby="nrg-rail-trace"
        id={INSPECTOR_SECTIONS.stabilityTelemetry}
        tabIndex={-1}
      >
        <h3 className="eyebrow" id="nrg-rail-trace">
          <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
          Rule trace
        </h3>
        <ol className="nrg-steps" data-testid="energetics-rule-trace">
          <Step n={1} label="Template structure" state={!structure ? "idle" : structureWarn ? "warn" : "done"}>
            <span>
              {structure
                ? `${structure.label}${structure.pdbId ? ` · ${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : ""}${
                    structure.resolution !== null ? ` · ${structure.resolution.toFixed(1)} Å` : ""
                  }`
                : isFolding
                  ? "Resolving"
                  : "Not reported"}
            </span>
            {structure?.repair && !evidence.foldxStandIn && <span className="nrg-step__sub">FoldX template: {structure.repair.toLowerCase()}</span>}
            {/*
              A mutating engine cannot start from a chain that already carries a substitution. When
              the resolver refused one, name the entry, the residues (or the unverified state), and
              what the run used instead — worded from the structure record, never hard-coded to
              AlphaFold: a Tier-2 outage can leave a structural homolog as the template.
            */}
            {structure?.excludedExperimental && (
              <span className="nrg-step__warn" data-testid="energetics-excluded-template">
                {structure.excludedExperimental.pdbId}
                {structure.excludedExperimental.chainId ? `:${structure.excludedExperimental.chainId}` : ""}{" "}
                {structure.excludedExperimental.unverified
                  ? "could not be checked against UniProt, so"
                  : <>is not the wild type — {structure.excludedExperimental.differences.join(", ")} — so</>}{" "}
                this run used{" "}
                {structure.href ? (
                  <a href={structure.href} target="_blank" rel="noopener noreferrer">
                    {structure.source === "alphafold" ? "the AlphaFold model" : `the ${structure.label.toLowerCase()}`}
                    <ExternalLink className="inline w-3 h-3 ml-0.5 -mt-0.5" aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : structure.source === "alphafold" ? (
                  "the AlphaFold model"
                ) : (
                  `the ${structure.label.toLowerCase()}`
                )}
                .
              </span>
            )}
            {structure && structure.sequenceDifferences.length > 0 && (
              <span className="nrg-step__warn" data-testid="energetics-template-differences">
                This experimental template differs from UniProt at {structure.sequenceDifferences.join(", ")}; read its
                estimates against that background.
              </span>
            )}
            {evidence.foldxStandIn && (
              <span className="nrg-step__sub">FoldX value: ProtVar precomputed{evidence.foldxStandIn.model ? ` on ${evidence.foldxStandIn.model}` : ""}; no local value</span>
            )}
            {evidence.lowPlddt !== null && (
              <span className="nrg-step__warn">AlphaFold pLDDT {evidence.lowPlddt.toFixed(1)} at this residue: structure-based estimates are unreliable here.</span>
            )}
          </Step>
          <Step n={2} label="Engines returned a value" state={coverage.insufficient ? "warn" : "done"}>
            <span>{coverage.label}</span>
            {evidence.running.length > 0 && (
              <span className="nrg-step__sub">Running: {listNames(evidence.running.map(r => r.name))}</span>
            )}
            {evidence.missing.length > 0 && (
              <span className="nrg-step__sub">
                No value: {evidence.missing.map(r => `${r.name} — ${absenceText(r).replace(/[.\s]+$/, "")}`).join("; ")}.
              </span>
            )}
            {withValue.some(r => !r.counted) && (
              <span className="nrg-step__sub">
                Shown, not counted: {listNames(withValue.filter(r => !r.counted).map(r => r.name))}
              </span>
            )}
          </Step>
          <Step n={3} label="Each engine on its own mark" state={agreement.nCounted ? "done" : "idle"}>
            <span>
              {agreement.destabilizing.length} destabilizing · {agreement.moderate.length} moderate ·{" "}
              {agreement.notDestabilizing.length} not destabilizing
            </span>
            <span className="nrg-step__sub">Local marks, listed below. No probability is computed.</span>
          </Step>
          <Step n={4} label="Summary" state={agreement.direction === "split" || agreement.direction.startsWith("mostly-") ? "warn" : agreement.nCounted ? "done" : "idle"}>
            <span>
              {AGREEMENT_CHIP[agreement.direction].label}
              {agreement.nCounted > 1 ? ` · median ${signedDdg(agreement.median, unit)}` : ""}
            </span>
            {agreement.nCounted > 0 && coverage.insufficient && (
              <span className="nrg-step__warn">Fewer than three engines returned a value; read this as individual estimates, not agreement.</span>
            )}
          </Step>
          <Step n={5} label="Engine record">
            <span>Not an ACMG input</span>
            <span className="nrg-step__sub">No criterion in the rule engine reads ΔΔG.</span>
          </Step>
        </ol>
      </section>
  );
}
