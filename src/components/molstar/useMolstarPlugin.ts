import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { DefaultPluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import {
  CustomPLDDTColorThemeProvider,
  CustomBFactorColorThemeProvider,
  CustomESM3AllostericColorThemeProvider,
  CustomDisplacementColorThemeProvider
} from "./molstarThemes";

export interface UseMolstarPluginOptions {
  isDark: boolean;
  onResidueHover?: (index: number | null) => void;
  onResidueClick?: (index: number) => void;
}

export function useMolstarPlugin({ isDark, onResidueHover, onResidueClick }: UseMolstarPluginOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<any>(null);
  const [pluginCreated, setPluginCreated] = useState<boolean>(false);
  const [webglResetCounter, setWebglResetCounter] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [captureMenuOpen, setCaptureMenuOpen] = useState<boolean>(false);
  const captureMenuRef = useRef<HTMLDivElement>(null);
  const lastResetTimeRef = useRef<number>(0);

  // Initialize Molstar Plugin UI once on mount
  useEffect(() => {
    let active = true;
    let localPlugin: any = null;
    let hoverSubscription: any = null;
    let clickSubscription: any = null;
    let rootInstance: any = null;

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
          layout: {
            initialShowControls: false,
            initialShowLog: false,
            initialShowSequence: false,
            initialShowHelper: false,
          },
          components: {
            remoteState: 'none',
            controls: {
              left: 'none',
              right: 'none',
              top: 'none',
              bottom: 'none',
            },
            hideTaskOverlay: true,
          },
          config: [
            [PluginConfig.State.DefaultServer, ''],
            [PluginConfig.State.CurrentServer, ''],
          ],
          canvas3d: {
            webgl: {
              preserveDrawingBuffer: true
            }
          }
        };

        localPlugin = await createPluginUI({
          target: container,
          spec: spec,
          render: (component, target) => {
            rootInstance = createRoot(target);
            rootInstance.render(component);
            return rootInstance;
          }
        });

        const canvas = container.querySelector('canvas');
        if (canvas) {
          canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - lastResetTimeRef.current < 5000) {
              console.warn('[MolstarViewer] WebGL context lost repeatedly. Aborting automatic recreation.');
              setLoadError("WebGL context lost repeatedly. Please reload the page or close other tabs using graphics acceleration.");
              setLoading(false);
              return;
            }
            lastResetTimeRef.current = now;
            console.warn('[MolstarViewer] WebGL context lost. Recreating molecular viewer instance...');
            setLoading(true);
            setLoadError(null);
            setWebglResetCounter(prev => prev + 1);
          });
        }

        if (!active) {
          localPlugin.dispose();
          return;
        }

        pluginRef.current = localPlugin;

        // Register custom color themes
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomPLDDTColorThemeProvider);
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomBFactorColorThemeProvider);
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomESM3AllostericColorThemeProvider);
        localPlugin.representation.structure.themes.colorThemeRegistry.add(CustomDisplacementColorThemeProvider);

        // Hover subscription
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

        // Click subscription
        clickSubscription = localPlugin.behaviors.interaction.click.subscribe((event: any) => {
          const current = event.current;
          if (current && current.loci && StructureElement.Loci.is(current.loci)) {
            const location = StructureElement.Loci.getFirstLocation(current.loci);
            if (location) {
              const resIdx = StructureProperties.residue.auth_seq_id(location);
              if (resIdx && onResidueClick) {
                try {
                  localPlugin.managers.structure.selection.clear();
                } catch (_) {}
                onResidueClick(resIdx);
              }
            }
          }
        });

        // P1-16: Clear the loading flag on success so the overlay does not persist.
        setLoading(false);
        setPluginCreated(true);
      } catch (err: any) {
        console.error("Molstar initialization error:", err);
        setLoadError(`Plugin init error: ${err.message || err}`);
        setLoading(false);
      }
    }

    initPlugin();

    return () => {
      active = false;
      if (hoverSubscription) hoverSubscription.unsubscribe();
      if (clickSubscription) clickSubscription.unsubscribe();
      if (localPlugin) {
        try {
          localPlugin.dispose();
        } catch (e) {
          console.warn("Molstar dispose warning:", e);
        }
      }
      if (rootInstance) {
        setTimeout(() => {
          try {
            rootInstance.unmount();
          } catch (e) {}
        }, 0);
      }
      pluginRef.current = null;
      setPluginCreated(false);
    };
  }, [webglResetCounter]);

  const captureCanvasBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) { resolve(null); return; }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  const handleDownloadCapture = async (gene?: string, uniprotId?: string) => {
    setCaptureMenuOpen(false);
    const helper = pluginRef.current?.managers?.viewportScreenshot
      || pluginRef.current?.helpers?.viewportScreenshot
      || pluginRef.current?.viewportScreenshot;
    if (helper) {
      try {
        await helper.download(`structural-snapshot-${gene || "gene"}-${uniprotId || "uniprot"}.png`);
        return;
      } catch (err) {
        console.warn('Molstar screenshot helper failed, falling back:', err);
      }
    }
    const blob = await captureCanvasBlob();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `structural-snapshot-${gene || "gene"}-${uniprotId || "uniprot"}.png`;
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

  return {
    containerRef,
    pluginRef,
    pluginCreated,
    loading, setLoading,
    loadError, setLoadError,
    captureMenuOpen, setCaptureMenuOpen,
    captureMenuRef,
    handleDownloadCapture,
    handleCopyCapture
  };
}
