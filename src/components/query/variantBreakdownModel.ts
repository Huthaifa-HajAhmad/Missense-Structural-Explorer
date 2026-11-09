/**
 * variantBreakdownModel.ts — what the query card says about the variant, derived once.
 *
 * Before a run, the card reads only what was typed. Once a run starts it fills in, field by field, from the
 * analysis result: the resolved gene, the protein change and its residue, the transcript and its tier, the
 * build and locus, and which numbering the residue numbers follow. Every cell has a fixed place, so the grid
 * is as tall when the run starts as when it ends and nothing moves as values arrive (a long tag or caption can
 * still wrap and add a line at a narrow width).
 *
 * It reuses the header's transcript and locus reading and the numbering policy, so this card, the top bar and
 * the Population rail cannot disagree about a transcript tier, a build or a notation.
 *
 * Pure: it renders nothing and reads no store.
 */
import type { AnalysisResult } from "../../types";
import { ASSEMBLY_LABELS } from "../../shared/assembly";
import { variantNumberingView } from "../../shared/numbering";
import { parseVariantCoordinate, type VariantCoordinate } from "../../shared/variantCoordinate";
import { buildVariantHeaderModel } from "../header/variantHeaderModel";
import { buildAssemblyLiftNote } from "../inspector/assemblyLiftNote";

export type BreakdownTone = "good" | "clay" | "warn" | "muted";

export interface BreakdownCell {
  id: "gene" | "change" | "residue" | "uniprot" | "transcript" | "build" | "coordinate" | "numbering";
  label: string;
  /** Null while `state` is `pending` (still resolving) or `absent` (the finished run did not report it). */
  value: string | null;
  state: "known" | "pending" | "absent";
  sub: string | null;
  tag: { label: string; tone: BreakdownTone } | null;
  title: string | null;
}

export interface BreakdownNote {
  id: "input" | "transcript" | "build";
  tone: "info" | "warn";
  text: string;
}

export interface VariantBreakdown {
  cells: BreakdownCell[];
  notes: BreakdownNote[];
  /** How far the reading has got: cells holding a value, cells a finished run left empty, and all cells. */
  progress: { known: number; absent: number; total: number };
}

export interface BreakdownInput {
  /**
   * What the reader typed (the line's parsed fields). `resolvedChange` is the protein change an earlier run of this
   * exact notation resolved to, when this session has one; nothing is guessed from the text.
   */
  typed: { gene: string; change: string; uniprot: string; resolvedChange?: string | null };
  /** The result of THIS query's run, or null before it has produced one. */
  result: AnalysisResult | null;
  /** The run is over: a field it did not report is absent, not still on its way. */
  settled: boolean;
}

/** A protein substitution, or null for anything else (a coordinate, a cDNA, nothing). */
function readProtein(notation: string): VariantCoordinate | null {
  try {
    return parseVariantCoordinate(notation);
  } catch {
    return null;
  }
}

export function buildVariantBreakdown({ typed, result, settled }: BreakdownInput): VariantBreakdown {
  const meta = result?.metadata;
  const header = result && meta
    ? buildVariantHeaderModel({ gene: meta.gene, variant: meta.variant, uniprotId: meta.uniprotId, analysisResult: result })
    : null;
  const missing: BreakdownCell["state"] = settled ? "absent" : "pending";
  const make = (
    id: BreakdownCell["id"],
    label: string,
    value: string | null | undefined,
    extra: Partial<Pick<BreakdownCell, "sub" | "tag" | "title">> = {},
  ): BreakdownCell => ({
    id, label, value: value || null, state: value ? "known" : missing,
    sub: extra.sub ?? null, tag: extra.tag ?? null, title: extra.title ?? null,
  });

  const known = typed.resolvedChange?.trim() || null;
  const modelled = readProtein(meta?.variant ?? known ?? typed.change);
  const typedGene = typed.gene.trim().toUpperCase();

  // The protein change leads with the notation the lab reported; a coordinate typed in says where it came from.
  const typedChange = typed.change.trim();
  const change = header?.headlineVariant || known || typedChange;
  const resolvedOrRun = Boolean(result || known);
  const changeSub = [
    modelled && resolvedOrRun ? modelled.hgvsp1.replace(/^p\./, "") : null,
    resolvedOrRun && typedChange && !readProtein(typedChange) ? `read from ${typedChange}` : null,
  ].filter(Boolean).join(" · ");

  const length = meta?.sequence?.length || null;
  const position = meta?.residueIndex ?? modelled?.pos ?? null;
  const residue = position ? `${position}${length ? ` of ${length}` : ""}` : null;

  const isoform = result?.uniprotIsoform;
  const accession = meta?.uniprotId || typed.uniprot.trim().toUpperCase();

  const transcript = header?.transcript ?? null;
  const ensembl = result?.transcriptId ?? null;
  const transcriptSub = transcript && ensembl && transcript.id !== ensembl ? `Ensembl ${ensembl}` : null;

  const submitted = result?.assembly ?? null;
  const build = result?.resolvedAssembly ?? submitted ?? header?.coordinate?.assemblyKey ?? null;
  const buildSub = build && submitted && submitted !== build ? `submitted as ${ASSEMBLY_LABELS[submitted]}` : null;

  /**
   * A protein notation typed as it is has no numbering basis from the server, but the run carries the protein
   * sequence, so the numbering can still be checked: the substituted residue must be the one written at that position.
   */
  const atSite = position && meta?.sequence ? meta.sequence[position - 1] : null;
  const siteCheck = modelled && atSite
    ? atSite === modelled.wt1
      ? make("numbering", "Numbering", "Canonical", {
          sub: `${modelled.wt3} at ${position} in ${accession}`, tag: { label: "checked", tone: "good" },
        })
      : make("numbering", "Numbering", "Mismatch", {
          sub: `${accession} has ${atSite} at ${position}, not ${modelled.wt1}`, tag: { label: "check", tone: "warn" },
        })
    : null;
  const numbering = meta
    ? variantNumberingView({ variant: meta.variant, uniprotId: meta.uniprotId, numberingRemap: result?.numberingRemap ?? null })
    : null;
  const basis = result?.numberingBasis;
  const numberingCell = basis === "remapped" || numbering?.remapped
    ? make("numbering", "Numbering", "Renumbered", {
        sub: numbering?.reported ? `reported ${numbering.reported}, modelled ${numbering.modelled}` : null,
        title: numbering?.basisNote ?? null,
      })
    : basis === "unverified"
      ? make("numbering", "Numbering", "Unverified", {
          // The transcript warning under the grid already says why; the reason is repeated only when it stands alone.
          sub: result?.transcriptWarning ? null : result?.numberingUnverifiedReason ?? null,
          tag: { label: "check", tone: "warn" },
        })
      : basis === "canonical"
        ? make("numbering", "Numbering", "Canonical", { tag: { label: "verified", tone: "good" } })
        : siteCheck ?? make("numbering", "Numbering", null);

  const cells: BreakdownCell[] = [
    make("gene", "Gene", meta?.gene || typedGene, {
      sub: result?.geneSymbolUpdated ? `was ${result.geneSymbolUpdated.from}` : null,
    }),
    make("change", "Protein change", change, { sub: changeSub || null }),
    make("residue", "Residue", residue, { sub: modelled ? `${modelled.wt3} → ${modelled.mut3}` : null }),
    make("uniprot", "UniProt", accession, { sub: isoform && isoform !== accession ? `isoform ${isoform}` : null }),
    make("transcript", "Transcript", transcript?.id, {
      sub: transcriptSub,
      tag: transcript?.tier.label ? { label: transcript.tier.label, tone: transcript.tier.tone } : null,
      title: transcript?.title,
    }),
    make("build", "Build", build ? ASSEMBLY_LABELS[build] : null, { sub: buildSub }),
    make("coordinate", "Genomic coordinate", header?.coordinate?.id, { title: header?.coordinate?.title }),
    numberingCell,
  ];

  const liftNote = buildAssemblyLiftNote(result);
  const notes: BreakdownNote[] = [];
  if (result?.inputResolution) notes.push({ id: "input", tone: "info", text: result.inputResolution.note });
  if (result?.transcriptWarning) notes.push({ id: "transcript", tone: "warn", text: result.transcriptWarning });
  if (liftNote) notes.push({ id: "build", tone: result?.coordinateLift?.status === "unavailable" ? "warn" : "info", text: liftNote });

  const count = (state: BreakdownCell["state"]) => cells.filter(cell => cell.state === state).length;
  return { cells, notes, progress: { known: count("known"), absent: count("absent"), total: cells.length } };
}
