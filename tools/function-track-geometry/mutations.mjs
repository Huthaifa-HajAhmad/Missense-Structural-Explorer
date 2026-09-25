#!/usr/bin/env node
/**
 * Mutation harness for the Functional Domains surface — the evidence behind the "Mutation-tested"
 * table in `README.md`.
 *
 *   node tools/function-track-geometry/mutations.mjs backup
 *   node tools/function-track-geometry/mutations.mjs apply [id …]
 *   node tools/function-track-geometry/mutations.mjs restore
 *
 * `apply` reintroduces defects into the real component, the palette and the legend; re-run
 * `npm run test:geometry:function-track` and read which assertions go red. With no ids, every
 * mutation is applied at once — which is how the first attempt *failed* to test three of them: the
 * "spans drawn as pins" mutation zeroes the bar count and silences the tiering, lane and underline
 * guards behind it. Apply them in small groups and attribute each failure from its own text.
 *
 * Every replacement asserts it matched exactly once, so a mutation that silently did not apply
 * cannot be mistaken for a guard that caught something. Files are written through Node as UTF-8,
 * never through PowerShell text cmdlets.
 *
 * `backup` snapshots the files into `scratch/` and prints their SHA-256s; `restore` copies them back
 * and prints the hashes again, so the two can be compared. Always restore before you commit.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPONENT = "src/components/evidence/FunctionInteractionsTabs.tsx";
const PALETTE = "src/shared/featurePalette.ts";
const LEGEND = "src/components/inspector/FeaturePaletteLegend.tsx";
const TARGETS = [COMPONENT, PALETTE, LEGEND];

/** @type {Array<{ id: string; file: string; from: string; to: string; expect: string }>} */
const MUTATIONS = [
  {
    id: "spans-drawn-as-pins",
    file: COMPONENT,
    from: "    const points = plotted.filter((f) => featureGeometryFor(getType(f)) === \"point\");\n    const spans = plotted.filter((f) => featureGeometryFor(getType(f)) === \"span\");",
    to: "    const points = plotted;\n    const spans: typeof plotted = [];",
    expect: "spans are bars and point sites are pins",
  },
  {
    id: "spans-share-one-tier",
    file: COMPONENT,
    from: "      let tier = tierEnds.findIndex((end) => span.start > end);",
    to: "      let tier = 0;",
    expect: "overlapping spans are packed onto separate tiers",
  },
  {
    id: "span-lane-moved-below-the-rail",
    file: COMPONENT,
    from: "  spanLaneTop: 62,",
    to: "  spanLaneTop: 100,",
    expect: "span bars stay inside the span lane",
  },
  {
    id: "no-enclosing-span-underline",
    file: COMPONENT,
    from: "                      const isEnclosing = coversResidue(span.feature, pos);",
    to: "                      const isEnclosing = false;",
    expect: "a span containing the variant is underlined",
  },
  {
    id: "ptm-swatch-too-light",
    file: PALETTE,
    from: "    color: \"#0284c7\", // sky-600",
    to: "    color: \"#7dd3fc\", // mutated: sky-300",
    expect: "pin and caret colours clear 3:1 (the track and the legend move together, so the legend equality check stays green)",
  },
  {
    id: "legend-swatch-hand-written",
    file: LEGEND,
    from: "              style={{ background: kind.color }}",
    to: "              style={{ background: kind.key === \"ptm\" ? \"#7dd3fc\" : kind.color }}",
    expect: "legend: every swatch matches the colour the track paints for that category",
  },
  {
    id: "stale-coloured-spans-swatch",
    file: LEGEND,
    from: "              data-legend-shape={row.key}",
    to: "              data-legend-shape={row.key}\n              data-legend-kind={row.key === \"span\" ? \"spans\" : undefined}",
    expect: "legend: lists every category the track can paint, and nothing else",
  },
];

const hash = (file) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
const backupPath = (file) => path.join(root, "scratch", `fd-backup-${path.basename(file)}`);

function backup() {
  for (const file of TARGETS) {
    copyFileSync(path.join(root, file), backupPath(file));
    console.log(`backup   ${file}  ${hash(file).slice(0, 16)}`);
  }
}

function apply() {
  const only = process.argv.slice(3);
  const unknown = only.filter((id) => !MUTATIONS.some((m) => m.id === id));
  if (unknown.length) {
    console.error(`UNKNOWN MUTATION ID(s): ${unknown.join(", ")}`);
    console.error(`known: ${MUTATIONS.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }
  const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;
  const edits = new Map();
  for (const mutation of selected) {
    const source = edits.get(mutation.file) ?? readFileSync(path.join(root, mutation.file), "utf8");
    const parts = source.split(mutation.from);
    if (parts.length !== 2) {
      console.error(`MUTATION NOT APPLIED: ${mutation.id} — pattern occurs ${parts.length - 1} time(s) in ${mutation.file}`);
      console.error("  (the source moved; fix the pattern rather than trusting a green run)");
      process.exit(1);
    }
    edits.set(mutation.file, parts.join(mutation.to));
    console.log(`applied  ${mutation.id} → expects to break: ${mutation.expect}`);
  }
  for (const [file, contents] of edits) writeFileSync(path.join(root, file), contents, "utf8");
}

function restore() {
  for (const file of TARGETS) {
    if (!existsSync(backupPath(file))) {
      console.error(`RESTORE FAILED: no backup for ${file}`);
      process.exit(1);
    }
    copyFileSync(backupPath(file), path.join(root, file));
    console.log(`restored ${file}  ${hash(file).slice(0, 16)}`);
  }
}

const command = process.argv[2];
if (command === "backup") backup();
else if (command === "apply") apply();
else if (command === "restore") restore();
else {
  console.error("usage: node tools/function-track-geometry/mutations.mjs backup|apply [id …]|restore");
  process.exit(2);
}
