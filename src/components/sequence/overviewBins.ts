/** Spatial bins preserve counts; predictor scores are never averaged into these bins. */
export function overviewBins<T extends { pos: number }>(
  items: readonly T[],
  length: number,
  width: number,
) {
  const size = Math.max(
    1,
    Math.ceil(length / Math.max(1, Math.floor(width / 24))),
  );
  const bins = new Map<number, { start: number; end: number; items: T[] }>();
  for (const item of items) {
    if (item.pos < 1 || item.pos > length) continue;
    const start = Math.floor((item.pos - 1) / size) * size + 1;
    const bin = bins.get(start) ?? {
      start,
      end: Math.min(length, start + size - 1),
      items: [],
    };
    bin.items.push(item);
    bins.set(start, bin);
  }
  return { size, bins: [...bins.values()].sort((a, b) => a.start - b.start) };
}

export function proteinTicks(length: number): number[] {
  const raw = Math.max(1, length / 5);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw)!;
  const ticks = [1];
  for (let pos = step; pos < length; pos += step)
    if (pos > 1 && length - pos > step / 3) ticks.push(pos);
  if (length > 1) ticks.push(length);
  return ticks;
}
