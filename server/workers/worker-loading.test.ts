import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * A pool thread loads its worker with Node's own TypeScript support ("type stripping"), not with Vitest's or
 * tsx's resolver. Node then finds an imported file only by its exact name, so every relative import a worker
 * reaches must spell out `.ts`. One missing extension made the 3D structural diff crash the whole server.
 */
const workersDir = fileURLToPath(new URL(".", import.meta.url));
const workers = readdirSync(workersDir).filter(name => name.endsWith("-worker.ts"));

describe("worker modules load in plain Node, the way a worker thread loads them", () => {
  it("finds the workers it is meant to check", () => {
    expect(workers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(workers)("%s", name => {
    const href = pathToFileURL(workersDir + name).href;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(href)});`], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
  });
});
