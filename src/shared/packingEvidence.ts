/**
 * packingEvidence.ts — the FoldX "Packing & geometry" readings for the Energetics tab.
 *
 * ONE QUESTION: what changed in the modelled protein structure when FoldX built the substitution?
 * The answer is a set of physical readings on the mutant model: two energy components of ΔΔG (Van der
 * Waals clash and electrostatics), neighbour side-chain RMSD, heavy-atom clash and contact counts, and
 * the site's surface-area change. None of them is stability (that is the ΔΔG on the same tab) and none
 * is an ACMG input.
 *
 * INVARIANTS
 *   • Absence is a state. A failed RMSD is not 0.00 Å, a missing contact count is not 0, and a Cα
 *     displacement on FoldX's rigid backbone is not a measurement (it is identical by construction).
 *   • Every drawn mark says what it is. The FoldX VdW 2.0 kcal/mol mark is app-defined, so it is `local`.
 *   • Physical terms are components of ΔΔG, not stability.
 *   • No red or green: nothing here is an ACMG code.
 *
 * These readings used to sit on the Structural perturbation tab beside protein-language-model scores.
 * That tab was retired on 2026-11-18 (doc/PROTEIN_LANGUAGE_MODELS_DECISION.md); the physical readings
 * moved here unchanged.
 */
import { ENGINE_STATE_LABELS } from "./engineStatus";
import { THRESHOLDS, LOCAL_STRUCTURAL_WINDOW, STRUCTURE_COLOUR_BANDS } from "./thresholds/constants";

export type ReadingTone = "neutral" | "muted" | "warning" | "accent";

export type AvailabilityState = "computed" | "pending" | "failed" | "absent";

export interface ReadingAvailability {
  state: AvailabilityState;
  /** From ENGINE_STATE_LABELS — never a hand-written status word. */
  label: string;
  reason: string | null;
}

export interface Mark {
  value: number;
  label: string;
}

export interface PhysicalReading {
  key: "vdw" | "elec" | "neighbour-rmsd" | "clash" | "ca-max" | "contacts" | "sasa";
  name: string;
  description: string;
  value: number | null;
  text: string;
  unit: string | null;
  /** Display axis, for readings drawn on a ruler. */
  scale: { min: number; max: number } | null;
  marks: Mark[];
  markKind: "local" | "none";
  call: { label: string; tone: ReadingTone } | null;
  note: string | null;
  availability: ReadingAvailability;
}

export interface PackingEvidence {
  /** The FoldX leg: still running, failed, never built, or built ("computed"). */
  state: AvailabilityState;
  rigidBackbone: boolean;
  /** How the mutant model was built, in one line, when the caller recorded it. */
  method: string | null;
  /**
   * pLDDT of the analysed AlphaFold model at the site, with its AlphaFold DB band: geometry built on
   * a low-confidence region describes the model more than the protein. Null for experimental structures.
   */
  inputConfidence: { plddt: number; band: string | null } | null;
  /** Heavy-atom clash counts in each model, for a paired figure; null without a structural comparison. */
  clashCounts: { wt: number; mut: number } | null;
  /** Site contacts the substitution loses and gains; null without a contact comparison. */
  contactChange: { lost: number; gained: number } | null;
  runs: number | null;
  runsIdentical: boolean;
  readings: PhysicalReading[];
  reason: string | null;
}

export interface PackingEvidenceInput {
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
  isFolding?: boolean;
  /** The FoldX leg's settled state and error, so a failed run is not reported as "not built". */
  foldingStatus?: "success" | "failed" | "unavailable" | null;
  foldingError?: string | null;
  /** The analysed residue's site record (`result.disruptionPredictor`): its pLDDT and what kind of B-factor it is. */
  site?: { plddt?: number | null; bFactorKind?: string | null } | null;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "+0.26", "−3.02": a signed number with a true minus sign. */
export const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const computed = (): ReadingAvailability => ({ state: "computed", label: ENGINE_STATE_LABELS.computed, reason: null });

/** AlphaFold DB's published band for a pLDDT value (exclusive lower edges, as Mol* draws them). */
function plddtBand(v: number): string | null {
  return STRUCTURE_COLOUR_BANDS.plddt.find(b => v > b.min)?.label ?? null;
}

function absent(reason: string): ReadingAvailability {
  return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason };
}

/** Why there is no FoldX model, resolved in the order the Energetics engine outcome uses. */
function foldxAbsenceReason(fe: any, isFolding: boolean, status?: string | null, error?: string | null): string {
  if (isFolding) return "FoldX is still modelling the mutant.";
  if (fe?.foldxBinaryMissing) return "FoldX is not installed on this server.";
  if (fe?.foldxRepairFailed) return "FoldX could not repair the template structure, so no mutant model was built.";
  if (status === "failed" || error) return `The FoldX run failed${error ? `: ${String(error).trim().replace(/\.$/, "")}` : ""}.`;
  if (status === "unavailable") return "FoldX is not configured on this deployment.";
  return "No FoldX mutant model was built for this variant.";
}

/** The Packing & geometry readings for one FoldX run, or the reason there are none. */
export function buildPackingEvidence({
  foldingEnergetics: fe,
  structuralDiff: diff,
  metrics,
  isFolding = false,
  foldingStatus,
  foldingError,
  site
}: PackingEvidenceInput): PackingEvidence {
  const hasFe = Boolean(fe) && (finite(fe.vdw) !== null || finite(fe.electrostatics) !== null);
  // Stated by the caller that built the pair; a zero RMSD is the fallback for snapshots that predate it.
  const buildModel = diff?.mutantModel === "foldx-buildmodel";
  const rigid = buildModel || (Boolean(diff) && finite(diff.rmsd) === 0);
  const method = buildModel
    ? "FoldX BuildModel: the wild-type backbone is kept and side chains near the site are repacked"
    : rigid
      ? "Backbone positions identical in both models (RMSD 0); how the mutant was built was not recorded"
      : null;
  const sitePlddt = site?.bFactorKind === "plddt" ? finite(site?.plddt) : null;
  const inputConfidence = sitePlddt !== null ? { plddt: sitePlddt, band: plddtBand(sitePlddt) } : null;
  const raw = Array.isArray(fe?.rawDdGs) ? fe.rawDdGs.filter((v: unknown) => finite(v) !== null) : [];
  const runs = raw.length > 0 ? raw.length : finite(fe?.structureProvenance?.foldxRuns);
  const sd = finite(fe?.foldxSd);
  const runsIdentical = (runs ?? 0) > 1 && sd !== null && sd < 0.001;

  if (!hasFe && !diff && !metrics) {
    return {
      state: isFolding ? "pending" : foldingStatus === "failed" || foldingError ? "failed" : "absent",
      rigidBackbone: false,
      method: null,
      inputConfidence,
      clashCounts: null,
      contactChange: null,
      runs: null,
      runsIdentical: false,
      readings: [],
      reason: foldxAbsenceReason(fe, isFolding, foldingStatus, foldingError)
    };
  }

  const vdw = finite(fe?.vdw);
  const clashMark = THRESHOLDS.vdwClash.significantClash;
  const elec = finite(fe?.electrostatics);
  const nRmsd = finite(fe?.localSidechainRmsd);
  const clash = finite(diff?.clashes?.diff);
  const disps: number[] = Array.isArray(diff?.windowDisplacements)
    ? diff.windowDisplacements.map((d: any) => finite(d?.displacement)).filter((v: number | null): v is number => v !== null)
    : [];
  const caMax = disps.length > 0 ? Math.max(...disps) : null;
  const lost = finite(metrics?.lostContacts);
  const gained = finite(metrics?.gainedContacts);
  const dSasa = finite(metrics?.deltaSasa);

  const pending = isFolding ? { state: "pending" as const, label: ENGINE_STATE_LABELS.running, reason: null } : null;

  const readings: PhysicalReading[] = [
    {
      key: "vdw",
      name: "Van der Waals clash term",
      description: "FoldX Van der Waals clash energy, mutant − wild type. One component of ΔΔG.",
      value: vdw,
      text: vdw !== null ? signed(vdw, 2) : "—",
      unit: "kcal/mol",
      scale: { min: -1, max: Math.max(4, vdw !== null ? Math.ceil(vdw + 0.5) : 4) },
      marks: [{ value: clashMark, label: `${clashMark.toFixed(1)} kcal/mol · local clash mark` }],
      markKind: "local",
      call: vdw === null ? null : vdw > clashMark
        ? { label: "Above clash mark", tone: "warning" }
        : { label: "Below clash mark", tone: "neutral" },
      note: runs ? `Mean of ${runs} BuildModel run${runs === 1 ? "" : "s"}` : null,
      availability: vdw !== null ? computed() : pending ?? absent("FoldX returned no energy terms.")
    },
    {
      key: "elec",
      name: "Electrostatics term",
      description: "FoldX electrostatic energy, mutant − wild type. One component of ΔΔG.",
      value: elec,
      text: elec !== null ? signed(elec, 2) : "—",
      unit: "kcal/mol",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: elec !== null ? computed() : pending ?? absent("FoldX returned no energy terms.")
    },
    {
      key: "neighbour-rmsd",
      name: "Neighbour side-chain RMSD",
      description: `Side-chain heavy atoms of residues within ±${LOCAL_STRUCTURAL_WINDOW} of the site after local backbone superposition — how differently the neighbours pack in the variant model.`,
      value: nRmsd,
      text: nRmsd !== null ? nRmsd.toFixed(2) : "—",
      unit: "Å",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      // The run's own wild type isolates the substitution; the input template also carries RepairPDB's moves.
      note:
        nRmsd === null
          ? null
          : fe?.localSidechainRmsdReference === "foldx-paired"
            ? "Against FoldX's paired wild type from the same run"
            : "Against the template before RepairPDB, so the repair's side-chain moves are included",
      availability: nRmsd !== null ? computed() : pending ?? absent("Not measured for this model.")
    },
    {
      key: "clash",
      name: "Atomic clash count",
      description: "Heavy-atom clashes in the mutant model minus the wild type.",
      value: clash,
      text: clash !== null ? (clash > 0 ? `+${clash}` : String(clash)) : "—",
      unit: null,
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: diff?.clashes ? `${diff.clashes.wtClashCount} → ${diff.clashes.mutClashCount}` : null,
      availability: clash !== null ? computed() : pending ?? absent("No structural comparison was run.")
    },
    {
      key: "ca-max",
      name: "Max Cα displacement",
      description: `Largest Cα shift within ±${LOCAL_STRUCTURAL_WINDOW} residues after superposition.`,
      value: rigid ? null : caMax,
      text: !rigid && caMax !== null ? caMax.toFixed(2) : "—",
      unit: "Å",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: rigid
        ? { state: "absent", label: "Not measured", reason: "FoldX builds the mutant on the wild-type backbone, so Cα positions are identical by construction. A zero here would describe the method, not the protein." }
        : caMax !== null ? computed() : pending ?? absent("No structural comparison was run.")
    },
    {
      key: "contacts",
      name: "Residue contacts",
      description: "Residues with a heavy atom within 4 Å of the site (±1 neighbours excluded), lost / gained.",
      value: lost !== null && gained !== null ? gained - lost : null,
      text: lost !== null && gained !== null ? `−${lost} / +${gained}` : "—",
      unit: null,
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: lost !== null && gained !== null ? `Net ${gained - lost > 0 ? "+" : gained - lost < 0 ? "−" : ""}${Math.abs(gained - lost)}` : null,
      availability: lost !== null && gained !== null ? computed() : pending ?? absent("No contact comparison was run.")
    },
    {
      key: "sasa",
      name: "Residue SASA change",
      description: "Absolute solvent-accessible area of the site residue, mutant − wild type. Tracks side-chain size as much as exposure.",
      value: dSasa,
      text: dSasa !== null ? signed(dSasa, 1) : "—",
      unit: "Å²",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: dSasa !== null ? computed() : pending ?? absent("No surface-area comparison was run.")
    }
  ];

  const wtClashes = finite(diff?.clashes?.wtClashCount);
  const mutClashes = finite(diff?.clashes?.mutClashCount);
  return { state: "computed", rigidBackbone: rigid, method, inputConfidence,
    clashCounts: wtClashes !== null && mutClashes !== null ? { wt: wtClashes, mut: mutClashes } : null,
    contactChange: lost !== null && gained !== null ? { lost, gained } : null,
    runs: runs ?? null, runsIdentical, readings, reason: null };
}
