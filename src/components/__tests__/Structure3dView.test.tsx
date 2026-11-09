// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook, cleanup, fireEvent, within } from "@testing-library/react";
import React from "react";
import { useStructure3dEvidence } from "../../lib/useStructure3dEvidence";
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

/** Local coordinates so the ESMFold family can offer its variant and superposition modes. */
const ESM_COORDINATES = { esmFoldWtPdb: AF, esmFoldMutPdb: MUTANT, esmFoldAlignedPdb: MUTANT };

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

describe("de novo overlay for a protein past AlphaFold DB's ceiling", () => {
  const base = {
    family: "esmfold" as const, hasVariant: true, loading: false, loadError: null,
    deNovoFolding: false, deNovoError: null, deNovoLoaded: false, scanWindowLength: null,
    customEntryLoaded: false, onSwitchToAlphaFold: () => {},
  };
  it("says AlphaFold DB has no model either, and labels the fallback honestly", () => {
    const { container, getByRole } = render(<StructureStatusOverlay {...base} proteinLength={4302} />);
    expect(container.textContent).toContain("no full-length model for a protein this long either");
    expect(container.textContent).toContain("2,700 aa");
    expect(getByRole("button", { name: "Open the AlphaFold2 view (experimental entry)" })).toBeTruthy();
  });
  it("makes no AlphaFold claim for a protein inside the ceiling or of unknown length", () => {
    for (const proteinLength of [900, null]) {
      cleanup();
      const { container, getByRole } = render(<StructureStatusOverlay {...base} proteinLength={proteinLength} />);
      expect(container.textContent).not.toContain("either");
      expect(getByRole("button", { name: "Open the AlphaFold2 view" })).toBeTruthy();
    }
  });
});

describe("3D rail — NAE1 p.Asp116Gly", () => {
  it.each([
    ['known AlphaFold', {}, 'Explain this structure confidence measure', 'pLDDT'],
    ['unknown provenance', { pdbText: CRYSTAL, pdbTextProvenance: null }, 'Why structure confidence is not interpreted', 'Uninterpreted structure confidence'],
  ])('opens confidence guidance appropriate to %s', (_label, overrides, trigger, title) => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    seed(overrides);
    const view = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    fireEvent.click(view.getByRole('button', { name: trigger }));
    expect(view.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(within(view.getByRole('dialog')).getByRole('heading', { level: 2 }).textContent).toContain(title);
  });
  it("keeps the guide on the AlphaFold model's own confidence measure while its coordinates are still loading", () => {
    seed({ pdbText: null });
    const view = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const guide = view.getByRole("button", { name: "Explain this structure confidence measure" });
    expect(guide.getAttribute("data-explanation-topic")).toBe("plddt");
    expect(view.container.textContent).not.toMatch(/N\/A/);
  });

  it("names the AlphaFold model as the wild type and never calls 1YOV's B-factor pLDDT", () => {
    const { container } = render(<StructureInspector family="alphafold" setCustomPdbUrl={() => {}} />);
    const text = container.textContent ?? "";
    expect(within(container.querySelector("[data-testid='structure-rail-canvas']") as HTMLElement).getByText("AF-Q13564-F1 v6")).toBeTruthy();
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
        onDownloadImage={async () => {}}
        onCopyImage={async () => true}
        isFullscreen={false}
        onToggleFullscreen={noop}
        {...extra}
      />
    );

  it("the image menu owns its open state: copy reports the result, Escape and an outside click close it", async () => {
    const onCopyImage = vi.fn(async () => false);
    const onDownloadImage = vi.fn(async () => {});
    const { getByRole, queryByRole } = toolbar(buildStructure3dEvidence(input()), { onCopyImage, onDownloadImage });
    const trigger = getByRole("button", { name: "Save or copy an image of the view" });

    fireEvent.click(trigger);
    fireEvent.click(getByRole("button", { name: /Copy to clipboard/ }));
    expect(onCopyImage).toHaveBeenCalledTimes(1);
    expect(queryByRole("group", { name: "Image actions" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(await within(trigger).findByText("Copy failed")).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.click(getByRole("button", { name: /Download PNG/ }));
    expect(onDownloadImage).toHaveBeenCalledTimes(1);
    expect(queryByRole("group", { name: "Image actions" })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("group", { name: "Image actions" })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(queryByRole("group", { name: "Image actions" })).toBeNull();
  });

  it("disables the variant and superposition while FoldX runs, and says why", () => {
    const { container } = toolbar(buildStructure3dEvidence(input()));
    const modes = container.querySelectorAll("[data-testid='structure-modes'] [role='radio']");
    expect(modes[1].getAttribute("aria-disabled")).toBe("true");
    expect(modes[1].getAttribute("title")).toBe("FoldX is running: repair.");
    expect(modes[0].getAttribute("aria-checked")).toBe("true");
  });

  it("lets the site button return to the variant when another residue is selected", () => {
    const onFocusSite = vi.fn();
    const away = toolbar(buildStructure3dEvidence(input()), { onFocusSite });
    const button = away.container.querySelector<HTMLButtonElement>("button[data-testid='structure-site']")!;
    expect(button.title).toContain("Return to the variant");
    fireEvent.click(button);
    expect(onFocusSite).toHaveBeenCalledOnce();
    cleanup();
    const onVariant = toolbar(buildStructure3dEvidence(input()), { selectedResidue: 116 });
    expect(onVariant.container.querySelector<HTMLButtonElement>("button[data-testid='structure-site']")!.title).toBe("Frame the variant site");
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

  it("keys the colouring, states the band provenance, and collapses into a mini colour bar", () => {
    const model = buildStructure3dEvidence(input());
    const { container } = render(<StructureLegend legend={model.legend} />);
    const legend = container.querySelector("[data-testid='structure-legend']")!;
    expect(legend.getAttribute("data-provenance")).toBe("published");
    // Collapsed by default: a title and a mini colour bar, no bands yet.
    expect(legend.getAttribute("data-collapsed")).toBe("true");
    expect(legend.querySelectorAll(".s3d-legend__mini-seg")).toHaveLength(model.legend!.entries.length);
    expect(legend.querySelector(".s3d-legend__list")).toBeNull();

    const toggle = within(legend as HTMLElement).getByRole("button", { name: "Show colour key" });
    expect(toggle.getAttribute("aria-controls")).toBe("s3d-legend-body");
    fireEvent.click(toggle);
    expect(legend.getAttribute("data-collapsed")).toBeNull();
    expect(legend.textContent).toContain("Very high");
    expect(legend.textContent).toContain("> 90");
    expect(legend.textContent).toContain("AlphaFold DB bands");
    expect(legend.querySelectorAll(".s3d-legend__swatch")).toHaveLength(model.legend!.entries.length);

    fireEvent.click(within(legend as HTMLElement).getByRole("button", { name: "Hide colour key" }));
    expect(legend.getAttribute("data-collapsed")).toBe("true");
  });

  it("keeps the Close-up toggle and omits the redundant side-chain diagram in both model families", () => {
    const onToggleSiteCloseUp = vi.fn();
    const { container: barContainer } = toolbar(buildStructure3dEvidence(input()), {
      siteCloseUp: true,
      onToggleSiteCloseUp,
    });
    const closeUpBtn = barContainer.querySelector("[data-testid='structure-site-closeup']") as HTMLButtonElement;
    expect(closeUpBtn).toBeTruthy();
    expect(closeUpBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(closeUpBtn);
    expect(onToggleSiteCloseUp).toHaveBeenCalledTimes(1);

    for (const family of ["alphafold", "esmfold"] as const) {
      for (const viewMode of ["wildtype", "mutant", "superimposed"] as const) {
        seed({ viewMode, ...ESM_COORDINATES });
        // The mode must really be on screen: an unavailable mode falls back to wild type and would make this loop vacuous.
        expect(renderHook(() => useStructure3dEvidence(family)).result.current.viewMode).toBe(viewMode);
        const view = render(<StructureInspector family={family} setCustomPdbUrl={() => {}} />);
        expect(view.container.querySelector("[data-testid='structure-sidechain-card']")).toBeNull();
        view.unmount();
      }
    }
  });

  it("exposes a Reset view camera control and surfaces active pLDDT filter and measured local fit badges on Display", () => {
    const onResetCamera = vi.fn();
    const wt = toolbar(buildStructure3dEvidence(input()), {
      plddtFilter: "70",
      onResetCamera,
    });
    const resetBtn = wt.container.querySelector<HTMLButtonElement>("[data-testid='structure-reset-view']")!;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.disabled).toBe(false);
    fireEvent.click(resetBtn);
    expect(onResetCamera).toHaveBeenCalledTimes(1);

    const wtPills = Array.from(wt.container.querySelectorAll(".s3d-btn__pill")).map(el => el.textContent);
    expect(wtPills).toEqual(["≥ 70"]);
    wt.unmount();

    const disabledReset = toolbar(buildStructure3dEvidence(input()), {
      canResetCamera: false,
      onResetCamera,
    });
    expect(disabledReset.container.querySelector<HTMLButtonElement>("[data-testid='structure-reset-view']")!.disabled).toBe(true);
    disabledReset.unmount();

    const base = input();
    const deNovoSuperimposed = buildStructure3dEvidence(
      input({
        family: "esmfold",
        viewMode: "superimposed",
        alignmentScope: "local",
        deNovo: {
          ...base.deNovo,
          wildTypeLoaded: true,
          variantLoaded: true,
          aligned: true,
          scan: scanBFactors(AF),
          site: readResidueAt(AF, 116),
        },
      }),
    );
    const sup = toolbar(deNovoSuperimposed, { plddtFilter: "none" });
    const supPills = Array.from(sup.container.querySelectorAll(".s3d-btn__pill")).map(el => el.textContent);
    expect(supPills).toEqual(["±15 fit"]);
    sup.unmount();

    // When local alignment falls back to global (measuredScope: "global"), ±15 fit is not certified on the pill
    const fallbackGlobal = {
      ...deNovoSuperimposed,
      alignment: {
        ...deNovoSuperimposed.alignment,
        scope: "local" as const,
        measuredScope: "global" as const,
      },
    };
    const fallbackBar = toolbar(fallbackGlobal, { plddtFilter: "none" });
    expect(fallbackBar.container.querySelectorAll(".s3d-btn__pill")).toHaveLength(0);
    fallbackBar.unmount();
  });

  it("distinguishes the queried variant site from off-site or unverified selections in the inspector card", () => {
    seed({
      ...ESM_COORDINATES,
      selectedResidueIndex: 200,
      hoveredResidueIndex: 150,
    });
    const atSite = render(
      <StructureInspector
        family="alphafold"
        setCustomPdbUrl={() => {}}
        selection={{
          position: 116,
          preview: false,
          state: "available",
          isQueriedSite: true,
          residue: null,
          summary: "Asp116 in chain A · Variant site",
          source: "AlphaFold DB · AF-Q13564-F1 v6",
          measurement: { label: "pLDDT", value: "96.2", note: "Very high (≥ 90)" },
        }}
      />,
    );
    expect(atSite.container.querySelector(".s3d-selection__badge")?.textContent).toBe("Queried site");
    expect(atSite.container.textContent).not.toContain("Site readings below stay tied to the queried substitution.");
    atSite.unmount();

    // Unmapped selection at the variant position must not claim "Queried site" and must keep the caveat note
    const unmappedAtSite = render(
      <StructureInspector
        family="alphafold"
        setCustomPdbUrl={() => {}}
        selection={{
          position: 116,
          preview: false,
          state: "unmapped",
          isQueriedSite: false,
          residue: null,
          summary: "Selection retained, but this structure’s numbering is not verified against UniProt.",
          source: "PDB 1YOV",
          measurement: null,
        }}
      />,
    );
    expect(unmappedAtSite.container.querySelector(".s3d-selection__badge")).toBeNull();
    expect(unmappedAtSite.container.querySelector(".s3d-selection__return")).toBeNull();
    expect(unmappedAtSite.container.textContent).not.toContain("Coordinates:");
    unmappedAtSite.unmount();

    // Unmapped selection away from the site labels the action "Return to position 116" without a substitution
    const unmappedAway = render(
      <StructureInspector
        family="alphafold"
        setCustomPdbUrl={() => {}}
        selection={{
          position: 200,
          preview: false,
          state: "unmapped",
          isQueriedSite: false,
          residue: null,
          summary: "Selection retained, but this structure’s numbering is not verified against UniProt.",
          source: "PDB 1YOV",
          measurement: null,
        }}
      />,
    );
    expect(unmappedAway.getByRole("button", { name: "Return to position 116" })).toBeTruthy();
    unmappedAway.unmount();

    const awayFromSite = render(
      <StructureInspector
        family="alphafold"
        setCustomPdbUrl={() => {}}
        selection={{
          position: 200,
          preview: false,
          state: "available",
          isQueriedSite: false,
          residue: null,
          summary: "Leu200 in chain A · 14.2 Å from the variant site",
          source: "AlphaFold DB · AF-Q13564-F1 v6",
          measurement: { label: "pLDDT", value: "88.0", note: "Confident (70–90)" },
        }}
      />,
    );
    const returnBtn = awayFromSite.getByRole("button", { name: /Return to Asp116Gly/i });
    expect(returnBtn).toBeTruthy();
    fireEvent.click(returnBtn);
    const state = useVariantAnalysisStore.getState();
    expect(state.selectedResidueIndex).toBe(116);
    expect(state.hoveredResidueIndex).toBeNull();
    expect(state.landscapeSelection?.kind).toBe("substitution");
    expect(state.landscapeSelection?.pos).toBe(116);
    awayFromSite.unmount();
  });
});


