import React, { useState } from "react";
import { Download } from "lucide-react";
import { EXPORT_FORMATS, type ExportFormat } from "./useReportExports";

/** The rail's sticky export control: one menu of formats, one button, one outcome line. */
export function ReportExportBar({ sections, busy, status, onExport }: {
  sections: number;
  busy: boolean;
  status: string | null;
  onExport: (format: ExportFormat) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("html");
  const button = EXPORT_FORMATS.find(f => f.id === format)!.button;
  return (
    <div className="rpt-export-primary">
      <label htmlFor="rpt-format" className="rpt-rail-title">
        Export report <span>{sections} {sections === 1 ? "section" : "sections"}</span>
      </label>
      <div>
        <select id="rpt-format" value={format} onChange={e => setFormat(e.target.value as ExportFormat)}>
          {EXPORT_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <button type="button" className="rpt-btn" data-variant="primary" disabled={busy} onClick={() => onExport(format)}>
          <Download size={14} aria-hidden="true" />{busy ? "Building" : button}
        </button>
      </div>
      <p role="status" className="rpt-dim">{status ?? ""}</p>
    </div>
  );
}
