import { useState, useRef, useEffect } from "react";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import type { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { Color } from "molstar/lib/mol-util/color";
import { isValidPdbUrl } from "./molstarThemes";
import { PAIR_COLOURS, pdbIdFromUrl, type ColourPlan, type LoadedEntry, type ThemePlan } from "../../shared/structure3dEvidence";
import type { StructureProvenance } from "../../shared/contracts";
import { STRUCTURE_REF_HEADER } from "../../shared/structureRefs";
import { registerStructureRefForPdb } from "../../api/structureRefRegistry";
import { SECONDARY_COLOURS, type ModelSecondary } from "../../shared/structureSecondary";
import { readModelSecondary, residueAnchor } from "./readSecondaryStructure";
import { drawContextLayer } from "./drawContextLayer";

/**
 * Loads the coordinates `AppViews` hands the canvas and draws them with the colour plan the 3D
 * evidence model chose. This hook decides nothing about what a structure IS.
 *
 * It used to: `customPdbData` was assumed to be an AlphaFold model unless a PDB id happened to be in
 * local state, so crystal temperature factors were drawn with pLDDT colours and cut by the pLDDT
 * filter; and an ESMFold view with no fold loaded fetched the resolver's structure (a crystal entry)
 * and drew it under the ESMFold label.
 */

export type PlddtFilter = "none" | "50" | "70";

export interface UseMolstarStructureOptions {
  pluginRef: React.MutableRefObject<any>;
  pluginCreated: boolean;
  uniprotId?: string | null;
  gene?: string | null;
  /** Coordinates for the primary structure. Null: load `customPdbUrl`, else (AlphaFold view only) fetch. */
  primaryPdbData: string | null;
  customPdbUrl: string | null;
  /** The superposed variant (its B column holds Cα displacement). */
  comparePdbData: string | null;
  /** The full-length model, already in the primary's frame, drawn faintly around a short template. */
  contextPdbData?: string | null;
  /** Residue numbers the primary covers; the context leaves them out. */
  contextCovered?: { start: number; end: number } | null;
  /** Fetch the AlphaFold DB model when no coordinates are supplied. False in the ESMFold view. */
  allowFetch: boolean;
  reloadNonce?: number;
  colour: ColourPlan;
  plddtFilter: PlddtFilter;
  /** 1 or 100; only set when the model says the primary B column holds pLDDT. */
  plddtScale: 1 | 100 | null;
  esm3Scores: number[] | null;
  variantPosition: number | null;
  /** The displayed coordinates use verified UniProt numbering at the variant site. */
  canAddressVariantSite: boolean;
  /**
   * How the drawn primary model numbers its residues. Callout anchors need residue numbers the app
   * can address even when the variant site itself is absent from the entry (`check: "absent"`), where
   * `canAddressVariantSite` is false.
   */
  residueNumbering?: "uniprot" | "entry" | "unknown";
  /** The site's card already names it, so the canvas must not also draw its 3D text label. */
  suppressVariantLabel?: boolean;
  /** A residue the reader clicked, when it is not the variant's. */
  selectedResidue: number | null;
  /** Residues drawn with the selection (see `ResidueFocus`); the selected residue is not repeated here. */
  companionResidues?: readonly number[];
  showPolarContacts: boolean;
  show3DLabels: boolean;
  /** Label every companion, not only a set of `MAX_LABELLED_COMPANIONS` or fewer: the reader's choice. */
  labelAllCompanions?: boolean;
  /** Missense-style site close-up: softens surrounding cartoon, shows 5 Å contact shell and labels, and frames the site tightly. */
  siteCloseUp?: boolean;
  residueColorHex: number;
  neonHighContrast: boolean;
  autoZoomOnSelect: boolean;
  cameraDuration: number;
  showPocket: boolean;
  pocketResidueIndices: number[];
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  /** The hook fetched the AlphaFold model itself: publish its text and where it came from. */
  onPdbTextLoaded?: (pdbText: string, provenance: StructureProvenance) => void;
  /** A PDB entry from the experimental list was fetched, or cleared (null). */
  onEntryLoaded?: (entry: LoadedEntry | null) => void;
  /** The drawn primary model's secondary structure once read; `null` at the start of every load. */
  onSecondaryStructure?: (secondary: ModelSecondary | null, state: "reading" | "ready" | "unavailable" | "idle") => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (err: string | null) => void;
}

function themeRef(plan: ThemePlan, esm3Scores: number[] | null, alphaOverride?: number | null): { color: string; colorParams?: any; typeParams?: any } {
  const extraAlpha = typeof alphaOverride === "number" && alphaOverride < 1 ? { typeParams: { alpha: alphaOverride } } : {};
  switch (plan.theme) {
    case "plddt":
      return { color: "plddt-confidence", colorParams: { scale: plan.scale }, ...extraAlpha };
    case "bfactor-quartile":
      return { color: "bfactor-quartile", ...extraAlpha };
    case "displacement":
      return { color: "backbone-displacement", ...extraAlpha };
    case "esm3":
      return { color: "esm3-shift", colorParams: { perturbationScores: esm3Scores ?? [] }, ...extraAlpha };
    case "secondary-structure":
      return { color: "secondary-structure", colorParams: { colors: { name: "custom", params: SECONDARY_COLOUR_MAP } }, ...extraAlpha };
    case "uniform": {
      const alpha = typeof alphaOverride === "number" ? Math.min(plan.alpha, alphaOverride) : plan.alpha;
      return {
        color: "uniform",
        colorParams: { value: Color(plan.color) },
        ...(alpha < 1 ? { typeParams: { alpha } } : {}),
      };
    }
  }
}

/** Mol*'s colour-map keys, filled from `SECONDARY_COLOURS` so the legend swatch is the drawn colour. */
const SECONDARY_COLOUR_MAP = {
  alphaHelix: Color(SECONDARY_COLOURS["alpha-helix"]),
  threeTenHelix: Color(SECONDARY_COLOURS["310-helix"]),
  piHelix: Color(SECONDARY_COLOURS["pi-helix"]),
  betaTurn: Color(SECONDARY_COLOURS.turn),
  betaStrand: Color(SECONDARY_COLOURS.strand),
  coil: Color(SECONDARY_COLOURS.coil),
  bend: Color(SECONDARY_COLOURS.bend),
  turn: Color(SECONDARY_COLOURS.turn),
  dna: Color(0xae00fe),
  rna: Color(0xfd0162),
  carbohydrate: Color(0xa6a6fa),
};

function formatOf(text: string): "mmcif" | "pdb" {
  return text.startsWith("data_") || text.includes("_atom_site") ? "mmcif" : "pdb";
}

function hasCoordinates(text: string | null | undefined): boolean {
  return !!text && (text.includes("ATOM") || text.includes("HETATM") || text.includes("_atom_site"));
}

function residueExpression(index: number) {
  return MS.struct.generator.atomGroups({
    "residue-test": MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), index]),
  });
}

/** Several residues by number, the way the pocket lining is selected. */
function residuesExpression(indices: readonly number[]) {
  return MS.struct.generator.atomGroups({
    "residue-test": MS.core.set.has([MS.core.type.set([...indices]), MS.struct.atomProperty.macromolecular.auth_seq_id()]),
  });
}

const NO_RESIDUES: readonly number[] = [];
/** Companions are labelled by default only while the set is small enough to read (a disulfide pair, not an
 * interface); a larger set is labelled when the reader asks for it (`labelAllCompanions`). */
export const MAX_LABELLED_COMPANIONS = 4;
/** A reader may label a large set, but not an unbounded one: 60 tethered labels stay readable on a laptop
 *  GPU; several hundred turn the canvas into text and cost a frame for every label. */
export const MAX_LABEL_ALL_COMPANIONS = 60;
/** Carbon colour of companion residues: distinct from the variant site, the grey surroundings and the pocket. */
export const COMPANION_CARBON = 0x3b6ea5;
/** Predicted pocket lining (P2Rank). Named here so the canvas guide's swatch is the drawn colour. */
export const POCKET_COLOUR = 0xb08a2e;

/** The element the plugin renders into. Named in two places, so it is named here once. */
export const VIEWER_CONTAINER_ID = "molstar-viewer-container";

/**
 * What the viewer actually built from a companion set, written where a harness can read it.
 *
 * Two facts, and the second is the one worth having: `companionResidues` proves the request arrived, and
 * `companionAtoms` proves Mol* resolved those numbers to atoms in the loaded model. Residues that do not exist in a
 * structure produce a component with no atoms, which draws nothing and looks exactly like a caption whose highlight
 * silently failed. `null` means no companion set is drawn — cleared on every redraw so a stale count cannot stand in
 * for the current one.
 */
function announceCompanions(count: number | null, atoms = 0) {
  if (typeof document === "undefined") return;
  const container = document.getElementById(VIEWER_CONTAINER_ID);
  if (!container) return;
  if (count === null) {
    delete container.dataset.companionResidues;
    delete container.dataset.companionAtoms;
    return;
  }
  container.dataset.companionResidues = String(count);
  container.dataset.companionAtoms = String(atoms);
}

/**
 * Tells the proof harness that a load finished and how many structures it drew (two for a superposition).
 * `drawnVersion` goes up on every finished load, so a check can tell a new draw from the previous one.
 */
function announceDrawn(structures: number | null, contextDrawn = false) {
  if (typeof document === "undefined") return;
  const container = document.getElementById(VIEWER_CONTAINER_ID);
  if (!container) return;
  if (structures === null) {
    delete container.dataset.drawnStructures;
    delete container.dataset.drawnContext;
    return;
  }
  container.dataset.drawnStructures = String(structures);
  container.dataset.drawnContext = contextDrawn ? "1" : "0";
  container.dataset.drawnVersion = String(Number(container.dataset.drawnVersion ?? "0") + 1);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stillInTree(plugin: any, ref: string | undefined): boolean {
  return !!ref && !!plugin?.state?.data?.tree?.transforms?.has(ref);
}

/** Builders return selectors; the component manager requires hierarchy refs with representations. */
export function resolveHierarchyComponent(plugin: any, selector: { ref: string } | null | undefined): any | null {
  if (!selector?.ref) return null;
  const component = plugin?.managers?.structure?.hierarchy?.current?.refs?.get(selector.ref);
  return component?.kind === "structure-component" && Array.isArray(component.representations) ? component : null;
}

export function useMolstarStructure(opts: UseMolstarStructureOptions) {
  const {
    pluginRef,
    pluginCreated,
    uniprotId,
    gene,
    primaryPdbData,
    customPdbUrl,
    comparePdbData,
    contextPdbData = null,
    contextCovered = null,
    allowFetch,
    reloadNonce,
    colour,
    plddtFilter,
    plddtScale,
    esm3Scores,
    variantPosition,
    canAddressVariantSite,
    residueNumbering = "unknown",
    suppressVariantLabel = false,
    selectedResidue,
    companionResidues = NO_RESIDUES,
    showPolarContacts,
    show3DLabels,
    labelAllCompanions = false,
    siteCloseUp = false,
    residueColorHex,
    neonHighContrast,
    autoZoomOnSelect,
    cameraDuration,
    showPocket,
    pocketResidueIndices,
    fetchWithAuth,
    onPdbTextLoaded,
    onEntryLoaded,
    onSecondaryStructure,
    setLoading,
    setLoadError,
  } = opts;

  const structureRef = useRef<any>(null);
  const structure2Ref = useRef<any>(null);
  const polymerRef = useRef<any>(null);
  const polymer2Ref = useRef<any>(null);
  const highlightRefs = useRef<string[]>([]);
  const isLoadingRef = useRef(false);
  const pendingCameraResetRef = useRef(false);
  /** The first finished load frames the structure once the canvas has its real size (cold-start cameras). */
  const framedFirstLoadRef = useRef(false);
  const drawnSourceRef = useRef<{
    primaryPdbData: string | null;
    customPdbUrl: string | null;
    comparePdbData: string | null;
    contextPdbData: string | null;
    uniprotId: string | null | undefined;
    allowFetch: boolean;
  } | null>(null);
  const [readyVersion, setReadyVersion] = useState(0);
  const [drawnPair, setDrawnPair] = useState(false);
  const [contextDrawn, setContextDrawn] = useState(false);

  // Callbacks change identity every render; the load effect reads them through refs.
  const onPdbTextLoadedRef = useRef(onPdbTextLoaded);
  onPdbTextLoadedRef.current = onPdbTextLoaded;
  const onEntryLoadedRef = useRef(onEntryLoaded);
  onEntryLoadedRef.current = onEntryLoaded;
  const onSecondaryRef = useRef(onSecondaryStructure);
  onSecondaryRef.current = onSecondaryStructure;

  const colourKey = JSON.stringify(colour);
  // A length-only key left an existing ESM3 heatmap stale after a same-length rerun.
  const scoresKey = esm3Scores ? JSON.stringify(esm3Scores) : "";
  const filterCut = plddtScale && plddtFilter !== "none" ? Number(plddtFilter) / (plddtScale === 1 ? 100 : 1) : null;
  // Alpha/visibility are representation properties, not colour-theme properties. Only these
  // changes require rebuilding visual components; palette and ESM3 score changes do not.
  const closeUpActive = Boolean(siteCloseUp && variantPosition && canAddressVariantSite);
  /** Residue numbers can be addressed on the canvas: verified UniProt numbering, site absent or not. */
  const residueNumbersTrusted = residueNumbering === "uniprot" || canAddressVariantSite;
  const ribbonAlphaOverride = closeUpActive ? 0.22 : null;
  const visualStructureKey = JSON.stringify({
    filterCut,
    primaryAlpha: colour.primary.theme === "uniform" ? colour.primary.alpha : 1,
    secondaryAlpha: colour.secondary?.theme === "uniform" ? colour.secondary.alpha : 1,
    secondaryCartoon: colour.secondaryCartoon,
    closeUpActive,
  });

  /* ── Load and draw ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (!pluginCreated || !pluginRef.current) return;
    const plugin = pluginRef.current;
    let active = true;

    async function load() {
      const drawn = drawnSourceRef.current;
      const visualOnly = !!structureRef.current && !!drawn &&
        drawn.primaryPdbData === primaryPdbData && drawn.customPdbUrl === customPdbUrl &&
        drawn.comparePdbData === comparePdbData && drawn.contextPdbData === contextPdbData && drawn.uniprotId === uniprotId && drawn.allowFetch === allowFetch;
      const cameraSnapshot = visualOnly ? plugin.canvas3d?.camera?.getSnapshot() : null;
      isLoadingRef.current = true;
      // A filter/opacity adjustment may briefly rebuild components, but it is not a new
      // coordinate fetch. Keep the previous camera and avoid the blocking load overlay.
      setLoading(!visualOnly);
      setLoadError(null);
      try {
        await plugin.clear();
        if (!active) return;
        announceDrawn(null);
        setDrawnPair(false);
        setContextDrawn(false);
        if (!visualOnly) onSecondaryRef.current?.(null, "reading");
        structureRef.current = null;
        structure2Ref.current = null;
        polymerRef.current = null;
        polymer2Ref.current = null;
        highlightRefs.current = [];

        let text: string | null = primaryPdbData;
        const entryId = customPdbUrl ? pdbIdFromUrl(customPdbUrl) : null;
        const label = entryId ? `${gene || "Protein"} · ${entryId}` : `${gene || "Protein"}`;
        if (!text && customPdbUrl) {
          if (!isValidPdbUrl(customPdbUrl)) throw new Error(`Refused to load ${customPdbUrl}: only RCSB, AlphaFold DB or this server may be used.`);
          const res = await fetchWithAuth(customPdbUrl);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error?.message || body?.message || `Could not load ${entryId ? `PDB ${entryId}` : customPdbUrl} (HTTP ${res.status}).`);
          }
          const entryText = await res.text();
          if (!active) return;
          if (!hasCoordinates(entryText)) throw new Error("The structure file contained no atomic coordinates.");
          /**
           * A reader-selected PDB entry is drawn from bytes THIS server just served, so it can be
           * reference-enabled exactly like the AlphaFold/pipeline path: register the reference the
           * route returned for these bytes, and a later pocket or contact-map call names them
           * instead of re-uploading the entry — and, crucially, instead of letting the accession
           * ladder answer with a different structure than the one on screen.
           *
           * Registration happens before the early `return` below, because that return hands the
           * entry to the store's echo and never reaches the local drawing path.
           */
          registerStructureRefForPdb(entryText, res.headers.get(STRUCTURE_REF_HEADER));
          const reasonHeader = res.headers.get("X-Entry-Reason");
          const unmappedHeader = Number.parseInt(res.headers.get("X-Entry-Unmapped") ?? "", 10);
          const mappingHeader = res.headers.get("X-Entry-Mapping");
          const entry: LoadedEntry = {
            url: customPdbUrl,
            text: entryText,
            numbering: res.headers.get("X-Entry-Numbering") === "uniprot" ? "uniprot" : "author",
            chainId: res.headers.get("X-Entry-Chain") || null,
            mapping: mappingHeader === "sifts" || mappingHeader === "needleman_wunsch" ? mappingHeader : null,
            unmappedResidues: Number.isFinite(unmappedHeader) && unmappedHeader > 0 ? unmappedHeader : null,
            reason: reasonHeader ? safeDecode(reasonHeader) : null,
          };
          // As with the AlphaFold fetch: published, and drawn from the store's echo, where the
          // model has scanned its B column and read its numbering.
          if (onEntryLoadedRef.current) {
            isLoadingRef.current = false;
            setLoading(false);
            onEntryLoadedRef.current(entry);
            return;
          }
          text = entryText;
        } else if (!text && allowFetch && uniprotId) {
          const res = await fetchWithAuth(`/api/v1/alphafold-pdb/${encodeURIComponent(uniprotId)}`);
          if (!res.ok) {
            throw new Error(res.status === 404 ? `AlphaFold DB has no model for ${uniprotId}.` : `Could not load the AlphaFold model (HTTP ${res.status}).`);
          }
          text = await res.text();
          if (!active) return;
          if (!hasCoordinates(text)) throw new Error("The structure file contained no atomic coordinates.");
          // Same as the entry path above: this AlphaFold model came from this server's route, so its
          // reference is registered before the early return hands the text to the store's echo.
          registerStructureRefForPdb(text, res.headers.get(STRUCTURE_REF_HEADER));
          // Publish, and let the store's echo draw it: only then is the provenance, and so the
          // pLDDT colouring and filter, known. Drawing here would paint it plain and race the echo.
          if (onPdbTextLoadedRef.current) {
            isLoadingRef.current = false;
            setLoading(false);
            onPdbTextLoadedRef.current(text, {
              source: "alphafold",
              afdbVersion: res.headers.get("X-Template-AfdbVersion") || undefined,
            });
            return;
          }
        }

        if (!text) {
          // Nothing to draw here (an ESMFold view still folding, or with no fold): an empty canvas,
          // never a stand-in structure under the wrong name.
          isLoadingRef.current = false;
          setLoading(false);
          return;
        }
        if (!hasCoordinates(text)) throw new Error("The structure file contained no atomic coordinates.");

        const data = await plugin.builders.data.rawData({ data: text, label });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, formatOf(text));
        if (!active || !trajectory) return;
        const model = await plugin.builders.structure.createModel(trajectory);
        if (!active || !model) return;
        const structure = await plugin.builders.structure.createStructure(model);
        if (!active || !structure) return;
        structureRef.current = structure;

        // pLDDT filter: only ever built when the model said this B column holds pLDDT.
        let polymerTarget: any = null;
        if (filterCut !== null) {
          polymerTarget = await plugin.builders.structure.tryCreateComponentFromExpression(
            structure,
            MS.struct.generator.atomGroups({
              "entity-test": MS.core.rel.eq([MS.ammp("entityType"), "polymer"]),
              "atom-test": MS.core.rel.gre([MS.struct.atomProperty.macromolecular.B_iso_or_equiv(), filterCut]),
            }),
            "plddt-filtered",
            { label: `pLDDT ≥ ${plddtFilter}` }
          );
        }
        if (!polymerTarget) polymerTarget = await plugin.builders.structure.tryCreateComponentStatic(structure, "polymer");
        if (!active) return;
        polymerRef.current = polymerTarget;
        if (polymerTarget) {
          await plugin.builders.structure.representation.addRepresentation(polymerTarget, { type: "cartoon", ...themeRef(colour.primary, esm3Scores, ribbonAlphaOverride) });
        }
        const ligand = await plugin.builders.structure.tryCreateComponentStatic(structure, "ligand");
        if (ligand) await plugin.builders.structure.representation.addRepresentation(ligand, { type: "ball-and-stick", color: "element-symbol" });
        const ion = await plugin.builders.structure.tryCreateComponentStatic(structure, "ion");
        if (ion) await plugin.builders.structure.representation.addRepresentation(ion, { type: "ball-and-stick", color: "element-symbol" });
        if (!active) return;

        if (comparePdbData && colour.secondary) {
          const data2 = await plugin.builders.data.rawData({ data: comparePdbData, label: `${gene || "Protein"} · variant (superposed)` });
          const trajectory2 = await plugin.builders.structure.parseTrajectory(data2, formatOf(comparePdbData));
          if (!active || !trajectory2) return;
          const model2 = await plugin.builders.structure.createModel(trajectory2);
          if (!active || !model2) return;
          const structure2 = await plugin.builders.structure.createStructure(model2);
          if (!active || !structure2) return;
          structure2Ref.current = structure2;
          const polymer2 = colour.secondaryCartoon ? await plugin.builders.structure.tryCreateComponentStatic(structure2, "polymer") : null;
          polymer2Ref.current = polymer2;
          if (polymer2) {
            await plugin.builders.structure.representation.addRepresentation(polymer2, { type: "cartoon", ...themeRef(colour.secondary, esm3Scores, ribbonAlphaOverride) });
          }
        }

        // The context is background. If it cannot be built, the structure the reader asked for is still drawn.
        let contextDrawn = false;
        if (contextPdbData && contextCovered) {
          try {
            contextDrawn = await drawContextLayer(plugin, contextPdbData, contextCovered, `${gene || "Protein"} · AlphaFold context`);
          } catch (err) {
            console.warn("[3D] The AlphaFold context could not be drawn:", err);
          }
          if (!active) return;
        }

        try {
          plugin.canvas3d?.camera && (plugin.canvas3d.camera.forceFull = true);
          plugin.canvas3d?.camera?.setState({ clipFar: false });
          if (pendingCameraResetRef.current) {
            pendingCameraResetRef.current = false;
            plugin.managers.camera?.reset(undefined, cameraDuration);
          } else if (cameraSnapshot) {
            plugin.canvas3d?.camera?.setState(cameraSnapshot, 0);
          } else if (!framedFirstLoadRef.current) {
            // The first load can finish before the canvas has been laid out (a cold browser profile),
            // and Mol* then frames the structure against a zero-sized viewport. Frame again once the
            // current task — and with it layout — is done, so the whole structure is actually in view.
            framedFirstLoadRef.current = true;
            setTimeout(() => {
              if (!active) return;
              try { plugin.managers.camera?.reset(undefined, 0); } catch { /* camera is best-effort */ }
            }, 0);
          }
        } catch { /* camera props are best-effort */ }

        if (active) {
          drawnSourceRef.current = { primaryPdbData, customPdbUrl, comparePdbData, contextPdbData, uniprotId, allowFetch };
          isLoadingRef.current = false;
          const hasSecond = Boolean(structure2Ref.current && stillInTree(plugin, structure2Ref.current.ref));
          setDrawnPair(hasSecond);
          setContextDrawn(contextDrawn);
          announceDrawn(hasSecond ? 2 : 1, contextDrawn);
          // Read after the cartoon is built: the cartoon attaches the same property, so this is the drawn assignment.
          onSecondaryRef.current?.(null, "reading");
          readModelSecondary(plugin, structure.obj.data).then(
            secondary => { if (active) onSecondaryRef.current?.(secondary, secondary ? "ready" : "unavailable"); },
            err => {
              console.warn("[3D] Could not read the secondary structure:", err);
              if (active) onSecondaryRef.current?.(null, "unavailable");
            },
          );
          setLoading(false);
          setReadyVersion(v => v + 1);
        }
      } catch (err: any) {
        isLoadingRef.current = false;
        if (!active) return;
        drawnSourceRef.current = null;
        console.error("[3D] Structure load failed:", err);
        setLoadError(err?.message || "The structure could not be drawn.");
        setLoading(false);
        // Nothing is drawn any more: the epoch must move so the canvas drops its callouts and anchors.
        onSecondaryRef.current?.(null, "idle");
        setReadyVersion(v => v + 1);
      }
    }

    load();
    return () => {
      active = false;
      isLoadingRef.current = false;
    };
    // Colour theme changes are handled below without reparsing coordinates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginCreated, uniprotId, gene, primaryPdbData, customPdbUrl, comparePdbData, contextPdbData, allowFetch, visualStructureKey, reloadNonce]);

  useEffect(() => {
    if (!pluginCreated || !readyVersion || isLoadingRef.current) return;
    const plugin = pluginRef.current;
    if (!plugin) return;
    let active = true;
    async function updateColour() {
      try {
        const primary = resolveHierarchyComponent(plugin, polymerRef.current);
        if (primary) {
          const theme = themeRef(colour.primary, esm3Scores);
          await plugin.managers.structure.component.updateRepresentationsTheme([primary], {
            color: theme.color as any, colorParams: theme.colorParams,
          });
        }
        if (!active) return;
        const secondary = resolveHierarchyComponent(plugin, polymer2Ref.current);
        if (secondary && colour.secondary) {
          const theme = themeRef(colour.secondary, esm3Scores);
          await plugin.managers.structure.component.updateRepresentationsTheme([secondary], {
            color: theme.color as any, colorParams: theme.colorParams,
          });
        }
      } catch (err) {
        if (active) console.error("[3D] Structure colour update failed:", err);
      }
    }
    void updateColour();
    return () => { active = false; };
    // The serialized keys capture value changes in colour plans and ESM3 arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginCreated, readyVersion, colourKey, scoresKey]);

  useEffect(() => {
    if (!customPdbUrl) onEntryLoadedRef.current?.(null);
  }, [customPdbUrl]);

  /* ── Site, environment, pocket and camera ─────────────────────────────── */
  useEffect(() => {
    if (!pluginCreated || !pluginRef.current || !structureRef.current || isLoadingRef.current) return;
    const plugin = pluginRef.current;
    const structure = structureRef.current;
    const structure2 = structure2Ref.current;
    let active = true;

    async function highlight() {
      try {
        // Delete the previous highlight components (and their representations) from the state tree.
        // The old code handed bare ref strings to `hierarchy.remove`, which expects component objects,
        // inside a catch-all — so earlier highlights could pile up.
        const stale = highlightRefs.current.filter(ref => stillInTree(plugin, ref));
        highlightRefs.current = [];
        if (stale.length) {
          const update = plugin.build();
          for (const ref of stale) update.delete(ref);
          try { await update.commit(); } catch { /* removed with the structure */ }
        }
        if (!active || !stillInTree(plugin, structure.ref)) return;
        const refs: string[] = [];
        // The companion proof is restated from scratch on every draw: a cleared highlight must not leave the last
        // count behind for a reader (or a harness) to mistake for the current state.
        announceCompanions(null);
        const loci: any[] = [];
        const superposed = !!structure2 && stillInTree(plugin, structure2.ref);
        const effectiveContacts = showPolarContacts || closeUpActive;
        const effectiveLabels = show3DLabels || closeUpActive;
        const siteLabels = effectiveLabels && !suppressVariantLabel;

        if (variantPosition && canAddressVariantSite) {
          const surroundings = MS.struct.modifier.includeSurroundings({ 0: residueExpression(variantPosition), radius: 5, "as-whole-residues": true });
          const site = await plugin.builders.structure.tryCreateComponentFromExpression(structure, residueExpression(variantPosition), "variant-site", { label: `Variant site ${variantPosition}` });
          if (!active) return;
          if (site) {
            // A load that started during the awaits above may have cleared the tree: this component's
            // ref then points at a deleted node and addRepresentation would throw "Could not find node".
            if (!stillInTree(plugin, site.ref)) return;
            refs.push(site.ref);
            await plugin.builders.structure.representation.addRepresentation(site, {
              type: "ball-and-stick",
              color: "uniform",
              colorParams: { value: superposed ? Color(PAIR_COLOURS.template) : residueColorHex },
              // Thinner in a superposition, so the variant residue drawn over it stays visible where
              // the two coincide (a glycine is backbone only).
              ...(superposed ? { typeParams: { sizeFactor: closeUpActive ? 0.22 : 0.16 } } : neonHighContrast ? { typeParams: { sizeFactor: 1.8 } } : closeUpActive ? { typeParams: { sizeFactor: 0.34 } } : {}),
            });
            if (neonHighContrast) {
              await plugin.builders.structure.representation.addRepresentation(site, { type: "spacefill", typeParams: { alpha: 0.35 }, color: "uniform", colorParams: { value: residueColorHex } });
            }
            if (siteLabels) {
              await plugin.builders.structure.representation.addRepresentation(site, {
                type: "label",
                typeParams: { level: "residue", background: true, backgroundOpacity: 0.9, borderWidth: 0.3, residueScale: 1.4, offsetZ: 1.5, tether: true, tetherLength: 1.8, tetherBaseWidth: 0.35, attachment: "bottom-left" },
              });
            }
            try {
              const focusExpr = effectiveContacts ? surroundings : residueExpression(variantPosition);
              loci.push(StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(focusExpr, structure.obj.data)));
            } catch { /* focus is optional */ }
          }

          // The site's surroundings: whole residues within 5 Å, thin sticks, and (if enabled) the
          // non-covalent contacts Mol* finds among them. An interactions representation on the single
          // site residue — what this used to draw — has no partners to show.
          if (effectiveContacts) {
            // The neighbours only (the site residue keeps its own colour), with grey carbons so the
            // variant site stays the one coloured residue; contacts are drawn over site + neighbours.
            const env = await plugin.builders.structure.tryCreateComponentFromExpression(
              structure,
              MS.struct.modifier.exceptBy({ 0: surroundings, by: residueExpression(variantPosition) }),
              "site-environment",
              { label: `Within 5 Å of ${variantPosition}` }
            );
            const contacts = await plugin.builders.structure.tryCreateComponentFromExpression(structure, surroundings, "site-contacts", { label: `Contacts around ${variantPosition}` });
            if (!active) return;
            if (env) {
              refs.push(env.ref);
              await plugin.builders.structure.representation.addRepresentation(env, {
                type: "ball-and-stick",
                color: "element-symbol",
                colorParams: { carbonColor: { name: "uniform", params: { value: Color(PAIR_COLOURS.template) } } },
                typeParams: { sizeFactor: closeUpActive ? 0.16 : 0.14 },
              });
            }
            if (contacts) {
              refs.push(contacts.ref);
              await plugin.builders.structure.representation.addRepresentation(contacts, { type: "interactions" });
            }
          }

          if (superposed) {
            const site2 = await plugin.builders.structure.tryCreateComponentFromExpression(structure2, residueExpression(variantPosition), "variant-site-superposed", { label: `Variant residue ${variantPosition}` });
            if (!active) return;
            if (site2) {
              refs.push(site2.ref);
              await plugin.builders.structure.representation.addRepresentation(site2, {
                type: "ball-and-stick",
                color: "uniform",
                colorParams: { value: Color(PAIR_COLOURS.variant) },
                typeParams: { sizeFactor: closeUpActive ? 0.36 : 0.3 },
              });
              if (siteLabels) {
                await plugin.builders.structure.representation.addRepresentation(site2, {
                  type: "label",
                  typeParams: { level: "residue", background: true, backgroundOpacity: 0.9, borderWidth: 0.3, residueScale: 1.4, offsetZ: 2.1, tether: true, tetherLength: 2.2, tetherBaseWidth: 0.35, attachment: "top-right" },
                });
              }
              try {
                const focusExpr2 = effectiveContacts ? surroundings : residueExpression(variantPosition);
                loci.push(StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(focusExpr2, structure2.obj.data)));
              } catch { /* optional */ }
            }
            if (effectiveContacts) {
              const contacts2 = await plugin.builders.structure.tryCreateComponentFromExpression(
                structure2,
                surroundings,
                "site-contacts-superposed",
                { label: `Variant contacts around ${variantPosition}` }
              );
              if (!active) return;
              if (contacts2) {
                refs.push(contacts2.ref);
                await plugin.builders.structure.representation.addRepresentation(contacts2, { type: "interactions" });
              }
            }
          }
        }

        // A clicked residue is shown as a selection — never relabelled as the mutated residue.
        if (selectedResidue && selectedResidue !== variantPosition && canAddressVariantSite) {
          const picked = await plugin.builders.structure.tryCreateComponentFromExpression(structure, residueExpression(selectedResidue), "selected-residue", { label: `Selected residue ${selectedResidue}` });
          if (!active) return;
          if (picked) {
            refs.push(picked.ref);
            await plugin.builders.structure.representation.addRepresentation(picked, { type: "ball-and-stick", color: "element-symbol" });
            try { loci.unshift(StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(residueExpression(selectedResidue), structure.obj.data))); } catch { /* optional */ }
          }
        }

        // Residues a surface asked to see with the selection (a disulfide's cysteines, an interface). They are
        // drawn on this model by number; whether they belong to it is the caller's claim, shown in the caption.
        if (companionResidues.length > 0 && canAddressVariantSite) {
          const companions = await plugin.builders.structure.tryCreateComponentFromExpression(structure, residuesExpression(companionResidues), "companion-residues", { label: `Companion residues (${companionResidues.length})` });
          if (!active) return;
          if (companions) {
            refs.push(companions.ref);
            announceCompanions(companionResidues.length, companions.cell.obj.data.elementCount);
            await plugin.builders.structure.representation.addRepresentation(companions, {
              type: "ball-and-stick",
              color: "element-symbol",
              colorParams: { carbonColor: { name: "uniform", params: { value: Color(COMPANION_CARBON) } } },
            });
            const labelled = effectiveLabels && (companionResidues.length <= MAX_LABELLED_COMPANIONS || labelAllCompanions);
            const container = document.getElementById(VIEWER_CONTAINER_ID);
            if (container) container.dataset.companionLabels = labelled ? "on" : "off";
            if (labelled) {
              // Label a bounded subset: `labelAllCompanions` can ask for a 200-residue set, and a label
              // representation for every one of them is unreadable and expensive. The card names the cap.
              const toLabel = companionResidues.length > MAX_LABEL_ALL_COMPANIONS ? companionResidues.slice(0, MAX_LABEL_ALL_COMPANIONS) : companionResidues;
              const labelTarget = toLabel.length === companionResidues.length ? companions
                : await plugin.builders.structure.tryCreateComponentFromExpression(structure, residuesExpression(toLabel), "companion-labels", { label: `Label ${toLabel.length} companion residues` });
              if (!active) return;
              if (labelTarget) {
                // The capped label set is a NEW cell when it differs from `companions`; without pushing
                // its ref here, effect cleanup would never delete it and repeated "Label N of M"
                // toggles would accumulate label components in the Mol* tree.
                if (labelTarget !== companions) refs.push(labelTarget.ref);
                await plugin.builders.structure.representation.addRepresentation(labelTarget, {
                  type: "label",
                  typeParams: { level: "residue", background: true, backgroundOpacity: 0.9, borderWidth: 0.3, residueScale: 1.2, offsetZ: 1.5, tether: true, tetherLength: 1.8, tetherBaseWidth: 0.35, attachment: "top-left" },
                });
              }
            }
            // Frame the whole set, not just the selected residue.
            const framed = [...new Set([...(selectedResidue ? [selectedResidue] : []), ...(variantPosition ? [variantPosition] : []), ...companionResidues])];
            try { loci.unshift(StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(residuesExpression(framed), structure.obj.data))); } catch { /* optional */ }
          }
        }

        if (showPocket && pocketResidueIndices.length > 0) {
          const pocket = await plugin.builders.structure.tryCreateComponentFromExpression(
            structure,
            MS.struct.generator.atomGroups({
              "residue-test": MS.core.set.has([MS.core.type.set(pocketResidueIndices), MS.struct.atomProperty.macromolecular.auth_seq_id()]),
            }),
            "pocket-lining",
            { label: "Predicted pocket lining" }
          );
          if (!active) return;
          if (pocket) {
            refs.push(pocket.ref);
            await plugin.builders.structure.representation.addRepresentation(pocket, { type: "ball-and-stick", color: "uniform", colorParams: { value: Color(POCKET_COLOUR) } });
            await plugin.builders.structure.representation.addRepresentation(pocket, { type: "molecular-surface", color: "uniform", colorParams: { value: Color(POCKET_COLOUR) }, typeParams: { alpha: 0.18 } });
          }
        }

        if (!active) {
          return;
        }
        highlightRefs.current = refs;
        if (loci.length > 0 && (autoZoomOnSelect || closeUpActive)) {
          plugin.managers.structure.selection.clear();
          const extraRadius = closeUpActive ? 3 : effectiveContacts ? 5 : 6;
          plugin.managers.camera.focusLoci(loci[0], { durationMs: cameraDuration, extraRadius });
        } else if (!variantPosition && autoZoomOnSelect) {
          try { plugin.managers.camera.reset(); } catch { /* optional */ }
        }
      } catch (err: any) {
        const msg = err?.message || "";
        if (/present in the tree|Could not find node|Cannot read properties of undefined/.test(msg)) {
          console.warn("[3D] Highlight cancelled by a structure change:", msg);
        } else {
          console.error("[3D] Highlight failed:", err);
        }
      }
    }

    highlight();
    return () => {
      active = false;
      // The attribute is the proof harness's readout of what is drawn; a stale "on" after the set is
      // cleared would report labels that no longer exist.
      const container = document.getElementById(VIEWER_CONTAINER_ID);
      if (container) delete container.dataset.companionLabels;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginCreated, readyVersion, variantPosition, canAddressVariantSite, selectedResidue, companionResidues.join(","), showPolarContacts, show3DLabels, suppressVariantLabel, labelAllCompanions, siteCloseUp, residueColorHex, neonHighContrast, autoZoomOnSelect, cameraDuration, showPocket, pocketResidueIndices.join(",")]);

  /** Frames a residue (or its 5 Å neighbourhood) without changing any selection. */
  const focusResidue = (index: number, scope: "residue" | "neighbourhood" = "residue") => {
    if (!residueNumbersTrusted) return;
    const plugin = pluginRef.current;
    const struct = structureRef.current;
    if (!plugin || !struct) return;
    try {
      const expr = scope === "neighbourhood"
        ? MS.struct.modifier.includeSurroundings({ 0: residueExpression(index), radius: 5, "as-whole-residues": true })
        : residueExpression(index);
      const loci = StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expr, struct.obj.data));
      plugin.managers.camera.focusLoci(loci, { durationMs: cameraDuration, extraRadius: scope === "neighbourhood" ? 3 : 6 });
    } catch (e) {
      console.warn("[3D] Could not focus residue", index, e);
    }
  };

  /** Frames a set of residues (e.g. companion cluster or pocket lining) without rebuilding components. */
  const focusResidues = (indices: readonly number[], extraRadius = 6) => {
    if (indices.length === 0) return;
    const plugin = pluginRef.current;
    const struct = structureRef.current;
    if (!plugin || !struct) return;
    try {
      const loci = StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(residuesExpression(indices), struct.obj.data));
      plugin.managers.camera.focusLoci(loci, { durationMs: cameraDuration, extraRadius });
    } catch (e) {
      console.warn("[3D] Could not focus residue set", e);
    }
  };

  /** Resets the 3D camera to frame the full structure without changing selection or display state. */
  const resetCamera = () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    pendingCameraResetRef.current = true;
    queueMicrotask(() => {
      if (!isLoadingRef.current) pendingCameraResetRef.current = false;
    });
    try {
      plugin.managers.camera?.reset(undefined, cameraDuration);
    } catch (e) {
      console.warn("[3D] Could not reset camera", e);
    }
  };

  /**
   * World position of a residue's Cα on the primary structure, or on the superposed variant.
   * `undefined` means "not read" (no trusted numbering or no structure), `null` means the residue has
   * no Cα in the drawn model — the callout says which, instead of calling both "out of view".
   */
  const anchorOf = (position: number, on: "primary" | "variant" = "primary", chain?: string | null): Vec3 | null | undefined => {
    const struct = on === "variant" ? structure2Ref.current : structureRef.current;
    if (!residueNumbersTrusted || !struct?.obj?.data) return undefined;
    try {
      return residueAnchor(struct.obj.data, position, chain);
    } catch {
      return undefined;
    }
  };

  return { structureRef, structure2Ref, drawnPair, contextDrawn, readyVersion, focusResidue, focusResidues, resetCamera, anchorOf };
}

