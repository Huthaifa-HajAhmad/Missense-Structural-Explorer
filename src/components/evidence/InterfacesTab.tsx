import { useCallback, useMemo, useState } from "react";
import { TabComponentProps } from "./types";
import { useOptionalSettings } from "../../context/SettingsContext";
import type { EnergyUnit } from "../../shared/engineStatus";
import { buildInterfacesEvidence, filterPartnerGroups, type ObservedView } from "../../shared/interfacesEvidence";
import { interfaceMapView, interfaceNumberingNote, interfaceWorkspaceReadings } from "../../shared/mechanismWorkspace";
import { evidenceTab } from "../../shared/evidenceTabs";
import { interfaceSelection } from "../../shared/residueFocus";
import { EvidencePanel, EvidenceViewTabs, useEvidenceWorkspace } from "./EvidenceWorkspace";
import { MechanismSelection } from "./MechanismSelection";
import { useInterfacesData } from "./interfaces/useInterfacesData";
import { usePartnerView } from "./interfaces/usePartnerView";
import { InterfaceHero } from "./interfaces/InterfaceHero";
import { InterfaceMapSection } from "./interfaces/InterfaceMapSection";
import { InterfaceOverview } from "./interfaces/InterfaceOverview";
import { AssemblyRecords } from "./interfaces/AssemblyRecords";
import { LocalFoldCard } from "./interfaces/LocalFoldCard";
import { BindingCard } from "./interfaces/BindingCard";
import { PartnersPanel } from "./interfaces/PartnersPanel";

/**
 * Interfaces & PPI.
 *
 * ONE QUESTION: does the variant residue sit where another protein touches this one, how well is that
 * attested, and with whom? Shape, top to bottom:
 *
 *   1. THE FINDING (InterfaceHero) — one figure ("1 of 4", or "Not modelled" in words), one sentence,
 *      its context, and the map around the residue.
 *   2. INTERFACE MAP (InterfaceMapSection) — topology, domains, sites, each solved partner's support
 *      profile with the stretches no structure models, fibrils last, the model when built.
 *   3. ASSEMBLIES & MODELS (AssemblyRecords, LocalFoldCard, BindingCard) — SUBUNIT statements, solved
 *      structures per partner, the complex model on request, LocalFold, the binding change.
 *   4. PARTNERS (PartnersPanel) — the shape in one sentence, tier chips, search, one grid by tier.
 *
 * In the workspace, 2–4 are the three sub-tabs; the binding change belongs to "Assemblies & models"
 * (it used to sit outside the panel and showed under every sub-tab).
 *
 * INVARIANTS: every sentence, state, count and fold comes from `buildInterfacesEvidence`; this file and
 * the pieces under `interfaces/` decide nothing about the evidence. Nothing here is an ACMG input.
 */
export function InterfacesTab({ analysisState, onSelectResidue, onNavigateToView }: TabComponentProps) {
  const result = analysisState.result;
  const data = useInterfacesData(result);
  const workspace = useEvidenceWorkspace("interfaces");
  const variantKey = `${result?.metadata?.gene ?? ""}|${result?.metadata?.variant ?? ""}`;
  const partnerView = usePartnerView(variantKey);
  const [lit, setLit] = useState<string | null>(null);

  const openRow = useCallback((key: string) => {
    if (workspace.enabled) { workspace.select(key); return; }
    const row = document.getElementById(`ifc-row-${key}`);
    if (!row) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    setLit(key);
  }, [workspace.enabled, workspace.select]);

  const { assembly, assemblyStatus, assemblyError, modelRequested, ppi, ppiStatus, ppiError, shift, shiftLoading, shiftError } = data;
  // Hover, pin and filter changes re-render this tab; the evidence is rebuilt only when its inputs move.
  const ev = useMemo(() => (result ? buildInterfacesEvidence({ result, assembly, assemblyStatus, assemblyError, modelRequested, ppi, ppiStatus, ppiError, shift, shiftLoading, shiftError }) : null),
    [result, assembly, assemblyStatus, assemblyError, modelRequested, ppi, ppiStatus, ppiError, shift, shiftLoading, shiftError]);
  const settingsCtx = useOptionalSettings();
  const unit: EnergyUnit = settingsCtx?.settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol";
  const rows = useMemo(() => (ev ? interfaceWorkspaceReadings(ev, unit) : null), [ev, unit]);
  if (!result || !ev || !rows) return null;

  const solved: ObservedView[] = [...ev.observed.partners, ...ev.observed.fibrils, ...ev.observed.crystals, ...ev.observed.peptides];
  // Native interfaces only: a fibril or crystal-packing contact is not an interface to draw on the monomer.
  const show3d = onSelectResidue && onNavigateToView
    ? (p: ObservedView) => {
        const selection = interfaceSelection(p, ev.position);
        if (!selection) return;
        onSelectResidue(selection.index, selection.focus);
        onNavigateToView("structure_alphafold");
      }
    : null;
  const visibleKeys = workspace.view === "partners"
    ? filterPartnerGroups(ev.groups, partnerView).flatMap(g => [...g.rows, ...(partnerView.openFolds.has(g.id) ? g.folded?.rows ?? [] : [])].map(p => `partner:${p.key}`))
    : workspace.comparison ? interfaceMapView(ev, workspace.window === "near", workspace.hidden).visibleKeys : [...solved.map(p => p.key), "complex-model", "binding-change"];
  const canLocalFold = ev.chains.length > 1 && !["not-applicable", "not-modelled", "pending"].includes(ev.model.state);
  const showMap = !workspace.enabled || workspace.comparison;
  const showRecords = !workspace.enabled || workspace.view === "records";
  const showPartners = !workspace.enabled || workspace.view === "partners";

  return (
    <div data-evidence-screen data-mechanism="interfaces" className={`ifc-screen @container${workspace.enabled ? " ifc-workspace" : ""}`}>
      <div role="status" aria-live="polite" className="sr-only">{ev.interface.verdict === "pending" ? "" : ev.finding.headline}</div>
      <header className="ifc-header">
        <h1 className="screen-title">{evidenceTab("interfaces").label}</h1>
        <p className="screen-tab-description">
          Whether the variant residue sits where another protein touches {ev.gene}, how well that is attested, which proteins it binds, and any predicted change in binding.
        </p>
      </header>

      <InterfaceHero
        ev={ev}
        workspace={workspace.enabled}
        failures={{
          assembly: ev.status.assembly === "error" ? data.assemblyError ?? "The assembly service did not answer." : null,
          lookups: ev.status.lookups === "error" ? data.ppiError ?? "The interaction lookups did not answer." : null,
        }}
        onRetryAssembly={data.retryAssembly}
        onRetryLookups={data.retryLookups}
        lit={workspace.selected ?? lit}
      />

      <EvidenceViewTabs tab="interfaces" comparisonLabel="Interface map" />
      <MechanismSelection tab="interfaces" rows={rows} visibleKeys={visibleKeys} />
      <EvidencePanel tab="interfaces">
        {showMap && <InterfaceMapSection ev={ev} numbering={interfaceNumberingNote(result)} lit={workspace.selected ?? lit} onLit={setLit} onOpen={openRow} onRequestModel={data.requestModel} />}
        {showMap && workspace.enabled && <InterfaceOverview ev={ev} />}
        {showRecords && (
          <AssemblyRecords
            ev={ev}
            variantKey={variantKey}
            variant={result.metadata?.variant ?? "variant"}
            complexPdb={data.assembly?.status === "success" ? data.assembly.complexPdb ?? null : null}
            lit={lit}
            onLit={setLit}
            show3d={show3d}
            onRequestModel={data.requestModel}
          >
            {canLocalFold && (
              <LocalFoldCard
                key={variantKey}
                ev={ev}
                requestHandoff={data.requestHandoff}
                importModel={data.importLocalFoldModel}
                handoffBusy={data.handoffBusy}
                importBusy={data.importBusy}
                error={data.localFoldError}
              />
            )}
          </AssemblyRecords>
        )}
        {showRecords && workspace.enabled && <BindingCard ev={ev} onRequest={data.requestShift} />}
        {showPartners && ev.observed.peptides.length > 0 && <section aria-label="Peptide fragments">
          <h2>Peptide fragments</h2>
          <p>These structures contain short fragments of {ev.gene}. They are excluded from whole-protein native interfaces and partner counts.</p>
          <ul>{ev.observed.peptides.map(p => <li key={p.key}>{p.label}: {p.pdbEntries.map(e => e.toUpperCase()).join(", ")}</li>)}</ul>
        </section>}
        {showPartners && <PartnersPanel ev={ev} view={partnerView} lookupError={data.ppiError ?? null} onRetry={data.retryLookups} />}
      </EvidencePanel>
      {!workspace.enabled && <BindingCard ev={ev} onRequest={data.requestShift} />}
      {workspace.enabled && (
        <details className="mx-guide">
          <summary>How to read this workspace</summary>
          <p>The sequence map uses UniProt residue numbering. Interface support is counted within each partner and structural context, over the structures that model the residue; it is not an effect size or a count of independent experiments. Select a lane or partner to pin its exact evidence.</p>
          <p>Assembly composition is a schematic, not molecular geometry. Fibril and outside-assembly contacts remain separate from native interfaces. Predictions and STRING associations do not establish a measured binding effect.</p>
        </details>
      )}
    </div>
  );
}

export default InterfacesTab;
