import React, { useEffect, useState } from "react";
import { BookOpen, Crosshair, Database, GitBranch, Layers, Ruler } from "lucide-react";
import { useStructure3dEvidence } from "../../lib/useStructure3dEvidence";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { describeDeNovoCapacityNotice, readProteinLength, resolveDeNovoFoldingCapacity } from "../../shared/foldingLimits";
import type { CoordinateIdentity, ModelFamily, Structure3dEvidence, TraceStep } from "../../shared/structure3dEvidence";

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

function IdentityRow({ role, identity }: { role: string; identity: CoordinateIdentity }) {
  return (
    <div className="s3d-canvas-card__row">
      <span className="s3d-canvas-card__role">{role}</span>
      <span className="s3d-canvas-card__name">
        {identity.href ? <a href={identity.href} target="_blank" rel="noreferrer">{identity.name}</a> : identity.name}
        <span className="s3d-canvas-card__sub">{[identity.kind, identity.detail].filter(Boolean).join(" · ")}</span>
        <span className="s3d-canvas-card__sub">{identity.channel.note}</span>
      </span>
    </div>
  );
}

function SiteSection({ site, isWildType }: { site: Structure3dEvidence["site"]; isWildType: boolean }) {
  return (
    <section className="s3d-rsec" aria-labelledby="s3d-rail-site">
      <h3 className="eyebrow" id="s3d-rail-site">
        <span><Crosshair className="w-3.5 h-3.5" aria-hidden="true" />{isWildType ? "Variant site" : "Wild-type reference site"}</span>
        {site.selected !== null && <span className="s3d-rsec__meta">selected: {site.selected}</span>}
      </h3>
      {!isWildType && <p className="s3d-section-intro">These site readings come from the wild-type coordinate source, not the FoldX or de novo variant model.</p>}
      <dl className="s3d-kv" data-testid="structure-site">
        <div className="s3d-kv__row"><dt>Substitution</dt><dd className="s3d-mono">{site.substitution ?? "Not reported"}</dd></div>
        <div className="s3d-kv__row">
          <dt>In the structure</dt>
          <dd>
            {site.check.state === "match" ? "Matches" : site.check.state === "mismatch" ? "Different residue" : site.check.state === "absent" ? "Not modelled" : "Not checked"}
            <span className="s3d-kv__note">{site.check.text}</span>
          </dd>
        </div>
        <div className="s3d-kv__row">
          <dt>{site.confidence.kind === "b-factor" ? "B-factor" : "Confidence"}</dt>
          <dd><span className="s3d-mono">{site.confidence.text}</span><span className="s3d-kv__note">{site.confidence.note}</span></dd>
        </div>
        {site.burial && (
          <div className="s3d-kv__row">
            <dt>Pipeline accessibility</dt>
            <dd>{site.burial}<span className="s3d-kv__note">From the analysis structure; it may differ from the canvas.</span></dd>
          </div>
        )}
        {site.region && <div className="s3d-kv__row"><dt>UniProt region</dt><dd>{site.region}</dd></div>}
      </dl>
    </section>
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

function ExperimentalEntries({ experimental, setCustomPdbUrl }: {
  experimental: ReturnType<typeof useStructure3dEvidence>["experimental"];
  setCustomPdbUrl: (url: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const entrySignature = experimental.rows.map(row => `${row.pdbId}:${row.loaded}`).join("|");
  useEffect(() => {
    if (experimental.rows.length > 0 && (experimental.rows.length <= 3 || experimental.rows.some(row => row.loaded))) setOpen(true);
    // Reopen only when the list or selected entry changes, not on every evidence-model render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrySignature]);
  return (
    <details className="s3d-disclosure" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Browse experimental entries</summary>
      <ul className="s3d-entries" data-testid="structure-entries">
        {experimental.rows.map(row => (
          <li key={row.pdbId} className="s3d-entry" data-loaded={row.loaded || undefined}>
            <span className="s3d-entry__id">
              {row.pdbId}
              {experimental.best?.pdbId === row.pdbId && <span className="s3d-entry__tag">closest covering entry</span>}
            </span>
            <button
              type="button" className="s3d-entry__load" aria-pressed={row.loaded}
              onClick={() => setCustomPdbUrl(row.loaded ? null : row.url)}
              aria-label={row.loaded ? `Return to the AlphaFold model from PDB ${row.pdbId}` : `Load PDB ${row.pdbId} on the canvas`}
            >{row.loaded ? "Shown" : "Show"}</button>
            <span className="s3d-entry__meta">
              {[
                row.identity === "Not reported" ? "identity not reported" : `identity ${row.identity}`,
                row.range ? `aligned ${row.range}` : "range not reported",
                row.coversSite === "yes" ? "covers the site" : row.coversSite === "no" ? "does not cover the site" : null,
                row.method ? row.method.toLowerCase() : null, row.resolution, row.organism,
              ].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="s3d-empty s3d-dim">{experimental.note}</p>
    </details>
  );
}

export interface StructureInspectorProps {
  family: ModelFamily;
  setCustomPdbUrl?: (url: string | null) => void;
}

export const StructureInspector: React.FC<StructureInspectorProps> = ({ family, setCustomPdbUrl }) => {
  const model = useStructure3dEvidence(family);
  const proteinLength = useVariantAnalysisStore(s => readProteinLength(s.analysisState?.result?.metadata).residues);
  const hasResult = useVariantAnalysisStore(s => Boolean(s.analysisState?.result));
  const deNovoFailed = useVariantAnalysisStore(s => Boolean(s.esmFoldingError));

  if (!hasResult) {
    return <div className="s3d-rail"><p className="s3d-empty"><strong>No variant loaded</strong>The structure trace appears after an analysis.</p></div>;
  }

  const { canvas, experimental, site } = model;
  const isWildType = model.viewMode === "wildtype";
  const capacityNotice =
    proteinLength !== null && !(family === "esmfold" && deNovoFailed)
      ? describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(proteinLength))
      : null;
  const capacity =
    capacityNotice && (family === "esmfold" ? !canvas.primary : capacityNotice.tone === "warning") ? capacityNotice : null;

  return (
    <div className="s3d-rail" data-testid="structure-rail" data-mode={model.viewMode}>
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
            />
            {canvas.secondary && <IdentityRow role="Variant" identity={canvas.secondary} />}
          </div>
        ) : (
          <p className="s3d-empty"><strong>{canvas.chip.label}</strong>{family === "esmfold" ? "No de novo structure is loaded." : "The wild-type coordinates are loading."}</p>
        )}
        {canvas.relationshipNote && <p className="s3d-relationship">{canvas.relationshipNote}</p>}
        {model.representation === "esm3" && (
          <p className="s3d-relationship">ESM3 colours are a variant-conditioned sequence overlay projected onto the predicted wild type. They do not measure a change in this structure.</p>
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

      {isWildType ? <SiteSection site={site} isWildType /> : <ComparisonSection model={model} />}
      {!isWildType && <SiteSection site={site} isWildType={false} />}

      {family === "alphafold" && setCustomPdbUrl && (
        <section className="s3d-rsec" aria-labelledby="s3d-rail-entries">
          <h3 className="eyebrow" id="s3d-rail-entries">
            <span><Database className="w-3.5 h-3.5" aria-hidden="true" />Experimental structures</span>
            <span className="s3d-rsec__meta">{experimental.loading ? "Searching RCSB" : `${experimental.rows.length} listed`}</span>
          </h3>
          <p className="s3d-section-intro">Show changes the wild-type canvas only. The FoldX variant keeps its own template.</p>
          {experimental.rows.length === 0 ? (
            <p className="s3d-empty">
              {experimental.loading ? "Searching the PDB for entries of this protein and its homologs." : "RCSB's sequence search returned no experimental entry."}
            </p>
          ) : <ExperimentalEntries experimental={experimental} setCustomPdbUrl={setCustomPdbUrl} />}
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
