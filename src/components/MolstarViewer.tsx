import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { DefaultPluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import "molstar/lib/mol-plugin-ui/skin/light.scss";
import { useSettings } from "../context/SettingsContext";
import { pocketFinderResponseSchema } from "../useVariantAnalysis";
import { useVariantAnalysisContext } from "../context/VariantAnalysisContext";
import { Layers, ChevronDown, ChevronUp, Sparkles, HelpCircle, Eye, Info, Settings, Camera, X, Activity, Cpu, Download, ClipboardCopy, Maximize2, Minimize2, Target } from "lucide-react";
export type { PocketResidue, PocketResult } from './molstar/molstarThemes';
export { CustomPLDDTColorTheme, CustomPLDDTColorThemeProvider, CustomBFactorColorTheme, CustomBFactorColorThemeProvider, CustomESM3AllostericColorTheme, CustomESM3AllostericColorThemeProvider } from './molstar/molstarThemes';
import {
  type PocketResidue,
  type PocketResult,
  type MolstarViewerProps,
  CustomPLDDTColorTheme,
  CustomPLDDTColorThemeProvider,
  CustomBFactorColorTheme,
  CustomBFactorColorThemeProvider,
  CustomESM3AllostericColorTheme,
  CustomESM3AllostericColorThemeProvider,
  isValidPdbUrl,
} from './molstar/molstarThemes';
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection, StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { Color } from "molstar/lib/mol-util/color";

export default function MolstarViewer({ 
  residueIndex, 
  customPdbData, 
  onResidueClick,
  comparePdbData,
  compareResidueIndex,
  compareVariant,
  disruptionWarning,
  mutantStatus,
  mutantDdG,
  heightClass,
  variant,
  active3dModelTab = "alphafold2"
}: MolstarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const structureRef = useRef<any>(null);
  const structure2Ref = useRef<any>(null);
  const componentRefRef = useRef<any>(null);
  const componentRefRef2 = useRef<any>(null);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plddtFilter, setPlddtFilter] = useState<"none" | "30" | "50" | "70">("none");
  const [templateSource, setTemplateSource] = useState<"experimental" | "alphafold" | null>(null);
  const [pluginsReadyState, setPluginsReadyState] = useState<number>(0);
  const [pluginCreated, setPluginCreated] = useState<boolean>(false);
  const [showWarningCard, setShowWarningCard] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [captureMenuOpen, setCaptureMenuOpen] = useState<boolean>(false);
  const [foldxBannerCollapsed, setFoldxBannerCollapsed] = useState<boolean>(false);
  const captureMenuRef = useRef<HTMLDivElement>(null);

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
  const analysisContext = useVariantAnalysisContext();
  const { state: analysisState, actions: analysisActions } = analysisContext;

  // Extract shared variables from context (F-A3)
  const uniprotId = analysisState.uniprotId;
  const gene = analysisState.gene;
  const customPdbUrl = analysisState.customPdbUrl;
  const onResidueHover = analysisActions.setHoveredResidueIndex;
  const fetchNearestResidues = analysisActions.fetchNearestResidues;
  const onPdbTextLoaded = analysisActions.setPdbText;
  const computedPocket = analysisState.computedPocket;
  const isPocketLoading = analysisState.isPocketLoading;
  const pocketError = analysisState.pocketError;
  const pdbId = analysisState.analysisState.result?.metadata?.pdbId;
  const pdbSource = analysisState.analysisState.result?.metadata?.pdbSource;
  const isEsmFolding = analysisState.isEsmFolding;
  const esmFoldingError = analysisState.esmFoldingError;
  const esmFoldPdb = analysisState.esmFoldPdb;

  const isDark = contextTheme !== "light";
  const showPolarContacts = contextShowPolarContacts;
  const residueColorHex = parseInt((settings.residueColor || "#F97316").replace("#", ""), 16);
  const cameraDuration = settings.cameraDuration;
  const autoZoomOnSelect = settings.autoZoomOnSelect;
  const neonHighContrast = settings.neonHighContrast;
  const show3DLabels = settings.show3DLabels !== undefined ? settings.show3DLabels : true;
  const energyUnit = settings.energyUnit;

  // Mode transition visual state
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const [pdbText, setPdbText] = useState<string | null>(null);
  const [showPocket, setShowPocket] = useState<boolean>(false);
  const [isPocketPanelOpen, setIsPocketPanelOpen] = useState<boolean>(false);
  const pocketComponentRefRef = useRef<any[]>([]);
  const [viewerStyle, setViewerStyle] = useState<"confidence" | "biomolecular" | "esm3-allosteric">("confidence");

  const [pocketErrorLocal, setPocketErrorLocal] = useState<string | null>(null);
  const setPocketError = setPocketErrorLocal;

  useEffect(() => {
    let active = true;
    if (customPdbData) {
      setPdbText(customPdbData);
    } else {
      const match = variant ? variant.match(/\d+/) : null;
      const posQuery = match ? `?pos=${match[0]}` : "";
      let pdbUrl = customPdbUrl || `/api/v1/alphafold-pdb/${uniprotId}${posQuery}`;
      if (pdbUrl.includes("alphafold.ebi.ac.uk")) {
        pdbUrl = `/api/v1/alphafold-pdb/${uniprotId}${posQuery}`;
      }
      if (!isValidPdbUrl(pdbUrl)) {
        if (import.meta.env.DEV) {
          console.warn(`Blocked custom PDB URL from unauthorized origin: ${pdbUrl}`);
        }
        setPocketError("Custom PDB URL blocked: unauthorized origin.");
        return;
      }
      const headers: Record<string, string> = {};
      if (!pdbUrl.startsWith("http://") && !pdbUrl.startsWith("https://")) {
        if (settings?.geminiSessionId) {
          headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
        }
        if (settings?.appApiToken) {
          headers["Authorization"] = `Bearer ${settings.appApiToken}`;
        }
      }
      let templateSrc: "experimental" | "alphafold" | null = null;
      fetch(pdbUrl, { headers })
        .then(res => {
          if (!res.ok) throw new Error("Could not fetch raw coordinates");
          const sourceHeader = res.headers.get("X-Template-Source");
          if (sourceHeader === "experimental" || sourceHeader === "alphafold") {
            templateSrc = sourceHeader;
          }
          return res.text();
        })
        .then(text => {
          if (active && text && text.indexOf("ATOM") !== -1) {
            setPdbText(text);
            if (templateSrc) {
              setTemplateSource(templateSrc);
            }
          }
        })
        .catch(err => {
          console.warn("Could not load raw coordinates for binding pocket solver:", err);
        });
    }
    return () => {
      active = false;
    };
  }, [uniprotId, customPdbUrl, customPdbData, variant]);

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

  // FoldX banner draggable states
  const [isFoldXDragging, setIsFoldXDragging] = useState<boolean>(false);
  const [foldXPosition, setFoldXPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [foldXDragStart, setFoldXDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleFoldXMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setIsFoldXDragging(true);
    setFoldXDragStart({
      x: e.clientX - foldXPosition.x,
      y: e.clientY - foldXPosition.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isFoldXDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setFoldXPosition({
        x: e.clientX - foldXDragStart.x,
        y: e.clientY - foldXDragStart.y,
      });
    };
    const handleMouseUp = () => {
      setIsFoldXDragging(false);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isFoldXDragging, foldXDragStart]);

  // Reset alert dismissed state and clear reposition coordinates whenever warning details alter
  useEffect(() => {
    setIsAlertClosed(false);
    setAlertPosition({ x: 0, y: 0 });
  }, [disruptionWarning]);

  // Reset FoldX banner collapse state and position when mutant status changes
  useEffect(() => {
    setFoldxBannerCollapsed(false);
    setFoldXPosition({ x: 0, y: 0 });
  }, [mutantStatus, mutantDdG]);

  // Close capture menu when clicking outside
  useEffect(() => {
    if (!captureMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (captureMenuRef.current && !captureMenuRef.current.contains(e.target as Node)) {
        setCaptureMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [captureMenuOpen]);

  // Track fullscreen changes (e.g. user presses Escape to exit)
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Trackpad horizontal/vertical swipe → camera pan & pinch zoom interceptor (Capture Phase)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Pinch gesture for zooming
        e.preventDefault();
        e.stopPropagation();
        
        const plugin = pluginRef.current;
        if (!plugin) return;
        try {
          const camera = plugin.canvas3d?.camera;
          if (!camera) return;
          const state = camera.state;
          if (state) {
            const target = Vec3.clone(state.target);
            const position = Vec3.clone(state.position);
            const forward = Vec3.zero();
            Vec3.sub(forward, target, position);
            
            // Fixed-displacement unit-vector zooming to prevent slowing down near target
            // Dynamically scale sensitivity for trackpad pinch gestures (small deltaY) vs physical mouse wheels
            let zoomSensitivity = 0.15;
            const absDelta = Math.abs(e.deltaY);
            if (absDelta > 0 && absDelta < 8) {
              zoomSensitivity = 1.6; // Scale up for pinch gesture events
            } else if (absDelta < 40) {
              zoomSensitivity = 0.75;
            }
            const step = e.deltaY * zoomSensitivity;
            
            const normForward = Vec3.zero();
            Vec3.normalize(normForward, forward);
            
            const offset = Vec3.zero();
            Vec3.scale(offset, normForward, step);
            
            const newPosition = Vec3.zero();
            Vec3.add(newPosition, position, offset);
            
            // Prevent zooming past target (Zeno-safe clamping)
            const newForward = Vec3.zero();
            Vec3.sub(newForward, target, newPosition);
            if (Vec3.dot(forward, newForward) < 0 || Vec3.magnitude(newForward) < 2.0) {
              return;
            }
            
            const newRadius = Vec3.distance(newPosition, target);
            camera.setState({
              position: newPosition,
              radius: newRadius
            }, 0);
          }
        } catch (err) {
          console.warn("Trackpad zoom error:", err);
        }
      } else {
        // Pan gesture: trackpad scroll/swipe
        // Heuristic: trackpad scroll events have deltaX, or small deltaY (< 50)
        const isTrackpadSwipe = Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 50;
        
        if (isTrackpadSwipe && (Math.abs(e.deltaX) > 1 || Math.abs(e.deltaY) > 1)) {
          e.preventDefault();
          e.stopPropagation();
          
          const plugin = pluginRef.current;
          if (!plugin) return;
          try {
            const camera = plugin.canvas3d?.camera;
            if (!camera) return;
            const state = camera.state;
            if (state) {
              const target = Vec3.clone(state.target);
              const position = Vec3.clone(state.position);
              const up = Vec3.clone(state.up);
              
              const forward = Vec3.zero();
              Vec3.sub(forward, target, position);
              Vec3.normalize(forward, forward);
              
              const right = Vec3.zero();
              Vec3.cross(right, forward, up);
              Vec3.normalize(right, right);
              
              const distance = Vec3.distance(position, target);
              const speedFactor = distance * 0.0015;
              
              const dx = e.deltaX * speedFactor;
              const dy = e.deltaY * speedFactor;
              
              const translation = Vec3.zero();
              const transX = Vec3.zero();
              Vec3.scale(transX, right, dx);
              
              const transY = Vec3.zero();
              Vec3.scale(transY, up, -dy);
              
              Vec3.add(translation, transX, transY);
              
              const newTarget = Vec3.zero();
              Vec3.add(newTarget, target, translation);
              
              const newPosition = Vec3.zero();
              Vec3.add(newPosition, position, translation);
              
              camera.setState({
                target: newTarget,
                position: newPosition
              }, 0);
            }
          } catch (err) {
            console.warn("Trackpad pan error:", err);
          }
        }
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => container.removeEventListener('wheel', handleWheel, { capture: true });
  }, [pluginCreated]);

  // Helper: capture canvas as blob
  const captureCanvasBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) { resolve(null); return; }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  const handleDownloadCapture = async () => {
    setCaptureMenuOpen(false);
    const helper = pluginRef.current?.managers?.viewportScreenshot 
      || pluginRef.current?.helpers?.viewportScreenshot 
      || pluginRef.current?.viewportScreenshot;
    if (helper) {
      try {
        await helper.download(`structural-snapshot-${gene}-${uniprotId}.png`);
        return;
      } catch (err) {
        console.warn('Molstar screenshot helper failed, falling back:', err);
      }
    }
    const blob = await captureCanvasBlob();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `structural-snapshot-${gene}-${uniprotId}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleCopyCapture = async () => {
    setCaptureMenuOpen(false);
    try {
      const blob = await captureCanvasBlob();
      if (blob && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else {
        console.warn('Clipboard write not supported in this browser.');
      }
    } catch (err) {
      console.warn('Failed to copy image to clipboard:', err);
    }
  };

  const handleToggleFullscreen = async () => {
    const el = containerRef.current?.closest('.molstar-viewer-card') as HTMLElement | null
      || containerRef.current?.parentElement?.parentElement as HTMLElement | null;
    if (!document.fullscreenElement && el) {
      try { await el.requestFullscreen(); } catch (e) {}
    } else {
      try { await document.exitFullscreen(); } catch (e) {}
    }
  };

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
      container.style.maxHeight = '100%';
      container.className = `w-full h-full ${isDark ? "text-slate-100" : "text-slate-900"}`;
      parent.appendChild(container);

      try {
        const spec: any = {
          ...DefaultPluginUISpec(),
          canvas3d: {
            webgl: {
              preserveDrawingBuffer: true
            }
          }
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

        // Register custom pLDDT theme provider
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomPLDDTColorThemeProvider);
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomBFactorColorThemeProvider);
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomESM3AllostericColorThemeProvider);

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

    if (!uniprotId && !customPdbData) {
      setLoading(false);
      setLoadError(null);
      return;
    }

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
        } else if (active3dModelTab === "esmfold2") {
          if (analysisContext.state.esmFoldPdb) {
            if (import.meta.env.DEV) {
              console.log(`Molstar loading ESMFold2 predicted mutated PDB structure`);
            }
            data = await localPlugin.builders.data.rawData({
              data: analysisContext.state.esmFoldPdb,
              label: `${gene} (ESMFold2 Mutant Structure)`
            });
          } else if (isEsmFolding) {
            // Currently folding, do not set error, let the folding overlay handle it
            setLoading(true);
            return;
          } else {
            setLoadError(esmFoldingError || "ESMFold2 3D model generation unavailable. Ensure Biohub API token is configured in Settings or try again.");
            setLoading(false);
            return;
          }
        } else {
          const match = variant ? variant.match(/\d+/) : null;
          const posQuery = match ? `?pos=${match[0]}` : "";
          let pdbUrl = customPdbUrl || `/api/v1/alphafold-pdb/${uniprotId}${posQuery}`;
          if (pdbUrl.includes("alphafold.ebi.ac.uk")) {
            pdbUrl = `/api/v1/alphafold-pdb/${uniprotId}${posQuery}`;
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

          // Fetch PDB coordinates using authenticated headers only for internal proxies
          const headers: Record<string, string> = {};
          if (!pdbUrl.startsWith("http://") && !pdbUrl.startsWith("https://")) {
            if (settings?.geminiSessionId) {
              headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
            }
            if (settings?.appApiToken) {
              headers["Authorization"] = `Bearer ${settings.appApiToken}`;
            }
          }
          const fetchRes = await fetch(pdbUrl, { headers });
          if (!fetchRes.ok) {
            throw new Error(`Failed to load PDB from proxy (status: ${fetchRes.status})`);
          }
          const pdbText = await fetchRes.text();

          data = await localPlugin.builders.data.rawData({ 
            data: pdbText, 
            label: `${gene} (AF-${uniprotId})`
          });
        }

        if (!active) return;

        // Use precise signatures: parseTrajectory is the correct method, and parameters are passed sequentially.
        const trajectory = await localPlugin.builders.structure.parseTrajectory(data, "pdb");
        const model = await localPlugin.builders.structure.createModel(trajectory);
        const structure = await localPlugin.builders.structure.createStructure(model);
        structureRef.current = structure;

        let targetStructure = structure;
        if (plddtFilter !== "none") {
          const threshold = parseInt(plddtFilter, 10);
          const expression = MS.struct.generator.atomGroups({
            'atom-test': MS.core.rel.gre([
              MS.struct.atomProperty.macromolecular.B_iso_or_equiv(),
              threshold
            ])
          });
          const filteredComponent = await localPlugin.builders.structure.tryCreateComponentFromExpression(
            structure,
            expression,
            'filtered-structure',
            { label: `pLDDT >= ${threshold}` }
          );
          if (filteredComponent) {
            targetStructure = filteredComponent;
          }
        }

        if (viewerStyle === "biomolecular") {
          // 1. Protein component -> cartoon representation in cyan
          const proteinComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'protein');
          if (proteinComp) {
            await localPlugin.builders.structure.representation.addRepresentation(proteinComp, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: Color(0x00bcd4) } // Cyan
            });
          }

          // 2. Nucleic component (DNA/RNA) -> cartoon & sticks in gray
          const nucleicComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'nucleic');
          if (nucleicComp) {
            await localPlugin.builders.structure.representation.addRepresentation(nucleicComp, {
              type: 'cartoon',
              color: 'uniform',
              colorParams: { value: Color(0x888888) } // Gray
            });
            await localPlugin.builders.structure.representation.addRepresentation(nucleicComp, {
              type: 'ball-and-stick',
              color: 'uniform',
              colorParams: { value: Color(0x999999) }
            });
          }

          // 3. Ligand component -> ball-and-stick colored by element
          const ligandComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'ligand');
          if (ligandComp) {
            await localPlugin.builders.structure.representation.addRepresentation(ligandComp, {
              type: 'ball-and-stick',
              color: 'element-symbol'
            });
          }

          // 4. Ion component -> spacefill colored by element
          const ionComp = await localPlugin.builders.structure.tryCreateComponentStatic(targetStructure, 'ion');
          if (ionComp) {
            await localPlugin.builders.structure.representation.addRepresentation(ionComp, {
              type: 'spacefill',
              color: 'element-symbol'
            });
          }
        } else if (viewerStyle === "esm3-allosteric") {
          await localPlugin.builders.structure.representation.applyPreset(targetStructure, 'auto', {
            theme: {
              globalName: 'esm3-allosteric',
              props: {
                perturbationScores: analysisContext.state.result?.esm3Eval?.perturbationScores || []
              }
            }
          });
        } else {
          // Apply standard auto representation preset for robust loading/coloring representation
          // utilizing the built-in 'plddt-confidence' color theme (AlphaFold uses B-factor for pLDDT)
          await localPlugin.builders.structure.representation.applyPreset(targetStructure, 'auto', {
            theme: { globalName: templateSource === 'experimental' ? 'bfactor-mobility' : 'plddt-confidence' }
          });
        }

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

          let targetStructure2 = structure2;
          if (plddtFilter !== "none") {
            const threshold = parseInt(plddtFilter, 10);
            const expression2 = MS.struct.generator.atomGroups({
              'atom-test': MS.core.rel.gre([
                MS.struct.atomProperty.macromolecular.B_iso_or_equiv(),
                threshold
              ])
            });
            const filteredComponent2 = await localPlugin.builders.structure.tryCreateComponentFromExpression(
              structure2,
              expression2,
              'filtered-structure-compare',
              { label: `pLDDT >= ${threshold}` }
            );
            if (filteredComponent2) {
              targetStructure2 = filteredComponent2;
            }
          }

          await localPlugin.builders.structure.representation.applyPreset(targetStructure2, 'auto', {
            theme: { globalName: templateSource === 'experimental' ? 'bfactor-mobility' : 'plddt-confidence' }
          });
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
          const modelName = customPdbUrl 
            ? `PDB model (${customPdbUrl.split('/').pop() || customPdbUrl})` 
            : `AlphaFold model AF-${uniprotId}`;
          setLoadError(`Failed to load 3D coordinates for ${modelName}. Please verify accession/model validity.`);
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
  }, [pluginCreated, uniprotId, customPdbUrl, customPdbData, gene, comparePdbData, variant, plddtFilter, templateSource, viewerStyle, active3dModelTab, analysisContext.state.esmFoldPdb, isEsmFolding, esmFoldingError]);

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
    <div className={`molstar-viewer-card relative w-full ${heightClass || "h-[650px]"} flex flex-col overflow-hidden transition-all border rounded-xl`} style={{ background: "var(--cs-bg)", borderColor: "var(--cs-border)" }}>
      
      {/* TOP CONTROL TOOLBAR: Unified Protein Source Indicator & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b z-20 shrink-0 pointer-events-auto shadow-xs" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        {/* Left: Unified Protein Source Badge, Gene, Residue, Focus Button */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span 
            className="flex items-center gap-1.5 px-3 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
            style={{
              background: "var(--cs-surface-2)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--cs-accent)" }} />
            <span>
              {comparePdbData ? (
                "Superimposed Structures"
              ) : customPdbData ? (
                mutantStatus === "success" ? "FoldX Mutant PDB" : "SCWRL4 Mutant PDB"
              ) : active3dModelTab === "esmfold2" ? (
                "ESMFold2 Mutant Model"
              ) : customPdbUrl ? (
                "Experimental Homolog PDB"
              ) : pdbSource === "RCSB PDB" && pdbId ? (
                `RCSB PDB: ${pdbId.toUpperCase()}`
              ) : uniprotId ? (
                `AlphaFold DB (AF-${uniprotId})`
              ) : (
                "No Structure Loaded"
              )}
            </span>
          </span>

          {gene && (
            <span 
              className="px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
              style={{
                background: "var(--cs-surface-2)",
                borderColor: "var(--cs-border-subtle)",
                color: "var(--cs-text-secondary)"
              }}
            >
              Gene: <strong style={{ color: "var(--cs-text-primary)" }}>{gene}</strong>
            </span>
          )}

          {residueIndex !== null && (
            <span 
              className="px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide text-[10px]"
              style={{
                background: "var(--cs-accent-mag-soft)",
                borderColor: "var(--cs-accent-mag)",
                color: "var(--cs-accent-mag)"
              }}
            >
              Residue: <strong>#{residueIndex}</strong>
            </span>
          )}

          {residueIndex !== null && (
            <button
              type="button"
              onClick={() => focusOnPocketResidue(residueIndex)}
              className="px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[10px] font-mono font-semibold transition-all hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
              style={{
                background: "var(--cs-surface)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-accent)"
              }}
              title={`Focus 3D camera on residue ${residueIndex}`}
            >
              <Target className="w-3 h-3" style={{ color: "var(--cs-accent)" }} />
              <span>Focus Residue #{residueIndex}</span>
            </button>
          )}
        </div>

        {/* Right: Actions (Representation, pLDDT Filter, Pocket Finder, Capture View, Fullscreen) */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Representation Style Selector */}
          <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
              Representation:
            </span>
            <select
              value={viewerStyle}
              onChange={(e) => setViewerStyle(e.target.value as "confidence" | "biomolecular" | "esm3-allosteric")}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-colors"
              style={{
                background: "var(--cs-surface)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-primary)"
              }}
            >
              <option value="confidence">pLDDT / B-factor</option>
              <option value="biomolecular">Cartoon & Sticks</option>
              <option value="esm3-allosteric">ESM3 Allosteric Heatmap</option>
            </select>
          </div>

          {/* pLDDT Filter Selector */}
          {templateSource === "alphafold" && (
            <div className="flex items-center gap-1.5 pl-2 border-l" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span className="text-[10px] font-bold uppercase tracking-wider hidden md:inline" style={{ color: "var(--cs-text-muted)" }}>
                pLDDT Filter:
              </span>
              <select
                value={plddtFilter}
                onChange={(e) => setPlddtFilter(e.target.value as "none" | "30" | "50" | "70")}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold outline-none cursor-pointer border transition-colors"
                style={{
                  background: "var(--cs-surface)",
                  borderColor: "var(--cs-border)",
                  color: "var(--cs-text-primary)"
                }}
              >
                <option value="none">Show All</option>
                <option value="50">pLDDT &ge; 50</option>
                <option value="70">pLDDT &ge; 70</option>
              </select>
            </div>
          )}

          {/* Pocket Finder Action Button */}
          <button
            type="button"
            onClick={() => {
              const next = !isPocketPanelOpen;
              setIsPocketPanelOpen(next);
              setShowPocket(next);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none"
            style={{
              background: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-surface)",
              borderColor: isPocketPanelOpen ? "var(--cs-accent-clay)" : "var(--cs-border)",
              color: isPocketPanelOpen ? "#ffffff" : "var(--cs-text-primary)"
            }}
            title="Run binding pocket analysis"
          >
            <Cpu className={`w-4 h-4 ${isPocketPanelOpen ? "text-white animate-pulse" : ""}`} style={{ color: isPocketPanelOpen ? "#ffffff" : "var(--cs-accent)" }} />
            <span>Pocket Finder</span>
          </button>

          {/* Capture View Dropdown Button */}
          <div className="relative flex" ref={captureMenuRef}>
            <button
              type="button"
              onClick={() => setCaptureMenuOpen(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none"
              style={{
                background: captureMenuOpen ? "var(--cs-bg-subtle)" : "var(--cs-surface)",
                borderColor: "var(--cs-border)",
                color: "var(--cs-text-primary)"
              }}
              title="Capture view options"
            >
              <Camera className="w-4 h-4" style={{ color: "var(--cs-accent)" }} />
              <span>Capture View</span>
              <ChevronUp className={`w-3.5 h-3.5 transition-transform ${captureMenuOpen ? "" : "rotate-180"}`} />
            </button>

            {captureMenuOpen && (
              <div 
                className="absolute top-full right-0 mt-1.5 w-44 rounded-xl border overflow-hidden z-30 animate-slide-in font-mono shadow-lg"
                style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
              >
                <button
                  type="button"
                  onClick={handleDownloadCapture}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)]"
                  style={{ color: "var(--cs-text-primary)" }}
                >
                  <Download className="w-4 h-4 shrink-0" style={{ color: "var(--cs-accent)" }} />
                  <span>Download PNG</span>
                </button>
                <div className="h-px" style={{ background: "var(--cs-border-subtle)" }} />
                <button
                  type="button"
                  onClick={handleCopyCapture}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-bold transition-colors cursor-pointer text-left hover:bg-[var(--cs-bg-subtle)]"
                  style={{ color: "var(--cs-text-primary)" }}
                >
                  <ClipboardCopy className="w-4 h-4 shrink-0" style={{ color: "var(--cs-accent)" }} />
                  <span>Copy Image</span>
                </button>
              </div>
            )}
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold font-mono border transition-all cursor-pointer select-none hover:bg-[var(--cs-bg-subtle)]"
            style={{
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div className="flex-1 min-h-0 relative w-full h-full">

        {/* ESM3 Representation Data Unavailable Overlay */}
        {viewerStyle === "esm3-allosteric" && !analysisContext.state.result?.esm3Eval && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
            <Activity className="w-10 h-10 mb-3" style={{ color: "var(--cs-text-muted)" }} />
            <p className="font-semibold text-base mb-1" style={{ color: "var(--cs-text-primary)" }}>
              ESM3 Representation Data Unavailable
            </p>
            <p className="text-xs max-w-md mb-4 text-center leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
              Allosteric perturbation heatmap requires an active Biohub API token. Configure your Biohub key in Settings to analyze structure-level attention maps.
            </p>
          </div>
        )}

        {/* ESMFold2 Active Prediction Loading State */}
        {active3dModelTab === "esmfold2" && isEsmFolding && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
            <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
            <p className="font-mono text-xs font-bold tracking-wider uppercase animate-pulse" style={{ color: "var(--cs-accent)" }}>
              Predicting 3D Mutant Fold via ESMFold2...
            </p>
            <p className="text-xs mt-2 text-center max-w-sm" style={{ color: "var(--cs-text-muted)" }}>
              Running deep transformer sequence folding query on Biohub server...
            </p>
          </div>
        )}

        {/* Standard Model Loading Overlay */}
        {loading && !isEsmFolding && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
            <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
            <p className="font-mono text-xs font-bold tracking-wider uppercase animate-pulse" style={{ color: "var(--cs-accent)" }}>
              {customPdbData ? "Rendering Mutant Structure..." : "Fetching Structure Coordinates..."}
            </p>
            <p className="text-xs mt-2 text-center max-w-sm" style={{ color: "var(--cs-text-muted)" }}>
              {customPdbData 
                ? `Processing custom 3D mutant biophysical simulation via local FoldX engine...`
                : `Downloading 3D PDB structure for UniProt accession: ${uniprotId}`}
            </p>
          </div>
        )}

        {/* Structure Load Error Overlay */}
        {(loadError || (active3dModelTab === "esmfold2" && !isEsmFolding && !esmFoldPdb && !customPdbData)) && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm" style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}>
            <Activity className="w-10 h-10 mb-3" style={{ color: "var(--cs-text-danger)" }} />
            <p className="font-semibold text-base mb-1" style={{ color: "var(--cs-text-primary)" }}>Structure Unavailable</p>
            <p className="text-xs max-w-md mb-4" style={{ color: "var(--cs-text-secondary)" }}>
              {loadError || esmFoldingError || "ESMFold2 3D model generation failed or endpoint is unreachable."}
            </p>
            <div className="text-xs p-3 rounded-lg text-left font-mono max-w-md w-full overflow-hidden border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
              Source Diagnostic: <span className="font-semibold break-all" style={{ color: "var(--cs-text-danger)" }}>
                {active3dModelTab === "esmfold2"
                  ? (esmFoldingError || "Biohub API endpoint unreachable (HTTP 502 / Connection Timeout)")
                  : customPdbData 
                    ? "Target FoldX Mutated Output" 
                    : customPdbUrl
                      ? `Custom PDB Model (${customPdbUrl.split('/').pop() || customPdbUrl})`
                      : pdbSource === "RCSB PDB" && pdbId 
                        ? `RCSB PDB (ID: ${pdbId.toUpperCase()})` 
                        : `AlphaFold DB v4 (AF-${uniprotId})`}
              </span>
            </div>
          </div>
        )}

        {/* Onboarding Welcome Overlay */}
        {!uniprotId && !customPdbData && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8 text-center" style={{ background: "var(--cs-bg)", color: "var(--cs-text-primary)" }}>
            <div className="relative mb-6 group cursor-default">
              <div className="relative p-6 rounded-2xl border transition-all duration-500 ease-out" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <svg className="w-14 h-14 animate-[spin_10s_linear_infinite]" style={{ color: "var(--cs-accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
            </div>
            
            <h3 className="text-sm font-semibold font-mono uppercase tracking-wider mb-3" style={{ color: "var(--cs-accent)" }}>
              3D Molecular Workspace Ready
            </h3>
            <div className="w-16 h-[1px] mx-auto mb-4" style={{ background: "var(--cs-border)" }}></div>
            
            <p className="text-xs max-w-sm mb-6 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
              Submit a genetic variant search query to load and inspect 3D protein structures. You can simulate mutation side-chains, calculate structural pockets, and analyze local structural disruptions.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 font-mono">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                ⚡ AlphaFold 3D Structures
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                🧪 FoldX Biophysics Engine
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                🧬 Variant Mutagenesis
              </span>
            </div>
          </div>
        )}

        <div 
          ref={containerRef} 
          id="molstar-viewer-container" 
          className={`w-full h-full text-slate-900 transition-all duration-700 ease-out ${
            isTransitioning ? "opacity-35 scale-[0.985] blur-[1px]" : "opacity-100 scale-100 blur-0"
          }`}
        />

        {/* FoldX / SCWRL4 result — collapsible draggable badge */}
        {customPdbData && mutantStatus && (
          <div
            className={`absolute z-20 max-w-[300px] pointer-events-auto select-none transition-shadow rounded-xl border border-l-4 border-l-indigo-500 overflow-hidden backdrop-blur-md ${
              isFoldXDragging ? "shadow-2xl" : "shadow-md"
            }`}
            onMouseDown={handleFoldXMouseDown}
            style={{
              top: `calc(0.75rem + ${foldXPosition.y}px)`,
              left: `calc(0.75rem + ${foldXPosition.x}px)`,
              cursor: isFoldXDragging ? 'grabbing' : 'grab',
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
          >
            {mutantStatus === "success" ? (
              <div>
                <button
                  type="button"
                  onClick={() => setFoldxBannerCollapsed(p => !p)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-[var(--cs-bg-subtle)]"
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-indigo-500 shrink-0 animate-pulse" />
                    <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
                      FoldX Model
                    </span>
                    {mutantDdG !== null && mutantDdG !== undefined && (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-accent)" }}>
                        ΔΔG: {mutantDdG.toFixed(2)} kcal/mol
                      </span>
                    )}
                  </div>
                  {foldxBannerCollapsed
                    ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                    : <ChevronUp className="w-3 h-3 text-slate-400 shrink-0" />}
                </button>
                {!foldxBannerCollapsed && (
                  <div className="px-3 pb-2.5 pt-0 text-[10px] font-mono border-t" style={{ borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-secondary)" }}>
                    <p className="leading-relaxed mt-1.5">
                      <strong>Biophysically Repacked:</strong> Side-chain coordinates reflect local FoldX force-field energy minimisation.
                      {mutantDdG !== null && mutantDdG !== undefined
                        ? ` Predicted ΔΔG: ${formatDdG(mutantDdG, energyUnit)}.`
                        : " ΔΔG unavailable."}
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Slide-out Automated Pocket Control Panel */}
      {isPocketPanelOpen && (
        <div
          id="pocket-finder-suite-panel"
          className="absolute top-14 right-3 max-h-[calc(100%-80px)] h-fit w-[310px] z-20 backdrop-blur-md rounded-xl border flex flex-col overflow-hidden shadow-2xl animate-fade-in pointer-events-auto transition-all"
          style={{
            transform: `translate(${pocketPosition.x}px, ${pocketPosition.y}px)`,
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between p-3.5 border-b cursor-grab active:cursor-grabbing select-none"
            style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}
            onMouseDown={handlePocketMouseDown}
          >
            <div className="flex items-center gap-2.5">
              <Activity className="w-4 h-4 animate-pulse" style={{ color: "var(--cs-accent)" }} />
              <div>
                <h3 className="text-[11.5px] font-bold uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-primary)" }}>Active Site Cavity Solver</h3>
                <p className="text-[8.5px] font-mono" style={{ color: "var(--cs-text-muted)" }}>3D Spatial Proximity & Pocket Analysis</p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => setIsPocketPanelOpen(false)}
              className="p-1 rounded-md transition-colors hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
              style={{ color: "var(--cs-text-secondary)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar">
            {residueIndex === null ? (
              <div className="text-center py-6">
                <p className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>Select a residue to run coordinate calculations.</p>
              </div>
            ) : isPocketLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent)", borderTopColor: "transparent" }}></div>
                <p className="text-[9px] font-mono animate-pulse text-center uppercase tracking-wider px-2" style={{ color: "var(--cs-text-muted)" }}>
                  Analyzing Local Spatial Proximities Server-side...
                </p>
              </div>
            ) : pocketError ? (
              <div className="text-center py-12 px-3 font-mono text-xs border rounded-lg" style={{ borderColor: "var(--cs-border)", background: "var(--cs-surface-2)", color: "var(--cs-text-danger)" }}>
                <p className="font-bold mb-1">Server Calculation Error</p>
                <p className="text-[10px] opacity-80">{pocketError}</p>
              </div>
            ) : computedPocket ? (
              <>
                {/* Pocket Stats Bento Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-center font-mono">
                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Pocket Volume</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-accent)" }}>{computedPocket.pocketVolume} Å³</strong>
                  </div>
                  
                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Affinity Prob.</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-accent)" }}>{computedPocket.pocketScore}%</strong>
                  </div>

                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Centroid Dist.</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: computedPocket.pocketDistance !== null && computedPocket.pocketDistance < 10 ? "var(--cs-text-danger)" : "var(--cs-text-primary)" }}>
                      {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                        ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                        : "N/A"}
                    </strong>
                  </div>

                  <div className="p-2.5 rounded-lg border text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                    <span className="block text-[9.5px] uppercase font-bold" style={{ color: "var(--cs-text-muted)" }}>Lining residues</span>
                    <strong className="text-[13.5px] block mt-0.5" style={{ color: "var(--cs-text-success)" }}>{computedPocket.pocketResidues?.length || 0}</strong>
                  </div>
                </div>

                {/* Predicted Substrate */}
                <div className="p-2.5 rounded-lg border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                  <span className="block text-[9.5px] uppercase font-bold font-mono" style={{ color: "var(--cs-text-muted)" }}>
                    Likely Target Co-Factor
                  </span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-accent)" }} />
                    <span className="text-[11.5px] font-bold truncate" style={{ color: "var(--cs-text-primary)" }}>{computedPocket.likelyCofactor}</span>
                  </div>
                </div>

                {/* Highlight Full Pocket Action */}
                <div className="flex items-center justify-between border-t border-b py-2.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                  <span className="text-[11px] font-bold font-mono uppercase" style={{ color: "var(--cs-text-muted)" }}>3D Highlights</span>
                  
                  <button
                    type="button"
                    onClick={() => setShowPocket(p => !p)}
                    className="px-3 py-1 rounded text-[10px] font-mono font-bold transition-all select-none cursor-pointer"
                    style={{
                      background: showPocket ? "var(--cs-accent)" : "var(--cs-surface-2)",
                      borderColor: "var(--cs-border)",
                      color: showPocket ? "#ffffff" : "var(--cs-text-primary)"
                    }}
                  >
                    {showPocket ? " Cavity ON" : " Cavity OFF"}
                  </button>
                </div>

                {/* Info redirect block */}
                <div className="p-3 rounded-lg border flex flex-col gap-1.5 leading-relaxed text-[11px]" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                  <p>
                    💡 Detailed spatial lining residue metrics, distance calculations, and curated functional site annotations are available under the <strong>Function</strong> tab in the evidence dashboard.
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-xs font-mono" style={{ color: "var(--cs-text-muted)" }}>No pocket coordinate results loaded.</p>
              </div>
            )}
          </div>
          
          {/* Footer panel caption */}
          <div className="p-2 border-t text-center text-[7.5px] font-mono uppercase select-none" style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)", color: "var(--cs-text-muted)" }}>
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
            cursor: isDragging ? 'grabbing' : 'grab',
            background: "var(--cs-surface)",
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)"
          }}
          className="absolute top-3 right-12 max-w-[280px] backdrop-blur-md p-3.5 rounded-xl border border-l-4 border-l-rose-500 z-20 shadow-xl transition-shadow flex flex-col gap-1.5 animate-slide-in pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between gap-4 border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
              <span className="text-[9px] font-extrabold uppercase tracking-widest font-mono" style={{ color: "var(--cs-text-danger)" }}>
                Biophysical Insight Alert
              </span>
            </div>
            
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsAlertClosed(true);
              }}
              className="p-1 rounded-md transition-colors hover:bg-[var(--cs-bg-subtle)] cursor-pointer"
              style={{ color: "var(--cs-text-secondary)" }}
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <h4 className="text-xs font-bold leading-tight flex items-center gap-1">
            {disruptionWarning.title}
          </h4>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            {disruptionWarning.description}
          </p>
          
          <div className="text-[8px] font-mono text-right mt-0.5 select-none" style={{ color: "var(--cs-text-muted)" }}>
            ⌥ Click & drag to move
          </div>
        </div>
      )}
    </div>
  );
}

