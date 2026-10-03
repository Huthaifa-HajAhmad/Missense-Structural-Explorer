import React from "react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import type { DirectionRow, DirectionSide, LadderColumn, LadderEvidence, LadderRow } from "../../../shared/ladderEvidence";

/**
 * StrengthLadder — every tool on one shared axis of evidence strength.
 *
 * Columns run BP4 strongest … neither … PP3 strongest, each headed by its Tavtigian points, so tools
 * on different raw scales (REVEL 0–1, CADD 0–50, phyloP −20…10) become comparable and a disagreement
 * between them shows without a sentence.
 *
 *   STRENGTH rows   the tools ClinGen has calibrated. The dot sits in the band the variant reached;
 *                   a band the tool's calibration cannot reach is hatched, never tinted.
 *   DIRECTION rows  the tools that publish only the authors' cut-point. The dot sits on a SIDE —
 *                   benign, between, pathogenic — in one flat tint, because a cut-point is not a
 *                   strength and a deeper shade would say otherwise. The tint is red or green only
 *                   for a tool the engine counts (its call is PP3 or BP4); any other stays grey.
 *
 * Every placement is read from `buildLadder`; this file tests no score.
 */

const SIDE_WORD: Record<DirectionSide, string> = { benign: "benign side", between: "between", pathogenic: "pathogenic side" };

function absentText(a: LadderRow["availability"]) {
  return a.state === "pending" ? ENGINE_STATE_LABELS.running : a.reason ?? `${ENGINE_STATE_LABELS["no-result"]} for this variant`;
}

function points(c: LadderColumn) {
  return c.points > 0 ? `+${c.points}` : c.points === 0 ? "0" : `−${Math.abs(c.points)}`;
}

export function StrengthLadder({ evidence, referenceKey }: { evidence: LadderEvidence; referenceKey: string | null }) {
  const { columns, ladder, directional } = evidence;
  const nBenign = columns.filter(c => c.direction === "BP4").length;
  const nPath = columns.filter(c => c.direction === "PP3").length;
  const mid = nBenign + 2; // 1-based grid line of the "Neither" column, after the name track
  const template = { gridTemplateColumns: `var(--prd-ladder-name) repeat(${columns.length}, minmax(0, 1fr))` } as React.CSSProperties;

  const describe = [
    ...ladder.map(l => {
      const col = columns.find(c => c.id === l.at);
      return `${l.name}: ${l.at === null ? "no result" : col?.direction ? `${col.direction} ${col.label}` : "neither"}`;
    }),
    ...directional.map(d => `${d.name}: ${d.side === null ? "no result" : `${SIDE_WORD[d.side]} of the authors' cut-point`}`),
  ].join("; ");
  const directionNote = directional.length
    ? " Tools listed as direction only have just their authors' cut-point, so they show a side of it, not a strength."
    : "";

  const side = (d: DirectionRow, s: DirectionSide) => (
    <span
      key={s}
      className="prd-ladder__side"
      data-side={s}
      data-here={d.side === s || undefined}
      data-votes={d.votes || undefined}
      style={{
        gridColumn: s === "benign" ? `2 / span ${nBenign}` : s === "between" ? `${mid} / span 1` : `${mid + 1} / span ${nPath}`,
      }}
    >
      {d.side === s && <i className="prd-ladder__dot" />}
    </span>
  );

  return (
    <div className="prd-ladder" role="img" aria-label={`Strength ladder. ${describe}.${directionNote}`} data-testid="strength-ladder">
      <div className="prd-ladder__row prd-ladder__head" style={template} aria-hidden="true">
        <span />
        {columns.map(c => (
          <span key={c.id} className="prd-ladder__col" data-dir={c.direction ?? "none"}>
            {c.label}
            <b>{points(c)}</b>
          </span>
        ))}
      </div>

      {ladder.map(l => (
        <div key={l.key} className="prd-ladder__row" style={template} aria-hidden="true" data-testid={`ladder-${l.key}`} data-at={l.at ?? "none-scored"}>
          <span className="prd-ladder__name" title={l.cutLines.join("  ·  ")}>
            {l.name}
            <small>
              {l.source}
              {l.key === referenceKey ? " · reference" : !l.votes ? " · not counted" : ""}
            </small>
          </span>
          {l.at === null ? (
            <span className="prd-ladder__absent">{absentText(l.availability)}</span>
          ) : (
            columns.map((c, i) => {
              const rank = c.direction === "BP4" ? nBenign - i : c.direction === "PP3" ? i - nBenign : 0;
              return (
                <span
                  key={c.id}
                  className="prd-ladder__cell"
                  data-dir={c.direction ?? "none"}
                  data-rank={rank}
                  data-unreachable={!l.reachable.includes(c.id) || undefined}
                  data-here={l.at === c.id || undefined}
                >
                  {l.at === c.id && <i className="prd-ladder__dot" />}
                </span>
              );
            })
          )}
        </div>
      ))}

      {directional.length > 0 && (
        <>
          <div className="prd-ladder__divider" aria-hidden="true">
            Direction only
            <span>The authors&apos; cut-point has no strength levels, so these show a side, not a strength.</span>
          </div>
          {directional.map(d => (
            <div
              key={d.key}
              className="prd-ladder__row"
              style={template}
              aria-hidden="true"
              data-testid={`ladder-${d.key}`}
              data-side={d.side ?? "none-scored"}
            >
              <span className="prd-ladder__name" title={`${d.source} · ${d.cutText}`}>
                {d.name}
                <small>
                  {d.source}
                  {!d.votes ? " · not counted" : ""}
                </small>
              </span>
              {d.side === null ? (
                <span className="prd-ladder__absent">{absentText(d.availability)}</span>
              ) : (
                (["benign", "between", "pathogenic"] as const).map(s => side(d, s))
              )}
            </div>
          ))}
        </>
      )}

      <div className="prd-ladder__sides" style={{ gridTemplateColumns: `var(--prd-ladder-name) ${nBenign}fr 1fr ${nPath}fr` }} aria-hidden="true">
        <span />
        <span>← BP4 benign</span>
        <span>indeterminate</span>
        <span>PP3 pathogenic →</span>
      </div>
    </div>
  );
}
