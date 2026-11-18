import { useEffect } from "react";
import { retiredEvidenceTabView } from "../components/evidence/types";
import type { MasterView } from "../types/ui";

/**
 * Sends a stale link to an evidence tab whose content moved to another page (an older build's link,
 * a stored tab id) to that page. Callers set the tab and then the Evidence view, so this waits until
 * both are in place.
 */
export function useRetiredEvidenceTabRedirect(
  masterView: MasterView,
  activeEvidenceTab: string,
  setActiveEvidenceTab: (tab: string) => void,
  setMasterView: (view: MasterView) => void
): void {
  useEffect(() => {
    const view = masterView === "evidence" ? retiredEvidenceTabView(activeEvidenceTab) : null;
    if (!view) return;
    setActiveEvidenceTab("clinical");
    setMasterView(view);
  }, [masterView, activeEvidenceTab, setActiveEvidenceTab, setMasterView]);
}
