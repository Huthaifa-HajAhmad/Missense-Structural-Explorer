import type { LogSource } from "../types/devConsole";

/**
 * Subsystem keywords, matched against the leading `[Tag]` of a console message.
 *
 * Order matters: the first rule that matches wins, so the more specific families come first.
 * Matching on a keyword *contained in* the tag — not an exact `[tag]` prefix — is what makes
 * `[FoldxService Error]`, `[ESMFold]`, `[Pocket Detection Error]` and `[Client Retry]` land in the
 * right subsystem. The old exact-prefix list sent all of them to `console`, so the Biophysics
 * filter silently hid every FoldX failure.
 */
const RULES: Array<[LogSource, RegExp]> = [
  ["component", /errorboundary/],
  ["notification", /notification/],
  ["biophysics", /foldx|dynamut|ddmut|thermompnn|stabilityoracle|rasp|esm-?2|esm-?3|esmc|saprot|biophysic|comparison|structuralmodel|structuralanalysis/],
  ["structure-3d", /esmfold|alphafold|pdb|pocket|mol\*|molstar|structure|3d|homolog|residue|uniprot|sequence/],
  ["genomics", /vep|mane|splice|genomic|notation|alphagenome|landscape|coordinate/],
  ["ai-narrative", /gemini|narrative|acmg|clinical/],
  ["literature", /pubmed|litrag|literature/],
  ["system", /cache|worker|webgl|vite|lazyretry/],
  ["workflow", /retry|pipeline|workflow|backfill|jobpoller|orchestrator/],
  ["network", /network|http|fetch|apiclient|stream/],
];

/** The first `[Tag]` of a message, lower-cased, or null when the message is untagged. */
export function leadingTag(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const match = /^\s*\[([^\]]+)\]/.exec(message);
  return match ? match[1].toLowerCase() : null;
}

export function classifyLogSource(args: unknown[]): LogSource {
  const tag = leadingTag(args[0]);
  if (!tag) return "console";
  for (const [source, pattern] of RULES) {
    if (pattern.test(tag)) return source;
  }
  return "console";
}
