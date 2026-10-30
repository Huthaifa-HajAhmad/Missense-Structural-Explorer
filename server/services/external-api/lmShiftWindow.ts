import type { EsmcLocalShift } from "./esm2.ts";

/**
 * The ±10-residue embedding-shift window a language-model engine returns, validated once here.
 *
 * Entries without a finite position and shift are dropped rather than counted as 0, and the mean is
 * absent when nothing was measured: `0.000` on a card cannot be told apart from a measured zero.
 */
export function parseShiftWindow(raw: unknown): { localShiftMap: EsmcLocalShift[]; localEmbeddingShift?: number } {
  const localShiftMap = (Array.isArray(raw) ? raw : []).filter(
    (d): d is EsmcLocalShift =>
      Number.isFinite(d?.position) && Number.isFinite(d?.shift) && typeof d?.residue === "string"
  );
  return {
    localShiftMap,
    localEmbeddingShift: localShiftMap.length
      ? localShiftMap.reduce((sum, d) => sum + d.shift, 0) / localShiftMap.length
      : undefined
  };
}
