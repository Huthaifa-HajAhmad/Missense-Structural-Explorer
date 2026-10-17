/**
 * shadow-tiers.ts — Candidate ladder rungs (local dbNSFP, ProtVar) evaluated beside the live ladder.
 *
 * WHY SHADOW
 * ----------
 * The concordance study (doc/RESOLVER_CONCORDANCE.md) supports the order cache -> local -> ProtVar ->
 * VEP -> VariantValidator, but on 248 variants. Before either rung may answer a clinician, it is run
 * against real traffic WITHOUT serving: after the live ladder has answered, each candidate rung reads the
 * same coordinate, and the two answers are compared on the same numbering basis.
 *
 *   local   vs the served MANE consequence (both MANE-numbered); only MANE-basis local rows count
 *   ProtVar vs the served canonical numbering (both UniProt canonical); only `canonical`/`remapped`
 *
 * Nothing here can change a response: it runs after the outcome is built, fire-and-forget, bounded
 * in flight, and every error is swallowed into a counter. Only fresh resolutions are shadowed (a cache
 * hit has no new evidence and would spend egress), and only GRCh38 SNVs, the rungs' whole scope.
 *
 * `RESOLVER_SHADOW_TIERS=off` disables it; unset means on, except under tests. Coordinates appear in the
 * disagreement log only outside production or with `RESOLVER_SHADOW_LOG_VARIANTS=true`, matching the
 * route's rule of not logging notations in production.
 */
import type { ResolutionOutcome, ResolvedTranscriptConsequence } from "./types.ts";
import { queryLocalDbnsfpCoordinateReading } from "../prediction/dbnsfp_local.ts";
import { fetchProtVarCoordinateMapping, type ProtVarCoordinateMapping } from "../external-api/protvar.ts";

export type ShadowRung = "local" | "protvar";
/** `no-reference`: the live ladder served nothing on this rung's numbering basis to compare with. */
export type ShadowVerdict = "agree" | "disagree" | "miss" | "no-reference" | "error";

interface Reading {
  gene: string;
  pos: number;
  wt: string;
  mut: string;
}

export interface ShadowReport {
  coordinate: string;
  served: { provider: string; mane: Reading | null; canonical: Reading | null };
  local: { verdict: ShadowVerdict; reading?: Reading | null; detail?: string };
  protvar: { verdict: ShadowVerdict; reading?: Reading | null; detail?: string };
}

export interface ShadowDeps {
  local: typeof queryLocalDbnsfpCoordinateReading;
  protvar: (chrom: string, pos: number, ref: string, alt: string, signal?: AbortSignal) => Promise<ProtVarCoordinateMapping>;
}

const DEFAULT_DEPS: ShadowDeps = { local: queryLocalDbnsfpCoordinateReading, protvar: fetchProtVarCoordinateMapping };

const MAX_IN_FLIGHT = 4;
const PROTVAR_TIMEOUT_MS = 12_000;

const THREE_TO_ONE: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
};

const emptyRung = (): Record<ShadowVerdict, number> => ({ agree: 0, disagree: 0, miss: 0, "no-reference": 0, error: 0 });
let stats = { evaluated: 0, skippedBusy: 0, outOfScope: 0, local: emptyRung(), protvar: emptyRung() };
let inFlight = 0;

export function shadowTiersEnabled(): boolean {
  const flag = process.env.RESOLVER_SHADOW_TIERS?.trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;
  if (flag === "on" || flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV !== "test" && !process.env.VITEST;
}

function logVariants(): boolean {
  return process.env.RESOLVER_SHADOW_LOG_VARIANTS === "true" || process.env.NODE_ENV !== "production";
}

/** Counters for `/api/v1/diagnostics`. Contains no variant data. */
export function getShadowTierStats() {
  return { enabled: shadowTiersEnabled(), inFlight, ...structuredClone(stats) };
}

export function resetShadowTierStats(): void {
  stats = { evaluated: 0, skippedBusy: 0, outOfScope: 0, local: emptyRung(), protvar: emptyRung() };
}

/** `ENSP…:p.Arg175His` / `p.(Arg175His)` -> R,175,H; null for anything that is not a missense change. */
function parseHgvsp(hgvsp: string | undefined): { pos: number; wt: string; mut: string } | null {
  const m = /p\.\(?([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})\)?$/.exec(hgvsp ?? "");
  const wt = m && THREE_TO_ONE[m[1]];
  const mut = m && THREE_TO_ONE[m[3]];
  return m && wt && mut && wt !== mut ? { pos: Number(m[2]), wt, mut } : null;
}

function toReading(tc: ResolvedTranscriptConsequence | undefined): Reading | null {
  const parsed = parseHgvsp(tc?.hgvsp);
  return parsed && tc?.gene_symbol ? { gene: tc.gene_symbol.toUpperCase(), ...parsed } : null;
}

const same = (a: Reading, b: Reading) => a.gene === b.gene && a.pos === b.pos && a.wt === b.wt && a.mut === b.mut;

/** The GRCh38 SNV an outcome resolved, or null when it is out of the shadow rungs' scope. */
function snvOf(outcome: ResolutionOutcome): { chrom: string; pos: number; ref: string; alt: string } | null {
  const c = outcome.consequence;
  const alleles = typeof c.allele_string === "string" ? c.allele_string.split("/") : [];
  if (outcome.assembly !== "GRCh38" || !outcome.proteinChangeFound || !c.seq_region_name || !c.start) return null;
  if (alleles.length !== 2 || !/^[ACGT]$/i.test(alleles[0]) || !/^[ACGT]$/i.test(alleles[1])) return null;
  return { chrom: String(c.seq_region_name).replace(/^chr/i, ""), pos: c.start, ref: alleles[0].toUpperCase(), alt: alleles[1].toUpperCase() };
}

/** Evaluates both candidate rungs for one outcome. Pure apart from `deps`; never throws. */
export async function evaluateShadowTiers(outcome: ResolutionOutcome, deps: ShadowDeps = DEFAULT_DEPS): Promise<ShadowReport | null> {
  const snv = snvOf(outcome);
  if (!snv) return null;

  const mane = toReading(outcome.consequence.transcript_consequences.find(tc => tc.mane_select && tc.hgvsp));
  const canonicalNumbered = outcome.numbering && (outcome.numbering.status === "canonical" || outcome.numbering.status === "remapped");
  const canonical = canonicalNumbered ? toReading(outcome.numbering!.consequence) : null;

  const report: ShadowReport = {
    coordinate: `${snv.chrom}-${snv.pos}-${snv.ref}-${snv.alt}`,
    served: { provider: outcome.consequence.provider, mane, canonical },
    local: { verdict: "miss" },
    protvar: { verdict: "miss" },
  };

  const [local, protvar] = await Promise.allSettled([
    deps.local(snv.chrom, snv.pos, snv.ref, snv.alt),
    deps.protvar(snv.chrom, snv.pos, snv.ref, snv.alt, AbortSignal.timeout(PROTVAR_TIMEOUT_MS)),
  ]);

  if (local.status === "rejected") {
    report.local = { verdict: "error", detail: String(local.reason?.message ?? local.reason) };
  } else if (!local.value || local.value.basis !== "mane") {
    report.local = { verdict: "miss", detail: local.value ? `basis ${local.value.basis}` : undefined };
  } else {
    const r = local.value.record;
    const wt = (r as { aaref?: string | null }).aaref?.toUpperCase();
    const mut = (r as { aaalt?: string | null }).aaalt?.toUpperCase();
    const reading = wt && mut ? { gene: r.gene.toUpperCase(), pos: r.pos, wt, mut } : null;
    report.local = !reading ? { verdict: "miss" }
      : !mane ? { verdict: "no-reference", reading }
      : { verdict: same(reading, mane) ? "agree" : "disagree", reading };
  }

  if (protvar.status === "rejected") {
    report.protvar = { verdict: "error", detail: String(protvar.reason?.message ?? protvar.reason) };
  } else if (protvar.value.status !== "found") {
    report.protvar = { verdict: "miss", detail: protvar.value.reason };
  } else {
    const p = protvar.value;
    const reading = { gene: p.gene.toUpperCase(), pos: p.position, wt: p.wt, mut: p.mut };
    report.protvar = !canonical ? { verdict: "no-reference", reading }
      : { verdict: same(reading, canonical) ? "agree" : "disagree", reading };
  }
  return report;
}

function record(report: ShadowReport): void {
  stats.evaluated++;
  stats.local[report.local.verdict]++;
  stats.protvar[report.protvar.verdict]++;
  for (const rung of ["local", "protvar"] as const) {
    const r = report[rung];
    if (r.verdict !== "disagree") continue;
    const reference = rung === "local" ? report.served.mane : report.served.canonical;
    console.warn(
      `[Resolver shadow] ${rung} disagrees with ${report.served.provider}`,
      logVariants()
        ? { coordinate: report.coordinate, shadow: r.reading, served: reference }
        : { gene: reference?.gene ?? null }
    );
  }
}

/** Fire-and-forget hook for `resolveCoordinate`. Never affects, delays or fails the caller. */
export function runShadowTiers(outcome: ResolutionOutcome, deps: ShadowDeps = DEFAULT_DEPS): void {
  if (!shadowTiersEnabled()) return;
  if (!snvOf(outcome)) {
    stats.outOfScope++;
    return;
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    stats.skippedBusy++;
    return;
  }
  inFlight++;
  void evaluateShadowTiers(outcome, deps)
    .then(report => {
      if (report) record(report);
    })
    .catch(() => {})
    .finally(() => {
      inFlight--;
    });
}
