import dotenv from "dotenv";
import { runProteinGymBenchmark, BenchmarkResult } from "../server/services/benchmark-proteingym.ts";
import { runEsmcAnalysis } from "../server/services/esmc.ts";
import { runEsm2Analysis } from "../server/services/esm2.ts";

// Load local environment variables (.env)
dotenv.config();

async function main() {
  console.log("=====================================================================");
  console.log("   ProteinGym Rare Disease DMS Substitutions Benchmark Runner");
  console.log("=====================================================================\n");

  const biohubToken = process.env.BIOHUB_TOKEN || null;
  const hfToken = process.env.HF_TOKEN || null;

  // Choose the evaluation model. We default to ESM-C, falling back to ESM-2.
  const modelChoice = (process.argv[2] || "esmc").toLowerCase();
  
  console.log(`Model Evaluator: ${modelChoice.toUpperCase()}`);
  console.log(`Biohub Token Configured: ${biohubToken ? "YES" : "NO (Will fall back to local models)"}`);
  console.log(`HuggingFace Token Configured: ${hfToken ? "YES" : "NO"}\n`);

  console.log("Fetching UniProt sequences and evaluating variants...");

  const start = Date.now();
  
  const predictorCallback = async (gene: string, variant: string, uniprotId: string, sequence: string): Promise<number | null> => {
    if (modelChoice === "esm2") {
      const res = await runEsm2Analysis(gene, variant, uniprotId, sequence, hfToken);
      return typeof res?.llr === "number" ? res.llr : null;
    } else {
      // Default to ESM-C (VESM-150M local or ESMC-6B remote)
      const res = await runEsmcAnalysis(gene, variant, uniprotId, sequence, biohubToken);
      return res && "llr" in res && typeof res.llr === "number" ? res.llr : null;
    }
  };

  try {
    const scoreCard = await runProteinGymBenchmark(predictorCallback);
    const duration = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`\nBenchmark execution completed in ${duration}s.\n`);
    console.log("| Gene | UniProt ID | Variants | Correlation (\u03c0) | Baseline | Verdict |");
    console.log("|------|------------|----------|-----------------|----------|---------|");

    let allPassed = true;
    for (const res of scoreCard) {
      const symbol = res.passed ? "\u2705 PASS" : "\u274c FAIL";
      if (!res.passed) allPassed = false;
      console.log(
        `| ${res.gene.padEnd(4)} | ${res.uniprotId} | ${String(res.variantCount).padStart(8)} | ${res.correlation.toFixed(4).padStart(15)} | ${res.baseline.toFixed(2).padStart(8)} | ${symbol.padEnd(7)} |`
      );
    }

    console.log("\n=====================================================================");
    if (allPassed) {
      console.log("   \u2705 ALL GENES PASSED BASELINE REGRESSION LIMITS SUCCESSFULLY!");
      console.log("=====================================================================");
      process.exit(0);
    } else {
      console.log("   \u274c REGRESSION DETECTED: Some genes did not meet correlation baselines.");
      console.log("=====================================================================");
      process.exit(1);
    }
  } catch (err: any) {
    console.error("\n[Fatal Error] Benchmark execution failed:", err.message);
    process.exit(1);
  }
}

main();
