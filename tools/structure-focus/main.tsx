import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "../../src/index.css";
import MolstarViewer from "../../src/components/MolstarViewer";
import { SettingsProvider } from "../../src/context/SettingsContext";
import { DevConsoleProvider } from "../../src/context/DevConsoleContext";
import { useVariantAnalysisStore } from "../../src/stores/useVariantAnalysisStore";
import { useStructure3dEvidence } from "../../src/lib/useStructure3dEvidence";
import { indexStructureResidues, readCaTrace } from "../../src/shared/coordinateText";
import { summariseSecondary } from "../../src/shared/structureSecondary";
import { buildStructureSelection } from "../../src/shared/structureSelection";
import { fitContextOntoTemplate } from "../../src/shared/structureContext";
import type { ResidueFocus } from "../../src/shared/residueFocus";
import SOD1_PDB from "./sod1-afdb.pdb?raw";

/**
 * The 3D canvas's residue focus, checked in a real WebGL context.
 *
 * WHY A BROWSER: "Show both cysteines in 3D" and "Show interface in 3D" promise that the viewer draws a residue SET,
 * not just the variant residue. Every layer under that promise — the caption, the store action, the prop, the Mol*
 * structure component, the atoms it resolves — can be individually correct while the canvas draws one residue, and a
 * vitest assertion would still pass: it can only see that `companionResidues` was passed. The check here reads what the
 * viewer wrote back after building the component (`data-companion-residues`, `data-companion-atoms`), so an empty
 * resolution — residues numbered for a different structure, say — fails instead of looking like success.
 *
 * FIXTURE: the real AlphaFold DB model for SOD1 (P00441, model_v6, 154 residues), which carries the Cys58–Cys147
 * disulfide UniProt records and the real homodimer interface residues. Not illustrative: the coordinates are
 * downloaded, not drawn. The variant is SOD1 p.Ala5Val (residue 5 is ALA in the model, which is what lets the canvas
 * address the site at all).
 *
 * Case order matters for the screenshot: the last state left on screen is the disulfide pair, labelled, because that
 * is the picture this check exists to produce.
 */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const CHECKS: Check[] = [];
function record(name: string, pass: boolean, detail: string): void {
  CHECKS.push({ name, pass, detail });
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(() => setTimeout(() => resolve(), 0), 0));

async function until(_what: string, predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await nextFrame();
  }
  return predicate();
}

const container = () => document.getElementById("molstar-viewer-container");
const banner = () => document.querySelector<HTMLElement>('[data-testid="structure-residue-focus"]');
const companionResidues = () => container()?.getAttribute("data-companion-residues") ?? null;
const companionAtoms = () => Number(container()?.getAttribute("data-companion-atoms") ?? "0");

const DISULFIDE: ResidueFocus = {
  companions: [147],
  label: "Disulfide bond between Cys58 and Cys147",
};
/** The real SOD1 dimer interface patch: 50–54 and 113–115 sit against the partner subunit in PDB 1SOS. */
const INTERFACE: ResidueFocus = {
  companions: [50, 51, 52, 53, 54],
  label: "SOD1 homodimer interface: 5 residues observed in 142 solved structures (PDBe-KB), not computed on this model",
};

/** A Hotspots-view set: SOD1 ClinVar P/LP residues near Ala5, more than the four labelled by default. */
const HOTSPOT_SET: ResidueFocus = {
  companions: [4, 7, 8, 10, 12, 14, 16, 21, 38, 41],
  label: "ClinVar P/LP missense residues, germline (11)",
};
const guideCard = () => document.querySelector<HTMLElement>('[data-testid="structure-guide-card"]');
const companionLabels = () => container()?.getAttribute("data-companion-labels") ?? null;
const drawnStructures = () => container()?.getAttribute("data-drawn-structures") ?? null;
const drawnVersion = () => Number(container()?.getAttribute("data-drawn-version") ?? "0");

// The same coordinates isolate viewer behavior; this is not a predicted variant structure.
const VARIANT_PDB = SOD1_PDB.split("\n").map(line => line.startsWith("ATOM") && Number(line.slice(22, 26)) === 5
  ? line.slice(0, 17) + "VAL" + line.slice(20) : line).join("\n");

const store = useVariantAnalysisStore;

function seed(): void {
  store.setState(
    {
      gene: "SOD1",
      variant: "p.Ala5Val",
      uniprotId: "P00441",
      pdbText: SOD1_PDB,
      active3dModelTab: "alphafold2",
      mutantPdb: VARIANT_PDB,
      foldingStatus: "success",
      foldingEnergetics: { structureProvenance: { source: "alphafold", uniprotId: "P00441" } },
      foldxReference: { state: "ready", reason: null, provenance: { source: "alphafold", uniprotId: "P00441" } },
      foldxReferencePdb: SOD1_PDB,
      foldxAlignedPdb: VARIANT_PDB,
      esmFoldWtPdb: SOD1_PDB,
      esmFoldMutPdb: VARIANT_PDB,
      esmFoldAlignedPdb: VARIANT_PDB,
      pdbTextProvenance: null,
      viewMode: "wildtype",
      selectedResidueIndex: null,
      residueFocus: null,
      analysisState: {
        isLoading: false,
        error: null,
        result: {
          metadata: {
            gene: "SOD1",
            variant: "p.Ala5Val",
            residueIndex: 5,
            wildType: "A",
            mutant: "V",
            uniprotId: "P00441",
            sequence:
              "MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ",
          },
        },
      },
    } as never,
    false,
  );
}

/**
 * The four lines `AppViews` uses to feed the canvas, repeated rather than imported: they are a few `useMemo`s over
 * store selectors, and importing the whole workspace would mount nine other views and their data.
 */
/** Residues 20–60 of the variant, in another frame: what a short experimental template looks like to the canvas. */
const FRAGMENT_PDB = VARIANT_PDB.split("\n").filter(line => {
  const seq = Number.parseInt(line.slice(22, 26), 10);
  return line.startsWith("ATOM  ") && seq >= 20 && seq <= 60;
}).map(line => {
  const x = Number.parseFloat(line.slice(30, 38));
  const y = Number.parseFloat(line.slice(38, 46));
  const z = Number.parseFloat(line.slice(46, 54));
  const f = (v: number) => v.toFixed(3).padStart(8);
  return `${line.slice(0, 30)}${f(-y + 30)}${f(x - 12)}${f(z + 7)}${line.slice(54)}`;
}).join("\n");

function Canvas() {
  const family = useVariantAnalysisStore(s => s.active3dModelTab === "esmfold2" ? "esmfold" : "alphafold");
  const model = useStructure3dEvidence(family);
  // Switched on by the check, after the ordinary mode cases: the variant then draws a short template with the full model around it.
  const [fragmentTemplate, setFragmentTemplate] = useState(false);
  useEffect(() => {
    const on = () => setFragmentTemplate(true);
    window.addEventListener("fragment-template", on);
    return () => window.removeEventListener("fragment-template", on);
  }, []);
  const contextFit = useMemo(() => (fragmentTemplate ? fitContextOntoTemplate(SOD1_PDB, FRAGMENT_PDB) : null), [fragmentTemplate]);
  const pdbText = model.viewMode === "mutant" ? (fragmentTemplate ? FRAGMENT_PDB : VARIANT_PDB) : SOD1_PDB;
  const selectedResidueIndex = useVariantAnalysisStore((s) => s.selectedResidueIndex);
  const residues = useMemo(() => indexStructureResidues(pdbText), [pdbText]);
  const secondary = useVariantAnalysisStore((s) => s.canvasSecondary);
  const trace = useMemo(() => readCaTrace(pdbText), [pdbText]);
  const context = useMemo(() => ({ secondary, trace, features: null }), [secondary, trace]);
  const selection = useMemo(
    () => buildStructureSelection(model, residues, selectedResidueIndex, context),
    [model, residues, selectedResidueIndex, context],
  );
  const siteSelection = useMemo(() => buildStructureSelection(model, residues, 5, context), [model, residues, context]);
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--cs-bg)" }}>
      <MolstarViewer
        model={model}
        coordinateIndex={residues}
        selection={selection}
        siteSelection={siteSelection}
        active
        primaryPdbData={pdbText}
        comparePdbData={model.viewMode === "superimposed" ? VARIANT_PDB : null}
        contextFit={contextFit}
        allowFetch={false}
        variantPosition={5}
        selectedResidue={selectedResidueIndex ?? null}
        onResidueClick={() => {}}
        onModeChange={() => {}}
        heightClass="h-full"
      />
    </div>
  );
}

function publish(): void {
  const node = document.getElementById("geometry-result");
  // UTF-8 first: details carry "Å" and "α", which `btoa` (Latin-1 only) rejects. check.mjs decodes UTF-8.
  const bytes = new TextEncoder().encode(JSON.stringify({ checks: CHECKS }));
  if (node) node.textContent = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

async function run(): Promise<void> {
  const canvasReady = await until(
    "viewer canvas",
    () => Boolean(container()?.querySelector("canvas")),
    45_000,
  );
  record("Mol* created a WebGL canvas on this machine", canvasReady, canvasReady ? "canvas present" : "no canvas after 45 s");

  // The first draw is what the companion attributes are written after; without it the "no companions" case below
  // would pass for the wrong reason (nothing had drawn at all).
  const firstDraw = await until(
    "first structure draw",
    () => Boolean(document.querySelector('[data-testid="structure-source"]')?.textContent?.includes("AF-P00441")),
    45_000,
  );
  record("the fixture loads as the AlphaFold model for P00441", firstDraw, document.querySelector('[data-testid="structure-source"]')?.textContent ?? "no source chip");
  await until("settle", () => false, 1_500);

  // ── Secondary structure, as Mol* assigned it on the drawn model ────────────────────────────────────────────
  // SOD1 is a Greek-key β-barrel (eight strands, two short helices): a real DSSP reading must find mostly strand.
  const readSecondary = await until("secondary structure", () => Boolean(store.getState().canvasSecondary), 20_000);
  const secondary = store.getState().canvasSecondary;
  const summary = secondary ? summariseSecondary(secondary) : null;
  record("Mol* assigns DSSP to the predicted model and the viewer publishes it", readSecondary && secondary?.source === "dssp" && secondary.chain === "A" && secondary.residueCount === 154,
    secondary ? `${secondary.source}, chain ${secondary.chain}, ${secondary.residueCount} residues` : "nothing published");
  record("the SOD1 β-barrel reads as mostly strand", Boolean(summary && summary.strands >= 6 && summary.strandFraction > 0.3 && summary.strandFraction > summary.helixFraction),
    summary ? `${summary.strands} strands (${Math.round(summary.strandFraction * 100)}%), ${summary.helices} helices (${Math.round(summary.helixFraction * 100)}%)` : "no summary");

  // ── Callouts: a card per residue, tied to its Cα by a leader line ──────────────────────────────────────────
  const stageBox = () => document.querySelector<HTMLElement>(".s3d-stage")!.getBoundingClientRect();
  const calloutLine = (key: string) => document.querySelectorAll<SVGPathElement>(".s3d-callouts__line")[[...document.querySelectorAll("[data-callout]")].findIndex(c => c.getAttribute("data-callout") === key)];
  /** The last point of the leader path: "M x y L x y L x y". */
  const lineEnd = (key: string) => {
    const d = calloutLine(key)?.getAttribute("d") ?? "";
    const parts = d.split("L").pop()?.trim().split(/\s+/).map(Number) ?? [];
    return parts.length === 2 ? { x: parts[0], y: parts[1] } : null;
  };
  /** A card is only usable once the placement pass has run: before that it sits at the stage origin. */
  const placed = (key: string) => document.querySelector(`[data-callout="${key}"]`)?.getAttribute("data-placed") === "true";
  const lineInside = (key: string) => {
    const line = calloutLine(key);
    if (!line || line.style.display === "none" || !placed(key)) return false;
    const end = lineEnd(key);
    if (!end) return false;
    const box = stageBox();
    return end.x > 0 && end.y > 0 && end.x < box.width && end.y < box.height;
  };
  const siteCallout = await until("site callout", () => lineInside("site"), 20_000);
  const siteCard = document.querySelector('[data-callout="site"]');
  record("the variant site has a callout whose leader line ends on the canvas", siteCallout,
    `${siteCard?.textContent?.slice(0, 120)} · line to (${lineEnd("site")?.x}, ${lineEnd("site")?.y})`);
  record("the site callout names the element DSSP assigned there", /(helix|strand|Turn|Bend|Coil)/.test(siteCard?.textContent ?? ""), siteCard?.textContent ?? "no card");
  record("the site's row moved from the guide card to its callout", !document.querySelector('[data-guide-item="site"]'), document.querySelector('[data-guide-item="site"]') ? "still in guide" : "guide row absent");

  store.getState().setSelectedResidueIndex(100);
  const trace = readCaTrace(SOD1_PDB);
  const at = (r: number) => trace.residues.indexOf(r) * 3;
  const expected = Math.hypot(trace.coords[at(100)] - trace.coords[at(5)], trace.coords[at(100) + 1] - trace.coords[at(5) + 1], trace.coords[at(100) + 2] - trace.coords[at(5) + 2]);
  const selectedCallout = await until("selected callout", () => lineInside("selected"), 20_000);
  const selectedText = document.querySelector('[data-callout="selected"]')?.textContent ?? "";
  record("a selected residue gets its own callout and line", selectedCallout, selectedText.slice(0, 140));
  record("its distance to the variant site is the Cα–Cα distance in the file", selectedText.includes("To site") && selectedText.includes(`${expected.toFixed(1)} Å`), `expected ${expected.toFixed(1)} Å; card: ${selectedText.slice(0, 140)}`);
  const xBefore = lineEnd("selected")?.x;
  const siteBefore = lineEnd("site")?.x;
  const clickFrame = () => document.querySelector<HTMLButtonElement>('[data-callout="selected"] .s3d-callout__icon')?.click();
  // The claim is that the click starts a camera move and the lines re-project. Both anchors must move:
  // one moving alone would be a redraw artefact, not a camera change.
  const cameraMoved = () => Math.abs((lineEnd("selected")?.x ?? xBefore ?? 0) - (xBefore ?? 0)) > 0.1
    && Math.abs((lineEnd("site")?.x ?? siteBefore ?? 0) - (siteBefore ?? 0)) > 0.05;
  clickFrame();
  let followed = await until("line follows the camera", cameraMoved, 10_000);
  if (!followed) {
    // The card may have re-rendered between locating it and clicking it; retry once against the live node.
    clickFrame();
    followed = await until("line follows the camera", cameraMoved, 10_000);
  }
  record("framing the residue moves the camera and the line follows it", followed, `selected x ${xBefore} to ${lineEnd("selected")?.x}; site x ${siteBefore} to ${lineEnd("site")?.x}`);
  store.getState().setSelectedResidueIndex(null);

  // ── Secondary-structure colouring ──────────────────────────────────────────────────────────────────────────
  store.getState().setStructureRepresentation("secondary");
  document.querySelector<HTMLButtonElement>('.s3d-legend[data-collapsed="true"] .s3d-legend__toggle')?.click();
  const keyed = await until("secondary legend", () => /Secondary structure/.test(document.querySelector(".s3d-legend")?.textContent ?? ""), 20_000);
  record("the cartoon can be coloured by secondary structure, keyed with its source", keyed && /DSSP \(Kabsch & Sander 1983\)/.test(document.querySelector(".s3d-legend")?.textContent ?? ""),
    document.querySelector(".s3d-legend")?.textContent?.slice(0, 160) ?? "no legend");
  store.getState().setStructureRepresentation("confidence");

  record(
    "no companion set is drawn before any focus is chosen",
    companionResidues() === null && banner() === null,
    `data-companion-residues=${companionResidues()}, banner=${banner() ? "present" : "absent"}`,
  );

  // ── A disulfide pair ────────────────────────────────────────────────────────────────────────────────────────
  store.getState().selectResidueWithFocus(58, DISULFIDE);
  const drewPair = await until("disulfide companions", () => companionAtoms() > 0, 45_000);
  const pairAtoms = companionAtoms();
  record("Mol* resolves the partner cysteine to atoms", drewPair && pairAtoms > 0, `${pairAtoms} atoms for residue 147`);
  record(
    "the viewer reports the companion count it drew",
    companionResidues() === "1",
    `data-companion-residues=${companionResidues()}`,
  );
  record(
    "the caption names both cysteines",
    /Disulfide bond between Cys58 and Cys147/.test(banner()?.textContent ?? ""),
    banner()?.textContent?.trim().slice(0, 120) ?? "no banner",
  );
  record(
    "the caption carries the count the canvas was given",
    banner()?.getAttribute("data-focus-count") === "1",
    `data-focus-count=${banner()?.getAttribute("data-focus-count")}`,
  );
  record(
    "the canvas can address the variant site, which is what allows companions to draw at all",
    Boolean(document.querySelector('button[data-testid="structure-site"]')) &&
      !document.querySelector('[data-kind="unmapped"]'),
    document.querySelector('[data-testid="structure-site"]')?.getAttribute("data-kind") ?? "site button present",
  );

  // ── An interface patch ──────────────────────────────────────────────────────────────────────────────────────
  store.getState().selectResidueWithFocus(5, INTERFACE);
  const drewPatch = await until("interface companions", () => companionResidues() === "5", 45_000);
  record("Mol* draws all five interface residues", drewPatch, `data-companion-residues=${companionResidues()}`);
  record("the interface patch resolves to atoms", companionAtoms() > 0, `${companionAtoms()} atoms across 5 residues`);
  record(
    "the interface caption says where the residues come from",
    /observed in 142 solved structures/.test(banner()?.textContent ?? ""),
    banner()?.textContent?.trim().slice(0, 160) ?? "no banner",
  );

  // ── A Hotspots set, larger than the default labelled size ──────────────────────────────────────────────────
  store.getState().selectResidueWithFocus(5, HOTSPOT_SET);
  const drewSet = await until("hotspot companions", () => companionResidues() === "10", 45_000);
  record("the canvas guide keys the highlighted set with its source", drewSet && /ClinVar P\/LP missense residues, germline/.test(guideCard()?.textContent ?? ""), guideCard()?.textContent?.trim().slice(0, 160) ?? "no guide card");
  record("a set above four residues is not labelled until the reader asks", companionLabels() === "off", `data-companion-labels=${companionLabels()}`);
  const labelAll = Array.from(document.querySelectorAll<HTMLInputElement>(".s3d-guide__check input")).find((i) => /Label all 10/.test(i.parentElement?.textContent ?? ""));
  record("the guide offers to label all ten", Boolean(labelAll), labelAll ? "checkbox present" : "no checkbox");
  labelAll?.click();
  const labelled = await until("label all", () => companionLabels() === "on", 45_000);
  record("asking labels every highlighted residue on the canvas", labelled, `data-companion-labels=${companionLabels()}`);

  // ── Clearing ───────────────────────────────────────────────────────────────────────────────────────────────
  store.getState().setSelectedResidueIndex(null);
  const cleared = await until("clear", () => companionResidues() === null && banner() === null, 10_000);
  record("clearing the selection removes the companions and the caption", cleared, `data-companion-residues=${companionResidues()}`);

  // Leave the disulfide on screen: this is the state the screenshot is for.
  store.getState().selectResidueWithFocus(58, DISULFIDE);
  const restored = await until("restore disulfide", () => companionAtoms() > 0, 45_000);
  record("the focus can be re-applied after clearing", restored, `${companionAtoms()} atoms`);

  // Every case starts from a cleared focus and ends with a fresh draw, so a result left over from the case before
  // cannot pass. A reload is proven by `drawnVersion` going up; the focus is re-applied only after it.
  const sourceOf = { wildtype: "wild type", mutant: "variant", superimposed: "wild type + variant" } as const;
  const modeLabel = { wildtype: "Wild type", mutant: "Variant", superimposed: "Superposition" } as const;
  let previousSource: string = sourceOf.wildtype;
  for (const family of ["alphafold2", "esmfold2"] as const) {
    for (const viewMode of ["wildtype", "mutant", "superimposed"] as const) {
      const name = `${family} ${viewMode}`;
      store.getState().setSelectedResidueIndex(null);
      await until("clear before mode", () => companionAtoms() === 0 && companionLabels() === null, 10_000);
      const versionBefore = drawnVersion();
      store.setState({ active3dModelTab: family, viewMode });
      const expectedStructures = viewMode === "superimposed" ? "2" : "1";
      const mustReload = sourceOf[viewMode] !== previousSource;
      const loaded = await until("mode load", () => (!mustReload || drawnVersion() > versionBefore) && drawnStructures() === expectedStructures, 60_000);
      previousSource = sourceOf[viewMode];
      record(`${name} loads ${expectedStructures === "2" ? "both structures" : "one structure"} after the switch`, loaded, `${drawnStructures()} structure(s), load ${versionBefore} to ${drawnVersion()}, reload ${mustReload ? "required" : "not needed"}`);
      store.getState().selectResidueWithFocus(58, DISULFIDE);
      const drawn = await until("mode companions", () => companionAtoms() > 0 && companionLabels() === "on", 30_000);
      record(`${name} draws highlighted atoms and labels`, drawn, `${companionAtoms()} atoms, labels ${companionLabels()}`);
      const checked = document.querySelector('[data-testid="structure-modes"] [aria-checked="true"]')?.textContent?.trim();
      record(`${name} keeps the requested mode`, checked === modeLabel[viewMode], `${checked}`);
    }
  }
  // A template that covers only residues 20–60: the full model must be drawn around it, fitted onto it.
  store.setState({ active3dModelTab: "alphafold2", viewMode: "mutant" });
  await until("variant drawn", () => drawnStructures() === "1", 60_000);
  window.dispatchEvent(new Event("fragment-template"));
  const contextDrawn = await until("context drawn", () => container()?.getAttribute("data-drawn-context") === "1", 60_000);
  record("a short template is drawn with the full-length model faint around it", contextDrawn, `drawnContext=${container()?.getAttribute("data-drawn-context")}, guide: ${document.querySelector('[data-guide-item="context"]')?.textContent?.slice(0, 120) ?? "no row"}`);
  store.setState({ active3dModelTab: "alphafold2", viewMode: "wildtype" });
  await until("final draw", () => companionAtoms() > 0 && drawnStructures() === "1", 60_000);

  document.title = `3D focus check — ${CHECKS.filter((c) => c.pass).length}/${CHECKS.length} passed`;
  // Written last: a crash before this leaves #geometry-result empty, and the runner reports an incomplete run
  // instead of reading a partial pass.
  publish();
}

seed();
// Camera flights are not what this harness tests, and an animated flight leaves the residue's true
// screen position undefined until enough frames have run. Snapping the camera makes a cold browser
// profile as deterministic as a warm one.
try {
  localStorage.setItem("missenseUserSettings", JSON.stringify({ cameraDuration: 0 }));
} catch { /* the check still runs; only the timing guarantee is lost */ }
createRoot(document.getElementById("root")!).render(
  <DevConsoleProvider>
    <SettingsProvider>
      <Canvas />
    </SettingsProvider>
  </DevConsoleProvider>,
);

void run();
