import React from "react";
import { Info, RotateCw } from "lucide-react";
import { TabComponentProps } from "./types";
import { useResidueContextEvidence } from "../../lib/useResidueContextEvidence";
import type { ResidueContextEvidence } from "../../shared/residueContextEvidence";
import { RESIDUE_SCALE_SOURCES } from "../../shared/residueScales";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { Prose } from "../ui/Prose";
import { ResidueGlyph } from "./residue/ResidueGlyph";
import { PropertyDumbbell, PropertyScaleReference } from "./residue/PropertyDumbbell";
import { PocketDistanceStrip } from "./residue/PocketDistanceStrip";
import { EvidencePanel, EvidenceViewTabs, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ResiduePropertyComparison } from './MolecularComparison';

/**
 * Residue Shifts & Pockets — the tab.
 *
 * Three tiers, from one model (`buildResidueContextEvidence`) that the inspector rail also renders:
 *   1. the finding: the residue pair, one sentence, the side-chain sketch and four key facts;
 *   2. residue properties: one row per published scale, the two residues on its own axis;
 *   3. structural environment: burial (measured accessibility, the Cα count as a reading) and the
 *      predicted pocket (one distance, one probability, residues nearest first).
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

function Finding({ model, compact = false }: { model: ResidueContextEvidence; compact?: boolean }) {
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
            <span className="rsx-pair__sub">
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
      <details className="mol-finding-details" open={compact ? undefined : true}>
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

function Properties({ model }: { model: ResidueContextEvidence }) {
  const { pair, properties } = model;
  return (
    <section className="rsx-card" aria-label="Residue properties" data-testid="residue-properties">
      {properties ? (
        <div className="rsx-table-wrap">
          <table className="rsx-table rsx-table--properties">
            <thead>
              <tr>
                <th scope="col" className="rsx-col-name">Property</th>
                <th scope="col" className="rsx-col-track">Position on the published scale</th>
                <th scope="col" className="rsx-num rsx-col-val">{pair.wildType}</th>
                <th scope="col" className="rsx-num rsx-col-val">{pair.mutant}</th>
                <th scope="col" className="rsx-num rsx-col-shift">Shift</th>
              </tr>
            </thead>
            <tbody>
              {properties.map(row => (
                <tr key={row.key} data-testid={`property-row-${row.key}`}>
                  <td>
                    <span className="rsx-name"><InspectReadingButton tab="structure" readingKey={row.key}>{row.label}</InspectReadingButton></span>
                    <span className="rsx-note">{RESIDUE_SCALE_SOURCES[row.key].citation}{RESIDUE_SCALE_SOURCES[row.key].unit ? `, ${RESIDUE_SCALE_SOURCES[row.key].unit}` : ""}</span>
                  </td>
                  <td>
                    <PropertyDumbbell
                      row={row}
                      wildType={pair.wildType}
                      mutant={pair.mutant}
                    />
                  </td>
                  <td className="rsx-num">{row.wildTypeNative ?? row.wildTypeValue}</td>
                  <td className="rsx-num">{row.mutantNative ?? row.mutantValue}</td>
                  <td className="rsx-num">
                    <span className="rsx-shift">{row.plainChange}</span>
                    <span className="rsx-note">{row.direction === "unchanged" ? "0%" : `${Math.round(row.absoluteDelta)}%`} of the scale</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rsx-hero__body">
          <p className="rsx-statement">
            <strong>{model.propertiesState === "loading" ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"]}</strong>
            <span>
              {model.propertiesState === "loading"
                ? "The residue property scales are still being assembled for this substitution."
                : "The wild-type or variant residue could not be resolved to a standard amino acid, so no scale is drawn."}
            </span>
          </p>
        </div>
      )}
      {model.backbone && (
        <p className="rsx-caveat" data-testid="backbone-caveat">
          <span className="rsx-ring" aria-hidden="true" />
          <span>
            <strong>{model.backbone.title}</strong> {model.backbone.body}
          </span>
        </p>
      )}
      <div className="rsx-foot">
        <span className="rsx-legend">
          <span><i className="rsx-key-wt" aria-hidden="true" />{pair.wildType}, wild type</span>
          <span><i className="rsx-key-mut" aria-hidden="true" />{pair.mutant}, variant</span>
        </span>
        <span>
          Shift is the share of each scale&apos;s range. The scales describe the two residues, not an effect on this protein.
        </span>
        {properties && (
          <PropertyScaleReference
            items={properties.map(row => ({ key: row.key, label: row.label, ticks: model.scaleContext[row.key] }))}
          />
        )}
      </div>
    </section>
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
  const canRetryStructure = !!onRetryStructural && !!burial && burial.status === "undetermined";

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
                <span className="rsx-reason">
                  {burial ? burial.structure : `${ENGINE_STATE_LABELS["no-result"]} · the structure step returned no accessibility or packing reading`}
                </span>
              </td>
            </tr>
            {!burial ? null : (
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
                      <td>
                        <ValueTrack
                          value={pocketStrip.centre.distance}
                          max={pocketStrip.max}
                          marks={pocketStrip.marks}
                          unit=" Å"
                          label={`${pocketStrip.centre.distance.toFixed(1)} Å from ${pocket.proximity.reference}; the app's marks are ${pocketStrip.marks.join(", ")} Å.`}
                        />
                      </td>
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
    <div className="rsx-screen" data-comparison={workspace.comparison || undefined} data-testid="residue-shifts-tab">
      <header>
        <h1 className="screen-title">Residue shifts and pockets</h1>
        <p className="screen-tab-description">
          What the substitution changes in the side chain, where the residue sits in the structure, and how close it is to a predicted ligand pocket.
        </p>
      </header>
      <EvidenceViewTabs tab="structure" comparisonLabel="Residue comparison" />
      <EvidencePanel tab="structure">
      <Finding model={model} compact={workspace.comparison} />
      {workspace.comparison ? <ResiduePropertyComparison model={model} /> : <Properties model={model} />}
      <Environment
        model={model}
        onExplain={setSelectedMetric}
        onRetryPocket={onRetryPocket}
        onRetryStructural={onRetryStructural}
        isPocketLoading={isPocketLoading}
        isStructuralLoading={isBiophysicalLoading}
        onSelectResidue={onSelectResidue}
        onViewIn3d={viewIn3d}
      />
      </EvidencePanel>
    </div>
  );
}
