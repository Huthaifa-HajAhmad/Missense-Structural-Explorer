/**
 * agent-results.ts — `validateAgentResult`: a paired computer's result is untrusted input.
 *
 * A person's own computer runs the same code the server runs (plan 0.1), but what reaches the server is
 * whatever the machine sent: a modified agent, a broken tool install or a bug can all produce a result that
 * looks fine and is wrong. Before an agent result may complete a job, and long before it may be served to
 * anyone else from the shared cache (`mayServe`, src/shared/computeProvenance.ts), it must pass:
 *
 *   1. Schema (zod): only the fields the server stores, bounded sizes. Unknown keys are dropped, never
 *      stored, so a field a newer runner adds is lost rather than failing every computer's result.
 *   2. Sanity: every number finite and inside a physical range.
 *   3. Identity: the result is FOR the job that was handed out. For FoldX, the mutant structure carries
 *      the requested substitution at the requested residue and keeps the template's residues; for P2Rank,
 *      the engine and status are ones the server itself would store.
 *   4. Tool version: well formed, and on the admin's allow-list when one is configured.
 *
 * A failure returns the reasons; the caller marks the attempt `invalid_result` and hands the job to the
 * server once (plan 9). Nothing here throws on bad input.
 */
import { z } from "zod";
import { AMINO_ACID_1_TO_3 } from "../../../src/shared/aminoAcids.ts";
import { parseResiduesFromPdb } from "../structure/pdb-parser.ts";
import { cleanPdbForFoldX } from "../stability/foldx/pdb-utils.ts";
import { parseQueueMutation } from "../stability/foldx-queue-job.ts";

/** Largest structure text a result may carry. The submit routes accept 10 MB of PDB. */
const MAX_PDB_CHARS = 12 * 1024 * 1024;
/** FoldX ddG beyond this (kcal/mol) is not a measurement; real clashes stay well inside it. */
const MAX_ABS_DDG = 200;
/** Of the template's residues, at least this share must still be present in the mutant model. */
const MIN_RESIDUES_KEPT = 0.95;

const finite = z.number().finite();
const nullableFinite = finite.nullable().optional();
const versionPattern = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.]{1,24})?$/;

export const foldxAgentResultSchema = z
  .object({
    status: z.literal("success"),
    pdb: z.string().min(80).max(MAX_PDB_CHARS),
    wtReferencePdb: z.string().max(MAX_PDB_CHARS).nullable().optional(),
    ddG: finite.min(-MAX_ABS_DDG).max(MAX_ABS_DDG),
    sd: finite.min(0).max(MAX_ABS_DDG).nullable().optional(),
    foldedResidueIndex: z.number().int().min(-9999).max(99999),
    resolvedChain: z.string().regex(/^[A-Za-z0-9]$/).optional(),
    energetics: z
      .object({
        foldxMean: finite.min(-MAX_ABS_DDG).max(MAX_ABS_DDG),
        foldxSd: nullableFinite,
        vdw: nullableFinite,
        electrostatics: nullableFinite,
        stericClashWarning: z.boolean().nullable().optional(),
        rawDdGs: z.array(finite.min(-MAX_ABS_DDG).max(MAX_ABS_DDG)).max(50).optional(),
        seed: z.number().int().optional(),
        localSidechainRmsd: finite.min(0).max(100).nullable().optional(),
        localSidechainRmsdReference: z.enum(["foldx-paired", "template"]).optional(),
        foldxRepairFailed: z.boolean().optional(),
        foldxRepairSkipped: z.boolean().optional(),
        foldxRepairSkippedReason: z.string().max(300).optional(),
        foldxRepairCached: z.boolean().optional(),
        bFactorMetadata: z.unknown().optional(),
        rasp: z.null().optional(),
        raspReason: z.undefined().optional(),
        thermompnn: z.null().optional(),
        stabilityoracle: z.null().optional(),
      }),
  });

/** One pocket residue as the P2Rank runner writes it (pocket/runner.ts). */
const pocketResidue = z.object({
  index: z.number().int().min(-9999).max(99999),
  chain: z.string().max(4),
  name: z.string().max(8),
  distance: finite.min(0).max(1e4),
  score: finite.min(-1e3).max(1e3),
  role: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
});

export const p2rankAgentResultSchema = z
  .object({
    pocketResidues: z.array(pocketResidue).max(2000),
    pocketScore: finite.min(0).max(1000),
    pocketVolume: finite.min(0).max(1e7),
    likelyCofactor: z.string().max(200),
    status: z.enum(["success", "none_detected"]),
    pocketDistance: finite.min(0).max(1e4).nullable().optional(),
    sasPoints: z.number().int().min(0).max(1e7).optional(),
    surfaceAtoms: z.number().int().min(0).max(1e7).optional(),
    cavityCentreDistance: finite.min(0).max(1e4).nullable().optional(),
    provenance: z
      .object({
        engine: z.literal("p2rank"),
        scoreSource: z.enum(["probability", "rescaled_raw_score", "unavailable"]),
        volumeSource: z.enum(["measured", "unavailable"]),
        profile: z.string().max(40).optional(),
      })
      .optional(),
  });

export type AgentValidation = { ok: true; result: any } | { ok: false; reasons: string[] };

function issues(err: z.ZodError): string[] {
  return err.issues.slice(0, 5).map((i) => `${i.path.join(".") || "result"}: ${i.message}`);
}

/**
 * The versions an admin allows from agents, per tool: `AGENT_ACCEPTED_FOLDX_VERSIONS` and
 * `AGENT_ACCEPTED_P2RANK_VERSIONS`, comma-separated. Unset = any well-formed version (the version is
 * still part of the cache key, so two versions never share a result).
 */
export function acceptedToolVersions(tool: "foldx" | "p2rank"): string[] | null {
  const raw = process.env[tool === "foldx" ? "AGENT_ACCEPTED_FOLDX_VERSIONS" : "AGENT_ACCEPTED_P2RANK_VERSIONS"];
  const list = (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

export function toolVersionProblem(tool: "foldx" | "p2rank", version: unknown): string | null {
  if (typeof version !== "string" || !versionPattern.test(version)) return `the ${tool} version "${String(version).slice(0, 40)}" is not a version number`;
  const allowed = acceptedToolVersions(tool);
  if (allowed && !allowed.includes(version)) return `${tool} ${version} is not one of the versions this workspace accepts (${allowed.join(", ")})`;
  return null;
}

/**
 * Validate a computer's FoldX result against the job it was handed (`job.wtPdb`, `job.mutation`).
 * On success `result` is the parsed copy (extra keys stripped), safe to store.
 */
export function validateFoldxAgentResult(job: { wtPdb: string; mutation: string }, raw: unknown, toolVersion: unknown): AgentValidation {
  const reasons: string[] = [];
  const versionIssue = toolVersionProblem("foldx", toolVersion);
  if (versionIssue) reasons.push(versionIssue);

  const parsed = foldxAgentResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: [...reasons, ...issues(parsed.error)] };
  const r = parsed.data;

  const want = parseQueueMutation(job.mutation);
  if (!want.position || !want.mutAa || !want.wtAa) return { ok: false, reasons: [...reasons, "the job's mutation could not be read"] };
  if (r.foldedResidueIndex !== want.position) reasons.push(`the result is for residue ${r.foldedResidueIndex}, the job asked for ${want.position}`);
  if (r.resolvedChain && r.resolvedChain.toUpperCase() !== want.chain) reasons.push(`the result is for chain ${r.resolvedChain}, the job asked for chain ${want.chain}`);
  if (Math.abs(r.energetics.foldxMean - r.ddG) > 1e-6) reasons.push("ddG and the FoldX mean disagree");

  const chain = (r.resolvedChain ?? want.chain).toUpperCase();
  const mutant = parseResiduesFromPdb(r.pdb);
  if (mutant.length === 0) {
    reasons.push("the mutant structure contains no residues");
  } else {
    const site = mutant.find((x) => x.resSeq === want.position && x.chain.toUpperCase() === chain && !x.insCode);
    const expected = AMINO_ACID_1_TO_3[want.mutAa];
    if (!site) reasons.push(`the mutant structure has no residue ${want.position} on chain ${chain}`);
    else if (expected && site.resName3 !== expected) reasons.push(`residue ${want.position} in the mutant structure is ${site.resName3}, not ${expected}`);

    const template = parseResiduesFromPdb(cleanPdbForFoldX(job.wtPdb));
    const have = new Set(mutant.map((x) => `${x.chain}:${x.resSeq}${x.insCode}`));
    const kept = template.filter((x) => have.has(`${x.chain}:${x.resSeq}${x.insCode}`)).length;
    if (template.length > 0 && kept / template.length < MIN_RESIDUES_KEPT) {
      reasons.push(`the mutant structure keeps ${kept} of the template's ${template.length} residues`);
    }
  }

  if (r.wtReferencePdb) {
    const ref = parseResiduesFromPdb(r.wtReferencePdb).find((x) => x.resSeq === want.position && x.chain.toUpperCase() === chain && !x.insCode);
    const expectedWt = AMINO_ACID_1_TO_3[want.wtAa];
    if (ref && expectedWt && ref.resName3 !== expectedWt) reasons.push(`the paired wild type has ${ref.resName3} at residue ${want.position}, not ${expectedWt}`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, result: r };
}

/**
 * Validate a computer's P2Rank result against the job's structure. `none_detected` is a real answer; an
 * fpocket fallback is not P2Rank's. Identity: every pocket residue must exist in the job's structure with
 * the residue type named, so a result computed on (or invented for) another structure is refused.
 */
export function validateP2RankAgentResult(job: { pdbText: string }, raw: unknown, toolVersion: unknown): AgentValidation {
  const reasons: string[] = [];
  const versionIssue = toolVersionProblem("p2rank", toolVersion);
  if (versionIssue) reasons.push(versionIssue);
  const parsed = p2rankAgentResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: [...reasons, ...issues(parsed.error)] };
  if (parsed.data.status === "success" && parsed.data.provenance?.engine !== "p2rank") reasons.push("a pocket result must say P2Rank produced it");
  if (parsed.data.pocketResidues.length > 0) {
    const inStructure = new Map(parseResiduesFromPdb(job.pdbText).map((r) => [`${r.chain.toUpperCase()}:${r.resSeq}`, r.resName3.toUpperCase()]));
    const strangers = parsed.data.pocketResidues.filter((r) => inStructure.get(`${r.chain.toUpperCase()}:${r.index}`) !== r.name.toUpperCase());
    if (strangers.length > 0) {
      const first = strangers[0];
      reasons.push(`${strangers.length} pocket residue${strangers.length === 1 ? "" : "s"} (first: ${first.name} ${first.chain}${first.index}) are not in the job's structure`);
    }
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, result: parsed.data };
}
