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

/**
 * Reads the method-id → `paperUrl` pairs a source file declares, so two files can be
 * compared without importing the second one (importing `EnergeticsView` would pull in the
 * whole viewer).
 *
 * Both entry shapes are accepted, because the two tables are not written the same way: the
 * shared module keys its entries `gpn_star: {` and the clone does too, but only some entries
 * carry an explicit `id:` field. Missing either shape would silently compare zero entries,
 * so the caller asserts the scan found something.
 */
function readDeclaredCitations(relativePath: string): Map<string, string> {
  const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
  const found = new Map<string, string>();
  let currentId: string | null = null;

  for (const line of source.split("\n")) {
    // An entry opens either as `id: "x",` or as a bare object key `x: {`.
    const idField = line.match(/^\s*id:\s*"([^"]+)"/);
    const bareKey = line.match(/^\s*([a-z0-9_]+):\s*\{\s*$/);
    if (idField) {
      currentId = idField[1];
      continue;
    }
    if (bareKey) {
      currentId = bareKey[1];
      continue;
    }
    const url = line.match(/^\s*paperUrl:\s*"([^"]+)"/);
    if (url && currentId) {
      // First declaration wins, so a later re-declaration in the same file cannot shadow it.
      if (!found.has(currentId)) found.set(currentId, url[1]);
    }
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

  it("keeps the Energetics tab's copy of the table in agreement on every citation", () => {
    // The failure this prevents is real and has already happened once: a correction applied
    // to the shared table while the tab's clone kept the old DOI, so two surfaces opened on
    // the same method cited different journals.
    const shared = readDeclaredCitations("src/components/evidence/MetricExplanations.ts");
    const clone = readDeclaredCitations("src/components/EnergeticsView.tsx");

    // Both must have been scanned, or the comparison below would pass on zero entries — the
    // way a source scanner "passes" when it was pointed at nothing.
    expect(shared.size, "no citations found in the shared table").toBeGreaterThan(5);
    expect(clone.size, "no citations found in the Energetics clone").toBeGreaterThan(5);
    const sharedIds = new Set(shared.keys());
    const compared = [...clone.keys()].filter((id) => sharedIds.has(id));
    expect(compared.length, "the two tables share no method ids to compare").toBeGreaterThan(0);

    const drift = compared
      .filter((id) => shared.get(id) !== clone.get(id))
      .map((id) => `  ${id}: shared "${shared.get(id)}" vs clone "${clone.get(id)}"`);
    expect(
      drift,
      drift.length
        ? `The two method tables disagree on a citation:\n${drift.join("\n")}\n` +
          `Cite one source. Correct BOTH copies.`
        : ""
    ).toEqual([]);
  });
});
