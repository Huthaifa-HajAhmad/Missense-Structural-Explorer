import { useSyncExternalStore } from "react";
import type { LoadState } from "../../../shared/interfacesEvidence";

/**
 * interfacesLive — the ONE live readiness source the Interfaces & PPI tab and its Evidence Lineage
 * rail share.
 *
 * WHY THIS EXISTS (read before changing it)
 *   The rail used to infer readiness from the stored result alone: `multimerData ? "ready" : "loading"`.
 *   That is wrong in three ways, all of which the user saw as trace steps "still running" long after
 *   the pipeline had finished:
 *     1. a payload that predates the fibril split is re-read by the tab, but the rail called it ready;
 *     2. a lookup that FAILED is never written to the store, so the rail spun "Running" forever;
 *     3. a payload whose store write never landed left the rail pending while the tab held the data.
 *   The tab's `useInterfacesData` is the only component that actually knows the live status. It
 *   publishes it here, and the rail reads it. When the tab is not mounted (the rail can render alone),
 *   the rail falls back to the stored result with the same staleness rules the tab applies.
 *
 * Module-level and external (not React context) because the tab and the rail are separate subtrees of
 * the inspector; a provider would have to wrap both and every test that renders them in isolation.
 * `useSyncExternalStore` keeps every subscriber consistent and re-renders on publish.
 */
export interface InterfacesLive {
  /** `${gene}|${variant}` the published status belongs to. */
  key: string | null;
  assemblyStatus: LoadState;
  assemblyError: string | null;
  ppiStatus: LoadState;
  ppiError: string | null;
  /** The binding change is on request, so idle is `false`, never a "loading" that would read pending. */
  shiftLoading: boolean;
  shiftError: string | null;
  modelRequested: boolean;
}

const EMPTY: InterfacesLive = {
  key: null,
  assemblyStatus: "loading",
  assemblyError: null,
  ppiStatus: "loading",
  ppiError: null,
  shiftLoading: false,
  shiftError: null,
  modelRequested: false,
};

let snapshot: InterfacesLive = EMPTY;
const listeners = new Set<() => void>();

function same(a: InterfacesLive, b: InterfacesLive): boolean {
  return (
    a.key === b.key &&
    a.assemblyStatus === b.assemblyStatus &&
    a.assemblyError === b.assemblyError &&
    a.ppiStatus === b.ppiStatus &&
    a.ppiError === b.ppiError &&
    a.shiftLoading === b.shiftLoading &&
    a.shiftError === b.shiftError &&
    a.modelRequested === b.modelRequested
  );
}

export function publishInterfacesLive(next: InterfacesLive): void {
  if (same(snapshot, next)) return;
  snapshot = next;
  listeners.forEach(l => l());
}

/** Test-only: clear the module snapshot between cases. */
export function resetInterfacesLive(): void {
  publishInterfacesLive(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): InterfacesLive {
  return snapshot;
}

export function useInterfacesLive(): InterfacesLive {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
