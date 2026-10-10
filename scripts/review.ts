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

const env: NodeJS.ProcessEnv = { ...process.env, OCR_NO_UPDATE: "1" };
// gemini-3.6-flash returned HTTP 400 on the tool-call follow-up in a capped run on 2026-10-10.
const targetModel = process.env.OCR_MODEL || "gemini-2.5-flash";

const isPlaceholder = (key?: string) => !key || key.startsWith("YOUR_") || key.includes("example") || key.trim() === "";

// Export all valid configured API keys so any provider / fallback has access
if (geminiKey && !isPlaceholder(geminiKey)) {
  env.GOOGLE_API_KEY = geminiKey;
  env.GEMINI_API_KEY = geminiKey;
}
if (openaiKey && !isPlaceholder(openaiKey)) {
  env.OPENAI_API_KEY = openaiKey;
}
if (anthropicKey && !isPlaceholder(anthropicKey)) {
  env.ANTHROPIC_API_KEY = anthropicKey;
}

// Pass CLI arguments (defaulting to `review` if none provided)
const rawArgs = process.argv.slice(2);
const providerArgIndex = rawArgs.indexOf("--provider");
const cliProvider = providerArgIndex !== -1 && rawArgs[providerArgIndex + 1] ? rawArgs[providerArgIndex + 1] : undefined;

let activeProvider = cliProvider || process.env.OCR_PROVIDER;
if (!activeProvider) {
  if (geminiKey && !isPlaceholder(geminiKey)) {
    activeProvider = "google";
  } else if (openaiKey && !isPlaceholder(openaiKey)) {
    activeProvider = "openai";
  } else if (anthropicKey && !isPlaceholder(anthropicKey)) {
    activeProvider = "anthropic";
  } else {
    activeProvider = "google";
    console.warn("⚠️ [OCR Review] GEMINI_API_KEY / OCR_API_KEY in .env is unset or contains a placeholder.");
    console.warn("   Paste your Gemini API key from Google AI Studio into .env to enable live AI review.\n");
  }
}

const subcommands = ["review", "scan", "suggest"];
let commandArgs: string[] = [];
if (rawArgs.length === 0) {
  commandArgs = ["review"];
} else if (subcommands.includes(rawArgs[0])) {
  commandArgs = [...rawArgs];
} else {
  commandArgs = ["review", ...rawArgs];
}

const hasProvider = commandArgs.includes("--provider");
const hasModel = commandArgs.includes("--model");
const hasConcurrency = commandArgs.includes("--concurrency");

const chosenModel = (activeProvider === "google" || activeProvider === "gemini")
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

const finalArgs = ["ocr", ...commandArgs, ...extraFlags];

console.log(`🔍 [Open Code Review] Running AI Code Review (${activeProvider} / ${chosenModel}) on current git changes...\n`);

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

const child = spawn(npxCmd, finalArgs, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

