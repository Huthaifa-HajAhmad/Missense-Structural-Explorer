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
          components: {
            remoteState: 'none',
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
            const root = createRoot(target);
            root.render(component);
            return root;
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
                onResidueClick(resIdx);
              }
            }
          }
        });

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
      pluginRef.current = null;
      setPluginCreated(false);
    };
  }, [webglResetCounter]);

  // Trackpad gesture zoom / pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
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

            let zoomSensitivity = 0.15;
            const absDelta = Math.abs(e.deltaY);
            if (absDelta > 0 && absDelta < 8) {
              zoomSensitivity = 1.6;
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
