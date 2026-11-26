/**
 * Stored payloads: which ones are too old to render, and the per-residue native interface support
 * other views (residue focus, hot spots) read for residues other than the queried one.
 */
import type { MultimerData, PpiBindingData } from "../contracts.ts";
import { observedLabel } from "./format.ts";
import { entriesModelling, type ObservedRanges } from "../residueCoverage.ts";

/**
 * A stored assembly payload that predates per-residue support, the assembly record, the fibril split,
 * the crystal check or residue coverage (or the per-entry ranges other residues are counted with) is
 * not rendered: it may count fibril stacking as the native interface, or call a residue no structure
 * models "not at the interface".
 */
export function isStaleAssembly(d: MultimerData | null | undefined): boolean {
  if (!d) return false;
  if (!d.assembly) return true;
  const partners = d.experimental?.partners ?? [];
  const exp = d.experimental;
  return (
    partners.some(p => !Array.isArray((p as any).support) || !Array.isArray((p as any).variantEntries) || !("context" in p)) ||
    // A payload written before the crystal-packing split or the coverage read carries no verdict on
    // them: re-read once, then trust the recorded flag (including `false` when the provider did not
    // answer), so a failed lookup does not make the assembly re-read forever.
    (partners.length > 0 && (exp?.crystalChecked === undefined || exp?.coverageChecked === undefined)) ||
    (partners.length > 0 && exp?.coverageChecked === true && !exp.coverage)
  );
}

/** A stored PPI payload from before IntAct evidence and the STRING lists is re-read, not rendered. */
export function isStalePpi(d: PpiBindingData | null | undefined): boolean {
  return Boolean(d) && !(d!.lookups && "intact" in d!.lookups && d!.string);
}

/**
 * Native interface support at every residue, for views that read residues other than the queried one.
 *
 * The same partners the Interfaces tab counts as native (not a tool binder or construct tag, not an amyloid
 * fibril, not crystal packing outside the assembly), each with the number of solved structures that place a
 * residue at the interface and the number of the pair's structures that have coordinates for that residue,
 * so a residue reads "104 of 137" and never "at the interface". When PDBe's coverage was not read, the
 * denominator falls back to every structure that holds the pair.
 *   - `unavailable`: no assembly was read, or the stored one predates per-residue support. Not a negative.
 *   - `none`: the service answered and no native interface is observed for this protein.
 */
export interface NativeInterfaceSupport {
  status: "ok" | "none" | "unavailable";
  reason: string | null;
  /** Residues with support from at least one native partner, with that partner's label and counts, best first. */
  byResidue: ReadonlyMap<number, ReadonlyArray<{ label: string; k: number; n: number }>>;
  /**
   * How many native structures have coordinates for `residue`. Zero means no native structure models it,
   * so the absence of support there is "not modelled", not "no interface". Absent when coverage was not read.
   */
  modelledAt?: (residue: number) => number;
}

const nativeInterfaceMemo = new WeakMap<object, Map<string, NativeInterfaceSupport>>();

function remember(exp: object, gene: string, value: NativeInterfaceSupport): NativeInterfaceSupport {
  const map = nativeInterfaceMemo.get(exp) ?? new Map<string, NativeInterfaceSupport>();
  map.set(gene, value);
  nativeInterfaceMemo.set(exp, map);
  return value;
}

export function nativeInterfaceSupport(assembly: MultimerData | null | undefined, gene: string): NativeInterfaceSupport {
  const none = new Map<number, never[]>();
  if (!assembly) return { status: "unavailable", reason: "The assembly was not read.", byResidue: none };
  if (isStaleAssembly(assembly)) return { status: "unavailable", reason: "The stored assembly predates per-residue support and is being re-read.", byResidue: none };
  const exp = assembly.experimental;
  if (exp?.status !== "ok") return { status: "unavailable", reason: "PDBe-KB interfaces were not read for this protein.", byResidue: none };
  if (exp.entryKinds === "failed" || exp.crystalChecked === false) {
    return {
      status: "unavailable",
      reason: "RCSB did not answer, so fibril and monomer-assembly entries could not be told apart from native ones.",
      byResidue: none,
    };
  }
  const cached = nativeInterfaceMemo.get(exp)?.get(gene);
  if (cached) return cached;
  const native = exp.partners.filter(p => !p.artefact && p.context !== "fibril" && p.context !== "crystal");
  if (!native.length) return remember(exp, gene, { status: "none", reason: null, byResidue: none });
  const ranges: ReadonlyMap<string, ObservedRanges> | null = exp.coverageChecked && exp.coverage ? new Map(Object.entries(exp.coverage)) : null;
  // An entry with the residue at its interface models it, so `k` bounds the count from below.
  const modelling = (entries: readonly string[], residue: number, k: number) =>
    ranges ? Math.max(k, entriesModelling(ranges, entries, residue).length) : entries.length;
  const byResidue = new Map<number, Array<{ label: string; k: number; n: number }>>();
  for (const p of native) {
    p.residues.forEach((residue, i) => {
      const k = p.support[i] ?? 0;
      if (k <= 0) return;
      const list = byResidue.get(residue) ?? [];
      list.push({ label: observedLabel(p, gene), k, n: modelling(p.pdbEntries, residue, k) });
      byResidue.set(residue, list);
    });
  }
  for (const list of byResidue.values()) list.sort((a, b) => b.k / Math.max(1, b.n) - a.k / Math.max(1, a.n) || b.k - a.k);
  const nativeEntries = [...new Set(native.flatMap(p => p.pdbEntries))];
  const modelledAt = ranges ? (residue: number) => modelling(nativeEntries, residue, 0) : undefined;
  return remember(exp, gene, { status: "ok", reason: null, byResidue, ...(modelledAt ? { modelledAt } : {}) });
}
