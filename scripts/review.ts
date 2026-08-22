#!/usr/bin/env node
/**
 * scripts/review.ts
 *
 * Secure Open Code Review (OCR) runner for MissenseResolve.
 * Automatically forwards local `.env` API keys via environment variables without shell interpolation.
 */

import { spawn } from "node:child_process";
import dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

const geminiKey = process.env.OCR_API_KEY || process.env.GEMINI_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

const env: NodeJS.ProcessEnv = { ...process.env };
const targetModel = process.env.OCR_MODEL || process.env.GEMINI_MODEL || "gemini-3.5-flash";

const isPlaceholder = (key?: string) => !key || key.startsWith("YOUR_") || key.includes("example") || key.trim() === "";

let activeProvider = "gemini";

if (geminiKey && !isPlaceholder(geminiKey)) {
  activeProvider = "gemini";
  env.GOOGLE_API_KEY = geminiKey;
  env.GEMINI_API_KEY = geminiKey;
} else if (openaiKey && !isPlaceholder(openaiKey)) {
  activeProvider = "openai";
  env.OPENAI_API_KEY = openaiKey;
} else if (anthropicKey && !isPlaceholder(anthropicKey)) {
  activeProvider = "anthropic";
  env.ANTHROPIC_API_KEY = anthropicKey;
} else {
  console.warn("⚠️ [OCR Review] GEMINI_API_KEY / OCR_API_KEY in .env is unset or contains a placeholder.");
  console.warn("   Paste your Gemini API key from Google AI Studio into .env to enable live AI review.\n");
}

// Pass CLI arguments (defaulting to `review` if none provided)
const rawArgs = process.argv.slice(2);
const hasProvider = rawArgs.includes("--provider");
const hasModel = rawArgs.includes("--model");
const hasConcurrency = rawArgs.includes("--concurrency");

const chosenModel = activeProvider === "gemini"
  ? targetModel
  : activeProvider === "openai"
  ? (process.env.OPENAI_MODEL || "gpt-4o")
  : (process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022");

const extraFlags: string[] = [];
if (!hasProvider) {
  extraFlags.push("--provider", activeProvider);
}
if (!hasModel) {
  extraFlags.push("--model", chosenModel);
}
if (!hasConcurrency) {
  // Gemini API is rate-limited by RPM; concurrency 1 ensures smooth sequential file reviews without 429 errors
  extraFlags.push("--concurrency", "1");
}

const args = rawArgs.length > 0 ? rawArgs : ["review"];
const finalArgs = ["@alibaba-group/open-code-review", ...args, ...extraFlags];

console.log(`🔍 [Open Code Review] Running AI Code Review (${activeProvider} / ${chosenModel}) on current git changes...\n`);

const child = spawn("npx", finalArgs, {
  env,
  stdio: "inherit",
  shell: true
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

