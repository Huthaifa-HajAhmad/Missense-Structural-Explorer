import { LRUCache } from "lru-cache";
import { AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1 } from "../../src/shared/aminoAcids.ts";
import { fetchWithRetry } from "./external.ts";
import { extractSequenceFromPdb } from "./pdb-parser.ts";
import { fetchUniprotSequence } from "./uniprot.ts";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { CONFIG } from "../config.ts";

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
    const { stdout } = await execFileAsync("python", ["-m", "uv", "run", scriptPath, tmpFile, chain, pos.toString()], { timeout: 15000 });
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

export async function fetchEsm3StructureEval(
  uniprotId: string,
  position: number,
  wtResidue: string,
  mutResidue: string,
  wtPdbText?: string | null,
  biohubToken?: string | null,
  sequenceOverride?: string | null
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
      signal: AbortSignal.timeout(20000)
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
    }
  } catch (err: any) {
    console.warn("[ESM3 Sidecar API] Failed to run ESM3 structural evaluation:", err.message);
    esm3Error = err.message;
  }



  // Parse PDB for secondary structure, pLDDT, and SASA if wtPdbText is provided
  let isHelix = false;
  let isSheet = false;
  let meanPlddt: number | null = null;
  let targetPlddt: number | null = null;
  let rsa = 0.12; // default core

  if (wtPdbText) {
    const sasaRes = await runSasaEval(wtPdbText, "A", position);
    if (sasaRes) {
      rsa = sasaRes.rsa;
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
    if (atomCount > 0) meanPlddt = totalAtomB / atomCount;
    if (targetAtomCount > 0) targetPlddt = targetB / targetAtomCount;
  }

  // If we could not retrieve real perturbation scores from the API, we return error to avoid fabricating data
  if (perturbationScores.length === 0) {
    const errorResult = { error: esm3Error || "No perturbation scores returned by Biohub ESM3 API." };
    // Do NOT cache API errors/failures so configuring keys can take immediate effect on retry
    return errorResult as any;
  }

  const maxVal = Math.max(...perturbationScores);
  const maxDriftResidue = perturbationScores.indexOf(maxVal) + 1;

  // 1. Predicted Local Structural Change
  let structuralChangeLevel: "none" | "minor" | "moderate" | "major" = "minor";
  if (maxVal < 0.08) structuralChangeLevel = "none";
  else if (maxVal < 0.22) structuralChangeLevel = "minor";
  else if (maxVal < 0.38) structuralChangeLevel = "moderate";
  else structuralChangeLevel = "major";

  // 2. Microenvironment
  const microenvironments: string[] = [];
  if (rsa < 0.15) microenvironments.push("Hydrophobic core");
  else if (rsa > 0.35) microenvironments.push("Surface");
  else microenvironments.push("Binding pocket");

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
  if (putativeStructuralChanges.length === 0) {
    putativeStructuralChanges.push("Minor sidechain rotamer realignment without major backbone shift");
  }

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
