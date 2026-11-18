function pct(value: number, min: number, max: number) {
  const span = max - min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - min) / span) * 100));
}

/**
 * One value on its own axis, with app-defined reading marks drawn dashed. None of these marks is a
 * published cut-point, so the axis is never red or green.
 */
export function MarkRuler({
  value,
  min,
  max,
  marks,
  label,
  format = (n: number) => n.toString()
}: {
  value: number;
  min: number;
  max: number;
  marks: { value: number; label: string }[];
  label: string;
  format?: (n: number) => string;
}) {
  const off = value < min || value > max;
  return (
    <div
      className="pkg-ruler"
      role="img"
      aria-label={`${label} ${format(value)} on a ${format(min)} to ${format(max)} axis${marks.length ? `; marked: ${marks.map(m => `${m.label} (${format(m.value)})`).join(", ")}` : ""}`}
    >
      <div className="pkg-ruler__track">
        {marks.map(m => (
          <span key={m.value} className="pkg-ruler__tick" style={{ left: `${pct(m.value, min, max)}%` }} title={m.label} />
        ))}
        <span className="pkg-ruler__marker" data-role="variant" data-off-scale={off || undefined} style={{ left: `${pct(value, min, max)}%` }} />
      </div>
      <div className="pkg-ruler__axis" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
