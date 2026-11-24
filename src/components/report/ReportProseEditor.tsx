/**
 * ReportProseEditor.tsx — the one editor in the Report: a textarea for a block's prose, with bold and
 * bullet helpers for the small markup `parseProse` reads. Nothing is saved until "Save text".
 */
import React, { useEffect, useRef, useState } from "react";
import { Bold, List } from "lucide-react";
import type { ReportBlock } from "../../shared/reportDocument";

// ── Editor ───────────────────────────────────────────────────────────────────────────────────────

export function ProseEditor({ block, onChange, onDone, onCancel }: { block: ReportBlock; onChange: (text: string, base?: string, evidenceId?: string) => void; onDone: () => void; onCancel: () => void }) {
  const [value, setValue] = useState(block.text);
  const editBase = useRef({ drafted: block.drafted, evidenceId: block.evidenceId });
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);

  const commit = (next: string, selStart?: number, selEnd?: number) => {
    setValue(next);

    if (selStart !== undefined) {
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(selStart, selEnd ?? selStart);
      });
    }
  };

  const wrapBold = () => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const chosen = value.slice(a, b) || "text";
    commit(`${value.slice(0, a)}**${chosen}**${value.slice(b)}`, a + 2, a + 2 + chosen.length);
  };

  const bullet = () => {
    const el = area.current;
    if (!el) return;
    const a = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const nl = value.indexOf("\n", el.selectionEnd);
    const b = nl === -1 ? value.length : nl;
    const lines = value.slice(a, b).split("\n").map(l => (/^\s*[-*•]\s/.test(l) ? l : `- ${l}`));
    const joined = lines.join("\n");
    commit(value.slice(0, a) + joined + value.slice(b), a, a + joined.length);
  };

  return (
    <div className="rpt-edit">
      <div className="rpt-edit__tools">
        <button type="button" className="rpt-btn" onClick={wrapBold} aria-label="Bold"><Bold className="w-3.5 h-3.5" aria-hidden="true" /></button>
        <button type="button" className="rpt-btn" onClick={bullet} aria-label="Bulleted list"><List className="w-3.5 h-3.5" aria-hidden="true" /> List</button>
        <span className="rpt-dim">Only this text is editable. Tables, figures and the classification are not.</span>
      </div>
      <textarea
        ref={area}
        className="rpt-edit__area"
        aria-label={`Edit ${block.title}`}
        value={value}
        rows={Math.min(14, Math.max(4, value.split("\n").length + 1))}
        onChange={e => commit(e.target.value)}
      />
      <div className="rpt-edit__tools" style={{ borderTop: "1px solid var(--cs-border-subtle)", borderBottom: 0 }}>
        <button type="button" className="rpt-btn" data-variant="primary" onClick={() => { onChange(value, editBase.current.drafted, editBase.current.evidenceId); onDone(); }}>Save text</button>
        <button type="button" className="rpt-btn" onClick={onCancel}>Cancel</button>
        <span className="rpt-dim">Changes apply when you save.</span>
      </div>
    </div>
  );
}
