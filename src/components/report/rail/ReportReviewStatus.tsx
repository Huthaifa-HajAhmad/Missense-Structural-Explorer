import React from "react";
import { ClipboardCheck } from "lucide-react";
import { REPORT_REVIEW_LABEL, type BlockKey, type ReportBlock } from "../../../shared/reportDocument";
import type { RunStatus } from "../../../shared/insightsEvidence";

/**
 * Whether the report is ready to hand on. It says "still running" while an evidence area is running,
 * lists the gaps when the run finished without some areas, and lists only sections that need the
 * author's eyes, each with the builder's own reason (`ReportBlock.review`). An AI summary that is
 * current is not listed: its own block already says it is unverified. With nothing ticked there is
 * nothing to hand on, so it says that instead of "ready".
 */
export function ReportReviewStatus({ blocks, completeness, onJump }: {
  blocks: readonly ReportBlock[];
  completeness: RunStatus;
  onJump: (key: BlockKey) => void;
}) {
  const flagged = blocks.filter(b => b.included && b.review !== null);
  // The same rule `exportedBlocks` uses: ticked and not empty (an edited block is never empty).
  const nothingTicked = !blocks.some(b => b.included && !b.empty);
  const gapSuffix = completeness.state === "gaps" && completeness.gaps.length
    ? ` Evidence gaps: ${completeness.gaps.join(", ")}.`
    : "";
  const message = nothingTicked
    ? "Nothing is ticked, so an export would be empty."
    : completeness.state === "running"
      ? `Still running: ${completeness.running.join(", ") || "analysis in progress"}. The report may change, so export after the run finishes.`
      : flagged.length > 0
        ? `Read ${flagged.length === 1 ? "this section" : `these ${flagged.length} sections`} before you export.${gapSuffix}`
        : completeness.state === "gaps"
          ? `Ready to export — with gaps: ${completeness.gaps.join(", ")}.`
          : "Ready to export. Nothing needs review.";
  const needsAttention = nothingTicked || completeness.state !== "complete" || flagged.length > 0;
  return (
    <section className="rpt-rail-section" aria-labelledby="rpt-rail-status">
      <h3 className="rpt-rail-title" id="rpt-rail-status"><ClipboardCheck size={14} aria-hidden="true" />Review status</h3>
      <div className="rpt-status" data-state={needsAttention ? "review" : "ready"}>
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
