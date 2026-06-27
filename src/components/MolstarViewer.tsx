import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { DefaultPluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import "molstar/lib/mol-plugin-ui/skin/light.scss";
import { useSettings } from "../context/SettingsContext";
import { pocketFinderResponseSchema } from "../useVariantAnalysis";

import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection, StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { Layers, ChevronDown, ChevronUp, Sparkles, HelpCircle, Eye, Info, Settings, Camera, X, Activity, Cpu } from "lucide-react";

// Pocket coordinate-level structures
export interface PocketResidue {
  index: number;
  name: string;
  distance: number;
  score: number;
  role: string;
  type: string;
}

export interface PocketResult {
  pocketResidues: PocketResidue[];
  pocketScore: number;
  pocketVolume: number;
  likelyCofactor: string;
  pocketDistance: number | null;
  status?: string;
}

function isValidPdbUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/") || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const allowedDomains = [
      "alphafold.ebi.ac.uk",
      "files.rcsb.org",
      "pdbe.org",
      "www.ebi.ac.uk"
    ];
    return allowedDomains.some(domain => 
      parsed.hostname === domain || parsed.hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

// Declare custom property to store selection status or custom controls if needed
interface MolstarViewerProps {
  uniprotId: string;
  residueIndex: number | null;
  gene: string;
  customPdbUrl?: string;
  customPdbData?: string;
  showPolarContacts?: boolean;
  theme?: "dark" | "light";
  onResidueHover?: (index: number | null) => void;
  onResidueClick?: (index: number | null) => void;
  comparePdbData?: string | null;
  compareResidueIndex?: number | null;
  compareVariant?: string | null;
  disruptionWarning?: {
    type: "both" | "clash" | "hbond";
    title: string;
    description: string;
  } | null;
  residueColorHex?: number;
  cameraDuration?: number;
  autoZoomOnSelect?: boolean;
  neonHighContrast?: boolean;
  mutantStatus?: "success" | "scwrl" | null;
  mutantDdG?: number | null;
  heightClass?: string;
  variant?: string;
  energyUnit?: "kcal/mol" | "kJ/mol";
  fetchNearestResidues?: (
    uniprotId: string,
    variant: string,
    residueIndex: number,
    pdbText: string,
    signal?: AbortSignal
  ) => Promise<void>;
  onPdbTextLoaded?: (pdbText: string | null) => void;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
}

export default function MolstarViewer({ 
  uniprotId, 
  residueIndex, 
  gene, 
  customPdbUrl, 
  customPdbData, 
  showPolarContacts: showPolarContactsProp, 
  theme,
  onResidueHover,
  onResidueClick,
  comparePdbData,
  compareResidueIndex,
  compareVariant,
  disruptionWarning,
  residueColorHex: residueColorHexProp,
  cameraDuration: cameraDurationProp,
  autoZoomOnSelect: autoZoomOnSelectProp,
  neonHighContrast: neonHighContrastProp,
  mutantStatus,
  mutantDdG,
  heightClass,
  variant,
  energyUnit,
  fetchNearestResidues,
  onPdbTextLoaded,
  computedPocket: computedPocketProp,
  isPocketLoading: isPocketLoadingProp,
  pocketError: pocketErrorProp
}: MolstarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const structureRef = useRef<any>(null);
  const structure2Ref = useRef<any>(null);
  const componentRefRef = useRef<any>(null);
  const componentRefRef2 = useRef<any>(null);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pluginsReadyState, setPluginsReadyState] = useState<number>(0);
  const [pluginCreated, setPluginCreated] = useState<boolean>(false);
  const [showWarningCard, setShowWarningCard] = useState(false);

  const formatDdG = (val: number | null | undefined, unit?: "kcal/mol" | "kJ/mol") => {
    if (val === null || val === undefined) return "";
    if (unit === "kJ/mol") {
      const kj = val * 4.184;
      return `${val.toFixed(2)} kcal/mol [~${kj.toFixed(2)} kJ/mol]`;
    }
    return `${val.toFixed(2)} kcal/mol`;
  };
  const [warningClicked, setWarningClicked] = useState(false);

  const { theme: contextTheme, settings, showPolarContacts: contextShowPolarContacts } = useSettings();
  const isDark = (theme || contextTheme) !== "light";
  const showPolarContacts = showPolarContactsProp !== undefined ? showPolarContactsProp : contextShowPolarContacts;
  const residueColorHex = residueColorHexProp !== undefined 
    ? residueColorHexProp 
    : parseInt((settings.residueColor || "#F97316").replace("#", ""), 16);
  const cameraDuration = cameraDurationProp !== undefined 
    ? cameraDurationProp 
    : settings.cameraDuration;
  const autoZoomOnSelect = autoZoomOnSelectProp !== undefined 
    ? autoZoomOnSelectProp 
    : settings.autoZoomOnSelect;
  const neonHighContrast = neonHighContrastProp !== undefined 
    ? neonHighContrastProp 
    : settings.neonHighContrast;
  const show3DLabels = settings.show3DLabels !== undefined ? settings.show3DLabels : true;

  // Mode transition visual state
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const [pdbText, setPdbText] = useState<string | null>(null);
  const [showPocket, setShowPocket] = useState<boolean>(false);
  const [isPocketPanelOpen, setIsPocketPanelOpen] = useState<boolean>(false);
  const pocketComponentRefRef = useRef<any[]>([]);

  const [pocketErrorLocal, setPocketErrorLocal] = useState<string | null>(null);
  const setPocketError = setPocketErrorLocal;
  const computedPocket = computedPocketProp || null;
  const isPocketLoading = isPocketLoadingProp || false;
  const pocketError = pocketErrorProp || pocketErrorLocal;

  useEffect(() => {
    let active = true;
    if (customPdbData) {
      setPdbText(customPdbData);
    } else {
      let pdbUrl = customPdbUrl || `/api/v1/alphafold-pdb/${uniprotId}`;
      if (pdbUrl.includes("alphafold.ebi.ac.uk")) {
        pdbUrl = `/api/v1/alphafold-pdb/${uniprotId}`;
      }
      if (!isValidPdbUrl(pdbUrl)) {
        if (import.meta.env.DEV) {
          console.warn(`Blocked custom PDB URL from unauthorized origin: ${pdbUrl}`);
        }
        setPocketError("Custom PDB URL blocked: unauthorized origin.");
        return;
      }
      const headers: Record<string, string> = {};
      if (settings?.geminiSessionId) {
        headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
      }
      fetch(pdbUrl, { headers })
        .then(res => {
          if (!res.ok) throw new Error("Could not fetch raw coordinates");
          return res.text();
        })
        .then(text => {
          if (active && text && text.indexOf("ATOM") !== -1) {
            setPdbText(text);
          }
        })
        .catch(err => {
          console.warn("Could not load raw coordinates for binding pocket solver:", err);
        });
    }
    return () => {
      active = false;
    };
  }, [uniprotId, customPdbUrl, customPdbData]);

  // Trigger nearest residues calculation when pdbText is loaded
  useEffect(() => {
    if (pdbText && uniprotId && residueIndex !== null && variant && fetchNearestResidues) {
      const controller = new AbortController();
      fetchNearestResidues(uniprotId, variant, residueIndex, pdbText, controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [pdbText, uniprotId, residueIndex, variant, fetchNearestResidues]);

  // Notify parent component when pdbText is loaded/updated
  useEffect(() => {
    if (onPdbTextLoaded) {
      onPdbTextLoaded(pdbText);
    }
  }, [pdbText, onPdbTextLoaded]);

  // Biophysical Insight alert draggable and closeable states
  const [isAlertClosed, setIsAlertClosed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [alertPosition, setAlertPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset alert dismissed state and clear reposition coordinates whenever warning details alter
  useEffect(() => {
    setIsAlertClosed(false);
    setAlertPosition({ x: 0, y: 0 });
  }, [disruptionWarning]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with primary mouse click and prevent dragging if clicking buttons inside the header
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - alertPosition.x,
      y: e.clientY - alertPosition.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setAlertPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragStart]);

  // Pocket-Finder Suite Panel dragging states
  const [isPocketDragging, setIsPocketDragging] = useState<boolean>(false);
  const [pocketPosition, setPocketPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pocketDragStart, setPocketDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset pocket panel layout coordinates whenever panel visibility changes
  useEffect(() => {
    setPocketPosition({ x: 0, y: 0 });
  }, [isPocketPanelOpen]);

  const handlePocketMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsPocketDragging(true);
    setPocketDragStart({
      x: e.clientX - pocketPosition.x,
      y: e.clientY - pocketPosition.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isPocketDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPocketPosition({
        x: e.clientX - pocketDragStart.x,
        y: e.clientY - pocketDragStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsPocketDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPocketDragging, pocketDragStart]);

  // 1. Initialize Molstar Plugin UI once on mount
  useEffect(() => {
    let active = true;
    let localPlugin: any = null;
    let hoverSubscription: any = null;
    let clickSubscription: any = null;

    async function initPlugin() {
      if (!containerRef.current) return;
      
      const parent = containerRef.current;
      parent.innerHTML = '';
      const container = document.createElement('div');
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.maxWidth = '100%';
      container.style.maxHeight = '1005px';
      container.className = `w-full h-full ${isDark ? "text-slate-100" : "text-slate-900"}`;
      parent.appendChild(container);

      try {
        const spec: any = {
          ...DefaultPluginUISpec(),
        };

        // Initialize Molstar Viewer
        localPlugin = await createPluginUI({
          target: container,
          spec: spec,
          render: (component, target) => {
            const root = createRoot(target);
            root.render(component);
            return root;
          }
        });
        
        if (!active) {
          localPlugin.dispose();
          return;
        }

        pluginRef.current = localPlugin;

        // Subscribe to Molstar interaction events
        hoverSubscription = localPlugin.behaviors.interaction.hover.subscribe((event: any) => {
          const current = event.current;
          if (current && current.loci && StructureElement.Loci.is(current.loci)) {
            const location = StructureElement.Loci.getFirstLocation(current.loci);
            if (location) {
              const resIdx = StructureProperties.residue.auth_seq_id(location);
              if (resIdx && onResidueHover) {
                onResidueHover(resIdx);
              }
            }
          } else {
            if (onResidueHover) {
              onResidueHover(null);
            }
          }
        });

        clickSubscription = localPlugin.behaviors.interaction.click.subscribe((event: any) => {
          const current = event.current;
          if (current && current.loci && StructureElement.Loci.is(current.loci)) {
            const location = StructureElement.Loci.getFirstLocation(current.loci);
            if (location) {
              const resIdx = StructureProperties.residue.auth_seq_id(location);
              if (resIdx && onResidueClick) {
                onResidueClick(resIdx);
              }
            }
          }
        });

        setPluginCreated(true);
      } catch (err: any) {
        console.error("Molstar initialization failed:", err);
        if (active) {
          setLoadError("Failed to initialize 3D molecular viewer.");
          setLoading(false);
        }
      }
    }

    initPlugin();

    // Cleanup
    return () => {
      active = false;
      if (hoverSubscription) {
        try { hoverSubscription.unsubscribe(); } catch (e) {}
      }
      if (clickSubscription) {
        try { clickSubscription.unsubscribe(); } catch (e) {}
      }
      if (localPlugin) {
        try {
          localPlugin.dispose();
        } catch (e) {
          console.error("Error disposing Molstar:", e);
        }
      }
      pluginRef.current = null;
      setPluginCreated(false);
    };
  }, []);

  // 2. Load and update coordinate models dynamically on prop changes
  useEffect(() => {
    let active = true;
    const localPlugin = pluginRef.current;
    if (!localPlugin || !pluginCreated) return;

    let transitionTimeout: any = null;

    async function loadStructure() {
      setLoading(true);
      setLoadError(null);
      setIsTransitioning(true);

      try {
        // Clear previous state/models loaded in the workspace
        await localPlugin.clear();

        // Load coordinate file (Either raw FoldX biophysical mutant PDB or AlphaFold pdb URL)
        let data;
        if (customPdbData) {
          if (import.meta.env.DEV) {
            console.log(`Molstar loading custom raw mutant PDB data for: ${gene}`);
          }
          data = await localPlugin.builders.data.rawData({
            data: customPdbData,
            label: `${gene} (FoldX Biophysical Mutant)`
          });
        } else {
          let pdbUrl = customPdbUrl || `/api/v1/alphafold-pdb/${uniprotId}`;
          if (pdbUrl.includes("alphafold.ebi.ac.uk")) {
            pdbUrl = `/api/v1/alphafold-pdb/${uniprotId}`;
          }
          if (!isValidPdbUrl(pdbUrl)) {
            if (import.meta.env.DEV) {
              console.warn(`Blocked custom PDB URL from unauthorized origin: ${pdbUrl}`);
            }
            setLoadError("Custom PDB URL blocked: unauthorized origin.");
            return;
          }
          if (import.meta.env.DEV) {
            console.log(`Molstar downloading pdb structure from proxy: ${pdbUrl}`);
          }

          data = await localPlugin.builders.data.download({ 
            url: pdbUrl, 
            isBinary: false,
            label: `${gene} (AF-${uniprotId})`
          });
        }

        if (!active) return;

        // Use precise signatures: parseTrajectory is the correct method, and parameters are passed sequentially.
        const trajectory = await localPlugin.builders.structure.parseTrajectory(data, "pdb");
        const model = await localPlugin.builders.structure.createModel(trajectory);
        const structure = await localPlugin.builders.structure.createStructure(model);
        structureRef.current = structure;

        // Apply standard auto representation preset for robust loading/coloring representation
        await localPlugin.builders.structure.representation.applyPreset(structure, 'auto');

        // Load comparison model if available (superimposing)
        if (comparePdbData) {
          if (import.meta.env.DEV) {
            console.log(`Molstar loading comparison raw mutant PDB data...`);
          }
          const data2 = await localPlugin.builders.data.rawData({
            data: comparePdbData,
            label: `${gene} (Comparison Mutant)`
          });
          const trajectory2 = await localPlugin.builders.structure.parseTrajectory(data2, "pdb");
          const model2 = await localPlugin.builders.structure.createModel(trajectory2);
          const structure2 = await localPlugin.builders.structure.createStructure(model2);
          structure2Ref.current = structure2;
          await localPlugin.builders.structure.representation.applyPreset(structure2, 'auto');
        } else {
          structure2Ref.current = null;
        }

        // Trigger dynamic highlighting effect
        setPluginsReadyState((prev) => prev + 1);
        setLoading(false);
        transitionTimeout = setTimeout(() => {
          setIsTransitioning(false);
        }, 150);
      } catch (err: any) {
        console.error("Molstar structure loading failed:", err);
        if (active) {
          setLoadError(`Failed to load 3D coordinates for AlphaFold model AF-${uniprotId}. Please verify UniProt accession validity.`);
          setLoading(false);
          setIsTransitioning(false);
        }
      }
    }

    loadStructure();

    return () => {
      active = false;
      if (transitionTimeout) {
        clearTimeout(transitionTimeout);
      }
      structureRef.current = null;
      structure2Ref.current = null;
      componentRefRef.current = null;
      componentRefRef2.current = null;
    };
  }, [pluginCreated, uniprotId, customPdbUrl, customPdbData, gene, comparePdbData]);

  // Run dynamic highlight & representation updates selectively on residueIndex or contact toggle changes
  useEffect(() => {
    let active = true;
    const localPlugin = pluginRef.current;
    const structure = structureRef.current;
    const structure2 = structure2Ref.current;

    async function updateHighlight() {
      if (!localPlugin || !structure || !active) return;

      // 1. Dispose previous mutated residue representation if existing
      if (componentRefRef.current) {
        try {
          const cell = localPlugin.state.data.cells.get(componentRefRef.current);
          if (cell) {
            if (import.meta.env.DEV) {
              console.log(`Disposing old custom component state cell: ${componentRefRef.current}`);
            }
            await localPlugin.state.data.build().delete(componentRefRef.current).commit();
          }
        } catch (delErr) {
          console.warn("Failed to delete stale residue component tree node:", delErr);
        }
        componentRefRef.current = null;
      }

      // 1b. Dispose previous comparison mutated residue representation if existing
      if (componentRefRef2.current) {
        try {
          const cell = localPlugin.state.data.cells.get(componentRefRef2.current);
          if (cell) {
            if (import.meta.env.DEV) {
              console.log(`Disposing old comparison custom component state cell: ${componentRefRef2.current}`);
            }
            await localPlugin.state.data.build().delete(componentRefRef2.current).commit();
          }
        } catch (delErr) {
          console.warn("Failed to delete stale comparison residue component tree node:", delErr);
        }
        componentRefRef2.current = null;
      }

      // 1c. Dispose previous pocket residues if existing
      if (pocketComponentRefRef.current && pocketComponentRefRef.current.length > 0) {
        for (const ref of pocketComponentRefRef.current) {
          try {
            const cell = localPlugin.state.data.cells.get(ref);
            if (cell) {
              await localPlugin.state.data.build().delete(ref).commit();
            }
          } catch (delErr) {
            console.warn("Failed to delete stale pocket component:", delErr);
          }
        }
        pocketComponentRefRef.current = [];
      }

      // If residueIndex is null, reset camera to center whole structure
      if (residueIndex === null) {
        try {
          localPlugin.managers.camera.reset();
        } catch (camErr) {}
        return;
      }

      // Build primary highlight
      let lociList: any[] = [];
      if (import.meta.env.DEV) {
        console.log(`Molstar selecting and highlighting residue sequence index: ${residueIndex}`);
      }
      try {
        const expression = MS.struct.generator.atomGroups({
          'residue-test': MS.core.rel.eq([
            MS.struct.atomProperty.macromolecular.auth_seq_id(),
            residueIndex
          ])
        });

        const residueComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
          structure,
          expression,
          'mutated-residue',
          { label: `Mutated Residue ${residueIndex}` }
        );

        if (residueComponent) {
          componentRefRef.current = residueComponent.ref;

          // Apply bright custom representation to make it stand out
          await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
            type: 'ball-and-stick',
            color: 'uniform',
            colorParams: { value: residueColorHex }
          });

          if (showPolarContacts) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'interactions',
                color: 'uniform',
                colorParams: { value: 0x38BDF8 } // light blue / cyan
              });
            } catch (intrErr) {
              console.warn("Failed to apply interactions representation:", intrErr);
            }
          }

          if (show3DLabels) {
            try {
              await localPlugin.builders.structure.representation.addRepresentation(residueComponent, {
                type: 'label',
                typeParams: {
                  level: 'residue',
                  background: true,
                  backgroundOpacity: 0.85,
                  backgroundColor: 0x090d16, // dark navy / slate
                  borderWidth: 0.2,
                  residueScale: 1.3,
                  offsetX: 2.0,
                  offsetY: 2.0,
                  offsetZ: 1.5,
                  tether: true,
                  tetherLength: 1.5,
                  tetherBaseWidth: 0.3,
                  attachment: 'bottom-left'
                }
              });
            } catch (labelErr) {
              console.warn("Failed to apply 3D residue labels:", labelErr);
            }
          }

          try {
            const selection = Script.getStructureSelection(expression, structure.obj.data);
            const loci = StructureSelection.toLociWithSourceUnits(selection);
            lociList.push(loci);
          } catch (e) {}
        }
      } catch (err) {
        console.error("Error drawing dynamic residue highlight:", err);
      }

      // Build comparison highlight if second structure is valid
      if (structure2 && compareResidueIndex !== null && compareResidueIndex !== undefined) {
        if (import.meta.env.DEV) {
          console.log(`Molstar selecting and highlighting comparison residue sequence index: ${compareResidueIndex}`);
        }
        try {
          const expression2 = MS.struct.generator.atomGroups({
            'residue-test': MS.core.rel.eq([
              MS.struct.atomProperty.macromolecular.auth_seq_id(),
              compareResidueIndex
            ])
          });

          const residueComponent2 = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            structure2,
            expression2,
            'compare-mutated-residue',
            { label: `Compare Residue ${compareResidueIndex}` }
          );

          if (residueComponent2) {
            componentRefRef2.current = residueComponent2.ref;

            // Apply light green / teal ball-and-stick representation so they can be contrasted side-by-side
            await localPlugin.builders.structure.representation.addRepresentation(residueComponent2, {
              type: 'ball-and-stick',
              color: 'uniform',
              colorParams: { value: 0xEC4899 } // Vibrant Pink
            });

            if (showPolarContacts) {
              try {
                await localPlugin.builders.structure.representation.addRepresentation(residueComponent2, {
                  type: 'interactions',
                  color: 'uniform',
                  colorParams: { value: 0xF43F5E } // light rose
                });
              } catch (intrErr) {
                console.warn("Failed to apply comparison interactions:", intrErr);
              }
            }

            if (show3DLabels) {
              try {
                await localPlugin.builders.structure.representation.addRepresentation(residueComponent2, {
                  type: 'label',
                  typeParams: {
                    level: 'residue',
                    background: true,
                    backgroundOpacity: 0.85,
                    backgroundColor: 0x1f1226, // deep purple / violet tint
                    borderWidth: 0.2,
                    residueScale: 1.3,
                    offsetX: 2.0,
                    offsetY: 2.0,
                    offsetZ: 1.5,
                    tether: true,
                    tetherLength: 1.5,
                    tetherBaseWidth: 0.3,
                    attachment: 'bottom-left'
                  }
                });
              } catch (labelErr) {
                console.warn("Failed to apply comparison 3D residue labels:", labelErr);
              }
            }

            try {
              const selection2 = Script.getStructureSelection(expression2, structure2.obj.data);
              const loci2 = StructureSelection.toLociWithSourceUnits(selection2);
              lociList.push(loci2);
            } catch (e) {}
          }
        } catch (err2) {
          console.error("Error drawing comparison residue highlight:", err2);
        }
      }

      // Paint and highlight automated pocket finder residues if enabled
      if (showPocket && computedPocket) {
        if (computedPocket.pocketResidues.length > 0) {
          if (import.meta.env.DEV) {
            console.log(`Molstar painting ${computedPocket.pocketResidues.length} binding pocket residues in gold`);
          }
          const refs: any[] = [];
          for (const res of computedPocket.pocketResidues) {
            try {
              const expression = MS.struct.generator.atomGroups({
                'residue-test': MS.core.rel.eq([
                  MS.struct.atomProperty.macromolecular.auth_seq_id(),
                  res.index
                ])
              });

              const pocketResComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
                structure,
                expression,
                `pocket-res-${res.index}`,
                { label: `Pocket ${res.name}` }
              );

              if (pocketResComponent) {
                refs.push(pocketResComponent.ref);

                await localPlugin.builders.structure.representation.addRepresentation(pocketResComponent, {
                  type: 'ball-and-stick',
                  color: 'uniform',
                  colorParams: { value: 0xEAB308 } // Bright Gold
                });

                try {
                  await localPlugin.builders.structure.representation.addRepresentation(pocketResComponent, {
                    type: 'interactions',
                    color: 'uniform',
                    colorParams: { value: 0xCA8A04 } // Dark Gold Contacts
                  });
                } catch (intrErr) {}

                try {
                  const selection = Script.getStructureSelection(expression, structure.obj.data);
                  const loci = StructureSelection.toLociWithSourceUnits(selection);
                  lociList.push(loci);
                } catch (e) {}
              }
            } catch (pErr) {
              console.warn("Failed to build pocket residue highlight:", pErr);
            }
          }
          pocketComponentRefRef.current = refs;
        }
      }

      // Focus camera and select
      if (lociList.length > 0) {
        try {
          localPlugin.managers.structure.selection.clear();
          for (const loci of lociList) {
            localPlugin.managers.structure.selection.fromLoci('add', loci);
          }
          if (autoZoomOnSelect) {
            // Focus first locus with a custom camera transition duration
            localPlugin.managers.camera.focusLoci(lociList[0], { durationMs: cameraDuration });
          }
        } catch (cameraErr) {
          console.warn("Failed to zoom camera on custom expression:", cameraErr);
          localPlugin.managers.camera.reset();
        }
      } else {
        localPlugin.managers.camera.reset();
      }
    }

    updateHighlight();

    return () => {
      active = false;
    };
  }, [pluginsReadyState, residueIndex, compareResidueIndex, showPolarContacts, show3DLabels, residueColorHex, cameraDuration, autoZoomOnSelect, showPocket, computedPocket]);

  const focusOnPocketResidue = (idx: number) => {
    const localPlugin = pluginRef.current;
    const structure = structureRef.current;
    if (!localPlugin || !structure) return;
    try {
      const expression = MS.struct.generator.atomGroups({
        'residue-test': MS.core.rel.eq([
          MS.struct.atomProperty.macromolecular.auth_seq_id(),
          idx
        ])
      });
      const selection = Script.getStructureSelection(expression, structure.obj.data);
      const loci = StructureSelection.toLociWithSourceUnits(selection);
      localPlugin.managers.camera.focusLoci(loci, { durationMs: 800 });
    } catch (e) {
      console.warn("Failed to focus pocket residue:", e);
    }
  };

  return (
    <div className={`relative w-full ${heightClass || "h-[650px]"} bg-slate-950 rounded-xl overflow-hidden shadow-inner border transition-all ${
      isDark ? "border-slate-800" : "border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
    }`}>
      {/* Loading Overlay */}
      {loading && (
        <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center p-6 backdrop-blur-sm transition-colors ${
          isDark ? "bg-slate-950/80 text-white" : "bg-white/80 text-slate-900"
        }`}>
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-indigo-500 font-mono text-sm tracking-widest uppercase animate-pulse">
            {customPdbData ? "Rendering Mutant Structure..." : "Fetching AlphaFold Coordinates..."}
          </p>
          <p className={`text-xs mt-2 text-center max-w-sm ${isDark ? "text-slate-400" : "text-slate-650"}`}>
            {customPdbData 
              ? `Processing custom 3D mutant biophysical simulation via local FoldX engine...`
              : `Downloading 3D PDB structure for UniProt accession: ${uniprotId}`}
          </p>
        </div>
      )}

      {/* Error Overlay */}
      {loadError && (
        <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm ${
          isDark ? "bg-[#111827]/90 text-rose-450" : "bg-slate-50/90 text-rose-600"
        }`}>
          <svg className="w-12 h-12 mb-3 stroke-current" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className={`font-semibold text-lg mb-2 ${isDark ? "text-white" : "text-slate-900"}`}>Structure Unavailable</p>
          <p className={`text-sm max-w-md mb-4 ${isDark ? "text-slate-400" : "text-slate-650"}`}>{loadError}</p>
          <div className={`text-xs p-3 rounded text-left font-mono max-w-md w-full overflow-hidden border ${
            isDark ? "bg-slate-900 border-slate-800 text-slate-400" : "bg-white border-slate-200 text-slate-500"
          }`}>
            Source: <span className="text-rose-500 break-all font-semibold">{customPdbData ? "Target FoldX Mutated Output" : `AlphaFold DB v4 (AF-${uniprotId})`}</span>
          </div>
        </div>
      )}

      {/* Actual Mol* Canvas Container */}
      <div 
         ref={containerRef} 
         id="molstar-viewer-container" 
         className={`w-full h-full text-slate-900 transition-all duration-700 ease-out ${
           isTransitioning ? "opacity-35 scale-[0.985] blur-[1px]" : "opacity-100 scale-100 blur-0"
         }`}
      />

      {/* Floating Viewport Toolbar for custom actions */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            const helper = pluginRef.current?.helpers?.viewportScreenshot || pluginRef.current?.viewportScreenshot;
            if (helper) {
              try {
                // Trigger customized Molstar high-res screenshot download
                await helper.download(`structural-snapshot-${gene}-${uniprotId}.png`);
              } catch (err) {
                console.warn("Screenshot download helper failed, falling back to WebGL stream:", err);
                // Canvas fallback
                const canvas = containerRef.current?.querySelector('canvas');
                if (canvas) {
                  const link = document.createElement('a');
                  link.download = `structural-snapshot-${gene}-${uniprotId}.png`;
                  link.href = canvas.toDataURL("image/png");
                  link.click();
                }
              }
            } else {
              // Standard webgl download fallback
              const canvas = containerRef.current?.querySelector('canvas');
              if (canvas) {
                const link = document.createElement('a');
                link.download = `structural-snapshot-${gene}-${uniprotId}.png`;
                link.href = canvas.toDataURL("image/png");
                link.click();
              }
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all pointer-events-auto cursor-pointer shadow-md select-none ${
            isDark 
              ? "bg-slate-900/90 hover:bg-indigo-600/20 border-slate-800 text-slate-200 hover:text-indigo-400 hover:border-indigo-500/50" 
              : "bg-white/95 hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-indigo-600 hover:border-indigo-300"
          }`}
          title="Capture high-resolution PNG image of the current structural visualization"
        >
          <Camera className="w-3.5 h-3.5 text-indigo-500" />
          <span>Capture View</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setIsPocketPanelOpen(prev => !prev);
            if (!isPocketPanelOpen) {
              setShowPocket(true);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all pointer-events-auto cursor-pointer shadow-md select-none ${
            isPocketPanelOpen
              ? "bg-indigo-600 border-indigo-500 text-white"
              : isDark
                ? "bg-slate-900/90 hover:bg-indigo-600/20 border-slate-800 text-slate-200 hover:text-indigo-400 hover:border-indigo-500/50" 
                : "bg-white/95 hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-indigo-600 hover:border-indigo-300"
          }`}
          title="Run dynamic coordinate and biophysical matching algorithms to render the nearest binding site residues"
        >
          <Cpu className={`w-3.5 h-3.5 ${isPocketPanelOpen ? "text-amber-300 animate-pulse font-bold" : "text-indigo-500"}`} />
          <span>Pocket-Finder Suite</span>
        </button>
      </div>

      {/* Warning/Success banner for mutant coordinates (F-2) */}
      {customPdbData && (
        mutantStatus === "success" ? (
          <div className={`absolute top-14 left-3 right-3 z-10 p-2 rounded-lg border text-[10px] font-mono shadow-sm flex items-center gap-2 pointer-events-auto select-none ${
            isDark 
              ? "bg-indigo-950/85 border-indigo-800/60 text-indigo-350" 
              : "bg-indigo-50 border-indigo-250 text-indigo-800 shadow-indigo-100/30"
          }`}>
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
            <span>
              <strong>FoldX Biophysically Repacked Model:</strong> Structure coordinates reflect local side-chain repacking. 
              {mutantDdG !== null && mutantDdG !== undefined 
                ? ` Predicted stability change (ΔΔG): ${formatDdG(mutantDdG, energyUnit)}.` 
                : " Predicted stability change (ΔΔG): ΔΔG not computed (FoldX energy output unavailable)."}
            </span>
          </div>
        ) : showWarningCard && (
          mutantStatus === "scwrl" ? (
            <div className={`absolute top-14 left-3 right-3 z-10 p-2.5 rounded-xl border text-[10px] font-mono shadow-lg flex items-center justify-between gap-2 pointer-events-auto select-none ${
              isDark 
                ? "bg-indigo-950/90 border-indigo-800/70 text-indigo-300" 
                : "bg-indigo-50/95 border-indigo-200 text-indigo-850 shadow-indigo-100/10"
            }`}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
                <span>
                  <strong>SCWRL4 Biophysically Packed Model:</strong> Side-chain rotamers have been packed using SCWRL4 as a secondary fallback. Stability energy calculations (ΔΔG) are not available.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowWarningCard(false)}
                className="p-1 text-xs hover:text-white dark:hover:text-indigo-100 font-bold bg-indigo-500/10 hover:bg-indigo-500/20 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>
          ) : null
        )
      )}

      {/* Mini Controls overlay */}
      <div className={`absolute bottom-3 left-3 backdrop-blur-sm px-3 py-1.5 rounded-lg text-[11px] font-mono z-1 pointer-events-none flex flex-wrap items-center gap-3 border transition-colors ${
        isDark 
          ? "bg-slate-950/80 border-slate-800/85 text-slate-300" 
          : "bg-white/80 border-slate-200 text-slate-600 shadow-sm"
      }`}>
        <span className="flex items-center gap-1.5 text-indigo-500 font-semibold pointer-events-auto">
          {comparePdbData ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
              <span>Superimposed Biophysical Variants</span>
            </>
          ) : customPdbData ? (
            mutantStatus === "success" ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                <span>FoldX Biophysical Model</span>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowWarningCard(prev => !prev);
                  setWarningClicked(true);
                }}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer transition ${
                  !warningClicked
                    ? "animate-pulse bg-amber-500/15 border-amber-500/35 text-amber-500 hover:bg-amber-500/25"
                    : "bg-slate-500/10 border-slate-500/20 text-slate-400 hover:bg-slate-500/20"
                }`}
                title="Click to view biophysical fallback warning"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${!warningClicked ? "bg-amber-500 animate-ping" : "bg-slate-400"}`}></span>
                <span>SCWRL4 Packed Model (Warning)</span>
              </button>
            )
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
              <span>AlphaFold AF-{uniprotId}</span>
            </>
          )}
        </span>
        <span className="text-slate-500 pointer-events-none">|</span>
        <span className="pointer-events-none">Gene: <strong className={isDark ? "text-white" : "text-slate-900 font-bold"}>{gene}</strong></span>
        {residueIndex !== null && (
          <>
            <span className="text-slate-500 pointer-events-none">|</span>
            <span className="text-amber-500 font-semibold pointer-events-none">Residue 1: #{residueIndex}</span>
          </>
        )}
        {comparePdbData && compareResidueIndex !== null && compareResidueIndex !== undefined && (
          <>
            <span className="text-slate-500 pointer-events-none">|</span>
            <span className="text-pink-500 font-semibold pointer-events-none">Residue 2 ({compareVariant || "Compare"}): #{compareResidueIndex}</span>
          </>
        )}
      </div>

      {/* Slide-out Automated Pocket Control Panel */}
      {isPocketPanelOpen && (
        <div 
          id="pocket-finder-suite-panel" 
          className={`absolute top-14 right-3 bottom-14 w-[310px] z-20 backdrop-blur-md rounded-xl border flex flex-col overflow-hidden shadow-2xl animate-fade-in pointer-events-auto transition-all ${
            isDark 
              ? "bg-slate-950/90 border-indigo-500/30 text-slate-100" 
              : "bg-white/95 border-indigo-250 text-slate-900 shadow-indigo-100/30"
          }`}
          style={{
            transform: `translate(${pocketPosition.x}px, ${pocketPosition.y}px)`,
          }}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between p-3 border-b border-indigo-500/10 bg-indigo-500/5 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handlePocketMouseDown}
          >
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider font-mono">Bound Pocket Suite</h3>
                <p className="text-[8px] opacity-65 font-mono">Automated 3D Proximity Scanner</p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => setIsPocketPanelOpen(false)}
              className={`p-1 rounded-md transition-colors hover:bg-slate-500/10 cursor-pointer ${
                isDark ? "text-slate-450 hover:text-slate-200" : "text-slate-500 hover:text-slate-950"
              }`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
            {residueIndex === null ? (
              <div className="text-center py-6">
                <p className="text-xs text-slate-500 font-mono">Select a residue to run coordinate calculations.</p>
              </div>
            ) : isPocketLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[9px] font-mono text-slate-400 animate-pulse text-center uppercase tracking-wider px-2">
                  Analyzing Local Spatial Proximities Server-side...
                </p>
              </div>
            ) : pocketError ? (
              <div className="text-center py-12 px-3 text-rose-500 font-mono text-xs border border-rose-500/20 rounded-lg bg-rose-500/5">
                <p className="font-bold mb-1">Server Calculation Error</p>
                <p className="text-[10px] opacity-80">{pocketError}</p>
              </div>
            ) : computedPocket ? (
              <>
                {/* P2Rank / Heuristic Validation Status Badge */}
                <div className="mb-2">
                  {computedPocket.status === "success" ? (
                    <div className="text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-center">
                      Validated ML Predictor: P2Rank Active
                    </div>
                  ) : (
                    <div className="text-[9px] font-mono font-bold bg-amber-500/10 text-amber-450 border border-amber-500/20 px-2 py-0.5 rounded text-center" title="P2Rank CLI was not detected. Used proximity density fallback.">
                      Spatial Density Heuristic (Fallback)
                    </div>
                  )}
                </div>

                {computedPocket.status === "success" ? (
                  <>
                    {/* Pocket Stats Bento Grid */}
                    <div className="grid grid-cols-2 gap-2 text-center font-mono">
                      <div className={`p-2 rounded-lg border text-center ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                        <span className="block text-[7.5px] uppercase text-slate-500 font-bold">Pocket Vol. Space</span>
                        <strong className="text-xs text-indigo-400 block mt-0.5">{computedPocket.pocketVolume} Å³</strong>
                      </div>
                      <div className={`p-2 rounded-lg border text-center ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                        <span className="block text-[7.5px] uppercase text-slate-500 font-bold">Affinity Index</span>
                        <strong className="text-xs text-amber-500 block mt-0.5">{computedPocket.pocketScore}%</strong>
                      </div>
                    </div>

                    {/* Predicted Substrate */}
                    <div className={`p-2.5 rounded-lg border ${
                      isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"
                    }`}>
                      <span className="block text-[7.5px] uppercase text-slate-500 font-bold font-mono">Target Pocket Specificity</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="text-[10px] font-bold text-slate-400 truncate">{computedPocket.likelyCofactor}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[10px] text-slate-400 opacity-80 mt-1 mb-2 italic">
                    ML pocket predictor unavailable in this environment; showing proximity-heuristic residue list only.
                  </p>
                )}

                {/* Highlight Full Pocket Action */}
                <div className="flex items-center justify-between border-t border-b border-indigo-500/10 py-2">
                  <span className="text-[9px] font-bold font-mono text-slate-500 uppercase">Interactive HIGHLIGHTS</span>
                  <button
                    type="button"
                    onClick={() => setShowPocket(p => !p)}
                    className={`px-2 py-1 rounded text-[9px] font-mono font-bold transition-all select-none cursor-pointer ${
                      showPocket
                        ? "bg-amber-500 hover:bg-amber-600 text-slate-950"
                        : isDark ? "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-800"
                    }`}
                  >
                    {showPocket ? "Highlight ON" : "Highlight OFF"}
                  </button>
                </div>

                {/* Coordinating Residues List */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[8px] font-mono font-bold text-slate-500">
                    <span>COORDINATED POCKET RESIDUES</span>
                    <span>{computedPocket.pocketResidues.length} FOUND</span>
                  </div>
                  
                  <div className="space-y-1 max-h-[220px] overflow-y-auto pr-0.5 custom-scrollbar">
                    {computedPocket.pocketResidues.map(res => (
                      <div 
                        key={res.index}
                        onClick={() => focusOnPocketResidue(res.index)}
                        className={`group p-1.5 rounded border flex flex-col gap-0.5 transition-all cursor-pointer ${
                          isDark 
                            ? "bg-slate-900/60 border-slate-800 hover:bg-indigo-950/20 hover:border-indigo-500/40" 
                            : "bg-slate-50/50 border-slate-100 hover:bg-indigo-50/20 hover:border-indigo-400/40"
                        }`}
                        title="Click to coordinate center gravity focus on this pocket residue in the 3D workspace"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="font-bold text-amber-500">{res.name}</span>
                          <span className="text-[9px] text-slate-450 group-hover:text-indigo-400 transition-colors">
                            {res.distance.toFixed(1)} Å
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[8px] text-slate-450 font-mono">
                          <span className="truncate max-w-[170px] text-[8px]">{res.role}</span>
                          <span className="font-bold bg-indigo-500/10 text-indigo-400 px-0.5 rounded shrink-0">
                            {res.score}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-xs text-slate-500 font-mono">No pocket coordinate results loaded.</p>
              </div>
            )}
          </div>
          
          {/* Footer panel caption */}
          <div className="p-2 border-t border-indigo-500/10 bg-indigo-500/5 text-center text-[7.5px] font-mono text-slate-500 uppercase select-none">
            Spatial Proximity Threshold &lt; 10.0 Å
          </div>
        </div>
      )}

      {/* Disruption Warning Overlay Badge - Draggable and Closeable */}
      {disruptionWarning && !isAlertClosed && (
        <div 
          id="disruption-warning-badge" 
          onMouseDown={handleMouseDown}
          style={{
            transform: `translate(${alertPosition.x}px, ${alertPosition.y}px)`,
            cursor: isDragging ? 'grabbing' : 'grab'
          }}
          className={`absolute top-3 right-3 max-w-[280px] backdrop-blur-md p-3.5 rounded-xl border z-20 shadow-lg transition-shadow flex flex-col gap-1.5 animate-slide-in pointer-events-auto select-none ${
            isDark 
              ? "bg-slate-950/85 border-rose-500/30 text-rose-300" 
              : "bg-white/95 border-rose-300 text-rose-800 shadow-rose-100/30 shadow-[0_4px_16px_rgba(244,63,94,0.08)]"
          }`}
        >
          <div className="flex items-center justify-between gap-4 border-b pb-1.5 border-rose-500/10">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full animate-ping ${
                disruptionWarning.type === 'hbond' ? 'bg-sky-500' : 'bg-rose-500'
              }`}></span>
              <span className={`w-1.5 h-1.5 rounded-full absolute ${
                disruptionWarning.type === 'hbond' ? 'bg-sky-500' : 'bg-rose-500'
              }`}></span>
              <span className={`text-[9px] font-extrabold uppercase tracking-widest font-mono ${
                disruptionWarning.type === 'hbond' ? 'text-sky-500' : 'text-rose-500'
              }`}>
                Biophysical Insight Alert
              </span>
            </div>
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAlertClosed(true);
              }}
              className={`p-1 rounded-md transition-colors hover:bg-slate-500/10 cursor-pointer ${
                isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-950"
              }`}
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <h4 className="text-xs font-bold leading-tight flex items-center gap-1">
            {disruptionWarning.title}
          </h4>
          <p className={`text-[10px] leading-relaxed opacity-95 ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            {disruptionWarning.description}
          </p>
          
          <div className="text-[8px] font-mono opacity-50 text-right mt-0.5 select-none text-slate-400">
            ⌥ Click & drag to move
          </div>
        </div>
      )}
    </div>
  );
}
