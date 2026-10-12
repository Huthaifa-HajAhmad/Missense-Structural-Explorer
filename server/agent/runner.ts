/**
 * runner.ts — run one claimed job on this computer, with the same code the server runs (plan 0.1).
 *
 * Only the two typed job kinds exist. The payload is DATA: structure text is written to a file, the
 * mutation and residue are checked against strict patterns and passed as arguments, nothing from the
 * server is ever executed as a command (plan F2). Each job gets its own scratch folder, removed when it
 * ends however it ends; an abort (lease lost, paused, the deadline) kills the tool's whole process tree,
 * which the runners already do for the server.
 *
 * The outcome is either a result to send, or a reason to give the job back to the server.
 */
import fs from "fs";
import path from "path";
import { generateMutantPdbInternal, type FoldxOptions } from "../services/stability/foldx/runner.ts";
import { findBindingPocketInternal } from "../services/structure/pocket/runner.ts";
import { ProcessTreeSampler } from "../services/infra/process-sampler.ts";
import { runInJobMeter } from "../services/infra/job-meter.ts";
import { classifyJobFailure } from "../services/infra/failure-class.ts";
import type { AgentFailureClass } from "../services/infra/agent-jobs.ts";
import { paths } from "./state.ts";
import type { ClaimedJob } from "./client.ts";

export type JobOutcome =
  | { kind: "result"; result: unknown; wallMs: number; peakRssBytes: number | null }
  | { kind: "fail"; errorClass: AgentFailureClass; message: string; wallMs: number; peakRssBytes: number | null };

export class PayloadError extends Error {}

const MUTATION = /^[A-Za-z][A-Za-z0-9][0-9]{1,6}[A-Za-z]$/;
const UNIPROT = /^[A-Za-z0-9_.-]{1,30}$/;

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/**
 * The FoldX conditions, taken field by field: anything else in `options` is ignored. A condition that is
 * present but out of range refuses the job (it goes to the server) rather than silently running FoldX's
 * default: the server files the result under the conditions the job asked for, so they must be the ones run.
 */
export function foldxOptionsFrom(raw: unknown): FoldxOptions & { seed: number } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const field = (name: string, min: number, max: number): number | undefined => {
    if (o[name] == null) return undefined;
    const v = num(o[name], min, max);
    if (v === undefined) throw new PayloadError(`the FoldX condition ${name} is out of range`);
    return v;
  };
  return {
    pH: field("pH", 0, 14),
    temperature: field("temperature", 200, 400),
    ionicStrength: field("ionicStrength", 0, 5),
    // The same default the server's cached wrapper applies, so a computer's run is the server's run.
    seed: field("seed", 0, 2 ** 31) ?? 12345,
  };
}

/** Check a claimed job's payload; throws `PayloadError` with the reason. */
export function checkPayload(job: ClaimedJob): void {
  const p = job.payload ?? {};
  if (job.type === "foldx") {
    if (typeof p.wtPdb !== "string" || p.wtPdb.length < 50 || p.wtPdb.length > 12 * 1024 * 1024) throw new PayloadError("the structure is missing or too large");
    if (typeof p.mutation !== "string" || !MUTATION.test(p.mutation)) throw new PayloadError("the mutation code is not valid");
    if (p.uniprotId != null && (typeof p.uniprotId !== "string" || !UNIPROT.test(p.uniprotId))) throw new PayloadError("the protein id is not valid");
    foldxOptionsFrom(p.options);
    return;
  }
  if (job.type === "p2rank") {
    if (typeof p.pdbText !== "string" || p.pdbText.length < 50 || p.pdbText.length > 12 * 1024 * 1024) throw new PayloadError("the structure is missing or too large");
    if (!Number.isInteger(p.mutIndex) || p.mutIndex < -9999 || p.mutIndex > 99999) throw new PayloadError("the residue number is not valid");
    if (p.targetChain != null && p.targetChain !== "" && (typeof p.targetChain !== "string" || !/^[A-Za-z0-9]$/.test(p.targetChain))) throw new PayloadError("the chain is not valid");
    return;
  }
  throw new PayloadError(`unknown job kind`);
}

/** Why a failed run failed, in the protocol's words. */
export function failureClassOf(err: any, aborted: boolean): AgentFailureClass {
  const message = String(err?.message ?? err ?? "");
  if (aborted) return "aborted";
  if (/FoldX binary not found|parameter files missing|cannot be executed|ENOENT|not installed/i.test(message)) return "tool_missing";
  if (/not found in the PDB structure|Mutation mismatch|Invalid mutation code/i.test(message)) return "input";
  const c = classifyJobFailure(err);
  if (c === "oom") return "oom";
  if (c === "timeout") return "timeout";
  return "tool_failed";
}

export async function runJob(
  job: ClaimedJob,
  opts: { signal: AbortSignal; onPhase?: (phase: string) => void | Promise<void> },
): Promise<JobOutcome> {
  const started = Date.now();
  const meter = new ProcessTreeSampler();
  const jobDir = path.join(paths.scratch(), job.id.replace(/[^A-Za-z0-9_-]/g, "_"));
  // The job's own deadline, as the server's queue enforces its cap.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.max(1000, job.deadlineMs));
  const signal = AbortSignal.any([opts.signal, deadline.signal]);
  try {
    checkPayload(job);
    await fs.promises.mkdir(jobDir, { recursive: true });
    const result = await runInJobMeter(meter, async () => {
      const p = job.payload;
      if (job.type === "foldx") {
        return generateMutantPdbInternal(p.wtPdb, p.mutation, p.uniprotId ?? undefined, jobDir, signal, foldxOptionsFrom(p.options), (phase) => opts.onPhase?.(phase));
      }
      const pocket = await findBindingPocketInternal(p.pdbText, p.mutIndex, jobDir, p.targetChain || undefined, signal);
      // fpocket's fallback, or no tool at all, is not P2Rank's answer: the server runs the job instead.
      if (pocket.status === "unavailable" || pocket.status === "fallback" || (pocket.status === "success" && pocket.provenance?.engine !== "p2rank")) {
        throw Object.assign(new Error("P2Rank did not produce this result on this computer"), { agentClass: "tool_failed" as const });
      }
      return pocket;
    });
    if (signal.aborted) throw new Error("Aborted");
    return { kind: "result", result, wallMs: Date.now() - started, peakRssBytes: await meter.stop() };
  } catch (err: any) {
    const peakRssBytes = await meter.stop();
    if (err instanceof PayloadError) return { kind: "fail", errorClass: "input", message: err.message, wallMs: Date.now() - started, peakRssBytes };
    const errorClass: AgentFailureClass = deadline.signal.aborted ? "timeout" : (err?.agentClass ?? failureClassOf(err, opts.signal.aborted));
    return { kind: "fail", errorClass, message: String(err?.message ?? err).slice(0, 400), wallMs: Date.now() - started, peakRssBytes };
  } finally {
    clearTimeout(timer);
    await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
