import { LRUCache } from "lru-cache";
import { AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { UNMEASURED_BURIAL_ENVIRONMENT, classifyBurialRsa } from "../../../src/shared/burialEvidence.ts";
import { THRESHOLDS } from "../../../src/shared/thresholds/constants.ts";
import { fetchWithRetry } from "../external.ts";
import { extractSequenceFromPdb } from "../structure/pdb-parser.ts";
import { fetchUniprotSequence } from "./uniprot.ts";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { CONFIG } from "../../config.ts";

const execFileAsync = promisify(execFile);

export async function runSasaEval(
  pdbText: string,
  chain: string,
  pos: number
): Promise<{ rsa: number; sse: string; sasa: number } | null> {
  const tmpFile = path.join(os.tmpdir(), `sasa_eval_${crypto.randomUUID()}.pdb`);
  try {
    await fs.promises.writeFile(tmpFile, pdbText, "utf8");
    const scriptPath = path.join(process.cwd(), "tools", "sasa_eval.py");
    // Use the application-managed virtualenv in production.  `python -m uv` asks
    // the system Python for an uv module it does not own, which made this sidecar
    // fail even though the image already contained its Biopython dependencies.
    const venvPython = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");
    const useVenv = fs.existsSync(venvPython);
    const command = useVenv ? venvPython : "uv";
    const args = useVenv
      ? [scriptPath, tmpFile, chain, pos.toString()]
      : ["run", "--project", path.join(process.cwd(), "tools"), scriptPath, tmpFile, chain, pos.toString()];
    const { stdout } = await execFileAsync(command, args, { timeout: 15000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.status === "success") {
      return { rsa: parsed.rsa, sse: parsed.sse, sasa: parsed.sasa };
    }
  } catch (err: any) {
    console.warn(`[SASA-SSE-Eval] Failed to execute Python sidecar:`, err.message);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        await fs.promises.unlink(tmpFile);
      }
    } catch (_) {}
  }
  return null;
}


export interface ESM3StructureEvalResult {
  uniprotId: string;
  position: number;
  wtResidue: string;
  mutResidue: string;
  pdbText: string | null;
  perturbationScores: number[];
  maxDriftResidue: number;
  structuralChangeLevel: "none" | "minor" | "moderate" | "major";
  microenvironments: string[];
  putativeStructuralChanges: string[];
  confidence: {
    level: "high" | "moderate" | "low";
    plddt: number;
    sequenceCoverage: number;
  };
  provenance?: string;
  sasa?: { rsa: number; sse: string; sasa: number } | null;
  error?: string;
  status?: "ok" | "error" | "timeout" | "offline";
}

export const esm3StructureCache = new LRUCache<string, any>({
  max: 500,
  ttl: 24 * 60 * 60 * 1000 // 24 hours TTL
});

/**
 * HTTP budget for the sidecar `/predict/esm3` call.
 *
 * The sidecar answers ESM3 by deployment: with a BioHub token it runs ESM3-Medium remotely (two
 * encode + two logits round trips); without one it falls back to the local VESM-150M, which runs the
 * masked LLR pass PLUS two unmasked embedding passes to build the perturbation map. On a ~670-residue
 * protein that local path takes ~18s on CPU — past the flat 20s this call used to allow — so ESM3 was
 * aborted and reported as a failure while the run still had ~100s of its 120s structural budget left
 * (`CONFIG.timeouts.structuralModelsMs`). Scale the budget for long sequences rather than aborting work
 * the outer budget would have completed; the default is preserved for the ordinary-length case.
 */
const ESM3_SIDECAR_BUDGET_MS = (sequenceLength: number): number =>
  sequenceLength > 500 ? 60000 : 20000;

export async function fetchEsm3StructureEval(
  uniprotId: string,
  position: number,
  wtResidue: string,
  mutResidue: string,
  wtPdbText?: string | null,
  biohubToken?: string | null,
  sequenceOverride?: string | null,
  /**
   * What `wtPdbText` is. Its site B-factor is reported as `confidence.plddt` only for an AlphaFold
   * model; for an experimental entry it is a temperature factor, and the Perturbation tab was showing
   * it as "input confidence". Omitted: treated as before (older callers pass AlphaFold text).
   */
  wtStructureSource?: "alphafold" | "experimental" | null
): Promise<ESM3StructureEvalResult | null> {
  const cacheKey = `${uniprotId}:${position}:${wtResidue}:${mutResidue}`;
  const cached = esm3StructureCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const wt1 = wtResidue.length === 3 ? AMINO_ACID_3_TO_1[wtResidue.toUpperCase()] || wtResidue : wtResidue.toUpperCase();
  const mut1 = mutResidue.length === 3 ? AMINO_ACID_3_TO_1[mutResidue.toUpperCase()] || mutResidue : mutResidue.toUpperCase();

  const canonicalAAs = ["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"];
  if (!canonicalAAs.includes(wt1) || !canonicalAAs.includes(mut1)) {
    return null;
  }

  let pdbText: string | null = null;
  let perturbationScores: number[] = [];
  let seqLen = 300;
  let esm3Error: string | undefined;
  /** Set only when the sidecar failed, so a timeout is not reported as a generic error. */
  let esm3Status: "error" | "timeout" | undefined;

  let sequence = sequenceOverride || "";
  if (!sequence && wtPdbText) {
    try {
      const parsed = extractSequenceFromPdb(wtPdbText, "A");
      sequence = parsed.sequence;
    } catch (_) {}
  }

  if (!sequence && uniprotId) {
    try {
      const fetched = await fetchUniprotSequence(uniprotId);
      if (fetched) sequence = fetched;
    } catch (_) {}
  }

  // If still no sequence could be extracted, generate minimal sequence
  if (!sequence) {
    sequence = "M" + "A".repeat(Math.max(10, position + 20));
  }

  const tokenToUse = biohubToken || process.env.BIOHUB_API_TOKEN || null;
  const sidecarSecret = process.env.SIDECAR_SECRET || "";
  let provenance = "ESM3-Medium (Remote)";
  const sidecarBudgetMs = ESM3_SIDECAR_BUDGET_MS(sequence.length);

  try {
    const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/esm3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": sidecarSecret
      },
      body: JSON.stringify({
        sequence,
        position,
        wt: wt1,
        mut: mut1,
        biohubToken: tokenToUse,
        refine: false
      }),
      signal: AbortSignal.timeout(sidecarBudgetMs)
    });

    if (sidecarRes.ok) {
      const sidecarData = await sidecarRes.json() as any;
      if (sidecarData.status === "success" && Array.isArray(sidecarData.perturbationScores)) {
        perturbationScores = sidecarData.perturbationScores;
        if (sidecarData.refinedPdb) {
          pdbText = sidecarData.refinedPdb;
        }
        if (typeof sidecarData.provenance === "string") {
          provenance = sidecarData.provenance;
        }
      }
    } else {
      const txt = await sidecarRes.text();
      console.warn(`[ESM3 Sidecar API] Prediction call failed with status ${sidecarRes.status}: ${txt}`);
      esm3Error = `Sidecar API returned HTTP ${sidecarRes.status}: ${txt}`;
      esm3Status = "error";
    }
  } catch (err: any) {
    // A timeout is retryable and must not read as a generic failure. `AbortSignal.timeout` rejects
    // with a `TimeoutError` DOMException; older runtimes report `AbortError`.
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.warn("[ESM3 Sidecar API] Failed to run ESM3 structural evaluation:", err.message);
    esm3Error = timedOut
      ? `ESM3 structural perturbation timed out after ${Math.round(sidecarBudgetMs / 1000)}s (sidecar /predict/esm3)`
      : err.message;
    esm3Status = timedOut ? "timeout" : "error";
  }



  // Parse PDB for secondary structure, pLDDT, and SASA if wtPdbText is provided
  let isHelix = false;
  let isSheet = false;
  let meanPlddt: number | null = null;
  let targetPlddt: number | null = null;
  /** Whether `rsa` below is a measurement or the placeholder it is initialised to. */
  let hasMeasuredRsa = false;
  let rsa = 0.12; // placeholder only; not a measurement until the sidecar answers

  if (wtPdbText) {
    const sasaRes = await runSasaEval(wtPdbText, "A", position);
    if (sasaRes) {
      rsa = sasaRes.rsa;
      hasMeasuredRsa = true;
      isHelix = sasaRes.sse === "a";
      isSheet = sasaRes.sse === "b";
    }

    const lines = wtPdbText.split(/\r?\n/);
    let totalAtomB = 0;
    let atomCount = 0;
    let targetB = 0;
    let targetAtomCount = 0;

    for (const line of lines) {
      const record = line.slice(0, 6).trim();
      if (record === "ATOM") {
        const resNum = parseInt(line.slice(22, 26).trim(), 10);
        const atomName = line.slice(12, 16).trim();
        const bFactor = parseFloat(line.slice(60, 66).trim());

        if (atomName === "CA") {
          totalAtomB += bFactor;
          atomCount++;
          if (resNum === position) {
            targetB += bFactor;
            targetAtomCount++;
          }
        }
        if (resNum > seqLen) seqLen = resNum;
      }
      
      // Fallback geometric parsing if Python SASA execution failed
      if (!sasaRes) {
        if (line.startsWith("HELIX")) {
          const start = parseInt(line.substring(21, 25).trim());
          const end = parseInt(line.substring(33, 37).trim());
          if (position >= start && position <= end) isHelix = true;
        } else if (line.startsWith("SHEET")) {
          const start = parseInt(line.substring(22, 26).trim());
          const end = parseInt(line.substring(33, 37).trim());
          if (position >= start && position <= end) isSheet = true;
        }
      }
    }
    if (wtStructureSource !== "experimental") {
      if (atomCount > 0) meanPlddt = totalAtomB / atomCount;
      if (targetAtomCount > 0) targetPlddt = targetB / targetAtomCount;
    }
  }

  // If we could not retrieve real perturbation scores from the API, we return error to avoid fabricating data
  if (perturbationScores.length === 0) {
    const errorResult: { error: string; status?: "error" | "timeout" } = {
      error: esm3Error || "No perturbation scores returned by Biohub ESM3 API."
    };
    if (esm3Status) errorResult.status = esm3Status;
    // Do NOT cache API errors/failures so configuring keys can take immediate effect on retry
    return errorResult as any;
  }

  const maxVal = Math.max(...perturbationScores);
  const maxDriftResidue = perturbationScores.indexOf(maxVal) + 1;

  // 1. Predicted Local Structural Change
  // App-defined bands over an embedding distance — one copy, in src/shared/thresholds, so the tab
  // can draw the same marks it is classified against.
  const drift = THRESHOLDS.esm3Drift;
  let structuralChangeLevel: "none" | "minor" | "moderate" | "major" = "minor";
  if (maxVal < drift.none) structuralChangeLevel = "none";
  else if (maxVal < drift.minor) structuralChangeLevel = "minor";
  else if (maxVal < drift.moderate) structuralChangeLevel = "moderate";
  else structuralChangeLevel = "major";

  // 2. Microenvironment
  const microenvironments: string[] = [];
  /*
   * Banded by the app's single burial definition rather than by local 0.15 / 0.35
   * literals: those numbers disagreed with the SASA engine that produces
   * `burialStatus` for the same residue, so the perturbation panel and the Residue
   * Shifts panel could call one RSA value "Hydrophobic core" and "boundary".
   *
   * Only when accessibility was actually measured. `rsa` starts at a hard-coded 0.12
   * ("default core") and stays there whenever the sidecar does not run — which is the common
   * case — so the panel used to assert "Hydrophobic core" for every variant with no structure
   * or SASA at all, and the perturbation rules below then reasoned about core packing on the
   * strength of that placeholder.
   */
  const burialBand = hasMeasuredRsa ? classifyBurialRsa(rsa) : null;
  if (burialBand === "core") microenvironments.push("Hydrophobic core");
  else if (burialBand === "surface") microenvironments.push("Surface");
  else if (burialBand === "boundary") microenvironments.push("Binding pocket");
  // The shared string, not a literal: the Perturbation tab's chips key their "this is an
  // absence, not a finding" styling off it.
  else microenvironments.push(UNMEASURED_BURIAL_ENVIRONMENT);

  if (isHelix) microenvironments.push("Alpha-Helix");
  else if (isSheet) microenvironments.push("Beta-Sheet");
  else microenvironments.push("Loop / Flexible Turn");

  // 3. Putative Structural Changes
  const putativeStructuralChanges: string[] = [];
  const largeResidues = ["W", "F", "Y", "R", "K"];
  const smallResidues = ["A", "G", "S", "C"];
  const positiveResidues = ["R", "K", "H"];
  const negativeResidues = ["D", "E"];

  if (mut1 === "P" && (isHelix || isSheet)) {
    putativeStructuralChanges.push("Proline-induced backbone disruption in structured domain");
  }
  if (wt1 === "G" && mut1 !== "G") {
    putativeStructuralChanges.push("Glycine flexibility loss at conformational hinge");
  }
  if ((positiveResidues.includes(wt1) && negativeResidues.includes(mut1)) || (negativeResidues.includes(wt1) && positiveResidues.includes(mut1))) {
    putativeStructuralChanges.push("Electrochemical charge reversal at local interface");
  }
  if (smallResidues.includes(wt1) && largeResidues.includes(mut1) && microenvironments.includes("Hydrophobic core")) {
    putativeStructuralChanges.push("Steric clash & volume expansion in buried core");
  }
  if (largeResidues.includes(wt1) && smallResidues.includes(mut1) && microenvironments.includes("Hydrophobic core")) {
    putativeStructuralChanges.push("Loss of hydrophobic packing volume");
  }
  if (["S", "T", "Y", "N", "Q", "K", "R", "D", "E"].includes(wt1) && ["A", "V", "L", "I", "F"].includes(mut1)) {
    putativeStructuralChanges.push("Loss of polar sidechain hydrogen-bonding interactions");
  }
  // No fallback sentence. "Minor sidechain rotamer realignment without major backbone shift" was
  // pushed whenever none of the residue-class rules above fired — a structural finding asserted from
  // the absence of a rule match, and shown on the tab as an ESM3 hypothesis. An empty list is the
  // honest result when no rule applies.

  // 4. Confidence
  let confLevel: "high" | "moderate" | "low" = "high";
  if (targetPlddt === null || targetPlddt === undefined) confLevel = "low";
  else if (targetPlddt < 50) confLevel = "low";
  else if (targetPlddt < 75) confLevel = "moderate";

  const result: ESM3StructureEvalResult = {
    uniprotId,
    position,
    wtResidue: wt1,
    mutResidue: mut1,
    pdbText,
    perturbationScores,
    maxDriftResidue,
    structuralChangeLevel,
    microenvironments,
    putativeStructuralChanges,
    confidence: {
      level: confLevel,
      plddt: targetPlddt !== null ? parseFloat(targetPlddt.toFixed(1)) : (null as any),
      sequenceCoverage: 100
    },
    provenance
  };

  esm3StructureCache.set(cacheKey, result);
  return result;
}
