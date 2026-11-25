import React from "react";
import { ClipboardCheck } from "lucide-react";
import { REPORT_REVIEW_LABEL, type BlockKey, type ReportBlock } from "../../../shared/reportDocument";

/**
 * Whether the report is ready to hand on. It lists only sections that need the author's eyes, each with
 * the builder's own reason (`ReportBlock.review`), so it can reach "ready". An AI summary that is
 * current is not listed: its own block already says it is unverified. With nothing ticked there is
 * nothing to hand on, so it says that instead of "ready".
 */
export function ReportReviewStatus({ blocks, onJump }: { blocks: readonly ReportBlock[]; onJump: (key: BlockKey) => void }) {
  const flagged = blocks.filter(b => b.included && b.review !== null);
  // The same rule `exportedBlocks` uses: ticked and not empty (an edited block is never empty).
  const nothingTicked = !blocks.some(b => b.included && !b.empty);
  const message = nothingTicked
    ? "Nothing is ticked, so an export would be empty."
    : flagged.length === 0
      ? "Ready to export. Nothing needs review."
      : `Read ${flagged.length === 1 ? "this section" : `these ${flagged.length} sections`} before you export.`;
  return (
    <section className="rpt-rail-section" aria-labelledby="rpt-rail-status">
      <h3 className="rpt-rail-title" id="rpt-rail-status"><ClipboardCheck size={14} aria-hidden="true" />Review status</h3>
      <div className="rpt-status" data-state={nothingTicked || flagged.length ? "review" : "ready"}>
        <p role="status">{message}</p>
        {flagged.map(b => (
          <button key={b.key} type="button" className="rpt-review-link" onClick={() => onJump(b.key)}>
            {b.title}<span>{REPORT_REVIEW_LABEL[b.review!]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
