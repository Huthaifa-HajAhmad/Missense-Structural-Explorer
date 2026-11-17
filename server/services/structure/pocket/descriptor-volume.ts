import path from "path";
import fs from "fs";

/**
 * Read a measured pocket volume from P2Rank's `-export_pocket_descriptors` output.
 *
 * The export's file name and columns are not documented in the bundled
 * distribution, so both are discovered rather than assumed: the output directory
 * is scanned for a `*pocket_descriptors*.csv`, its header is searched for a volume
 * column, and a row is matched on a pocket id/rank/name column when one exists.
 *
 * Returns null whenever the file, the column or the matching row is absent, so the
 * caller reports no volume rather than inventing one.
 */
export function readPocketDescriptorVolume(outputDir: string, pocketId: number): number | null {
  try {
    if (!fs.existsSync(outputDir)) return null;

    const candidate = fs
      .readdirSync(outputDir)
      .find(name => /pocket[_-]?descriptors?.*\.csv$/i.test(name));
    if (!candidate) return null;

    const lines = fs
      .readFileSync(path.join(outputDir, candidate), "utf8")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return null;

    const header = lines[0].split(",").map(cell => cell.trim().toLowerCase());
    const volumeIdx = header.findIndex(cell => cell.includes("volume"));
    if (volumeIdx === -1) return null;

    const idIdx = header.findIndex(cell => ["rank", "id", "name", "pocket", "pocket_id"].includes(cell));

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map(cell => cell.trim());
      if (idIdx !== -1) {
        const numericId = parseInt((cells[idIdx] ?? "").replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(numericId) && numericId !== pocketId) continue;
      }
      const parsed = parseFloat(cells[volumeIdx] ?? "");
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return null;
  } catch (err: any) {
    console.warn(`[Pocket Finder ML] Could not read pocket descriptors:`, err?.message ?? err);
    return null;
  }
}
