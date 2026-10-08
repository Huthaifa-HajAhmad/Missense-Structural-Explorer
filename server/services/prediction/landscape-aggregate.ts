/**
 * Per-residue landscape statistics, computed on ONE transcript's numbering.
 *
 * dbNSFP stores one row per genomic SNV and lists, for every transcript the SNV touches, that
 * transcript's residue number and (for REVEL and AlphaMissense) that transcript's score. The
 * previous aggregation pushed each SNV's score into EVERY listed residue number, so an isoform-2
 * residue 98 was counted as canonical residue 98. On NAE1 p.Asp116Gly that put 48 "evaluated
 * variants" at a residue whose codon admits at most 9 SNVs.
 *
 * The rules here:
 *   1. Choose one reference transcript for the whole window (MANE flag → Ensembl canonical flag →
 *      best agreement with the displayed UniProt sequence → most covered), and read each SNV's
 *      residue number and scores at THAT transcript's index only.
 *   2. Count each genomic SNV once, and only if it changes the amino acid.
 *   3. Conservation is a per-nucleotide score, so it is averaged over distinct nucleotides of the
 *      codon, not over variant rows (a nucleotide with three alts is not three times as conserved).
 */

export type TranscriptBasis = "mane" | "ensembl-canonical" | "sequence-match" | "most-covered" | "unknown";

/** One transcript's reading of an SNV. */
export interface TranscriptReading {
  transcript: string | null;
  pos: number;
  revel: number | null;
  am: number | null;
  isMane: boolean;
  isCanonical: boolean;
}

/** An SNV as dbNSFP reports it, before a transcript is chosen. */
export interface SnvCandidate {
  /** Unique per genomic SNV (chrom:pos:ref>alt), used to count each SNV once. */
  variantKey: string;
  /** Unique per nucleotide (chrom:pos), used to average conservation over nucleotides. */
  nucleotideKey: string | null;
  aaref: string | null;
  aaalt: string | null;
  gerp: number | null;
  phylop: number | null;
  readings: TranscriptReading[];
}

export interface LandscapePositionData {
  residx: number;
  /** Reference amino acid dbNSFP reports at this residue on the chosen transcript. */
  aaref: string | null;
  /** True when `aaref` disagrees with the displayed UniProt sequence at this residue. */
  refMismatch: boolean;
  revelMean: number | null;
  revelMin: number | null;
  revelMax: number | null;
  /**
   * Distinct missense substitutions (alternative amino acids) with a REVEL score at this residue.
   * Summaries are taken over substitutions, not SNVs: AlphaMissense scores the amino-acid change, so
   * two SNVs giving the same amino acid must not weigh it twice.
   */
  revelCount: number;
  amMean: number | null;
  amMin: number | null;
  amMax: number | null;
  amCount: number;
  /** Mean GERP++ RS over the distinct nucleotides of the codon that carry a score. */
  gerp: number | null;
  /** Mean phyloP100way over the distinct nucleotides of the codon that carry a score. */
  phylop: number | null;
  /** Distinct nucleotides behind `gerp` / `phylop`. */
  nucleotideCount: number;
  /**
   * The missense substitutions dbNSFP scores at this residue, one entry per alternative amino
   * acid. AlphaMissense scores the amino-acid change, so it is one value; REVEL scores the SNV, so
   * when two SNVs give the same amino acid the higher REVEL is kept. This set can be smaller than
   * the codon's SNV-reachable set (substitutions needing two nucleotide changes are absent), so
   * surfaces must say "scored", not "SNV-reachable", when they count it. Omitted from whole-protein
   * summaries to keep that payload small.
   */
  substitutions?: SubstitutionScore[];
}

export interface SubstitutionScore {
  alt: string;
  am: number | null;
  revel: number | null;
}

export interface LandscapeMeta {
  source: "dbnsfp-local" | "myvariant" | "none";
  /** e.g. "dbNSFP 4.4a"; null when the source does not report one. */
  sourceVersion: string | null;
  transcript: string | null;
  transcriptBasis: TranscriptBasis;
  window: { start: number; end: number } | null;
  /** UniProt accession the residue letters were checked against, when a sequence was available. */
  referenceSequence: string | null;
  /** Machine-readable data-quality notes, e.g. "overcount:116" or "ref-mismatch:3". */
  qualityFlags: string[];
  cached: boolean;
  retrievedAt: string;
}

export interface LandscapeResult {
  positions: LandscapePositionData[];
  meta: LandscapeMeta;
}

/** The most SNVs one codon admits: 3 nucleotides × 3 alternative bases. */
export const MAX_SNVS_PER_CODON = 9;

const AMINO_ACIDS = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));

const THREE_TO_ONE: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
  LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  TER: "*", STOP: "*"
};

export function normalizeAminoAcid(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim().toUpperCase();
  if (!s || s === ".") return null;
  if (s.length === 1) return s === "X" ? "*" : s;
  return THREE_TO_ONE[s] ?? null;
}

/** "p.Asp116Gly", "D116G", "Asp116Gly" → { ref: "D", alt: "G" }. */
export function parseAminoAcidChange(raw: unknown): { ref: string | null; alt: string | null } {
  if (typeof raw !== "string") return { ref: null, alt: null };
  const m = raw.trim().replace(/^p\./i, "").match(/^([A-Za-z*]{1,3})\d+([A-Za-z*]{1,4})/);
  if (!m) return { ref: null, alt: null };
  return { ref: normalizeAminoAcid(m[1]), alt: normalizeAminoAcid(m[2]) };
}

export function toFiniteOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "" || raw === ".") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/**
 * The nucleotide a variant id names, whatever allele suffix it carries: "chr7:117287507G>A",
 * "chr7:g.117287507G>A" and "chr7:117287507" all read as "chr7:117287507". The previous pattern
 * required the full `g.<pos><ref>><alt>` shape, which myvariant.info's ids do not use — so every
 * myvariant-sourced candidate had `nucleotideKey: null`, and in `aggregateLandscape` the same
 * nucleotide's three alt SNVs were counted as three nucleotides in the codon-mean GERP++/phyloP
 * (and in `nucleotideCount`, shown on the tab as "2 nt").
 */
export function parseNucleotideKey(id: string): string | null {
  const m = id.match(/^(chr[^:]+):(?:g\.)?(\d+)/i);
  return m ? `${m[1].toLowerCase()}:${m[2]}` : null;
}

/** A dbNSFP multi-value field as a list: arrays stay arrays, "a;b;c" strings split. */
export function asList(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.includes(";")) return raw.split(";");
  return [raw];
}

/**
 * The value belonging to transcript index `i`. dbNSFP gives some scores per transcript (REVEL,
 * AlphaMissense) and some once per SNV; a list the same length as the transcript list is read at
 * `i`, a single value applies to every transcript, and anything else is ambiguous → first finite.
 */
export function valueAtIndex(raw: unknown, i: number, transcriptCount: number): number | null {
  const list = asList(raw);
  if (list.length === 0) return null;
  if (list.length === transcriptCount) return toFiniteOrNull(list[i]);
  if (list.length === 1) return toFiniteOrNull(list[0]);
  for (const v of list) {
    const n = toFiniteOrNull(v);
    if (n !== null) return n;
  }
  return null;
}

function isFlagSet(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw !== "string") return false;
  const s = raw.trim().toUpperCase();
  return s === "YES" || s === "Y" || s.startsWith("MANE");
}

/** Read a flag list aligned to transcripts; a missing list reads as "not flagged". */
function flagAt(raw: unknown, i: number, transcriptCount: number): boolean {
  const list = asList(raw);
  if (list.length === transcriptCount) return isFlagSet(list[i]);
  return false;
}

function scoreOf(field: any): unknown {
  if (field === null || field === undefined) return null;
  if (typeof field === "object" && !Array.isArray(field) && "score" in field) return field.score;
  return field;
}

/**
 * One myvariant.info hit → an SNV candidate carrying every transcript's reading. Returns null for
 * hits with no dbNSFP block or no residue number at all.
 */
export function candidateFromMyVariantHit(hit: any): SnvCandidate | null {
  const d = hit?.dbnsfp;
  if (!d) return null;

  const id: string = typeof hit._id === "string" ? hit._id : "";
  // myvariant.info ids carry no "g." separator ("chr7:117287507G>A"), so the old full-allele
  // pattern never matched and the nucleotide key was always null — see `parseNucleotideKey`.
  const nucleotideKey = parseNucleotideKey(id);

  const rawPos = d.aa?.pos ?? d.aapos ?? d.aa_pos ?? d["aa.pos"];
  const positions = asList(rawPos)
    .map((p) => parseInt(String(p).trim(), 10))
    .map((p) => (Number.isFinite(p) && p > 0 ? p : null));
  const transcripts = asList(d.ensembl?.transcriptid ?? d.ensembl_transcriptid).map((t) =>
    typeof t === "string" && t.trim() && t !== "." ? t.trim() : null
  );

  const n = Math.max(positions.length, transcripts.length);
  if (n === 0) return null;

  const readings: TranscriptReading[] = [];
  for (let i = 0; i < n; i++) {
    const pos = positions.length === n ? positions[i] : positions.length === 1 ? positions[0] : null;
    if (pos === null || pos === undefined) continue;
    readings.push({
      transcript: transcripts.length === n ? transcripts[i] : null,
      pos,
      revel: valueAtIndex(scoreOf(d.revel), i, n),
      am: valueAtIndex(scoreOf(d.alphamissense), i, n),
      isMane: flagAt(d.mane ?? d.mane_select ?? d.ensembl?.mane, i, n),
      isCanonical: flagAt(d.vep_canonical ?? d.ensembl?.canonical, i, n)
    });
  }
  if (readings.length === 0) return null;

  const gerpObj = d["gerp++"] ?? {};
  const gerp = toFiniteOrNull(asList(gerpObj.rs ?? d.gerp?.["91_mammals"]?.score)[0]);
  const phylopRaw =
    d.phylop?.["100way_vertebrate"]?.score ?? d.phylop?.vertebrate ?? d.phylop?.phylop100way_vertebrate ?? null;
  const phylop = toFiniteOrNull(asList(phylopRaw)[0]);

  return {
    variantKey: id || `${nucleotideKey ?? "?"}:${normalizeAminoAcid(d.aa?.alt) ?? "?"}:${readings[0].pos}`,
    nucleotideKey,
    aaref: normalizeAminoAcid(d.aa?.ref ?? d.aaref),
    aaalt: normalizeAminoAcid(d.aa?.alt ?? d.aaalt),
    gerp,
    phylop,
    readings
  };
}

export interface TranscriptChoice {
  transcript: string | null;
  basis: TranscriptBasis;
}

/**
 * Choose the transcript whose numbering the whole window is read on. `sequence` is the UniProt
 * canonical sequence the residue row displays; agreement with it is the fallback when dbNSFP
 * carries no MANE / canonical flag.
 */
export function selectReferenceTranscript(candidates: SnvCandidate[], sequence: string | null): TranscriptChoice {
  const mane = new Map<string, number>();
  const canonical = new Map<string, number>();
  const coverage = new Map<string, number>();
  const matches = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const c of candidates) {
    for (const r of c.readings) {
      if (!r.transcript) continue;
      bump(coverage, r.transcript);
      if (r.isMane) bump(mane, r.transcript);
      if (r.isCanonical) bump(canonical, r.transcript);
      if (sequence && c.aaref && sequence[r.pos - 1] === c.aaref) bump(matches, r.transcript);
    }
  }
  const best = (m: Map<string, number>) => {
    let top: string | null = null;
    let topN = 0;
    for (const [k, v] of m) {
      if (v > topN || (v === topN && top !== null && (coverage.get(k) ?? 0) > (coverage.get(top) ?? 0))) {
        top = k;
        topN = v;
      }
    }
    return top;
  };

  const byMane = best(mane);
  if (byMane) return { transcript: byMane, basis: "mane" };
  const byCanonical = best(canonical);
  if (byCanonical) return { transcript: byCanonical, basis: "ensembl-canonical" };
  if (sequence) {
    const byMatch = best(matches);
    if (byMatch) return { transcript: byMatch, basis: "sequence-match" };
  }
  const byCoverage = best(coverage);
  if (byCoverage) return { transcript: byCoverage, basis: "most-covered" };
  return { transcript: null, basis: "unknown" };
}

/**
 * The single reading of an SNV on the chosen transcript. Without transcript ids (older payloads),
 * an SNV listing several residue numbers is read at the one whose reference residue agrees with the
 * sequence, else the first — never at all of them.
 */
export function readingFor(c: SnvCandidate, choice: TranscriptChoice, sequence: string | null): TranscriptReading | null {
  if (choice.transcript) {
    return c.readings.find((r) => r.transcript === choice.transcript) ?? null;
  }
  if (c.readings.length === 1) return c.readings[0];
  if (sequence && c.aaref) {
    const agreeing = c.readings.find((r) => sequence[r.pos - 1] === c.aaref);
    if (agreeing) return agreeing;
  }
  return c.readings[0] ?? null;
}

function isMissense(c: SnvCandidate): boolean {
  // An SNV with no reported amino-acid change cannot be classified; keep it rather than guess.
  if (!c.aaalt) return true;
  if (!AMINO_ACIDS.has(c.aaalt)) return false;
  return c.aaref === null || c.aaalt !== c.aaref;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

export interface AggregateOptions {
  start: number;
  end: number;
  sequence: string | null;
  choice: TranscriptChoice;
}

export interface AggregateOutput {
  positions: LandscapePositionData[];
  qualityFlags: string[];
}

/** Aggregate SNV candidates into one row per residue in [start, end], gaps included. */
export function aggregateLandscape(candidates: SnvCandidate[], opts: AggregateOptions): AggregateOutput {
  const { start, end, sequence, choice } = opts;
  type Bucket = {
    /** Distinct missense SNVs, for the one-codon sanity check. */
    seen: Set<string>;
    gerp: Map<string, number>;
    phylop: Map<string, number>;
    aaref: Map<string, number>;
    subs: Map<string, SubstitutionScore>;
    /** Missense SNVs whose alternative amino acid was not reported; each counts as its own entry. */
    unnamed: Array<{ revel: number | null; am: number | null }>;
  };
  const buckets = new Map<number, Bucket>();
  const bucket = (pos: number) => {
    let b = buckets.get(pos);
    if (!b) {
      b = { seen: new Set(), gerp: new Map(), phylop: new Map(), aaref: new Map(), subs: new Map(), unnamed: [] };
      buckets.set(pos, b);
    }
    return b;
  };

  for (const c of candidates) {
    const r = readingFor(c, choice, sequence);
    if (!r || r.pos < start || r.pos > end) continue;
    const b = bucket(r.pos);
    // Conservation belongs to the nucleotide, whatever the substitution, so it is recorded before
    // the missense filter: a synonymous SNV's nucleotide is still part of the codon.
    // When no nucleotide can be parsed (some cached local rows carry no genomic coordinate), the
    // per-SNV key stands in: it can over-count a nucleotide by its alts, but it can never merge
    // two different nucleotides, so the mean stays right about what was actually read.
    const nt = c.nucleotideKey ?? parseNucleotideKey(c.variantKey) ?? c.variantKey;
    if (c.gerp !== null) b.gerp.set(nt, c.gerp);
    if (c.phylop !== null) b.phylop.set(nt, c.phylop);
    if (c.aaref) b.aaref.set(c.aaref, (b.aaref.get(c.aaref) ?? 0) + 1);

    if (!isMissense(c) || b.seen.has(c.variantKey)) continue;
    b.seen.add(c.variantKey);
    if (c.aaalt && AMINO_ACIDS.has(c.aaalt)) {
      const prev = b.subs.get(c.aaalt);
      const revel = prev?.revel == null ? r.revel : r.revel == null ? prev.revel : Math.max(prev.revel, r.revel);
      b.subs.set(c.aaalt, { alt: c.aaalt, am: prev?.am ?? r.am, revel });
    } else {
      b.unnamed.push({ revel: r.revel, am: r.am });
    }
  }

  const qualityFlags: string[] = [];
  let mismatches = 0;
  const positions: LandscapePositionData[] = [];
  for (let pos = start; pos <= end; pos++) {
    const b = buckets.get(pos);
    let aaref: string | null = null;
    if (b && b.aaref.size) {
      aaref = [...b.aaref.entries()].sort((x, y) => y[1] - x[1])[0][0];
    }
    const refMismatch = Boolean(sequence && aaref && sequence[pos - 1] && sequence[pos - 1] !== aaref);
    if (refMismatch) mismatches++;
    const entries = b ? [...b.subs.values(), ...b.unnamed] : [];
    const revel = entries.map((e) => e.revel).filter((v): v is number => v !== null);
    const am = entries.map((e) => e.am).filter((v): v is number => v !== null);
    if ((b?.seen.size ?? 0) > MAX_SNVS_PER_CODON) qualityFlags.push(`overcount:${pos}`);
    const gerp = b ? [...b.gerp.values()] : [];
    const phylop = b ? [...b.phylop.values()] : [];
    positions.push({
      residx: pos,
      aaref,
      refMismatch,
      revelMean: mean(revel),
      revelMin: min(revel),
      revelMax: max(revel),
      revelCount: revel.length,
      amMean: mean(am),
      amMin: min(am),
      amMax: max(am),
      amCount: am.length,
      gerp: mean(gerp),
      phylop: mean(phylop),
      nucleotideCount: Math.max(b?.gerp.size ?? 0, b?.phylop.size ?? 0),
      substitutions: b ? [...b.subs.values()].sort((x, y) => x.alt.localeCompare(y.alt)) : []
    });
  }
  if (mismatches > 0) qualityFlags.push(`ref-mismatch:${mismatches}`);
  return { positions, qualityFlags };
}
