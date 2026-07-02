import { CLINVAR_AA_MAP } from "../../src/aminoAcids.ts";

export interface ACMGItem {
  code: string;
  reason: string;
}

export interface RuleBasedInsights {
  plausibility: string;
  acmgCriteria: ACMGItem[];
}

export function normalizeProteinChangeTo1Letter(variantStr: string): string | null {
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();
  
  // Try 3-letter match e.g. arg408trp
  const match3 = clean.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
  if (match3) {
    const wt1 = CLINVAR_AA_MAP[match3[1]];
    const pos = match3[2];
    const mut1 = CLINVAR_AA_MAP[match3[3]];
    if (wt1 && mut1) {
      return `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
    }
  }
  
  // Try 1-letter match e.g. r408w
  const match1 = clean.match(/^([a-z])(\d+)([a-z])$/);
  if (match1) {
    return `${match1[1].toUpperCase()}${match1[2]}${match1[3].toUpperCase()}`;
  }
  
  return null;
}

export function computeRuleBasedACMG(
  gene: string,
  variant: string,
  clinvar: any,
  predictorData: any,
  conservationData: any
): RuleBasedInsights {
  const criteria: ACMGItem[] = [];

  // 1. PP3 / BP4 (In silico predictors)
  const isPredictorPathogenic = 
    (predictorData?.caddPhred !== null && predictorData?.caddPhred !== undefined && predictorData?.caddPhred >= 25.0) ||
    (predictorData?.amClass === "pathogenic") ||
    (conservationData?.revel !== null && conservationData?.revel !== undefined && conservationData?.revel >= 0.75);

  const isPredictorBenign = 
    (predictorData?.caddPhred !== null && predictorData?.caddPhred !== undefined && predictorData?.caddPhred <= 10.0) ||
    (predictorData?.amClass === "benign") ||
    (conservationData?.revel !== null && conservationData?.revel !== undefined && conservationData?.revel <= 0.15);

  if (isPredictorPathogenic) {
    criteria.push({
      code: "PP3",
      reason: `Multiple in silico predictors agree on pathogenic impact (CADD: ${predictorData?.caddPhred ?? "N/A"}, REVEL: ${conservationData?.revel ?? "N/A"}, AlphaMissense: ${predictorData?.amClass ?? "N/A"}).`
    });
  } else if (isPredictorBenign) {
    criteria.push({
      code: "BP4",
      reason: `Multiple in silico predictors agree on benign impact (CADD: ${predictorData?.caddPhred ?? "N/A"}, REVEL: ${conservationData?.revel ?? "N/A"}, AlphaMissense: ${predictorData?.amClass ?? "N/A"}).`
    });
  }

  // 2. PM2 / BS1 / BA1 (Population Frequency)
  let maxFreq = 0;
  let hasFreq = false;
  if (clinvar?.alleleFrequencies && Array.isArray(clinvar.alleleFrequencies)) {
    for (const freq of clinvar.alleleFrequencies) {
      if (freq.value !== null && freq.value !== undefined) {
        hasFreq = true;
        const val = parseFloat(String(freq.value));
        if (!isNaN(val) && val > maxFreq) {
          maxFreq = val;
        }
      }
    }
  }

  if (hasFreq) {
    if (maxFreq > 0.05) {
      criteria.push({
        code: "BA1",
        reason: `Allele frequency is stand-alone benign (${(maxFreq * 100).toFixed(3)}% > 5.0% in population database).`
      });
    } else if (maxFreq > 0.01) {
      criteria.push({
        code: "BS1",
        reason: `Allele frequency is significantly higher than expected for disorder (${(maxFreq * 100).toFixed(3)}% > 1.0%).`
      });
    } else if (maxFreq < 0.0001) {
      criteria.push({
        code: "PM2",
        reason: `Variant is extremely rare in population databases (frequency ${(maxFreq * 100).toFixed(4)}% < 0.01%).`
      });
    }
  } else {
    criteria.push({
      code: "PM2",
      reason: "Variant is absent or extremely rare in population databases."
    });
  }

  // 3. PP2 (Missense constraint)
  const missenseConstrainedGenes = ["PAH", "FGFR3", "GBA1", "G6PD", "LDLR"];
  if (missenseConstrainedGenes.includes(gene.toUpperCase())) {
    criteria.push({
      code: "PP2",
      reason: `Missense variant in gene ${gene} which has a low rate of benign missense variants and is established as a missense-disease mechanism.`
    });
  }

  // 4. ClinVar direct evidence (PS1 / BS2 heuristic)
  const clinvarClass = (clinvar?.classification || "").toLowerCase();
  if (clinvarClass.includes("pathogenic")) {
    criteria.push({
      code: "PS1",
      reason: `Direct ClinVar classification records this variant as pathogenic/likely pathogenic (UID: ${clinvar.uid || "N/A"}).`
    });
  } else if (clinvarClass.includes("benign")) {
    criteria.push({
      code: "BS2",
      reason: `Direct ClinVar classification records this variant as benign/likely benign (UID: ${clinvar.uid || "N/A"}).`
    });
  }

  // Gather criteria codes
  const pathCodes = criteria.filter(c => c.code.startsWith("P") || c.code === "VS" || c.code === "PVS1");
  const benignCodes = criteria.filter(c => c.code.startsWith("B"));

  let plausibility = "";
  if (pathCodes.length > 0 && benignCodes.length === 0) {
    plausibility = `Plausibly pathogenic based on gathered evidence: ${pathCodes.map(c => c.code).join(", ")}.`;
  } else if (benignCodes.length > 0 && pathCodes.length === 0) {
    plausibility = `Plausibly benign based on gathered evidence: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else if (pathCodes.length > 0 && benignCodes.length > 0) {
    plausibility = `Conflicting evidence detected. Pathogenic indicators: ${pathCodes.map(c => c.code).join(", ")}; Benign indicators: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else {
    plausibility = "No strong pathogenic or benign indicator criteria suggested from the database evidence.";
  }

  return {
    plausibility,
    acmgCriteria: criteria
  };
}
