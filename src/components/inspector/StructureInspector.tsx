import type { StructureSelection } from "../../shared/structureSelection";
import React from "react";
import { BookOpen, Database, GitBranch, Layers, Ruler, Spline } from "lucide-react";
import { useStructure3dEvidence } from "../../lib/useStructure3dEvidence";
import { landscapeKey } from "../../shared/landscapeEvidence";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { describeDeNovoCapacityNotice, readProteinLength, resolveDeNovoFoldingCapacity } from "../../shared/foldingLimits";
import { alphafoldDbCoverage } from "../../shared/alphafoldAvailability";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import type { CoordinateIdentity, ModelFamily, Structure3dEvidence, TraceStep } from "../../shared/structure3dEvidence";
import { trackRegions } from "../../shared/residueRegions";
import { ResearchGuideButton } from "../knowledge/ResearchGuideButton";
import { StructureSelectionCard } from "./StructureSelectionCard";
import { StructureFoldTrack } from "./StructureFoldTrack";
import { StructureExperimentalEntries } from "./StructureExperimentalEntries";

function Step({ step }: { step: TraceStep }) {
  return (
    <li className="s3d-step" data-state={step.state}>
      <span className="s3d-step__n" aria-hidden="true">{step.n}</span>
      <div className="s3d-step__body">
        <span className="s3d-step__label">{step.label}</span>
        <span className="s3d-step__value">{step.value}</span>
        {step.sub && <span className="s3d-step__sub">{step.sub}</span>}
        {step.warn && <span className="s3d-step__warn">{step.warn}</span>}
      </div>
    </li>
  );
}

/** Which reading guide explains the value the drawn model stores in its B-factor column. */
function confidenceGuide(kind: CoordinateIdentity["channel"]["kind"]): { topic: string; label: string } {
  if (kind === "plddt") return { topic: "plddt", label: "Explain this structure confidence measure" };
  if (kind === "temperature-factor") return { topic: "bfactor", label: "Explain this structure confidence measure" };
  return { topic: "structure_confidence", label: "Why structure confidence is not interpreted" };
}

function IdentityRow({ role, identity, withGuide }: { role: string; identity: CoordinateIdentity; withGuide?: boolean }) {
  const guide = confidenceGuide(identity.channel.kind);
  return (
    <div className="s3d-canvas-card__row">
      <span className="s3d-canvas-card__role">{role}</span>
      <span className="s3d-canvas-card__name">
        {identity.href ? <a href={identity.href} target="_blank" rel="noreferrer">{identity.name}</a> : identity.name}
        <span className="s3d-canvas-card__sub">{[identity.kind, identity.detail].filter(Boolean).join(" · ")}</span>
        <span className="s3d-canvas-card__sub">
          {identity.channel.note}
          {withGuide && <ResearchGuideButton topic={guide.topic} context={identity.channel.note} label={guide.label} iconOnly className="s3d-canvas-card__guide" />}
        </span>
      </span>
    </div>
  );
}

function ComparisonSection({ model }: { model: Structure3dEvidence }) {
  const { comparison, readings } = model;
  return (
    <section className="s3d-rsec" aria-labelledby="s3d-rail-compare">
      <h3 className="eyebrow" id="s3d-rail-compare">
        <span><Ruler className="w-3.5 h-3.5" aria-hidden="true" />{comparison.rigidBackbone ? "Side-chain comparison" : "Coordinate comparison"}</span>
        {comparison.fit && !comparison.rigidBackbone && <span className="s3d-rsec__meta">{comparison.fit} fit</span>}
      </h3>
      {comparison.state === "ready" && readings.length > 0 ? (
        <>
          <p className="s3d-section-intro">{comparison.headline}.</p>
          {comparison.rigidBackbone && (
            <p className="s3d-comparison-context">FoldX fixes the template backbone. Cα motion and RMSD are zero by construction, so this view reports the side-chain and contact readings instead.</p>
          )}
          <ul className="s3d-readings" data-testid="structure-readings">
            {readings.map(reading => (
              <li key={reading.key} className="s3d-reading">
                <span className="s3d-reading__label">{reading.label}</span>
                <span className="s3d-reading__value" data-state={reading.state}>
                  {reading.value ?? (reading.state === "not-applicable" ? "Not applicable" : "Not measured")}
                </span>
                <span className="s3d-reading__note">{reading.note}</span>
                {reading.caveat && <span className="s3d-reading__caveat">{reading.caveat}</span>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="s3d-empty"><strong>{comparison.headline}</strong>{comparison.reason}</p>
      )}
    </section>
  );
}

export interface StructureInspectorProps {
  selection?: StructureSelection;
  family: ModelFamily;
  setCustomPdbUrl?: (url: string | null) => void;
  onReturnToVariant?: () => void;
  onSelectResidue?: (position: number) => void;
}

export const StructureInspector: React.FC<StructureInspectorProps> = ({
  family,
  setCustomPdbUrl,
  selection,
  onReturnToVariant,
  onSelectResidue,
}) => {
  const model = useStructure3dEvidence(family);
  const proteinLength = useVariantAnalysisStore(s => readProteinLength(s.analysisState?.result?.metadata).residues);
  const hasResult = useVariantAnalysisStore(s => Boolean(s.analysisState?.result));
  const deNovoFailed = useVariantAnalysisStore(s => Boolean(s.esmFoldingError));
  const canvasSecondary = useVariantAnalysisStore(s => s.canvasSecondary);
  const canvasSecondaryState = useVariantAnalysisStore(s => s.canvasSecondaryState);
  const features = useVariantAnalysisStore(s => s.analysisState?.result?.uniprotFeatures?.features ?? null);

  if (!hasResult) {
    return <div className="s3d-rail"><p className="s3d-empty"><strong>No variant loaded</strong>The structure trace appears after an analysis.</p></div>;
  }

  const { canvas, experimental, site } = model;
  const capacityNotice =
    proteinLength !== null && !(family === "esmfold" && deNovoFailed)
      ? describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(proteinLength), {
          // Only a length past AlphaFold DB's ceiling proves the model cannot exist; a length
          // inside it says nothing about whether an entry was published.
          alphafoldModelAvailable: alphafoldDbCoverage(proteinLength) === "beyond-limit" ? false : null,
        })
      : null;
  const capacity =
    capacityNotice && (family === "esmfold" ? !canvas.primary : capacityNotice.tone === "warning") ? capacityNotice : null;

  const handleReturn = () => {
    const store = useVariantAnalysisStore.getState();
    store.setHoveredResidueIndex(null);
    if (onReturnToVariant) {
      onReturnToVariant();
      return;
    }
    if (!site.position) return;
    const meta = store.analysisState?.result?.metadata;
    store.setLandscapeSelection({
      key: landscapeKey(store.gene, store.variant, store.uniprotId),
      kind: "substitution",
      pos: site.position,
      alt: meta?.mutant || undefined,
    });
    store.setSelectedGenomicVariant(null);
    store.setSelectedResidueIndex(site.position);
  };
  const trackLength = proteinLength ?? (canvas.primary?.numbering === "uniprot" ? canvasSecondary?.segments.at(-1)?.end ?? 0 : 0);
  // `readModelSecondary` numbers residues with the drawn model's own auth_seq_id. Plotting that row on
  // the UniProt axis is only honest when the entry was renumbered to UniProt.
  const numberingIsUniprot = canvas.primary?.numbering === "uniprot";
  const foldSecondary = numberingIsUniprot ? canvasSecondary : null;
  const foldNote = !canvas.primary
    ? "Secondary structure appears once the model is drawn."
    : !numberingIsUniprot
      ? "Secondary structure hidden: this entry uses its own author numbering, not UniProt, so it cannot share this axis."
      : canvasSecondaryState === "reading"
        ? "Reading the secondary-structure assignment from the model…"
        : canvasSecondaryState === "unavailable"
          ? "Mol* returned no secondary-structure assignment for this model. This is a result, not a load in progress."
          : null;

  return (
    <div className="s3d-rail" data-testid="structure-rail" data-mode={model.viewMode}>
      {selection && <StructureSelectionCard selection={selection} site={site} onReturn={handleReturn} />}

      <section className="s3d-rsec" aria-labelledby="s3d-rail-fold">
        <h3 className="eyebrow" id="s3d-rail-fold">
          <span><Spline className="w-3.5 h-3.5" aria-hidden="true" />Fold and regions</span>
        </h3>
        <StructureFoldTrack
          secondary={foldSecondary}
          secondaryNote={foldNote}
          regions={trackRegions(features)}
          length={trackLength}
          structureName={canvas.primary?.name ?? null}
          variantPosition={site.position}
          selectedPosition={selection?.position ?? null}
          onSelectResidue={onSelectResidue}
        />
      </section>

      <section className="s3d-rsec s3d-rsec--canvas" aria-labelledby="s3d-rail-canvas">
        <h3 className="eyebrow" id="s3d-rail-canvas">
          <span><Layers className="w-3.5 h-3.5" aria-hidden="true" />On the canvas</span>
          <span className="s3d-rsec__meta">{model.modes.find(mode => mode.id === model.viewMode)?.label}</span>
        </h3>
        {canvas.primary ? (
          <div className="s3d-canvas-card" data-testid="structure-rail-canvas">
            <IdentityRow
              role={canvas.secondary && family === "alphafold" ? "Template" : canvas.primary.role === "variant" ? "Variant" : "Wild type"}
              identity={canvas.primary}
              withGuide
            />
            {canvas.secondary && <IdentityRow role="Variant" identity={canvas.secondary} />}
          </div>
        ) : (
          <p className="s3d-empty"><strong>{canvas.chip.label}</strong>{family === "esmfold" ? "No de novo structure is loaded." : "The wild-type coordinates are loading."}</p>
        )}
        {canvas.relationshipNote && <p className="s3d-relationship">{canvas.relationshipNote}</p>}
        {model.representation === "esm3" && (
          <p className="s3d-relationship">Embedding colours are a variant-conditioned sequence overlay projected onto the predicted wild type. They do not measure a change in this structure.</p>
        )}
        {model.notices.map(notice => (
          <p key={notice.key} className="s3d-notice" data-tone={notice.tone}><strong>{notice.title}</strong>{notice.body}</p>
        ))}
        {capacity && (
          <p className="s3d-notice" data-tone={capacity.tone === "warning" ? "warning" : "info"} data-folding-notice={capacity.tone}>
            <strong>{capacity.title}</strong>{capacity.body}
          </p>
        )}
      </section>

      {model.viewMode !== "wildtype" && <ComparisonSection model={model} />}

      {family === "alphafold" && setCustomPdbUrl && (
        <section className="s3d-rsec" aria-labelledby="s3d-rail-entries">
          <h3 className="eyebrow" id="s3d-rail-entries">
            <span><Database className="w-3.5 h-3.5" aria-hidden="true" />Experimental structures</span>
            <span className="s3d-rsec__meta">{experimental.loading ? "Searching RCSB" : `${experimental.rows.length} listed`}</span>
          </h3>
          <p className="s3d-section-intro">Show loads an entry as the wild type. The FoldX variant keeps its own template.</p>
          {experimental.rows.length === 0 ? (
            <p className="s3d-empty">
              {experimental.loading ? "Searching the PDB for entries of this protein and its homologs." : "RCSB's sequence search returned no experimental entry."}
            </p>
          ) : <StructureExperimentalEntries experimental={experimental} setCustomPdbUrl={setCustomPdbUrl} />}
        </section>
      )}

      <section className="s3d-rsec" aria-labelledby="s3d-rail-method">
        <h3 className="eyebrow" id="s3d-rail-method"><span><BookOpen className="w-3.5 h-3.5" aria-hidden="true" />Method and sources</span></h3>
        <details className="s3d-disclosure">
          <summary><GitBranch className="w-3.5 h-3.5" aria-hidden="true" />Coordinate lineage · {model.trace.length} steps</summary>
          <ol className="s3d-steps" data-testid="structure-rule-trace">{model.trace.map(step => <Step key={step.n} step={step} />)}</ol>
        </details>
        <details className="s3d-disclosure">
          <summary>What the view can and cannot tell you</summary>
          <ul className="s3d-method-list">{model.notes.map(note => <li key={note}>{note}</li>)}<li>{model.engineRecord}</li></ul>
        </details>
        <details className="s3d-disclosure">
          <summary>Sources · {model.sources.length}</summary>
          <ul className="s3d-refs" data-testid="structure-sources">
            {model.sources.map(source => (
              <li key={source.doi}>{source.citation}<br /><a href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer">doi:{source.doi}</a></li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
};

export default React.memo(StructureInspector);
