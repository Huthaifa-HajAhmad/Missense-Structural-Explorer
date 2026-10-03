#!/usr/bin/env node
/**
 * Mutation harness for the Functional domains schematic — the evidence behind the "Mutation-tested"
 * table in `README.md`.
 *
 *   node tools/function-track-geometry/mutations.mjs backup
 *   node tools/function-track-geometry/mutations.mjs apply [id …]
 *   node tools/function-track-geometry/mutations.mjs restore
 *
 * `apply` reintroduces one defect into the real layout, component or stylesheet; re-run
 * `npm run test:geometry:function-track` and read which assertion goes red. Apply one id at a time so
 * each failure is attributed from its own text.
 *
 * Every replacement asserts it matched exactly once, so a mutation that silently did not apply cannot
 * be mistaken for a guard that caught something. `backup` snapshots the files into `scratch/`;
 * `restore` copies them back and prints their hashes. Always restore before you commit.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LAYOUT = "src/components/evidence/function/architectureLayout.ts";
const DRAWING = "src/components/evidence/function/DomainArchitecture.tsx";
const STYLES = "src/styles/function.css";
const TARGETS = [LAYOUT, DRAWING, STYLES];

/** @type {Array<{ id: string; file: string; from: string; to: string; expect: string }>} */
const MUTATIONS = [
  {
    id: "scale-offset",
    file: LAYOUT,
    from: "const x = (r: number) => x0 + ((Math.min(Math.max(r, win.start)",
    to: "const x = (r: number) => 3 + x0 + ((Math.min(Math.max(r, win.start)",
    expect: "every mark sits at its residue / the variant is drawn at its residue",
  },
  {
    id: "tiers-ignored",
    file: LAYOUT,
    from: "      if (!spans.every(([l, r]) => free(band[t], l, r, 6))) continue;",
    to: "",
    expect: "no two labels overlap / no stem or mark crosses a label",
  },
  {
    id: "stem-from-backbone-centre",
    file: LAYOUT,
    from: "stemFrom: p.above ? (domains.some((d) => p.px >= d.x && p.px <= d.x + d.width) ? bb - 15 : bb - bh / 2)",
    to: "stemFrom: p.above ? bb",
    expect: "stems join the backbone to their heads",
  },
  {
    id: "query-below-the-pins",
    file: LAYOUT,
    from: "          headY: queryHeadY,",
    to: "          headY: pinHeadAbove + 20,",
    expect: "stems join the backbone to their heads (marks drawn above the variant)",
  },
  {
    id: "small-hit-target",
    file: DRAWING,
    from: "<rect x={p.x - 12} y={p.y - 12} width={24} height={24} className=\"fnd-arch__hit\" />",
    to: "<rect x={p.x - 6} y={p.y - 6} width={12} height={12} className=\"fnd-arch__hit\" />",
    expect: "every target is at least 24×24px",
  },
  {
    id: "faint-uncited-mark",
    file: STYLES,
    from: '.fnd-arch__pin[data-tone="uncited"] rect:not(.fnd-arch__hit) { fill: var(--cs-text-muted); stroke: var(--cs-text-muted); }',
    to: '.fnd-arch__pin[data-tone="uncited"] rect:not(.fnd-arch__hit) { fill: color-mix(in srgb, var(--cs-text-muted) 30%, var(--cs-surface)); stroke: none; }',
    expect: "marks reach 3:1 against the card",
  },
  {
    id: "no-row-focus-ring",
    file: STYLES,
    from: ".fnd-subject__btn:focus-visible { outline: 2px solid var(--cs-accent-clay); outline-offset: 0; }",
    to: ".fnd-subject__btn:focus-visible { outline: none; }",
    expect: "keyboard focus shows a 2px ring",
  },
  {
    id: "ss-strip-always",
    file: LAYOUT,
    from: "const hasSS = ev.secondaryStructure.length > 0 && span <= SECONDARY_MAX_SPAN;",
    to: "const hasSS = ev.secondaryStructure.length > 0;",
    expect: "the helix / strand strip is drawn only in a window of 300 residues or fewer",
  },
  {
    id: "membrane-bars-widened",
    file: LAYOUT,
    from: "\"im\" : \"tm\";\n      const w = Math.max(3, b - a);",
    to: "\"im\" : \"tm\";\n      const w = Math.max(3, b - a) + 5;",
    expect: "transmembrane bars and topology rails sit at their residues",
  },
  {
    id: "lane-over-the-axis",
    file: LAYOUT,
    from: "const axisY = (membrane ? membrane.bottom : sitesBottom) + 18;",
    to: "const axisY = sitesBottom + 18;",
    expect: "the topology lane sits between the site marks and the axis",
  },
  {
    id: "overview-window-off",
    file: LAYOUT,
    from: "window: { x: x(win.start), width:",
    to: "window: { x: x(win.start) + 8, width:",
    expect: "the overview strip brackets the window",
  },
  {
    id: "label-never-flips",
    file: LAYOUT,
    from: "const flip = !above && labelled && px + 10 + lw > W - 4;",
    to: "const flip = false;",
    expect: "every label is inside the drawing (a mark just inside the right edge of a zoomed window)",
  },
];

const hash = (file) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
const backupPath = (file) => path.join(root, "scratch", `fd-backup-${path.basename(file)}`);

function backup() {
  mkdirSync(path.join(root, "scratch"), { recursive: true });
  for (const file of TARGETS) {
    copyFileSync(path.join(root, file), backupPath(file));
    console.log(`backup   ${file}  ${hash(file).slice(0, 16)}`);
  }
}

function apply() {
  const only = process.argv.slice(3);
  const unknown = only.filter((id) => !MUTATIONS.some((m) => m.id === id));
  if (unknown.length) {
    console.error(`UNKNOWN MUTATION ID(s): ${unknown.join(", ")}\nknown: ${MUTATIONS.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }
  const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;
  const edits = new Map();
  for (const mutation of selected) {
    const source = edits.get(mutation.file) ?? readFileSync(path.join(root, mutation.file), "utf8");
    const parts = source.split(mutation.from);
    if (parts.length !== 2) {
      console.error(`MUTATION NOT APPLIED: ${mutation.id} — pattern occurs ${parts.length - 1} time(s) in ${mutation.file}`);
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
