import { CONFIG } from "../config.ts";

export interface StabilityOracleEvalResult {
  ddG: number;
  isStabilizing: boolean;
  contactsAnalyzed: number;
  provenance: string;
}

const AA_SINGLE = ["A", "R", "N", "D", "C", "Q", "E", "G", "H", "I", "L", "K", "M", "F", "P", "S", "T", "W", "Y", "V"];

function normalizeThreeLetterToSingle(three: string): string | null {
  const map: Record<string, string> = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C",
    GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I",
    LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P",
    SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V"
  };
  return map[three.toUpperCase()] || null;
}

export async function runStabilityOracleAnalysis(
  gene: string,
  variant: string,
  uniprotId: string,
  sequence: string,
  wtPdb?: string | null
): Promise<StabilityOracleEvalResult | null> {
  const mutMatch = variant.match(/([a-zA-Z]{3}|[a-zA-Z])\s*(\d+)\s*([a-zA-Z]{3}|[a-zA-Z])/);
  if (!mutMatch) return null;

  const rawWt = mutMatch[1];
  const pos = parseInt(mutMatch[2], 10);
  const rawMut = mutMatch[3];

  const wtRes = rawWt.length === 3
    ? normalizeThreeLetterToSingle(rawWt)
    : (AA_SINGLE.includes(rawWt.toUpperCase()) ? rawWt.toUpperCase() : null);

  const mutRes = rawMut.length === 3
    ? normalizeThreeLetterToSingle(rawMut)
    : (AA_SINGLE.includes(rawMut.toUpperCase()) ? rawMut.toUpperCase() : null);

  if (!wtRes || !mutRes) {
    return null;
  }

  const sidecarSecret = process.env.SIDECAR_SECRET || "";
  try {
    const sidecarRes = await fetch(`${CONFIG.services.sidecarBaseUrl}/predict/stabilityoracle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sidecar-Secret": sidecarSecret
      },
      body: JSON.stringify({
        sequence,
        position: pos,
        wt: wtRes,
        mut: mutRes,
        wtPdb: wtPdb || null
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (sidecarRes.ok) {
      const data = await sidecarRes.json() as any;
      if (data && data.status === "success" && typeof data.ddG === "number") {
        return {
          ddG: data.ddG,
          isStabilizing: !!data.isStabilizing,
          contactsAnalyzed: typeof data.contactsAnalyzed === "number" ? data.contactsAnalyzed : 0,
          provenance: typeof data.provenance === "string" ? data.provenance : "StabilityOracle (PyTorch 3D Graph-Transformer)"
        };
      }
    } else {
      console.warn(`[StabilityOracle Warning] Sidecar request failed with status: ${sidecarRes.status}`);
      return null;
    }
  } catch (err: any) {
    console.warn("[StabilityOracle Warning] Sidecar connection not available. In accordance with No-Heuristics Policy, no synthetic fallbacks are used:", err.message);
    return null;
  }

  return null;
}
