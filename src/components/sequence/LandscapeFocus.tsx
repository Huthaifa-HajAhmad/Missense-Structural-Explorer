import React, { useMemo, useState } from "react";
import type { LandscapeResidueItem } from "../../shared/contracts";
import {
  bandKey,
  bandLabel,
  conservationLevel,
  complementBase,
  HEATMAP_AA_ORDER,
  residueCount,
  residueSummary,
  snvReachableAminoAcids,
  translateCodon,
  type LandscapeTool,
  type SummaryMode
} from "../../shared/landscapeEvidence";
import { aviRankBand } from "../../shared/alphagenomeEvidence";
import type { AlphaGenomeSaturationPosition } from "../../shared/contracts";
import type { CodonNucleotide } from "./useAlphaGenomeRegion";
import type { DomainSpan, TargetMutation, VariantScores } from "./types";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { useRovingGrid } from "./useRovingGrid";

const TOOL_NAME: Record<LandscapeTool, string> = { revel: "REVEL", alphaMissense: "AlphaMissense" };
const LETTER_CLASS: Record<string, string> = {
  D: "acidic", E: "acidic", K: "basic", R: "basic", H: "basic", S: "polar", T: "polar", N: "polar", Q: "polar",
  F: "aromatic", W: "aromatic", Y: "aromatic", G: "special", P: "special", C: "special"
};
const GUTTER = 88;
const f3 = (n: number) => n.toFixed(3);

/** Residue column width before the container is measured (and in jsdom): fixed per focus width. */
export function columnWidthFor(width: number): number {
  if (width <= 21) return 30;
  if (width <= 31) return 27;
  return 21;
}

const MIN_COL = 18;
const MAX_COL = 48;
const RIGHT_PAD = 16;

/**
 * Column width that makes the residues fill the card. Fixed 27 px columns left a quarter of the
 * card empty on a wide screen; a codon's three bases take a third each, so a fractional width is fine.
 */
export function fitColumnWidth(available: number, residueCount: number, fallback: number): number {
  if (available <= 0 || residueCount <= 0) return fallback;
  return Math.max(MIN_COL, Math.min(MAX_COL, Math.floor((available - GUTTER - RIGHT_PAD) / residueCount)));
}

/** A residue column dbNSFP has no missense record for (not a score of zero, and not "benign"). */
export function hasNoRecord(row: LandscapeResidueItem | undefined): boolean {
  return !row || (residueCount(row, "revel") === 0 && residueCount(row, "alphaMissense") === 0);
}

export interface NucleotidePick {
  position: AlphaGenomeSaturationPosition;
  genomicAlt: string;
  codonIndex: number;
  codonPosition: number;
  phred: number | null;
}

interface Props {
  residues: string[];
  start: number;
  target: TargetMutation;
  width: number;
  rows: Map<number, LandscapeResidueItem>;
  mode: SummaryMode;
  colorBy: LandscapeTool;
  variantScores: VariantScores;
  domains: DomainSpan[];
  selected: { kind: "residue" | "substitution" | "nucleotide"; pos: number; alt?: string } | null;
  selectedGenomic: { pos: number; alt: string } | null;
  hoveredPos: number | null;
  loadingWindow: boolean;
  codons: Map<number, CodonNucleotide[]>;
  strand: "+" | "-" | null;
  laneStatus: "pending" | "error" | "none" | "ready";
  /** AlphaGenome codons dropped because they do not translate to the residue drawn above them. */
  codonMismatches?: number;
  genomicPos: number | null;
  genomicAlt: string | null;
  onPickResidue: (pos: number) => void;
  onPickSubstitution: (pos: number, alt: string) => void;
  onPickNucleotide: (pick: NucleotidePick) => void;
  onHover: (pos: number | null) => void;
  /** Residue-letter class for the reader's sequence colour scheme; defaults to chemistry. */
  residueClass?: (aa: string) => string;
}

export function LandscapeFocus(props: Props) {
  const {
    residues, start, target, width, rows, mode, colorBy, variantScores, domains, selected, selectedGenomic,
    hoveredPos, loadingWindow, codons, strand, laneStatus, genomicPos, genomicAlt,
    onPickResidue, onPickSubstitution, onPickNucleotide, onHover
  } = props;
  const residueClass = props.residueClass ?? ((aa: string) => LETTER_CLASS[aa] ?? "hydrophobic");
  const [sizeRef, measured] = useMeasuredWidth<HTMLElement>();
  const colW = fitColumnWidth(measured, residues.length, columnWidthFor(width));
  /*
   * Cell height ≥ 24px (WCAG 2.5.8). The old 14–20px cells were under the hit-target floor on
   * every pointer; the whole-window overview lives on the horizontal axis (columns still fit the
   * measured width), so the taller rows are absorbed by vertical scroll, not by dropping columns.
   * Floor 24, cap 26 so wide columns stay near-square.
   */
  const cellH = Math.max(24, Math.min(26, Math.round(colW * 0.55)));
  const ntW = colW / 3;
  const [readout, setReadout] = useState<string | null>(null);
  const heat = useRovingGrid<HTMLDivElement>();
  const lane = useRovingGrid<HTMLDivElement>();
  const residueRow = useRovingGrid<HTMLDivElement>();
  const summaryRow = useRovingGrid<HTMLDivElement>();
  const consRow = useRovingGrid<HTMLDivElement>();
  const end = start + residues.length - 1;
  const cols = useMemo(() => residues.map((aa, i) => ({ aa, pos: start + i })), [residues, start]);
  const statWord = mode === "mean" ? "mean" : "max";
  /** Hover and keyboard focus both light the residue everywhere and put the reading in the header. */
  const track = (pos: number, text: string) => ({
    onMouseEnter: () => (onHover(pos), setReadout(text)),
    onMouseLeave: () => (onHover(null), setReadout(null)),
    onFocus: () => (onHover(pos), setReadout(text)),
    onBlur: () => (onHover(null), setReadout(null))
  });

  /** Both predictors for one substitution, the colour-by tool first, on one line. */
  const readSubstitution = (aa: string, pos: number, alt: string, isTarget: boolean): string => {
    const row = rows.get(pos);
    const sub = row?.substitutions?.find((x) => x.alt === alt);
    const order: LandscapeTool[] = colorBy === "revel" ? ["revel", "alphaMissense"] : ["alphaMissense", "revel"];
    const scored = order
      .map((t) => {
        const v = sub ? (t === "revel" ? sub.revel : sub.am) : null;
        return v !== null ? `${TOOL_NAME[t]} ${f3(v)} (${bandLabel(t, v)})` : null;
      })
      .filter(Boolean);
    const reachable = reachableByPos.get(pos);
    const why =
      reachable && !reachable.has(alt)
        ? "needs two or more nucleotide changes, not scored in dbNSFP"
        : hasNoRecord(row) && !(loadingWindow && !row)
          ? "no dbNSFP missense record at this residue"
          : "no score";
    return [`${aa}${pos}${alt}`, ...(scored.length ? scored : [why]), isTarget ? "the queried variant" : null].filter(Boolean).join(" · ");
  };

  const focusOf = (pos: number): "target" | "selected" | "hovered" | undefined =>
    pos === target.pos ? "target" : selected?.pos === pos ? "selected" : hoveredPos === pos ? "hovered" : undefined;

  const reachableByPos = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const [pos, nts] of codons) m.set(pos, snvReachableAminoAcids(nts.map((n) => n.codingRef).join("")));
    return m;
  }, [codons]);

  const visibleDomains = domains
    .filter((d) => d.end >= start && d.start <= end)
    .map((d) => ({ ...d, from: Math.max(d.start, start) - start, to: Math.min(d.end, end) - start }));

  const heatmapRow = (alt: string, r: number) => (
    <div key={alt} className="flex items-center">
      <span className="ls-gutter ls-aa font-semibold !text-[11px]" data-class={LETTER_CLASS[alt] ?? "hydrophobic"} style={{ width: GUTTER, background: "transparent" }} aria-hidden="true">
        {alt}
      </span>
      {cols.map(({ aa, pos }, c) => {
        if (alt === aa) {
          return (
            <button key={pos} type="button" className="ls-sub" data-band="reference" data-rc={`${r}:${c}`} style={{ width: colW - 1 }} onClick={() => onPickResidue(pos)} aria-label={`Reference ${aa}${pos}`} {...track(pos, `Reference ${aa}${pos}`)}>
              ·
            </button>
          );
        }
        const sub = rows.get(pos)?.substitutions?.find((s) => s.alt === alt);
        const v = sub ? (colorBy === "revel" ? sub.revel : sub.am) : null;
        const reachable = reachableByPos.get(pos);
        const pending = loadingWindow && !rows.has(pos);
        const norecord = !pending && hasNoRecord(rows.get(pos));
        const band =
          v !== null ? bandKey(colorBy, v) : pending ? "unscored" : reachable && !reachable.has(alt) ? "unreachable" : norecord ? "norecord" : "unscored";
        const isTarget = pos === target.pos && alt === target.mut;
        const isSel = selected?.kind === "substitution" && selected.pos === pos && selected.alt === alt;
        const label =
          `${aa}${pos}${alt}: ` +
          (v !== null
            ? `${TOOL_NAME[colorBy]} ${f3(v)} (${bandLabel(colorBy, v)})`
            : pending
              ? "loading"
              : band === "unreachable"
              ? "needs two or more nucleotide changes; not scored in dbNSFP"
              : band === "norecord"
                ? "no dbNSFP missense record at this residue"
                : `no ${TOOL_NAME[colorBy]} score${reachable ? " (SNV-reachable)" : ""}`) +
          (isTarget ? " · the queried variant" : "");
        return (
          <button
            key={pos}
            type="button"
            className="ls-sub"
            data-band={band}
            data-focus={isTarget ? "target" : isSel ? "selected" : undefined}
            data-rc={`${r}:${c}`}
            data-entry={isTarget ? "" : undefined}
            style={{ width: colW - 1 }}
            onClick={() => onPickSubstitution(pos, alt)}
            aria-label={label}
            {...track(pos, readSubstitution(aa, pos, alt, isTarget))}
          />
        );
      })}
    </div>
  );


  const laneColumns = cols.filter(({ pos }) => codons.has(pos)).length;
  const laneEmpty = laneStatus === "ready" && laneColumns === 0;

  const ntLane = () => {
    if (laneStatus !== "ready" || laneEmpty) {
      const text =
        laneStatus === "pending"
          ? "Loading AlphaGenome nucleotide ranks…"
          : laneStatus === "error"
            ? "AlphaGenome region not loaded (see the exon panel below)."
            : laneEmpty
              ? `AlphaGenome scored the exon around the variant only, and none of residues ${start}–${end} lie in it. Move the window back to the variant to see nucleotide ranks.`
              : "No genomic interval was resolved for this variant, so no nucleotide lane.";
      return <div className="text-[11px] text-cs-text-muted pb-1" style={{ paddingLeft: GUTTER }}>{text}</div>;
    }
    return (
      <div ref={lane.ref} onFocus={lane.onFocus} onKeyDown={lane.onKeyDown} role="group" aria-label="AlphaGenome nucleotide ranks, one row per base, three columns per residue">
        {["A", "C", "G", "T"].map((base, r) => (
          <div key={base} className="flex items-center mb-px">
            <span className="ls-gutter !text-[11px] !text-cs-text-secondary" style={{ width: GUTTER }} aria-hidden="true">{base}</span>
            {cols.map(({ aa, pos }, c) => {
              const nts = codons.get(pos);
              if (!nts) {
                return <span key={pos} className="ls-nt" data-rank="none" style={{ width: colW }} aria-hidden="true" />;
              }
              return nts.map((nt, k) => {
                const codon = nts.map((n) => n.codingRef).join("");
                const rc = `${r}:${c * 3 + k}`;
                if (base === nt.codingRef) {
                  return (
                    <button key={`${pos}-${k}`} type="button" className="ls-nt" data-rank="ref" data-rc={rc} style={{ width: ntW }} onClick={() => onPickResidue(pos)} aria-label={`Coding ${base}, codon ${pos} position ${k + 1} (reference)`} {...track(pos, `Reference ${base}, codon ${pos} position ${k + 1} (${codon})`)} />
                  );
                }
                const gAlt = strand === "-" ? complementBase(base) : base;
                const phred = nt.position.variants[gAlt]?.phred ?? null;
                const rank = aviRankBand(phred);
                const mutated = translateCodon(codon.slice(0, k) + base + codon.slice(k + 1));
                const effect = mutated === "*" ? "stop gained" : mutated === aa ? "synonymous" : `${aa}${pos}${mutated}`;
                const isQuery = nt.position.pos === genomicPos && genomicAlt?.toUpperCase() === gAlt;
                const isSel = selectedGenomic?.pos === nt.position.pos && selectedGenomic.alt === gAlt;
                const label =
                  `Coding ${nt.codingRef}>${base} at codon ${pos} position ${k + 1} (genomic ${nt.position.pos} ${nt.position.ref}>${gAlt}) → ${effect}` +
                  (phred !== null ? `, AVI Phred ${phred.toFixed(1)}, ${rank?.label ?? "no rank"} of all SNVs` : ", no AlphaGenome score");
                return (
                  <button
                    key={`${pos}-${k}`}
                    type="button"
                    className="ls-nt"
                    data-rank={rank ? String(rank.level) : "none"}
                    data-focus={isQuery ? "target" : isSel ? "selected" : undefined}
                    data-rc={rc}
                    data-entry={isQuery ? "" : undefined}
                    style={{ width: ntW }}
                    onClick={() => onPickNucleotide({ position: nt.position, genomicAlt: gAlt, codonIndex: pos, codonPosition: k + 1, phred })}
                    aria-label={label}
                    {...track(pos, label)}
                  />
                );
              });
            })}
          </div>
        ))}
        <div className="flex items-center">
          <span className="ls-gutter" style={{ width: GUTTER }}>CODON</span>
          {cols.map(({ pos }) => {
            const nts = codons.get(pos);
            if (!nts) return <span key={pos} style={{ width: colW }} className="shrink-0" />;
            return nts.map((nt, k) => (
              <span
                key={`${pos}-${k}`}
                aria-hidden="true"
                className={`shrink-0 text-center font-mono text-[10px] font-semibold ${pos === target.pos ? "text-cs-accent-clay" : "text-cs-text-secondary"} ${k === 0 ? "border-l border-cs-border-subtle" : ""}`}
                style={{ width: ntW }}
              >
                {nt.codingRef}
              </span>
            ));
          })}
        </div>
      </div>
    );
  };

  return (
    <section
      ref={sizeRef}
      className="ls-panel py-3 flex flex-col gap-1 overflow-x-auto scrollbar-thin"
      style={{ ["--ls-cell-h" as string]: `${cellH}px` }}
      aria-label="Focus window"
    >
      <div className="flex justify-between gap-3 px-4 pb-1 text-[12px] text-cs-text-secondary">
        <span className="font-semibold text-cs-text-primary shrink-0">Focus · residues {start}–{end}</span>
        <span className="font-mono text-[11px] text-cs-text-secondary truncate min-h-[16px]" aria-live="off">
          {readout ?? <span className="text-cs-text-muted font-sans">Hover or focus a cell to read it · arrow keys move inside a grid</span>}
        </span>
      </div>

      <div className="flex font-mono text-[10px] h-4 text-cs-text-muted" style={{ paddingLeft: GUTTER }} aria-hidden="true">
        {cols.map(({ pos }) => (
          <span key={pos} className={`shrink-0 text-center ${pos === target.pos ? "font-bold text-cs-accent-clay" : ""}`} style={{ width: colW }}>
            {pos % 5 === 0 || pos === target.pos ? pos : ""}
          </span>
        ))}
      </div>

      {visibleDomains.length > 0 && (
        <div className="flex items-center">
          <span className="ls-gutter" style={{ width: GUTTER }}>DOMAIN</span>
          <div className="relative h-[14px] shrink-0" style={{ width: cols.length * colW }}>
            {visibleDomains.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className="ls-domain absolute top-[2px] overflow-hidden"
                style={{ left: d.from * colW + 1, width: (d.to - d.from + 1) * colW - 2 }}
                title={`${d.name} (${d.start}–${d.end})`}
              >
                <span className="px-1 text-[9px] leading-[10px] font-mono text-cs-text-primary truncate block">{d.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={residueRow.ref} onFocus={residueRow.onFocus} onKeyDown={residueRow.onKeyDown} role="group" aria-label="Residues in the focus window" className="flex items-center">
        <span className="ls-gutter" style={{ width: GUTTER }}>RESIDUE</span>
        {cols.map(({ aa, pos }, c) => {
          const row = rows.get(pos);
          const mismatch = Boolean(row?.refMismatch);
          const label =
            `Residue ${aa}${pos}${pos === target.pos ? ", the queried residue" : ""}` +
            (mismatch ? ` · dbNSFP reports ${row?.aaref ?? "another residue"} here; scores may be on a different numbering` : "");
          return (
            <button
              key={pos}
              type="button"
              className="ls-cell ls-cell--letter ls-aa"
              data-class={residueClass(aa)}
              data-focus={focusOf(pos)}
              data-mismatch={mismatch ? "true" : undefined}
              data-rc={`0:${c}`}
              data-entry={pos === target.pos ? "" : undefined}
              style={{ width: colW }}
              onClick={() => onPickResidue(pos)}
              aria-label={label}
              {...track(pos, label)}
            >
              {aa}
            </button>
          );
        })}
      </div>

      <div ref={consRow.ref} onFocus={consRow.onFocus} onKeyDown={consRow.onKeyDown} role="group" aria-label="phyloP conservation per residue, codon mean" className="flex items-end">
        <span className="ls-gutter self-center" style={{ width: GUTTER }}>PHYLOP</span>
        {cols.map(({ pos }, c) => {
          const row = rows.get(pos);
          const v = row?.phylop ?? null;
          const level = conservationLevel("phylop", v);
          const label =
            v === null
              ? `Residue ${pos}: no phyloP`
              : `Residue ${pos}: phyloP ${v.toFixed(2)}${row?.gerp != null ? `, GERP++ ${row.gerp.toFixed(2)}` : ""} (codon mean over ${row?.nucleotideCount ?? 0} nt)` +
                (pos === target.pos && variantScores.phylop !== null ? ` · variant nucleotide phyloP ${variantScores.phylop.toFixed(2)}` : "");
          return (
            <button
              key={pos}
              type="button"
              className="shrink-0 h-6 flex items-end justify-center cursor-pointer bg-transparent border-0 p-0"
              style={{ width: colW }}
              data-rc={`0:${c}`}
              aria-label={label}
              onClick={() => onPickResidue(pos)}
              {...track(pos, label)}
            >
              <span
                aria-hidden="true"
                className="ls-cons block rounded-t-sm"
                data-level={level ?? "none"}
                style={{ width: Math.max(8, colW - 8), height: v === null ? 2 : 3 + 15 * Math.min(1, Math.max(0, (v + 2) / 12)) }}
              />
            </button>
          );
        })}
      </div>

      <div
        ref={heat.ref}
        onFocus={heat.onFocus}
        onKeyDown={heat.onKeyDown}
        className="flex flex-col gap-px mt-1"
        role="group"
        aria-label={`Substitution heatmap, ${TOOL_NAME[colorBy]}: one row per substituted amino acid, one column per residue`}
      >
        {HEATMAP_AA_ORDER.map(heatmapRow)}
      </div>

      <div ref={summaryRow.ref} onFocus={summaryRow.onFocus} onKeyDown={summaryRow.onKeyDown} role="group" aria-label={`Residue ${statWord} of ${TOOL_NAME[colorBy]}`} className="flex items-center mt-1">
        <span className="ls-gutter" style={{ width: GUTTER }}>{statWord.toUpperCase()} (n≤9)</span>
        {cols.map(({ pos }, c) => {
          const row = rows.get(pos);
          const v = residueSummary(row, colorBy, mode);
          const n = residueCount(row, colorBy);
          const pending = loadingWindow && !row;
          const label =
            v === null
              ? `Residue ${pos}: ${pending ? "loading" : hasNoRecord(row) ? "no dbNSFP missense record" : `no ${TOOL_NAME[colorBy]} score`}`
              : `Residue ${pos} ${TOOL_NAME[colorBy]} ${statWord} ${f3(v)} over ${n} scored substitution${n === 1 ? "" : "s"} · band ${bandLabel(colorBy, v)} (orientation only)` +
                (pos === target.pos ? ` · this variant ${colorBy === "revel" ? variantScores.revel?.toFixed(3) ?? "—" : variantScores.am?.toFixed(3) ?? "—"}` : "");
          return (
            <button
              key={pos}
              type="button"
              className="ls-cell ls-band !h-6"
              data-band={bandKey(colorBy, v) ?? "none"}
              data-focus={pos === target.pos ? "target" : undefined}
              data-rc={`0:${c}`}
              data-entry={pos === target.pos ? "" : undefined}
              style={{ width: colW }}
              onClick={() => onPickResidue(pos)}
              aria-label={label}
              {...track(pos, label)}
            >
              {v !== null ? v.toFixed(2).replace(/^0/, "") : pending ? "…" : "–"}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between gap-3 px-4 pt-2 mt-2 border-t border-cs-border-subtle text-[12px] text-cs-text-secondary">
        <span className="font-semibold text-cs-text-primary">
          Nucleotides · coding strand{strand === "-" ? " (−), complemented" : strand === "+" ? " (+)" : ""} · three columns under each residue
        </span>
        <span className="text-cs-text-muted">AlphaGenome AVI genome-wide rank · not an ACMG band · contains AlphaMissense</span>
      </div>
      {laneStatus === "ready" && (props.codonMismatches ?? 0) > 0 && (
        <div className="text-[11px] text-cs-text-warning" style={{ paddingLeft: GUTTER }}>
          {props.codonMismatches} AlphaGenome codon{props.codonMismatches === 1 ? "" : "s"} did not translate to the residue shown and
          {props.codonMismatches === 1 ? " is" : " are"} left out: its transcript numbering may differ from this sequence.
        </div>
      )}
      {ntLane()}
    </section>
  );
}
