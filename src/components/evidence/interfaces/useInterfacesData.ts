import { useCallback, useEffect, useRef, useState } from "react";
import type { MultimerData, PpiBindingData, PpiBindingShift } from "../../../shared/contracts";
import { useApiClient, extractErrorMessage } from "../../../apiClient";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { getDeduplicatedPromise } from "../../../variantAnalysisUtils";
import { setCachedVariant } from "../../../services/pipeline/variantCache";
import { isStaleAssembly, isStalePpi, type LoadState } from "../../../shared/interfacesEvidence";

/**
 * useInterfacesData — the three requests behind the Interfaces & PPI tab, each scoped to the
 * (gene, variant) it was issued for so a late answer for the previous variant never paints this one.
 *
 *   assembly  POST /structure/multimer            curated assembly + solved interfaces. Cheap; read on
 *                                                  open (the pipeline usually has it already).
 *             POST /structure/multimer {model}    the Boltz-2 complex: ON REQUEST. A job that outlives
 *                                                  one request answers "running" and is asked again
 *                                                  every POLL_MS while the tab is open; the server
 *                                                  resumes the same job, it never submits a second.
 *   lookups   POST /ppi/binding-affinity           partners, IntAct methods, STRING lists, sites.
 *   binding   POST /ppi/binding-shift              DDMut-PPI on a wild-type complex: ON REQUEST, and
 *                                                  followed the same way while it is "running".
 *
 * A stored payload that predates per-structure support or the IntAct/STRING fields is re-read, not
 * rendered: those payloads carried the counts this tab exists to correct.
 */

const POLL_MS = 15000;

type Keyed<T> = { key: string; status: LoadState; data: T | null; message?: string };

function patchResult(gene: string, variant: string, patch: Record<string, unknown>) {
  const state = useVariantAnalysisStore.getState().analysisState;
  const meta = state?.result?.metadata;
  if (meta?.gene !== gene || meta?.variant !== variant) return;
  useVariantAnalysisStore.getState().setAnalysisState((prev: any) => (prev?.result ? { ...prev, result: { ...prev.result, ...patch } } : prev));
  const current = useVariantAnalysisStore.getState().analysisState?.result;
  if (current && meta?.uniprotId) setCachedVariant(gene, variant, meta.uniprotId, { analysisResult: current });
}

export function useInterfacesData(result: any) {
  const gene: string | undefined = result?.metadata?.gene;
  const variant: string | undefined = result?.metadata?.variant;
  const uniprotId: string | undefined = result?.metadata?.uniprotId;
  const key = gene && variant ? `${gene}|${variant}` : null;
  const { fetchWithAuth } = useApiClient();

  // ── Assembly (and the model, when asked) ──────────────────────────────
  const storedAsm = (result?.multimerData ?? null) as MultimerData | null;
  const freshStoredAsm = storedAsm && !isStaleAssembly(storedAsm) ? storedAsm : null;
  const [asm, setAsm] = useState<Keyed<MultimerData> | null>(null);
  const [modelRequested, setModelRequested] = useState<string | null>(null);

  const fetchAssembly = useCallback(
    async (model: boolean, signal?: AbortSignal) => {
      if (!gene || !variant || !uniprotId || !key) return;
      if (model) setModelRequested(key);
      setAsm(prev => ({ key, status: "loading", data: prev?.key === key ? prev.data : null }));
      try {
        const run = async () => {
          const response = await fetchWithAuth("/api/v1/structure/multimer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gene, variant, uniprotId, ...(model ? { model: true } : {}) }),
            signal,
          });
          if (!response.ok) throw new Error(await extractErrorMessage(response, "The assembly service did not answer."));
          return (await response.json()) as MultimerData;
        };
        // The lookups-only request shares the pipeline's key, so the two never run twice.
        const next = model ? await run() : await getDeduplicatedPromise(`multimer_${gene}_${variant}_${uniprotId}`, run, signal);
        if (!next || signal?.aborted) return;
        setAsm({ key, status: "ready", data: next });
        if (next.status !== "running") setModelRequested(null);
        patchResult(gene, variant, { multimerData: next });
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) return;
        if (model) setModelRequested(null);
        setAsm(prev => ({ key, status: "error", data: prev?.key === key ? prev.data : null, message: err?.message || "The assembly service did not answer." }));
      }
    },
    [gene, variant, uniprotId, key, fetchWithAuth]
  );

  useEffect(() => {
    if (!key) return;
    if (freshStoredAsm) {
      setAsm({ key, status: "ready", data: freshStoredAsm });
      return;
    }
    const controller = new AbortController();
    void fetchAssembly(false, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, Boolean(freshStoredAsm), fetchAssembly]);

  // ── Lookups ──────────────────────────────────────────────────────────
  const storedPpi = (result?.ppiBindingData ?? null) as PpiBindingData | null;
  const freshStoredPpi = storedPpi && storedPpi.gene === gene && storedPpi.variant === variant && !isStalePpi(storedPpi) ? storedPpi : null;
  const [ppi, setPpi] = useState<Keyed<PpiBindingData> | null>(null);

  const fetchLookups = useCallback(
    async (signal?: AbortSignal) => {
      if (!gene || !variant || !key) return;
      setPpi(prev => ({ key, status: "loading", data: prev?.key === key ? prev.data : null }));
      try {
        const response = await fetchWithAuth("/api/v1/ppi/binding-affinity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gene, variant, uniprotId }),
          signal,
        });
        if (signal?.aborted) return;
        if (!response.ok) {
          setPpi({ key, status: "error", data: null, message: await extractErrorMessage(response, "The interaction lookups did not answer.") });
          return;
        }
        const data = (await response.json()) as PpiBindingData;
        if (signal?.aborted) return;
        setPpi({ key, status: "ready", data });
        patchResult(gene, variant, { ppiBindingData: data });
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) return;
        setPpi({ key, status: "error", data: null, message: err?.message || "The interaction lookups did not answer." });
      }
    },
    [gene, variant, uniprotId, key, fetchWithAuth]
  );

  useEffect(() => {
    if (!key) return;
    if (freshStoredPpi) {
      setPpi({ key, status: "ready", data: freshStoredPpi });
      return;
    }
    const controller = new AbortController();
    void fetchLookups(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, Boolean(freshStoredPpi), fetchLookups]);

  // ── Binding change ───────────────────────────────────────────────────
  const storedShift = (result?.ppiBindingShift ?? null) as PpiBindingShift | null;
  const storedShiftForVariant = storedShift && storedShift.gene === gene && storedShift.variant === variant ? storedShift : null;
  const [shift, setShift] = useState<Keyed<PpiBindingShift> | null>(null);

  const requestShift = useCallback(async () => {
    if (!key || !gene || !variant || !uniprotId) return;
    setShift({ key, status: "loading", data: null });
    try {
      const response = await fetchWithAuth("/api/v1/ppi/binding-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene, variant, uniprotId }),
      });
      if (!response.ok) {
        setShift({ key, status: "error", data: null, message: await extractErrorMessage(response, "The binding change could not be estimated.") });
        return;
      }
      const data = (await response.json()) as PpiBindingShift;
      setShift({ key, status: "ready", data });
      patchResult(gene, variant, { ppiBindingShift: data });
    } catch (err: any) {
      setShift({ key, status: "error", data: null, message: err?.message || "The binding change could not be estimated." });
    }
  }, [key, gene, variant, uniprotId, fetchWithAuth]);

  // ── Follow running jobs while the tab is open ────────────────────────
  const activeAsm = asm && asm.key === key ? asm : null;
  const activeShift = shift && shift.key === key ? shift : null;
  const asmData = activeAsm?.data ?? freshStoredAsm;
  const shiftData = activeShift?.data ?? storedShiftForVariant;
  const asmRunning = asmData?.status === "running" && activeAsm?.status !== "loading";
  const shiftRunning = shiftData?.status === "running" && activeShift?.status !== "loading";
  const timers = useRef<{ asm?: ReturnType<typeof setTimeout>; shift?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => {
    if (!asmRunning) return;
    timers.current.asm = setTimeout(() => void fetchAssembly(true), POLL_MS);
    return () => clearTimeout(timers.current.asm);
  }, [asmRunning, fetchAssembly]);
  useEffect(() => {
    if (!shiftRunning) return;
    timers.current.shift = setTimeout(() => void requestShift(), POLL_MS);
    return () => clearTimeout(timers.current.shift);
  }, [shiftRunning, requestShift]);

  const activePpi = ppi && ppi.key === key ? ppi : null;

  return {
    assembly: asmData,
    assemblyStatus: (activeAsm?.status ?? (freshStoredAsm ? "ready" : "loading")) as LoadState,
    assemblyError: activeAsm?.status === "error" ? activeAsm.message ?? null : null,
    modelRequested: modelRequested === key,
    ppi: activePpi?.data ?? freshStoredPpi,
    ppiStatus: (activePpi?.status ?? (freshStoredPpi ? "ready" : "loading")) as LoadState,
    ppiError: activePpi?.status === "error" ? activePpi.message ?? null : null,
    shift: shiftData,
    shiftLoading: activeShift?.status === "loading",
    shiftError: activeShift?.status === "error" ? activeShift.message ?? null : null,
    requestModel: () => void fetchAssembly(true),
    retryAssembly: () => void fetchAssembly(false),
    retryLookups: () => void fetchLookups(),
    requestShift: () => void requestShift(),
  };
}
