import { useEffect, useRef, useState } from "react";
import type { PartnerGroup } from "../../../shared/interfacesEvidence";
import { useEvidenceWorkspace } from "../EvidenceWorkspace";
import { PPI_QUERY_PARAM, PPI_TIER_PARAM, parsePpiQuery, parsePpiTier, withPpiParams } from "./viewUrlState";

/**
 * The partner list's view: one tier, a name query and the open folds. In the workspace these live in
 * the workspace's options; otherwise in local state. Tier and query are mirrored to the URL
 * (`?ppit`, `?ppiq`), read on open, removed on unmount, and reset for a new variant: a query for one
 * protein's partners means nothing for the next.
 */
export function usePartnerView(variantKey: string) {
  const workspace = useEvidenceWorkspace("interfaces");
  const search = () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [localTier, setLocalTier] = useState<PartnerGroup | null>(() => parsePpiTier(search().get(PPI_TIER_PARAM)));
  const [localQuery, setLocalQuery] = useState<string>(() => parsePpiQuery(search().get(PPI_QUERY_PARAM)));
  const [localFolds, setLocalFolds] = useState<ReadonlySet<PartnerGroup>>(new Set());
  const tier = workspace.enabled ? parsePpiTier(workspace.section) : localTier;
  const query = workspace.enabled ? workspace.query : localQuery;
  const openFolds: ReadonlySet<string> = workspace.enabled ? new Set(workspace.expanded) : localFolds;

  const setTier = (next: PartnerGroup | null) => (workspace.enabled ? workspace.setOptions({ section: next ?? "" }) : setLocalTier(next));
  const setQuery = (value: string) => (workspace.enabled ? workspace.setOptions({ query: value }) : setLocalQuery(value));
  const toggleFold = (id: PartnerGroup) => {
    if (workspace.enabled) return workspace.toggleGroup(id);
    setLocalFolds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const firstVariant = useRef(variantKey);
  useEffect(() => {
    if (firstVariant.current === variantKey) return;
    firstVariant.current = variantKey;
    setTier(null);
    setQuery("");
    setLocalFolds(new Set());
  }, [variantKey]);

  // The workspace takes the URL's tier and query once, when it first initialises.
  const urlSeeded = useRef(false);
  useEffect(() => {
    if (workspace.enabled && !workspace.initialized) {
      workspace.setOptions({ initialized: true, section: urlSeeded.current ? "" : localTier ?? "", query: urlSeeded.current ? "" : localQuery });
      urlSeeded.current = true;
    }
  }, [workspace.enabled, workspace.initialized]);
  useEffect(() => {
    if (typeof window === "undefined" || (workspace.enabled && !workspace.initialized)) return;
    const next = withPpiParams(window.location.href, tier, query);
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, [tier, query, workspace.initialized, workspace.enabled]);
  useEffect(() => () => {
    if (typeof window === "undefined") return;
    const next = withPpiParams(window.location.href, null, "");
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, []);

  return { tier, query, openFolds, setTier, setQuery, toggleFold };
}
