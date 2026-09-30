import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { METRIC_EXPLANATIONS } from "../evidence/MetricExplanations";

/**
 * The method citations must be correct, and there must be only one of them.
 *
 * WHAT THIS PINS
 * --------------
 * `src/components/evidence/MetricExplanations.ts` and `src/components/EnergeticsView.tsx`
 * each declare their own table of method explanations. That duplication is how the two
 * corrections below could half-land: one copy fixed, the other still pointing a reader at a
 * DOI that resolves to a different paper. The agreement assertion at the bottom is the part
 * that matters — it fails the moment the copies drift on a citation again.
 *
 * WHY THESE TWO SPECIFICALLY
 * -------------------------
 * DynaMut2 and RaSP both carried a DOI belonging to a different paper, under a journal name
 * that did not match it. Nothing in the app could catch that: a DOI is a string, and a string
 * that looks like a DOI is exactly what a reviewer skims past. The correct identities are
 * pinned literally below so a revert fails rather than silently reappearing.
 */
const REPO_ROOT = process.cwd();

/** The two bibliographic identities that were wrong, with what replaced them. */
const CORRECTED: Record<string, { paperTitle: string; paperUrl: string }> = {
  // Rodrigues et al., Protein Science 2021 — the DynaMut2 methods paper. The old entry
  // named Bioinformatics 2020 and a DOI that resolves to an unrelated article.
  dynamut2: {
    paperTitle: "Rodrigues et al. Protein Science (2021)",
    paperUrl: "https://doi.org/10.1002/pro.3942"
  },
  // Blaabjerg et al., eLife 2023 — "Rapid protein stability prediction using deep learning
  // representations" (RaSP). The old entry named Cell Systems and a DOI for a different
  // article.
  rasp: {
    paperTitle: "Blaabjerg et al. eLife (2023)",
    paperUrl: "https://doi.org/10.7554/eLife.82593"
  }
};

/** DOIs that resolved to a different paper than the entry claimed. Never reuse. */
const RETIRED_DOIS = [
  "10.1093/bioinformatics/btaa784",
  "10.1016/j.cels.2023.01.001"
];

interface DeclaredCitation {
  title: string | null;
  url: string | null;
}

const SHARED_TABLE = "src/components/evidence/MetricExplanations.ts";
const CLONE_TABLE = "src/components/EnergeticsView.tsx";

/**
 * Reads the method-id → citation pairs a source file declares, so two files can be compared
 * without importing the second one (importing `EnergeticsView` would pull in the whole
 * viewer).
 *
 * It tracks BOTH halves of a citation. An earlier version compared only the URL, and a
 * mutation proved that was not enough: reverting the clone's journal name to the wrong one
 * while keeping the correct DOI passed every assertion — which is half the defect this file
 * exists to catch.
 *
 * Both entry shapes are accepted, because the two tables are not written the same way: an
 * entry may open as a bare object key (`rasp: {`) or carry an explicit `id:` field. Missing
 * either shape would silently compare zero entries, which the caller guards against.
 */
function readDeclaredCitations(relativePath: string): Map<string, DeclaredCitation> {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
  const found = new Map<string, DeclaredCitation>();
  let currentId: string | null = null;

  for (const line of source.split("\n")) {
    const idField = line.match(/^\s*id:\s*"([^"]+)"/);
    const bareKey = line.match(/^\s*([a-z0-9_]+):\s*\{\s*$/);
    if (idField || bareKey) {
      currentId = (idField ?? bareKey)![1];
      if (!found.has(currentId)) found.set(currentId, { title: null, url: null });
      continue;
    }
    if (!currentId) continue;
    const entry = found.get(currentId)!;
    const title = line.match(/^\s*paperTitle:\s*"([^"]+)"/);
    if (title && entry.title === null) entry.title = title[1];
    const url = line.match(/^\s*paperUrl:\s*"([^"]+)"/);
    if (url && entry.url === null) entry.url = url[1];
  }
  return found;
}

describe("method citations", () => {
  it("cites DynaMut2 and RaSP to the papers those methods actually came from", () => {
    for (const [id, expected] of Object.entries(CORRECTED)) {
      const entry = (METRIC_EXPLANATIONS as Record<string, typeof expected | undefined>)[id];
      expect(entry, `${id} has no explanation entry`).toBeDefined();
      expect(entry!.paperTitle).toBe(expected.paperTitle);
      expect(entry!.paperUrl).toBe(expected.paperUrl);
    }
  });

  it("never reuses a DOI that was known to point at a different paper", () => {
    for (const [id, entry] of Object.entries(
      METRIC_EXPLANATIONS as Record<string, { paperUrl: string } | undefined>
    )) {
      if (!entry) continue;
      for (const retired of RETIRED_DOIS) {
        expect(
          entry.paperUrl.includes(retired),
          `${id} points at ${retired}, which was verified to resolve to a different paper`
        ).toBe(false);
      }
    }
  });

  it("gives every method a fully-qualified https link", () => {
    for (const [id, entry] of Object.entries(
      METRIC_EXPLANATIONS as Record<string, { paperUrl: string } | undefined>
    )) {
      if (!entry) continue;
      expect(entry.paperUrl, `${id} has an unqualified link`).toMatch(/^https:\/\//);
    }
  });

  it("resolves a complete citation for every method in the shared table", () => {
    // The anti-mis-attribution check. The scanner attributes a citation to the most
    // recently opened entry, so a field reorder would silently move a URL onto its
    // neighbour; requiring every documented method to come back with a title AND a url turns
    // that silent mis-attribution into a failure.
    const scanned = readDeclaredCitations(SHARED_TABLE);
    const missing: string[] = [];
    for (const id of Object.keys(METRIC_EXPLANATIONS)) {
      const found = scanned.get(id);
      if (!found) missing.push(`${id} (not found by the scanner)`);
      else if (!found.url || !found.title) missing.push(`${id} (${JSON.stringify(found)})`);
    }
    expect(
      missing,
      `Citations the scanner could not resolve:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("has exactly one method table: the Energetics tab keeps no copy of its own", () => {
    // The tab used to declare a second table, and the two drifted: DDMut on a 2022 DOI, ThermoMPNN on
    // a vendor page and StabilityOracle on this repository, in the copy the Energetics info buttons
    // opened. The tab now opens the shared table, so the stronger invariant is that no copy exists.
    const clone = readDeclaredCitations(CLONE_TABLE);
    expect([...clone.keys()], "EnergeticsView declares its own citations again").toEqual([]);
  });

  it("cites the stability engines to their methods papers", () => {
    const expected: Record<string, string> = {
      ddmut: "https://doi.org/10.1093/nar/gkad472",
      thermompnn: "https://doi.org/10.1073/pnas.2314853121",
      stabilityoracle: "https://doi.org/10.1038/s41467-024-49780-2",
    };
    for (const [id, url] of Object.entries(expected)) {
      expect((METRIC_EXPLANATIONS as Record<string, { paperUrl: string }>)[id].paperUrl).toBe(url);
    }
  });

  it("describes the neighbour side-chain RMSD as the app measures it, with no unsourced band", () => {
    const rmsd = METRIC_EXPLANATIONS.rmsd;
    // It was "the mutated sidechain" with "RMSD > 1.5 Å indicates substantial repacking", credited to
    // Guerois 2002, which defines neither the measure nor the threshold.
    expect(rmsd.description).toMatch(/within ±5 of the site/);
    expect(rmsd.description).toMatch(/paired wild type/);
    expect(`${rmsd.description} ${rmsd.interpretation}`).not.toMatch(/1\.5 Å/);
  });
});
