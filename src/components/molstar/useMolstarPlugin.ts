import { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { DefaultPluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import { PluginConfig } from "molstar/lib/mol-plugin/config";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { StructureElement, StructureProperties } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import { STRUCTURE_THEME_PROVIDERS } from "./molstarThemes";

/** `rgb(r, g, b)` / `rgba(…)` → a Mol* colour; null when the string is not an opaque colour. */
function cssColorToMolstar(css: string): number | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(css);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return Color.fromRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

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
  const hoverRef = useRef(onResidueHover);
  hoverRef.current = onResidueHover;
  const clickRef = useRef(onResidueClick);
  clickRef.current = onResidueClick;

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
            },
            cameraClipping: {
              radius: 0,
              far: false,
              minNear: 0.1
            },
            cameraFog: {
              name: 'off',
              params: {}
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

        // Ensure camera clipping and fog are completely disabled
        if (localPlugin.canvas3d) {
          try {
            localPlugin.canvas3d.setProps({
              cameraClipping: {
                radius: 0,
                far: false,
                minNear: 0.1
              },
              cameraFog: {
                name: 'off',
                params: {}
              }
            });
            if (localPlugin.canvas3d.camera) {
              localPlugin.canvas3d.camera.forceFull = true;
              localPlugin.canvas3d.camera.setState({ clipFar: false });
            }
          } catch (clipErr) {
            console.warn('[Molstar] Could not set cameraClipping props:', clipErr);
          }
        }

        // The 3D view's colour themes (bands shared with the on-canvas legend).
        for (const provider of STRUCTURE_THEME_PROVIDERS) {
          localPlugin.representation.structure.themes.colorThemeRegistry.add(provider);
        }

        // Hover subscription
        hoverSubscription = localPlugin.behaviors.interaction.hover.subscribe((event: any) => {
          const current = event.current;
          if (current && current.loci && StructureElement.Loci.is(current.loci)) {
            const location = StructureElement.Loci.getFirstLocation(current.loci);
            if (location) {
              const resIdx = StructureProperties.residue.auth_seq_id(location);
              if (resIdx) {
                hoverRef.current?.(resIdx);
              }
            }
          } else {
            hoverRef.current?.(null);
          }
        });

        // Click subscription
        clickSubscription = localPlugin.behaviors.interaction.click.subscribe((event: any) => {
          const current = event.current;
          if (current && current.loci && StructureElement.Loci.is(current.loci)) {
            const location = StructureElement.Loci.getFirstLocation(current.loci);
            if (location) {
              const resIdx = StructureProperties.residue.auth_seq_id(location);
              if (resIdx) {
                try {
                  localPlugin.managers.structure.selection.clear();
                } catch (_) {}
                clickRef.current?.(resIdx);
              }
            }
          }
        });

        // P1-16: Clear the loading flag on success so the overlay does not persist.
        setLoading(false);
        setPluginCreated(true);
      } catch (err: any) {
        console.error("[Molstar] Initialization error:", err);
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
          console.warn("[Molstar] Dispose warning:", e);
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

  /**
   * The canvas background follows the app theme. It used to be fixed when the plugin was created, so
   * switching between light and dark left a white canvas inside a dark card (or the reverse). The
   * colour is read from the container's computed background, so it is always the current token.
   */
  useEffect(() => {
    const plugin = pluginRef.current;
    const host = containerRef.current;
    if (!pluginCreated || !plugin?.canvas3d || !host) return;
    const frame = window.requestAnimationFrame(() => {
      let el: HTMLElement | null = host;
      let colour: number | null = null;
      while (el && colour === null) {
        colour = cssColorToMolstar(getComputedStyle(el).backgroundColor);
        el = el.parentElement;
      }
      if (colour === null) return;
      try {
        plugin.canvas3d.setProps({ renderer: { backgroundColor: colour as any } });
      } catch (err) {
        console.warn("[3D] Could not set the canvas background:", err);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pluginCreated, isDark]);

  // Close the capture menu on an outside click or Escape; it used to stay open until toggled.
  useEffect(() => {
    if (!captureMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (captureMenuRef.current && !captureMenuRef.current.contains(e.target as Node)) setCaptureMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCaptureMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [captureMenuOpen]);

  const captureCanvasBlob = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) { resolve(null); return; }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  /** `fileStem` names the structure and colouring, so a saved image records what it shows. */
  const handleDownloadCapture = async (fileStem: string) => {
    setCaptureMenuOpen(false);
    const fileName = `structure_${fileStem || "view"}.png`;
    const helper = pluginRef.current?.managers?.viewportScreenshot
      || pluginRef.current?.helpers?.viewportScreenshot
      || pluginRef.current?.viewportScreenshot;
    if (helper) {
      try {
        await helper.download(fileName);
        return;
      } catch (err) {
        console.warn('[Molstar] Screenshot helper failed, falling back:', err);
      }
    }
    const blob = await captureCanvasBlob();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = fileName;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  /** Resolves true when the image reached the clipboard, so the caller can say whether it worked. */
  const handleCopyCapture = async (): Promise<boolean> => {
    setCaptureMenuOpen(false);
    try {
      const blob = await captureCanvasBlob();
      if (blob && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      }
      console.warn('[Molstar] Clipboard write not supported in this browser.');
      return false;
    } catch (err) {
      console.warn('[Molstar] Failed to copy image to clipboard:', err);
      return false;
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
