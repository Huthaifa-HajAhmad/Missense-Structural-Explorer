import type { StructureSelection } from "../../shared/structureSelection";
import type { Structure3dEvidence } from "../../shared/structure3dEvidence";
import { SECONDARY_COLOURS, SECONDARY_MEANING, formatSecondaryAt } from "../../shared/structureSecondary";
import { REGION_KIND_LABEL } from "../../shared/residueRegions";
import { hexColour } from "../../shared/colorHex";



interface Props {
  selection: StructureSelection;
  site: Structure3dEvidence["site"];
  onReturn: () => void;
}

/**
 * The residue the reader is looking at, read in a fixed order: what it is, where it sits in the fold,
 * how confident the model is there, how far it is from the variant, and what UniProt annotates over
 * it. Every value names its source in the note under it. The residue code is the heading; the state
 * is a chip beside it, not a word the eye must skip to reach the identity.
 */
export function StructureSelectionCard({ selection, site, onReturn }: Props) {
  const isAtVariantPosition = Boolean(selection.position && site.position && selection.position === site.position);
  const isAtVariantSite = Boolean(site.canAddressVariantSite && selection.state === "available" && isAtVariantPosition && selection.isQueriedSite !== false);
  const returnText = site.canAddressVariantSite && selection.state === "available" && site.substitution
    ? `Return to ${site.substitution}`
    : `Return to position ${site.position}`;
  const r = selection.residue;
  const code = r ? `${r.resName.charAt(0)}${r.resName.slice(1).toLowerCase()}${selection.position}` : null;

  return (
    <section className="s3d-selection" aria-label={selection.preview ? "Residue preview" : "Selected residue"} data-state={selection.state} data-is-site={isAtVariantSite ? "true" : undefined}>
      <div className="s3d-selection__head">
        <h3>
          {code
            ? <span className="s3d-selection__id s3d-mono">{code}</span>
            : selection.position ? <span className="s3d-selection__id s3d-mono">Position {selection.position}</span> : "No residue selected"}
          {selection.position && <span className="s3d-selection__state" data-state={selection.preview ? "preview" : "selected"}>{selection.preview ? "Preview" : "Selected"}</span>}
          {isAtVariantSite && <span className="s3d-selection__badge">Queried site</span>}
        </h3>
        {selection.position && site.position && !isAtVariantPosition && (
          <button type="button" className="s3d-selection__return" onClick={onReturn} title="Select the queried site">{returnText}</button>
        )}
      </div>
      <p className="s3d-selection__summary">
        {r ? `Chain ${r.chain || "(unnamed)"}${selection.residueName ? ` · ${selection.residueName}` : ""}` : selection.summary}
      </p>

      {(selection.state === "available" || (selection.regions?.length ?? 0) > 0) && (
        <dl className="s3d-facts" data-testid="structure-selection-facts">
          {selection.secondary && (
            <div className="s3d-facts__row">
              <dt>Secondary structure</dt>
              <dd>
                <span className="s3d-facts__value">
                  <span className="s3d-facts__swatch" style={{ background: hexColour(SECONDARY_COLOURS[selection.secondary.segment.cls]) }} aria-hidden="true" />
                  <span className="s3d-facts__num s3d-mono">{formatSecondaryAt(selection.secondary)}</span>
                </span>
                <span className="s3d-kv__note">
                  {SECONDARY_MEANING[selection.secondary.segment.cls]}. {selection.secondarySource === "file" ? "Entry HELIX/SHEET records." : "DSSP on these coordinates."}
                </span>
              </dd>
            </div>
          )}
          {selection.state === "available" && !selection.secondary && (
            <div className="s3d-facts__row">
              <dt>Secondary structure</dt>
              <dd><span className="s3d-kv__note">No assignment has been read for this model.</span></dd>
            </div>
          )}
          {selection.measurement && (
            <div className="s3d-facts__row">
              <dt>{selection.measurement.label}</dt>
              <dd>
                <span className="s3d-facts__value">
                  {selection.band && <span className="s3d-facts__swatch" style={{ background: hexColour(selection.band.color) }} aria-hidden="true" />}
                  <span className="s3d-facts__num s3d-mono">{selection.measurement.value}</span>
                  {selection.band && <span className="s3d-facts__qual">{selection.band.label.toLowerCase()}</span>}
                </span>
                <span className="s3d-kv__note">{selection.measurement.note}</span>
              </dd>
            </div>
          )}
          {isAtVariantSite && site.burial && (
            <div className="s3d-facts__row">
              <dt>Accessibility</dt>
              <dd>
                <span className="s3d-facts__value">{site.burial}</span>
                <span className="s3d-kv__note">From the analysis structure, not the canvas.</span>
              </dd>
            </div>
          )}
          {selection.siteDistance && (
            <div className="s3d-facts__row">
              <dt>To the variant site</dt>
              <dd>
                <span className="s3d-facts__value"><span className="s3d-facts__num s3d-mono">{selection.siteDistance.angstrom.toFixed(1)} Å</span></span>
                <span className="s3d-kv__note">Cα to Cα on this model · {selection.siteDistance.separation} apart in sequence.</span>
              </dd>
            </div>
          )}
          {(selection.regions?.length ?? 0) > 0 && (
            <div className="s3d-facts__row">
              <dt>UniProt annotation</dt>
              <dd>
                <ul className="s3d-regions">
                  {selection.regions!.map(h => (
                    <li key={`${h.kind}-${h.start}-${h.end}-${h.label}`} className="s3d-region" data-kind={h.kind}>
                      <span className="s3d-region__kind">{REGION_KIND_LABEL[h.kind]}</span>
                      <span className="s3d-region__label">{h.label}</span>
                      <span className="s3d-region__range s3d-mono">{h.start}–{h.end}</span>
                      <span className="s3d-region__evidence">{h.evidence}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {selection.betweenDomains && (
            <div className="s3d-facts__row">
              <dt>Between domains</dt>
              <dd>
                <span className="s3d-facts__value">{selection.betweenDomains.before.label} → {selection.betweenDomains.after.label}</span>
                <span className="s3d-kv__note">
                  Residues {selection.betweenDomains.start}–{selection.betweenDomains.end} lie in no UniProt domain. UniProt does not call this stretch a linker unless a Linker region is listed above.
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
