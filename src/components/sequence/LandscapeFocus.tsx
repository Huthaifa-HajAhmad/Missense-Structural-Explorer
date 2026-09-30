import React, { useMemo } from "react";
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

const TOOL_NAME: Record<LandscapeTool, string> = { revel: "REVEL", alphaMissense: "AlphaMissense" };
const LETTER_CLASS: Record<string, string> = {
  D: "acidic", E: "acidic", K: "basic", R: "basic", H: "basic", S: "polar", T: "polar", N: "polar", Q: "polar",
  F: "aromatic", W: "aromatic", Y: "aromatic", G: "special", P: "special", C: "special"
};
const GUTTER = 88;
const f3 = (n: number) => n.toFixed(3);

/** Residue column width for a focus width; a multiple of 3 so each codon's bases sit under it. */
export function columnWidthFor(width: number): number {
  if (width <= 21) return 30;
  if (width <= 31) return 27;
  return 21;
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
  const colW = columnWidthFor(width);
  const ntW = colW / 3;
  const end = start + residues.length - 1;
  const cols = useMemo(() => residues.map((aa, i) => ({ aa, pos: start + i })), [residues, start]);
  const statWord = mode === "mean" ? "mean" : "max";
  const hover = (pos: number | null) => () => onHover(pos);

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

  const heatmapRow = (alt: string) => (
    <div key={alt} className="flex items-center">
      <span className="ls-gutter ls-aa font-semibold !text-[11px]" data-class={LETTER_CLASS[alt] ?? "hydrophobic"} style={{ width: GUTTER, background: "transparent" }}>
        {alt}
      </span>
      {cols.map(({ aa, pos }) => {
        if (alt === aa) {
          return (
            <button key={pos} type="button" className="ls-sub" data-band="reference" style={{ width: colW - 1 }} onClick={() => onPickResidue(pos)} aria-label={`Reference ${aa}${pos}`} title={`Reference ${aa}${pos}`}>
              ·
            </button>
          );
        }
        const sub = rows.get(pos)?.substitutions?.find((s) => s.alt === alt);
        const v = sub ? (colorBy === "revel" ? sub.revel : sub.am) : null;
        const reachable = reachableByPos.get(pos);
        const pending = loadingWindow && !rows.has(pos);
        const band = v !== null ? bandKey(colorBy, v) : pending ? "unscored" : reachable && !reachable.has(alt) ? "unreachable" : "unscored";
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
              : `no ${TOOL_NAME[colorBy]} score${reachable ? " (SNV-reachable)" : ""}`) +
          (isTarget ? " · the queried variant" : "");
        return (
          <button
            key={pos}
            type="button"
            className="ls-sub"
            data-band={band}
            data-focus={isTarget ? "target" : isSel ? "selected" : undefined}
            style={{ width: colW - 1 }}
            onClick={() => onPickSubstitution(pos, alt)}
            onMouseEnter={hover(pos)}
            onMouseLeave={hover(null)}
            aria-label={label}
            title={label}
          />
        );
      })}
    </div>
  );

  const ntLane = () => {
    if (laneStatus !== "ready") {
      const text =
        laneStatus === "pending"
          ? "Loading AlphaGenome nucleotide ranks…"
          : laneStatus === "error"
            ? "AlphaGenome region not loaded (see the exon panel below)."
            : "No genomic interval was resolved for this variant, so no nucleotide lane.";
      return <div className="text-[11px] text-cs-text-muted" style={{ paddingLeft: GUTTER }}>{text}</div>;
    }
    return (
      <>
        {["A", "C", "G", "T"].map((base) => (
          <div key={base} className="flex items-center mb-px">
            <span className="ls-gutter !text-[11px] !text-cs-text-secondary" style={{ width: GUTTER }}>{base}</span>
            {cols.map(({ aa, pos }) => {
              const nts = codons.get(pos);
              if (!nts) {
                return <span key={pos} className="ls-nt" data-rank="none" style={{ width: colW }} title={`Residue ${pos}: codon outside the AlphaGenome region`} />;
              }
              return nts.map((nt, k) => {
                const codon = nts.map((n) => n.codingRef).join("");
                if (base === nt.codingRef) {
                  return (
                    <button key={`${pos}-${k}`} type="button" className="ls-nt" data-rank="ref" style={{ width: ntW }} onClick={() => onPickResidue(pos)} aria-label={`Coding ${base}, codon ${pos} position ${k + 1} (reference)`} />
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
                    style={{ width: ntW }}
                    onClick={() => onPickNucleotide({ position: nt.position, genomicAlt: gAlt, codonIndex: pos, codonPosition: k + 1, phred })}
                    onMouseEnter={hover(pos)}
                    onMouseLeave={hover(null)}
                    aria-label={label}
                    title={label}
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
                className={`shrink-0 text-center font-mono text-[10px] font-semibold ${pos === target.pos ? "text-cs-accent-clay" : "text-cs-text-secondary"} ${k === 0 ? "border-l border-cs-border-subtle" : ""}`}
                style={{ width: ntW }}
              >
                {nt.codingRef}
              </span>
            ));
          })}
        </div>
      </>
    );
  };

  return (
    <section className="ls-panel py-3 flex flex-col gap-1 overflow-x-auto scrollbar-thin" aria-label="Focus window">
      <div className="flex justify-between gap-3 px-4 pb-1 text-[12px] text-cs-text-secondary">
        <span className="font-semibold text-cs-text-primary">Focus · residues {start}–{end} · every substitution, every nucleotide</span>
        <span className="text-cs-text-muted">{TOOL_NAME[colorBy]} per substitution · hatched = not reachable by one SNV</span>
      </div>

      <div className="flex font-mono text-[10px] h-4 text-cs-text-muted" style={{ paddingLeft: GUTTER }} aria-hidden="true">
        {cols.map(({ pos }) => (
          <span key={pos} className={`shrink-0 text-center ${pos === target.pos ? "font-bold text-cs-accent-clay" : ""}`} style={{ width: colW }}>
            {pos % 5 === 0 || pos === target.pos ? pos : ""}
          </span>
        ))}
      </div>

      <div className="flex items-center">
        <span className="ls-gutter" style={{ width: GUTTER }}>DOMAIN</span>
        <div className="relative h-[14px] shrink-0" style={{ width: cols.length * colW }}>
          {visibleDomains.length === 0 ? (
            <span className="text-[10px] text-cs-text-muted">none annotated in this window</span>
          ) : (
            visibleDomains.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className="ls-domain absolute top-[2px] overflow-hidden"
                style={{ left: d.from * colW + 1, width: (d.to - d.from + 1) * colW - 2 }}
                title={`${d.name} (${d.start}–${d.end})`}
              >
                <span className="px-1 text-[9px] leading-[10px] font-mono text-cs-text-primary truncate block">{d.name}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center">
        <span className="ls-gutter" style={{ width: GUTTER }}>RESIDUE</span>
        {cols.map(({ aa, pos }) => {
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
              style={{ width: colW }}
              onClick={() => onPickResidue(pos)}
              onMouseEnter={hover(pos)}
              onMouseLeave={hover(null)}
              onFocus={hover(pos)}
              onBlur={hover(null)}
              aria-label={label}
              title={label}
            >
              {aa}
            </button>
          );
        })}
      </div>

      <div className="flex items-end">
        <span className="ls-gutter self-center" style={{ width: GUTTER }}>PHYLOP</span>
        {cols.map(({ pos }) => {
          const row = rows.get(pos);
          const v = row?.phylop ?? null;
          const level = conservationLevel("phylop", v);
          const label =
            v === null
              ? `Residue ${pos}: no phyloP`
              : `Residue ${pos}: phyloP ${v.toFixed(2)}${row?.gerp != null ? `, GERP++ ${row.gerp.toFixed(2)}` : ""} (codon mean over ${row?.nucleotideCount ?? 0} nt)` +
                (pos === target.pos && variantScores.phylop !== null ? ` · variant nucleotide phyloP ${variantScores.phylop.toFixed(2)}` : "");
          return (
            <span key={pos} className="shrink-0 h-[20px] flex items-end justify-center" style={{ width: colW }} title={label} aria-label={label} role="img">
              <span
                className="ls-cons block rounded-t-sm"
                data-level={level ?? "none"}
                style={{ width: colW - 8, height: v === null ? 2 : 3 + 15 * Math.min(1, Math.max(0, (v + 2) / 12)) }}
              />
            </span>
          );
        })}
      </div>

      <div className="flex flex-col gap-px mt-1" role="group" aria-label={`Substitution heatmap, ${TOOL_NAME[colorBy]}: one row per substituted amino acid, one column per residue`}>
        {HEATMAP_AA_ORDER.map(heatmapRow)}
      </div>

      <div className="flex items-center mt-1">
        <span className="ls-gutter" style={{ width: GUTTER }}>{statWord.toUpperCase()} (n≤9)</span>
        {cols.map(({ pos }) => {
          const row = rows.get(pos);
          const v = residueSummary(row, colorBy, mode);
          const n = residueCount(row, colorBy);
          const pending = loadingWindow && !row;
          const label =
            v === null
              ? `Residue ${pos}: ${pending ? "loading" : `no ${TOOL_NAME[colorBy]} score`}`
              : `Residue ${pos} ${TOOL_NAME[colorBy]} ${statWord} ${f3(v)} over ${n} SNV-reachable substitution${n === 1 ? "" : "s"} · band ${bandLabel(colorBy, v)} (orientation only)` +
                (pos === target.pos ? ` · this variant ${colorBy === "revel" ? variantScores.revel?.toFixed(3) ?? "—" : variantScores.am?.toFixed(3) ?? "—"}` : "");
          return (
            <button
              key={pos}
              type="button"
              className="ls-cell ls-band !h-[22px]"
              data-band={bandKey(colorBy, v) ?? "none"}
              data-focus={pos === target.pos ? "target" : undefined}
              style={{ width: colW }}
              onClick={() => onPickResidue(pos)}
              aria-label={label}
              title={label}
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
