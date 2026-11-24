import React from "react";
import { ChevronRight, FileText } from "lucide-react";
import { BLOCK_ORDER, REPORT_GROUPS, REPORT_PRESETS, type BlockKey, type ReportBlock, type ReportDocument, type ReportPresetId } from "../../../shared/reportDocument";
import { formatEvidenceCode } from "../../../shared/thresholds";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";

/** A short note after a section's name. `code` notes are criterion codes and set in the mono face. */
function noteFor(b: ReportBlock, pinned: number): { text: string; code?: boolean } {
  if (b.stillCounted.length) return { text: `${b.stillCounted.join(", ")} still counted`, code: true };
  if (b.review) return { text: "needs review" };
  if (b.edited) return { text: "edited" };
  if (b.key === "literature") return { text: pinned ? `${pinned} pinned` : "none pinned" };
  if (b.counted.length) return { text: b.counted.map(formatEvidenceCode).join(", "), code: true };
  if (b.empty) return { text: "nothing yet" };
  if (b.status === "pending") return { text: "running" };
  if (b.status === "absent") return { text: "no reading" };
  return { text: "" };
}

function ContentsRow({ block: b, active, pinned, onJump }: { block: ReportBlock; active: boolean; pinned: number; onJump: (key: BlockKey) => void }) {
  const toggle = useVariantAnalysisStore(s => s.toggleReportSection);
  const note = noteFor(b, pinned);
  // A section with nothing in it is skipped by every export, so a tick would promise nothing.
  const exportable = !b.empty || b.edited;
  return (
    <li className="rpt-list__row" data-off={b.included && exportable ? undefined : ""} data-active={active ? "" : undefined}>
      {exportable ? (
        <label className="rpt-contents-label">
          <input type="checkbox" checked={b.included} aria-label={`${b.title} in export`} onChange={() => toggle(b.key)} />
          <span>{b.title}</span>
        </label>
      ) : (
        <span className="rpt-contents-label"><span className="rpt-contents-none" aria-hidden="true" /><span>{b.title}</span></span>
      )}
      <span className="rpt-list__meta" data-code={note.code ? "" : undefined}>{note.text}</span>
      <button type="button" className="rpt-jump" aria-label={`Go to ${b.title}`} onClick={() => onJump(b.key)} disabled={!b.included && b.empty}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Which sections the exports carry: two presets, then every section by part, each with a way to it. */
export function ReportContents({ doc, activeSection, onJump }: { doc: ReportDocument; activeSection: string; onJump: (key: BlockKey) => void }) {
  const applyPreset = useVariantAnalysisStore(s => s.applyReportPreset);
  const pinned = useVariantAnalysisStore(s => s.reportCitations.length);
  const presets = Object.keys(REPORT_PRESETS) as ReportPresetId[];
  const activePreset = presets.find(id =>
    BLOCK_ORDER.every(k => doc.blocks.find(b => b.key === k)?.included === REPORT_PRESETS[id].blocks.includes(k))
  );
  return (
    <section className="rpt-rail-section" aria-labelledby="rpt-rail-sections">
      <h3 className="rpt-rail-title" id="rpt-rail-sections">
        <FileText size={14} aria-hidden="true" />Contents{activePreset ? null : <span className="rpt-custom">Custom</span>}
      </h3>
      <p className="rpt-rail-help">Ticked sections go into every export. Sections with nothing in them are skipped.</p>
      <div className="rpt-seg" role="group" aria-label="Preset">
        {presets.map(id => (
          <button key={id} type="button" aria-pressed={activePreset === id} title={REPORT_PRESETS[id].hint} onClick={() => applyPreset(id)}>
            {REPORT_PRESETS[id].label}
          </button>
        ))}
      </div>
      {REPORT_GROUPS.map(group => (
        <details key={group.id} className="rpt-contents-group" open>
          <summary>{group.label}</summary>
          <ul className="rpt-list">
            {doc.blocks.filter(b => group.keys.includes(b.key)).map(b => (
              <ContentsRow key={b.key} block={b} active={activeSection === b.key} pinned={pinned} onJump={onJump} />
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
