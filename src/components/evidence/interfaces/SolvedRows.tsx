import React, { useState } from "react";
import { Box } from "lucide-react";
import { rcsbUrl, type InterfacesEvidence, type ObservedView } from "../../../shared/interfacesEvidence";
import { InspectReadingButton } from "../EvidenceWorkspace";
import { StateCells } from "./ui";

/**
 * The solved-structures group of the assembly table: one row per partner pair and context, then the
 * chains set aside. The count column is the structures that MODEL the residue; a pair whose structures
 * never model it says so instead of "0 of 5" (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, C1).
 */
interface SolvedProps {
  ev: InterfacesEvidence;
  lit: string | null;
  onLit: (key: string | null) => void;
  show3d: ((p: ObservedView) => void) | null;
}

const gapAt = (p: ObservedView, position: number | null) => (position === null ? null : p.unmodelled?.find(g => g.start <= position && position <= g.end) ?? null);

function contextWords(p: ObservedView): { at: string; unit: string; chip: string | null } {
  if (p.context === "fibril") return { at: "touches a neighbouring fibril chain", unit: "fibril structures", chip: "Fibril" };
  if (p.context === "crystal") return { at: "touches another chain outside the deposited assembly", unit: "monomer-assembly entries", chip: "Outside assembly" };
  return { at: "at the interface", unit: "structures", chip: null };
}

function Reason({ p, ev }: { p: ObservedView; ev: InterfacesEvidence }) {
  const words = contextWords(p);
  const res = ev.residueLabel;
  if (p.n === 0 && p.total > 0) {
    const gap = gapAt(p, ev.position);
    return <>{res} has no coordinates in any of these {p.total} structures{gap ? ` (residues ${gap.start}–${gap.end} are unmodelled in all of them)` : ""}, so they cannot show whether it is at this interface.</>;
  }
  if (!p.variantAtInterface) {
    const skipped = p.total - p.n;
    return <>{res} is not among its {p.residues.length} interface residues{skipped > 0 ? ` in the ${p.n} structures that model it; ${skipped} more have no coordinates for it` : ""}.</>;
  }
  const tail = p.context === "fibril"
    ? " Stacking along a fibril, not a native interface."
    : p.context === "crystal"
      ? " The entry's deposited biological assembly is a monomer, so this contact is outside it and is not counted as a native interface."
      : ` The best-attested residues of this interface are seen in ${p.maxSupport} of ${p.total}.`;
  return (
    <>
      {res} {words.at} in{" "}
      {p.variantEntries.map((e, i) => (
        <React.Fragment key={e}>
          {i ? ", " : ""}
          <a className="ifc-pdb" href={rcsbUrl(e)} target="_blank" rel="noopener noreferrer">{e.toUpperCase()}</a>
        </React.Fragment>
      ))}
      .{tail}
    </>
  );
}

function SolvedRow({ p, ev, lit, onLit, show3d }: SolvedProps & { p: ObservedView }) {
  const native = p.context !== "fibril" && p.context !== "crystal";
  const words = contextWords(p);
  const unmodelled = p.n === 0 && p.total > 0;
  return (
    <tr id={`ifc-row-${p.key}`} data-reading-key={p.key} data-rule-input={(native && p.variantAtInterface) || undefined} data-lit={lit === p.key || undefined} onMouseEnter={() => onLit(p.key)} onMouseLeave={() => onLit(null)}>
      <th scope="row" className="ifc-subject">
        <span className="ifc-subject__name"><InspectReadingButton tab="interfaces" readingKey={p.key}>{p.label}</InspectReadingButton></span>
        <span className="ifc-subject__note ifc-mono">{p.accession}{p.homomeric ? " · same protein" : ""}{p.organism ? ` · ${p.organism}` : ""}</span>
        {show3d && native && p.residues.length > 0 && (
          <button type="button" className="ifc-link ifc-3d" onClick={() => show3d(p)}>
            <Box className="w-3 h-3" aria-hidden="true" />
            Show interface in 3D
          </button>
        )}
      </th>
      <td className="ifc-reason"><Reason p={p} ev={ev} /></td>
      <td className="ifc-num">
        {unmodelled ? `– of ${p.total}` : `${p.k} of ${p.n}`}
        <span className="ifc-unit">{unmodelled ? "none model it" : p.n < p.total ? `${words.unit} that model it` : words.unit}</span>
      </td>
      <td className="ifc-status">
        <span className="ev-tier" data-tone={native && p.variantAtInterface ? "neutral" : "muted"}>
          {words.chip ?? (unmodelled ? "Not modelled" : p.variantAtInterface ? "At interface" : "Not at it")}
        </span>
      </td>
    </tr>
  );
}

function setAsideChip(o: ObservedView): string {
  if (/antibody|nanobody/i.test(o.artefact ?? "")) return "Tool binder";
  if (/no UniProt/i.test(o.artefact ?? "")) return "Unmapped";
  return "Construct";
}

function ArtefactRow({ p }: { p: ObservedView }) {
  const what = p.artefact ? p.artefact.charAt(0).toUpperCase() + p.artefact.slice(1) : "Not biological";
  return (
    <tr>
      <th scope="row" className="ifc-subject">
        <span className="ifc-subject__name">{p.name}</span>
        <span className="ifc-subject__note ifc-mono">{p.accession}</span>
      </th>
      <td className="ifc-reason" colSpan={2}>{what}, in {p.total === 1 ? "1 structure" : `${p.total} structures`}: not a biological partner, not counted.</td>
      <td className="ifc-status"><span className="ev-tier" data-tone="muted">{setAsideChip(p)}</span></td>
    </tr>
  );
}

export function SolvedRows(props: SolvedProps) {
  const { ev } = props;
  const [open, setOpen] = useState(false);
  const rows = [...ev.observed.partners, ...ev.observed.fibrils, ...ev.observed.crystals];
  const fold = ev.observed.artefactsFold;
  return (
    <tbody data-group="solved">
      <tr className="ifc-group">
        <th colSpan={4} scope="rowgroup">
          <span className="ifc-group__inner">
            <span className="ifc-group__title">Solved structures</span>
            <span className="ifc-group__meta">PDBe-KB interface residues and residue coverage, UniProt numbering</span>
          </span>
        </th>
      </tr>
      {rows.length ? rows.map(p => <SolvedRow key={p.key} {...props} p={p} />) : (
        <tr>
          <th scope="row" className="ifc-subject">
            <span className="ifc-subject__name">Interfaces in the PDB</span>
            <span className="ifc-subject__note">observed, not predicted</span>
          </th>
          <StateCells label={ev.observed.availability.label} reason={ev.observed.availability.reason} />
        </tr>
      )}
      {ev.observed.artefactsShown.map(p => <ArtefactRow key={p.key} p={p} />)}
      {fold && (
        <tr className="ifc-fold">
          <td colSpan={4}>
            <span className="ifc-fold__summary">{fold.summary}</span>
            <button type="button" className="ifc-link ifc-fold__toggle" aria-expanded={open} aria-controls="ifc-set-aside-list" onClick={() => setOpen(o => !o)}>
              {open ? "Hide names" : `Show ${fold.rows.length} names`}
            </button>
            {open && (
              <ul className="ifc-chips" id="ifc-set-aside-list" aria-label={`${fold.rows.length} more set-aside chains`}>
                {fold.rows.map(p => (
                  <li key={p.key} className="ifc-chip"><span className="ifc-chip__name">{p.name}</span><span className="ifc-chip__meta ifc-mono">{p.accession}</span></li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}
