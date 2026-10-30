import React from "react";
import { Info, RotateCw } from "lucide-react";
import { TabComponentProps } from "./types";
import { useResidueContextEvidence } from "../../lib/useResidueContextEvidence";
import type { ResidueContextEvidence } from "../../shared/residueContextEvidence";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { Prose } from "../ui/Prose";
import { ResidueGlyph } from "./residue/ResidueGlyph";
import { PocketDistanceStrip } from "./residue/PocketDistanceStrip";
import { EvidencePanel, EvidenceViewTabs, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ResiduePropertyComparison } from './MolecularComparison';
import { evidenceTab } from '../../shared/evidenceTabs';

/**
 * Residue Shifts & Pockets — the tab.
 *
 * Two views of one model (`buildResidueContextEvidence`) that the inspector rail also renders:
 *   1. comparison: the finding (the residue pair, one sentence, the side-chain sketch, four key
 *      facts) and one row per published scale, with the two residues on its own axis;
 *   2. records: the structural environment — burial (measured accessibility, the Cα count as a
 *      reading) and the predicted pocket (one distance, one probability, residues nearest first),
 *      opened by a one-line residue context instead of a second copy of the hero.
 *
 * It replaced two green/red residue cards, a coral "marked decrease" chip per axis, boxed KPI
 * cards, a hard-coded "likely co-factor" row, and a pocket distance that disagreed with the
 * inspector's. No ACMG criterion reads this evidence, so nothing here is coloured as pathogenic or
 * benign.
 */

function pct(value: number, max: number): string {
  return `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

function ValueTrack({
  value,
  max,
  marks,
  label,
  unit = ""
}: {
  value: number;
  max: number;
  marks: readonly number[];
  label: string;
  unit?: string;
}) {
  return (
    <div className="rsx-track" role="img" aria-label={label}>
      <div className="rsx-track__bar">
        {marks.map(m => (
          <span key={m} className="rsx-track__cut" style={{ left: pct(m, max) }} />
        ))}
        <span className="rsx-track__mut" style={{ left: pct(value, max) }} />
      </div>
      <div className="rsx-track__axis" aria-hidden="true">
        <span className="rsx-track__tick" data-edge="start" style={{ left: 0 }}>0</span>
        {marks.map(m => (
          <span key={m} className="rsx-track__tick" style={{ left: pct(m, max) }}>{m}</span>
        ))}
        <span className="rsx-track__tick" data-edge="end" style={{ left: "100%" }}>{max}{unit}</span>
      </div>
    </div>
  );
}

function Finding({ model }: { model: ResidueContextEvidence }) {
  const { pair } = model;
  return (
    <section className="rsx-card" aria-labelledby="rsx-finding-title" data-testid="residue-finding">
      <div className="rsx-head">
        <h2 className="eyebrow" id="rsx-finding-title">Structural context · not an ACMG input</h2>
        <span className="ev-tier" data-tone="muted">Informational</span>
      </div>
      <div className={`rsx-hero__body rsx-hero__body--split${model.glyph ? "" : " rsx-hero__body--single"}`}>
        <div className="rsx-hero__copy">
          <div className="rsx-pair">
            <span className="rsx-pair__fig" data-testid="residue-pair">
              {pair.wildType || "?"}
              <span className="rsx-pair__arrow" aria-hidden="true">&rarr;</span>
              {pair.mutant || "?"}
            </span>
            <span className="rsx-pair__sub" data-testid="residue-pair-sub">
              {[pair.wildTypeName, pair.mutantName].every(Boolean)
                ? `${pair.wildTypeName} to ${pair.mutantName}${pair.position ? ` at ${pair.position}` : ""}`
                : pair.position
                  ? `Position ${pair.position}`
                  : null}
              {pair.grantham !== null && (
                <>
                  {" · "}Grantham distance <span className="rsx-mono">{pair.grantham}</span>, {pair.granthamClass}
                </>
              )}
            </span>
          </div>
          <Prose className="rsx-finding" data-testid="residue-finding-text">
            <strong>{model.finding.headline}</strong> {model.finding.detail}
          </Prose>
          {pair.grantham !== null && (
            <p className="rsx-term">Grantham distance scores how chemically different the two amino acids are, from composition, polarity and size (5–215). A larger score is a bigger difference, not a higher chance of disease.</p>
          )}
        </div>
        {model.glyph && (
          <div className="rsx-hero__glyph">
          <ResidueGlyph
            diff={model.glyph}
            wildType={pair.wildType}
            mutant={pair.mutant}
            wildTypeName={pair.wildTypeName}
            mutantName={pair.mutantName}
          />
          </div>
        )}
      </div>
      <details className="mol-finding-details" open>
      <summary>Structure and pocket context</summary>
      <dl className="rsx-facts">
        {model.facts.map(fact => (
          <div className="rsx-fact" key={fact.label}>
            <dt className="rsx-label">{fact.label}</dt>
            <dd className="rsx-fact__dd">
              <span className={`rsx-fact__value${fact.mono ? " rsx-mono" : ""}`}>{fact.value}</span>
              <span className="rsx-fact__sub">{fact.sub}</span>
            </dd>
          </div>
        ))}
      </dl>
      </details>
    </section>
  );
}

/**
 * The records view drops the hero so the figure is not drawn twice; this line keeps the
 * substitution itself in view, so "burial" and "pocket" below are read against a named residue.
 */
function ResidueContextLine({ model }: { model: ResidueContextEvidence }) {
  const { pair } = model;
  const names = pair.wildTypeName && pair.mutantName ? `${pair.wildTypeName} to ${pair.mutantName}` : null;
  return (
    <p className="rsx-context-line" data-testid="residue-context-line">
      <span className="rsx-context-line__pair">
        {pair.wildType || "?"}<span aria-hidden="true"> &rarr; </span>{pair.mutant || "?"}
      </span>
      <span>{[names, pair.position ? `at ${pair.position}` : null].filter(Boolean).join(" ")}</span>
      {pair.grantham !== null && (
        <span>Grantham distance <span className="rsx-mono">{pair.grantham}</span>, {pair.granthamClass}</span>
      )}
    </p>
  );
}

function Environment({
  model,
  onExplain,
  onRetryPocket,
  onRetryStructural,
  isPocketLoading,
  isStructuralLoading,
  onSelectResidue,
  onViewIn3d
}: {
  model: ResidueContextEvidence;
  onExplain: (metric: string) => void;
  onRetryPocket?: () => void | Promise<void>;
  onRetryStructural?: () => void | Promise<void>;
  isPocketLoading?: boolean;
  isStructuralLoading?: boolean;
  onSelectResidue?: (index: number) => void;
  onViewIn3d?: () => void;
}) {
  const { burial, pocket, pocketStrip } = model;
  const rsa = burial?.indicators.rsa;
  const packing = burial?.indicators.packing;
  const canRetry = (pocket.status === "error" || pocket.status === "unavailable") && !!onRetryPocket;
  // Only offer a re-run once the step is not already running: while it runs the row is a status,
  // not a failure, and the disabled button would state the opposite of what is happening.
  const canRetryStructure = !!onRetryStructural && !isStructuralLoading && (!burial || burial.status === "undetermined");

  return (
    <section className="rsx-card" aria-label="Structural environment" data-testid="residue-environment">
      <div className="rsx-table-wrap">
        <table className="rsx-table rsx-table--environment">
          <thead>
            <tr>
              <th scope="col" className="rsx-col-name">Reading</th>
              <th scope="col">Axis or context</th>
              <th scope="col" className="rsx-num rsx-col-reading">Value</th>
              <th scope="col" className="rsx-end rsx-col-call">Reads as</th>
            </tr>
          </thead>
          <tbody>
            <tr className="rsx-group">
              <td colSpan={4}>
                <span className="rsx-label">Burial</span>
                {/* The cause belongs here, once. `finding.detail` is a composite that also carries the
                    pocket's state, so it must never stand in for the structure step's own reason. */}
                <span className="rsx-reason" data-testid="burial-cause">
                  {burial ? burial.structure : isStructuralLoading ? ENGINE_STATE_LABELS.running : model.structureReason}
                </span>
              </td>
            </tr>
            {!burial ? <tr><td colSpan={4}>
              {isStructuralLoading ? (
                <p className="rsx-state" role="status">
                  <strong className="rsx-state__title">Locating this residue</strong>
                  <span className="rsx-state__detail">The structure step is measuring how much of the residue water can reach; a reading appears here when it returns.</span>
                </p>
              ) : (
                <>
                  <p className="rsx-state">
                    <strong className="rsx-state__title">No accessibility reading</strong>
                    <span className="rsx-state__detail">It measures how much of the residue water can reach, needs the residue located in a structure, and a pocket scan does not supply it.</span>
                  </p>
                  {canRetryStructure && (
                    <button type="button" className="rsx-button" onClick={() => void onRetryStructural!()}>
                      <RotateCw className="w-4 h-4" aria-hidden="true" />
                      Run the structure step again
                    </button>
                  )}
                </>
              )}
            </td></tr> : (
              <>
                <tr data-testid="burial-rsa-row">
                  <td>
                    <span className="rsx-name">
                      <InspectReadingButton tab="structure" readingKey="burial">Solvent accessibility</InspectReadingButton>
                      <button type="button" className="rsx-info" onClick={() => onExplain("burial_status")} aria-label="Explain solvent accessibility">
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </span>
                    <span className="rsx-note">relative, Shrake–Rupley</span>
                  </td>
                  {rsa && rsa.marker !== null ? (
                    <>
                      <td>
                        <ValueTrack
                          value={rsa.marker}
                          max={rsa.domainMax}
                          marks={rsa.ticks.map(t => t.value)}
                          unit="%"
                          label={`Relative solvent accessibility ${rsa.valueLabel}; the app's cut-points are ${rsa.ticks.map(t => t.label).join(" and ")}.`}
                        />
                      </td>
                      <td className="rsx-num">{rsa.valueLabel}</td>
                      <td className="rsx-end"><span className="ev-tier" data-tone="neutral">{burial.label}</span></td>
                    </>
                  ) : (
                    <>
                      <td colSpan={2}>
                        <p className="rsx-state" role="status">
                          <strong className="rsx-state__title">Accessibility didn&rsquo;t run</strong>
                          <span className="rsx-state__detail">{burial.reason}</span>
                        </p>
                        {canRetryStructure && (
                          <button type="button" className="rsx-button" disabled={isStructuralLoading} onClick={() => void onRetryStructural!()}>
                            <RotateCw className="w-4 h-4" aria-hidden="true" />
                            Run the structure step again
                          </button>
                        )}
                      </td>
                      <td className="rsx-end"><span className="ev-tier" data-tone="muted">{burial.label}</span></td>
                    </>
                  )}
                </tr>
                <tr data-testid="burial-packing-row">
                  <td>
                    <span className="rsx-name">
                      Cα neighbours
                      <button type="button" className="rsx-info" onClick={() => onExplain("contact_density")} aria-label="Explain Cα neighbours">
                        <Info className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </span>
                    <span className="rsx-note">within 10 Å, a reading only</span>
                  </td>
                  {packing && packing.marker !== null ? (
                    <>
                      <td>
                        <ValueTrack
                          value={packing.marker}
                          max={packing.domainMax}
                          marks={[]}
                          label={`${packing.valueLabel} Cα atoms within 10 Å. Shown as a reading; it does not decide burial.`}
                        />
                      </td>
                      <td className="rsx-num rsx-end">{packing.valueLabel}</td>
                      <td className="rsx-end rsx-reason">Does not decide burial</td>
                    </>
                  ) : (
                    <td colSpan={3} className="rsx-reason">Not reported.</td>
                  )}
                </tr>
                {(burial.staleWord || burial.disagreement) && (
                  <tr>
                    <td colSpan={4} className="rsx-reason">{burial.disagreement ?? burial.staleWord}</td>
                  </tr>
                )}
              </>
            )}

            <tr className="rsx-group">
              <td colSpan={4}>
                <span className="rsx-label"><InspectReadingButton tab="structure" readingKey="pocket">Predicted pocket</InspectReadingButton></span>
                <span className="rsx-reason">
                  P2Rank{pocket.ranking.profile ? ` · ${pocket.ranking.profile} profile` : ""} · the structure loaded in 3D
                  <button type="button" className="rsx-info" onClick={() => onExplain("p2rank")} aria-label="Explain P2Rank">
                    <Info className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </span>
                <span className="rsx-caption">
                  Finds cavity geometry on one static structure, not function. Its probability is calibrated per profile and does not compare across profiles.
                </span>
              </td>
            </tr>
            {pocket.status === "success" ? (
              <>
                <tr data-testid="pocket-distance-row">
                  <td>
                    <span className="rsx-name">Distance</span>
                    <span className="rsx-note">to {pocket.proximity.reference}</span>
                  </td>
                  {pocketStrip && pocketStrip.centre !== null ? (
                    <>
                      <td className="rsx-reason">Shown on the pocket distance map below</td>
                      <td className="rsx-num">{pocketStrip.centre.distance.toFixed(1)} Å</td>
                    </>
                  ) : (
                    <td colSpan={2} className="rsx-reason">{pocket.proximity.detail}</td>
                  )}
                  <td className="rsx-end"><span className="ev-tier" data-tone="neutral">{pocket.classification.label}</span></td>
                </tr>
                <tr data-testid="pocket-score-row">
                  <td>
                    <span className="rsx-name">
                      {pocket.ranking.kind === "probability" ? "Ligand-site probability" : "P2Rank score"}
                    </span>
                    <span className="rsx-note">
                      {pocket.ranking.kind === "probability" ? "P2Rank, this profile only" : "not a probability"}
                    </span>
                  </td>
                  <td className="rsx-reason">
                    {pocket.ranking.kind === "probability"
                      ? "P2Rank's estimate that this cavity binds a ligand"
                      : pocket.ranking.kind === "rescaled_raw_score"
                        ? "The probability rounded to zero, so the runner reports a rescaled score"
                        : "This result does not say whether the score is a probability"}
                  </td>
                  <td className="rsx-num rsx-end">{pocket.ranking.display ?? "Not reported"}</td>
                  <td className="rsx-end rsx-reason">No local band</td>
                </tr>
                <tr data-testid="pocket-volume-row">
                  <td>
                    <span className="rsx-name">Cavity size</span>
                    <span className="rsx-note">{pocket.volume.isMeasured ? "measured volume" : "surface points"}</span>
                  </td>
                  <td className="rsx-reason">
                    {pocket.volume.isMeasured ? `${pocket.volume.label}: ${pocket.volume.detail}` : "No volume was measured, so none is quoted"}
                  </td>
                  <td className="rsx-num rsx-end">
                    {pocket.volume.isMeasured && pocket.volume.volume !== null
                      ? `${pocket.volume.volume.toLocaleString()} Å³`
                      : pocket.volume.surfacePoints !== null
                        ? pocket.volume.surfacePoints
                        : "Not reported"}
                  </td>
                  <td className="rsx-end rsx-reason">{pocket.volume.isMeasured ? "Measured geometry" : "Count, not volume"}</td>
                </tr>
              </>
            ) : (
              <tr data-testid="pocket-state-row">
                <td colSpan={4}>
                  <div className="rsx-statement">
                    <strong>{pocket.status === "loading" ? ENGINE_STATE_LABELS.running : pocket.headline}</strong>
                    {pocket.plainLanguage && <span>{pocket.plainLanguage}</span>}
                    {canRetry && (
                      <button
                        type="button"
                        className="rsx-button"
                        disabled={isPocketLoading}
                        onClick={() => {
                          // `void`: the handler may return a promise React would discard.
                          void onRetryPocket!();
                        }}
                      >
                        <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                        Retry pocket detection
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pocket.status === "success" && pocketStrip && (
        <PocketDistanceStrip
          strip={pocketStrip}
          onSelectResidue={onSelectResidue}
          onViewIn3d={onViewIn3d}
        />
      )}
      <div className="rsx-foot">
        <span className="rsx-legend">
          <span><i className="rsx-key-cut" aria-hidden="true" />This app&apos;s own cut-points, not published ones</span>
        </span>
        {pocket.status === "success" && <span>Distances are from residue {model.pair.position ?? "under study"}.</span>}
      </div>
    </section>
  );
}

export function StructureTab({
  analysisState,
  setSelectedMetric,
  computedPocket,
  isPocketLoading,
  pocketError,
  isBiophysicalLoading,
  active3dModelTab,
  onRetryPocket,
  onRetryStructural,
  onSelectResidue,
  onNavigateToView
}: TabComponentProps) {
  const result = analysisState.result;
  const workspace = useEvidenceWorkspace('structure');
  const { model } = useResidueContextEvidence({ result, computedPocket, isPocketLoading, pocketError, isBiophysicalLoading });

  if (!result) return null;

  const firstResidue = model.pocket.lining.byDistance[0];
  const viewIn3d = onNavigateToView
    ? () => {
        if (firstResidue) onSelectResidue?.(firstResidue.index);
        onNavigateToView(active3dModelTab === "esm3" || active3dModelTab === "esmfold2" ? "structure_esmfold" : "structure_alphafold");
      }
    : undefined;

  return (
    <div data-evidence-screen className="rsx-screen" data-comparison={workspace.comparison || undefined} data-testid="residue-shifts-tab">
      <header>
        <h1 className="screen-title">{evidenceTab('structure').label}</h1>
        <p className="screen-tab-description">
          What the substitution changes in the side chain, where the residue sits in the structure, and how close it is to a predicted ligand pocket.
        </p>
      </header>
      <EvidenceViewTabs tab="structure" comparisonLabel="Residue comparison" />
      <EvidencePanel tab="structure">
      {(!workspace.enabled || workspace.comparison) && <Finding model={model} />}
      {workspace.enabled && !workspace.comparison && <ResidueContextLine model={model} />}
      {workspace.comparison && <ResiduePropertyComparison model={model} />}
      {(!workspace.enabled || workspace.view === 'records') && <Environment
        model={model}
        onExplain={setSelectedMetric}
        onRetryPocket={onRetryPocket}
        onRetryStructural={onRetryStructural}
        isPocketLoading={isPocketLoading}
        isStructuralLoading={isBiophysicalLoading}
        onSelectResidue={onSelectResidue}
        onViewIn3d={viewIn3d}
      />}
      </EvidencePanel>
    </div>
  );
}
