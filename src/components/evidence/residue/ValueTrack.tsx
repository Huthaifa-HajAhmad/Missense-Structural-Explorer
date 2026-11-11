import React from "react";

const pct = (value: number, max: number) => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;

/** One value on its own 0 to max axis, with dashed marks at the cut-points that apply to it. */
export function ValueTrack({
  value,
  max,
  marks,
  label,
  unit = ""
}: {
  value: number;
  max: number;
  marks: readonly number[];
  label: string;
  unit?: string;
}) {
  return (
    <div className="rsx-track" role="img" aria-label={label}>
      <div className="rsx-track__bar">
        {marks.map(m => (
          <span key={m} className="rsx-track__cut" style={{ left: pct(m, max) }} />
        ))}
        <span className="rsx-track__mut" style={{ left: pct(value, max) }} />
      </div>
      <div className="rsx-track__axis" aria-hidden="true">
        <span className="rsx-track__tick" data-edge="start" style={{ left: 0 }}>0</span>
        {marks.map(m => (
          <span key={m} className="rsx-track__tick" style={{ left: pct(m, max) }}>{m}</span>
        ))}
        <span className="rsx-track__tick" data-edge="end" style={{ left: "100%" }}>{max}{unit}</span>
      </div>
    </div>
  );
}
