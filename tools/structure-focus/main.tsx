import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "../../src/index.css";
import MolstarViewer from "../../src/components/MolstarViewer";
import { SettingsProvider } from "../../src/context/SettingsContext";
import { DevConsoleProvider } from "../../src/context/DevConsoleContext";
import { useVariantAnalysisStore } from "../../src/stores/useVariantAnalysisStore";
import { useStructure3dEvidence } from "../../src/lib/useStructure3dEvidence";
import { indexStructureResidues } from "../../src/shared/coordinateText";
import { buildStructureSelection } from "../../src/shared/structureSelection";
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

async function until(what: string, predicate: () => boolean, timeoutMs: number): Promise<boolean> {
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
 * Builds the canvas view by hand rather than with `useStructureWorkspace`: this page has no sign-in provider
 * (the hook's alignment request needs one), and it draws fixed SOD1 coordinates whatever the store holds.
 */
function Canvas() {
  const family = useVariantAnalysisStore(s => s.active3dModelTab === "esmfold2" ? "esmfold" : "alphafold");
  const model = useStructure3dEvidence(family);
  const pdbText = model.viewMode === "mutant" ? VARIANT_PDB : SOD1_PDB;
  const selectedResidueIndex = useVariantAnalysisStore((s) => s.selectedResidueIndex);
  const residues = useMemo(() => indexStructureResidues(pdbText), [pdbText]);
  const selection = useMemo(
    () => buildStructureSelection(model, residues, selectedResidueIndex),
    [model, residues, selectedResidueIndex],
  );
  const compare = model.viewMode === "superimposed" ? VARIANT_PDB : null;
  const view = useMemo(
    () => ({ model, coordinateIndex: residues, selection, primary: pdbText, compare, allowFetch: false }),
    [model, residues, selection, pdbText, compare],
  );
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--cs-bg)" }}>
      <MolstarViewer
        view={view}
        active
        onResidueClick={() => {}}
        onModeChange={() => {}}
        heightClass="h-full"
      />
    </div>
  );
}

function publish(): void {
  const node = document.getElementById("geometry-result");
  if (node) node.textContent = btoa(JSON.stringify({ checks: CHECKS }));
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
  store.setState({ active3dModelTab: "alphafold2", viewMode: "wildtype" });
  await until("final draw", () => companionAtoms() > 0 && drawnStructures() === "1", 60_000);

  document.title = `3D focus check — ${CHECKS.filter((c) => c.pass).length}/${CHECKS.length} passed`;
  // Written last: a crash before this leaves #geometry-result empty, and the runner reports an incomplete run
  // instead of reading a partial pass.
  publish();
}

seed();
createRoot(document.getElementById("root")!).render(
  <DevConsoleProvider>
    <SettingsProvider>
      <Canvas />
    </SettingsProvider>
  </DevConsoleProvider>,
);

void run();
