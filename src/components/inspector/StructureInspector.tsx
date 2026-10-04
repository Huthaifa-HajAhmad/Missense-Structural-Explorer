import React from "react";
import { BookOpen, Crosshair, Database, GitBranch, Layers, Ruler } from "lucide-react";
import { useStructure3dEvidence } from "../../lib/useStructure3dEvidence";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { describeDeNovoCapacityNotice, readProteinLength, resolveDeNovoFoldingCapacity } from "../../shared/foldingLimits";
import type { CoordinateIdentity, ModelFamily, TraceStep } from "../../shared/structure3dEvidence";

/**
 * 3D structure — the inspector rail. It renders the same model as the viewer's toolbar and colour key
 * (`useStructure3dEvidence`), as a trace a curator can audit.
 *
 * It replaced a panel that, on NAE1 p.Asp116Gly, showed "pLDDT Confidence 94.5 (Very High)" for a
 * crystal B-factor; "PDB B-Factor" for the AlphaFold model (the B-factor metadata was never wired);
 * "Local Window RMSD ±15 residue active-site" for a ±5 window; χ1 "0.0°" for a glycine; "N/A" four
 * times; homolog identities that were RCSB relevance scores and coverages that were a hard-coded 80%;
 * "ESMFold-2 … (Lin et al. 2023)", which cites ESMFold v1; and a de novo tip asserting that local
 * alignment "snaps structured domains (< 1.0 Å RMSD)". The model switch moved to the canvas toolbar,
 * where it stays usable when this panel is collapsed.
 */

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
        {identity.href ? (
          <a href={identity.href} target="_blank" rel="noreferrer">{identity.name}</a>
        ) : (
          identity.name
        )}
        <span className="s3d-canvas-card__sub">{[identity.kind, identity.detail].filter(Boolean).join(" · ")}</span>
        <span className="s3d-canvas-card__sub">{identity.channel.note}</span>
      </span>
    </div>
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
    return (
      <div className="s3d-rail">
        <p className="s3d-empty">
          <strong>No variant loaded</strong>
          The trace appears once a variant has been analysed.
        </p>
      </div>
    );
  }

  const { canvas, comparison, readings, site, experimental } = model;
  /**
   * The de novo length notice (`foldingLimits`). Shown in the ESMFold view while no fold is on screen,
   * and in the AlphaFold view only when no de novo model is possible at all. Suppressed while a fold
   * failure is reported: a "folding uses Tier-1" line under a failure is the contradiction the old
   * panel shipped.
   */
  const capacityNotice =
    proteinLength !== null && !(family === "esmfold" && deNovoFailed)
      ? describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(proteinLength))
      : null;
  const capacity =
    capacityNotice && (family === "esmfold" ? !model.canvas.primary : capacityNotice.tone === "warning") ? capacityNotice : null;

  return (
    <div className="s3d-rail" data-testid="structure-rail">
      {/* ── 1. What is on the canvas ── */}
      <section className="s3d-rsec" aria-labelledby="s3d-rail-canvas">
        <h3 className="eyebrow" id="s3d-rail-canvas">
          <span><Layers className="w-3.5 h-3.5" aria-hidden="true" />On the canvas</span>
          <span className="s3d-rsec__meta">{model.modes.find(m => m.id === model.viewMode)?.label}</span>
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
          <p className="s3d-empty">
            <strong>{canvas.chip.label}</strong>
            {family === "esmfold" ? "No de novo structure is loaded." : "The wild-type coordinates are loading."}
          </p>
        )}
        {model.notices.map(n => (
          <p key={n.key} className="s3d-notice" data-tone={n.tone}>
            <strong>{n.title}</strong>
            {n.body}
          </p>
        ))}
        {capacity && (
          <p className="s3d-notice" data-tone={capacity.tone === "warning" ? "warning" : "info"} data-folding-notice={capacity.tone}>
            <strong>{capacity.title}</strong>
            {capacity.body}
          </p>
        )}
      </section>

      {/* ── 2. Trace ── */}
      <section className="s3d-rsec" aria-labelledby="s3d-rail-trace">
        <h3 className="eyebrow" id="s3d-rail-trace">
          <span><GitBranch className="w-3.5 h-3.5" aria-hidden="true" />Trace</span>
        </h3>
        <ol className="s3d-steps" data-testid="structure-rule-trace">
          {model.trace.map(step => <Step key={step.n} step={step} />)}
        </ol>
      </section>

      {/* ── 3. Comparison ── */}
      <section className="s3d-rsec" aria-labelledby="s3d-rail-compare">
        <h3 className="eyebrow" id="s3d-rail-compare">
          <span><Ruler className="w-3.5 h-3.5" aria-hidden="true" />Coordinate comparison</span>
          {comparison.fit && <span className="s3d-rsec__meta">{model.alignment.scope === "global" ? "whole-chain fit" : "local fit"}</span>}
        </h3>
        {comparison.state === "ready" && readings.length > 0 ? (
          <>
            <p className="s3d-empty">{comparison.headline}.</p>
            <ul className="s3d-readings" data-testid="structure-readings">
              {readings.map(r => (
                <li key={r.key} className="s3d-reading">
                  <span className="s3d-reading__label">{r.label}</span>
                  <span className="s3d-reading__value" data-state={r.state}>
                    {r.value ?? (r.state === "not-applicable" ? "Not applicable" : "Not measured")}
                  </span>
                  <span className="s3d-reading__note">{r.note}</span>
                  {r.caveat && <span className="s3d-reading__caveat">{r.caveat}</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="s3d-empty">
            <strong>{comparison.headline}</strong>
            {comparison.reason}
          </p>
        )}
      </section>

      {/* ── 4. Variant site ── */}
      <section className="s3d-rsec" aria-labelledby="s3d-rail-site">
        <h3 className="eyebrow" id="s3d-rail-site">
          <span><Crosshair className="w-3.5 h-3.5" aria-hidden="true" />Variant site</span>
          {site.selected !== null && <span className="s3d-rsec__meta">selected: {site.selected}</span>}
        </h3>
        <dl className="s3d-kv" data-testid="structure-site">
          <div className="s3d-kv__row">
            <dt>Substitution</dt>
            <dd className="s3d-mono">{site.substitution ?? "Not reported"}</dd>
          </div>
          <div className="s3d-kv__row">
            <dt>In the structure</dt>
            <dd>
              {site.check.state === "match" ? "Matches" : site.check.state === "mismatch" ? "Different residue" : site.check.state === "absent" ? "Not modelled" : "Not checked"}
              <span className="s3d-kv__note">{site.check.text}</span>
            </dd>
          </div>
          <div className="s3d-kv__row">
            <dt>{site.confidence.kind === "b-factor" ? "Mobility" : "Confidence"}</dt>
            <dd>
              <span className="s3d-mono">{site.confidence.text}</span>
              <span className="s3d-kv__note">{site.confidence.note}</span>
            </dd>
          </div>
          {site.burial && (
            <div className="s3d-kv__row">
              <dt>Accessibility</dt>
              <dd>{site.burial}</dd>
            </div>
          )}
          {site.region && (
            <div className="s3d-kv__row">
              <dt>UniProt region</dt>
              <dd>{site.region}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* ── 5. Experimental structures (AlphaFold view) ── */}
      {family === "alphafold" && setCustomPdbUrl && (
        <section className="s3d-rsec" aria-labelledby="s3d-rail-entries">
          <h3 className="eyebrow" id="s3d-rail-entries">
            <span><Database className="w-3.5 h-3.5" aria-hidden="true" />Experimental structures</span>
            <span className="s3d-rsec__meta">
              {experimental.loading ? "Searching RCSB" : `${experimental.rows.length} listed`}
            </span>
          </h3>
          {experimental.rows.length === 0 ? (
            <p className="s3d-empty">
              {experimental.loading ? "Searching the PDB for entries of this protein and its homologs." : "RCSB's sequence search returned no experimental entry."}
            </p>
          ) : (
            <ul className="s3d-entries" data-testid="structure-entries">
              {experimental.rows.map(row => (
                <li key={row.pdbId} className="s3d-entry" data-loaded={row.loaded || undefined}>
                  <span className="s3d-entry__id">
                    {row.pdbId}
                    {experimental.best?.pdbId === row.pdbId && <span className="s3d-entry__tag">closest covering entry</span>}
                  </span>
                  <button
                    type="button"
                    className="s3d-entry__load"
                    aria-pressed={row.loaded}
                    onClick={() => setCustomPdbUrl(row.loaded ? null : row.url)}
                    aria-label={row.loaded ? `Return to the AlphaFold model from PDB ${row.pdbId}` : `Load PDB ${row.pdbId} on the canvas`}
                  >
                    {row.loaded ? "Shown" : "Show"}
                  </button>
                  <span className="s3d-entry__meta">
                    {[
                      row.identity === "Not reported" ? "identity not reported" : `identity ${row.identity}`,
                      row.range ? `aligned ${row.range}` : "range not reported",
                      row.coversSite === "yes" ? "covers the site" : row.coversSite === "no" ? "does not cover the site" : null,
                      row.method ? row.method.toLowerCase() : null,
                      row.resolution,
                      row.organism,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="s3d-empty s3d-dim">{experimental.note}</p>
        </section>
      )}

      {/* ── 6. Method ── */}
      <section className="s3d-rsec" aria-labelledby="s3d-rail-method">
        <h3 className="eyebrow" id="s3d-rail-method">
          <span><BookOpen className="w-3.5 h-3.5" aria-hidden="true" />Method and sources</span>
        </h3>
        <details className="s3d-notes">
          <summary>What the view can and cannot tell you</summary>
          <ul>
            {model.notes.map(note => <li key={note}>{note}</li>)}
            <li>{model.engineRecord}</li>
          </ul>
        </details>
        <ul className="s3d-refs" data-testid="structure-sources">
          {model.sources.map(src => (
            <li key={src.doi}>
              {src.citation}
              <br />
              <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noreferrer">doi:{src.doi}</a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default React.memo(StructureInspector);
