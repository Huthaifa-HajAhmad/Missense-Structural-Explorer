/**
 * A numeric colour as a CSS hex string. Mol* stores colours as 0xRRGGBB integers; five components had
 * their own copy of this one-liner, so a formatting change had five places to go wrong.
 */
export function hexColour(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}
