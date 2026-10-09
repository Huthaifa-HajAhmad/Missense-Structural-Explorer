// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";
import { StructureInspector } from "../inspector/StructureInspector";
import { StructureToolbar } from "../molstar/StructureToolbar";
import { StructureLegend } from "../molstar/StructureLegend";
import { StructureStatusOverlay } from "../molstar/StructureStatusOverlay";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { buildStructure3dEvidence, type Structure3dInput } from "../../shared/structure3dEvidence";
import { scanBFactors, readResidueAt } from "../../shared/coordinateText";

/**
 * What the 3D view may claim on screen, on the audit's reference variant NAE1 p.Asp116Gly: the
 * pipeline's wild type is the AlphaFold DB model; FoldX built the variant on PDB 1YOV chain A; the
 * analysis metadata names 1YOV as the structure the disruption step read (B-factor 94.5 Å²).
 */

function atom(serial: number, name: string, res: string, seq: number, b: number): string {
  return (
    "ATOM  " + String(serial).padStart(5) + " " + name.padEnd(4) + " " + res.padEnd(3) + " A" + String(seq).padStart(4) +
    "    " + (seq * 1.5).toFixed(3).padStart(8) + "   0.000   0.000  1.00" + b.toFixed(2).padStart(6) + "           C"
  );
}
const AF = ["TITLE     ALPHAFOLD MONOMER V2.0 PREDICTION FOR Q13564", atom(1, "CA", "SER", 115, 90.4), atom(2, "CA", "ASP", 116, 92.3), atom(3, "CA", "GLY", 117, 71)].join("\n");
const CRYSTAL = [atom(1, "CA", "SER", 115, 40.2), atom(2, "CA", "ASP", 116, 94.5), atom(3, "CA", "GLY", 117, 52.8), atom(4, "CA", "LYS", 118, 60.1)].join("\n");
const MUTANT = [atom(1, "CA", "SER", 115, 40.2), atom(2, "CA", "GLY", 116, 94.5), atom(3, "CA", "GLY", 117, 52.8)].join("\n");

function seed(overrides: Record<string, unknown> = {}) {
  useVariantAnalysisStore.setState({
    analysisState: {
      isLoading: false,
      error: null,
      result: {
        metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", residueIndex: 116, wildType: "Asp", mutant: "Gly", pdbId: "1YOV", pdbSource: "RCSB PDB" },
        disruptionPredictor: { level: "low", reason: "", plddt: null, bFactor: 94.5, bFactorKind: "temperature-factor", burialStatus: "surface", rsa: 0.41 },
      },
    } as any,
    uniprotId: "Q13564",
    gene: "NAE1",
    pdbText: AF,
    pdbTextProvenance: { source: "alphafold", afdbVersion: "v6" },
    customPdbUrl: null,
    customPdbEntry: null,
    viewMode: "wildtype",
    structureRepresentation: "confidence",
    selectedResidueIndex: 116,
    mutantPdb: MUTANT,
    foldingStatus: "success",
    isFolding: false,
    foldingDdG: 2.62,
    foldingEnergetics: { foldxMean: 2.62, foldxSd: 0.11, rawDdGs: [2.5, 2.6, 2.7, 2.61, 2.69], structureProvenance: { source: "experimental", pdbId: "1YOV", chainId: "A" } },
    foldxReference: { state: "ready", reason: null, provenance: { source: "experimental", pdbId: "1YOV", chainId: "A" } },
    foldxReferencePdb: CRYSTAL,
    foldxAlignedPdb: MUTANT,
    foldxMetrics: { localWindowRmsd: 0, globalRmsd: 0, maxCaDisplacement: 0, wtChi1: -65.2, mutChi1: null, chi1Deviation: null, wtSasa: 41.3, mutSasa: 12.8, lostHBonds: 2, gainedHBonds: 0, lostContacts: 3, gainedContacts: 0 },
    homologs: [
      { pdbId: "1YOV", score: 1, identity: 100, coverage: 100, title: "", organism: "Homo sapiens", method: "X-RAY DIFFRACTION", resolution: 2.6, isHuman: true, querySeqFrom: 1, querySeqTo: 534, coversPosition: true },
      { pdbId: "9QN5", score: 0.05, identity: null, coverage: null, title: "", organism: "Homo sapiens", method: "ELECTRON MICROSCOPY", resolution: 1.97, isHuman: true },
    ],
    isHomologsLoading: false,
    esmFoldWtPdb: null,
    esmFoldMutPdb: null,
    esmFoldingError: null,
    isEsmFolding: false,
    ...overrides,
  } as any);
}

beforeEach(() => {
  cleanup();
  seed();
});

describe("coordinate load recovery", () => {
  it("retries the canvas load without silently rerunning structural analysis", () => {
    const retryLoad = vi.fn();
    const retryAnalysis = vi.fn();
    const { getByRole } = render(<StructureStatusOverlay
      family="alphafold" hasVariant loading={false} loadError="Coordinate parse failed"
      deNovoFolding={false} deNovoError={null} deNovoLoaded={false}
      proteinLength={null} scanWindowLength={null} customEntryLoaded={false}
      onRetryLoad={retryLoad} onRetryStructural={retryAnalysis}
    />);
    fireEvent.click(getByRole("button", { name: "Retry loading coordinates" }));
    expect(retryLoad).toHaveBeenCalledOnce();
    expect(retryAnalysis).not.toHaveBeenCalled();
  });
});

describe("3D rail — NAE1 p.Asp116Gly", () => {
  it("names the AlphaFold model as the wild type and never calls 1YOV's B-factor pLDDT", () => {
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const text = container.textContent ?? "";
    expect(within(container.querySelector("[data-testid='structure-rail-canvas']") as HTMLElement).getByText("AF-Q13564-F1 v6")).toBeTruthy();
    expect(text).toContain("pLDDT 92.3 · very high");
    expect(text).not.toMatch(/pLDDT 94\.5/);
    expect(text).not.toMatch(/\bN\/A\b/);
    expect(container.textContent).not.toContain("Side-chain comparison");
    expect(container.textContent).not.toContain("Coordinate comparison");
  });

  it("describes the FoldX variant by its template and states that ΔΔG is not pathogenicity", () => {
    seed({ viewMode: "mutant" });
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const text = container.textContent ?? "";
    expect(text).toContain("FoldX variant on PDB 1YOV chain A");
    expect(text).toContain("The variant is not built on the wild type shown");
    expect(text).toMatch(/a stability estimate, not pathogenicity/);
    expect(text).toContain("Side-chain comparison");
    expect(text).not.toContain("Local Cα RMSD");
  });

  it("prints χ1 as not applicable for the glycine, and never 0.0°", () => {
    seed({ viewMode: "superimposed" });
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const readings = container.querySelector("[data-testid='structure-readings']") as HTMLElement;
    expect(readings).toBeTruthy();
    expect(readings.textContent).toContain("Not applicable");
    expect(readings.textContent).toContain("Gly has no χ1");
    expect(container.textContent).not.toContain("0.0°");
    expect(readings.textContent).not.toContain("Cα RMSD");
    expect(container.textContent).toContain("Cα motion and RMSD are zero by construction");
  });

  it("lists experimental entries without inventing identity or coverage", () => {
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const entries = container.querySelector("[data-testid='structure-entries']") as HTMLElement;
    expect(entries.textContent).toContain("identity not reported");
    expect(entries.textContent).toContain("range not reported");
    expect(entries.textContent).not.toMatch(/5% ID|In Range/);
  });

  it("cites AlphaFold and FoldX in the AlphaFold view, and ends the trace with the engine record", () => {
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const sources = container.querySelector("[data-testid='structure-sources']") as HTMLElement;
    expect(sources.textContent).toContain("10.1038/s41586-021-03819-2");
    expect(sources.textContent).toContain("10.1093/bioinformatics/btz184");
    expect(sources.textContent).not.toContain("10.1126/science.ade2574");
    const steps = container.querySelectorAll("[data-testid='structure-rule-trace'] > li");
    expect(steps).toHaveLength(5);
    expect(steps[4].textContent).toContain("Engine record");
  });
});

describe("3D toolbar and legend", () => {
  const input = (overrides: Partial<Structure3dInput> = {}): Structure3dInput => ({
    family: "alphafold",
    viewMode: "wildtype",
    representation: "confidence",
    variant: { position: 116, wildType: "Asp", mutant: "Gly", uniprotId: "Q13564", gene: "NAE1" },
    selectedResidue: null,
    wildType: { provenance: { source: "alphafold", afdbVersion: "v6" }, customPdbUrl: null, scan: scanBFactors(AF), site: readResidueAt(AF, 116) },
    foldx: {
      running: true, phaseLabel: "Repair", status: null, error: null, ddG: null, ddGSd: null, runs: null,
      template: null, repairSkipped: false, repairSkippedReason: null, repairFailed: false,
      reference: { state: "idle", reason: null, provenance: null }, aligned: false, referenceSite: null,
    },
    deNovo: { folding: false, error: null, wildTypeLoaded: false, variantLoaded: false, singleStructure: false, engines: null, scan: null, aligned: false, site: null },
    alignmentScope: "global",
    metrics: null,
    esm3: null,
    region: null,
    burial: null,
    homologs: [],
    homologsLoading: false,
    ...overrides,
  });

  const noop = () => {};
  const toolbar = (model: ReturnType<typeof buildStructure3dEvidence>, extra: Partial<React.ComponentProps<typeof StructureToolbar>> = {}) =>
    render(
      <StructureToolbar
        model={model}
        variantPosition={116}
        selectedResidue={200}
        onModeChange={noop}
        onRepresentationChange={noop}
        plddtFilter="none"
        onPlddtFilterChange={noop}
        onFocusSite={noop}
        pocketOpen={false}
        onTogglePocket={noop}
        captureOpen={false}
        setCaptureOpen={vi.fn()}
        captureMenuRef={React.createRef()}
        onDownload={noop}
        onCopy={noop}
        copyState="idle"
        onOpenGuide={noop}
        isFullscreen={false}
        onToggleFullscreen={noop}
        {...extra}
      />
    );

  it("disables the variant and superposition while FoldX runs, and says why", () => {
    const { container } = toolbar(buildStructure3dEvidence(input()));
    const modes = container.querySelectorAll("[data-testid='structure-modes'] [role='radio']");
    expect(modes[1].getAttribute("aria-disabled")).toBe("true");
    expect(modes[1].getAttribute("title")).toBe("FoldX is running: repair.");
    expect(modes[0].getAttribute("aria-checked")).toBe("true");
  });

  it("names the canvas from its own provenance and marks a clicked residue as a selection", () => {
    const { container } = toolbar(buildStructure3dEvidence(input()));
    expect(container.querySelector("[data-testid='structure-source']")?.textContent).toContain("AF-Q13564-F1 v6");
    expect(container.querySelector("[data-testid='structure-site']")?.textContent).toContain("Asp116Gly");
    expect(container.textContent).toContain("Selected 200");
  });

  it("frames the selected residue from a named button, which is inert when unavailable", () => {
    const onFocusSelection = vi.fn();
    const first = toolbar(buildStructure3dEvidence(input()), { onFocusSelection });
    fireEvent.click(first.getByRole("button", { name: "Selected 200, frame on structure" }));
    expect(onFocusSelection).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = toolbar(buildStructure3dEvidence(input()));
    expect((second.getByRole("button", { name: "Selected 200, frame on structure" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores Home and End when only one mode is available", () => {
    const onModeChange = vi.fn();
    const { container } = toolbar(buildStructure3dEvidence(input()), { onModeChange });
    const modes = container.querySelectorAll<HTMLElement>("[data-testid='structure-modes'] [role='radio']");
    fireEvent.keyDown(modes[0], { key: "Home" });
    fireEvent.keyDown(modes[0], { key: "End" });
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("never offers the pLDDT filter for crystal temperature factors", () => {
    const crystal = buildStructure3dEvidence(
      input({ wildType: { provenance: { source: "experimental", pdbId: "1YOV", chainId: "A" }, customPdbUrl: null, scan: scanBFactors(CRYSTAL), site: readResidueAt(CRYSTAL, 116) } })
    );
    const { container } = toolbar(crystal);
    expect(container.textContent).not.toContain("pLDDT ≥ 70");
    fireEvent.click(within(container).getByRole("button", { name: /display/i }));
    expect((container.querySelector("[data-testid='structure-colour']") as HTMLSelectElement).value).toBe("confidence");
    expect(container.textContent).toContain("B-factor, relative");
  });

  it("keys the colouring and states the band provenance", () => {
    const { container } = render(<StructureLegend legend={buildStructure3dEvidence(input()).legend} />);
    const legend = container.querySelector("[data-testid='structure-legend']")!;
    expect(legend.getAttribute("data-provenance")).toBe("published");
    expect(legend.textContent).toContain("Very high");
    expect(legend.textContent).toContain("AlphaFold DB bands");
  });
});
