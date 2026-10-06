/**
 * Dev-only harness: renders the Interfaces & PPI tab from captured fixtures, with no pipeline. Used
 * for design review screenshots; never imported by the app. Served by `ifc-harness.html` in dev.
 * `?bare=1` strips the solved interfaces (an RGS9-like case: UniProt ranges only, no profile).
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { SettingsProvider } from "../context/SettingsContext";
import { InterfacesTab } from "../components/evidence/InterfacesTab";
import { InterfacesRail } from "../components/inspector/InterfacesRail";
import { SOD1_INTERFACES as F } from "../shared/__tests__/fixtures/sod1Interfaces";

const bare = new URLSearchParams(window.location.search).has("bare");
const RESULT: any = {
  ...F.result,
  multimerData: bare
    ? { ...F.assembly, experimental: { ...(F.assembly as any).experimental, partners: [] } }
    : F.assembly,
  ppiBindingData: F.ppi,
};

function Harness() {
  return (
    <SettingsProvider>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, padding: 16, background: "var(--cs-bg, #faf9f7)", minHeight: "100vh" }}>
        <InterfacesTab
          isDark={false}
          classCard="rounded-xl border overflow-hidden"
          classCardHeader=""
          classCardTitle=""
          classBorderSec=""
          classTextBody=""
          classTextMute=""
          analysisState={{ result: RESULT, isLoading: false } as any}
          activeTab="interfaces"
          onTabChange={() => {}}
          energyUnit="kcal/mol"
          formatDdGValue={(v: number | null) => `${v}`}
          setSelectedMetric={() => {}}
          foldingDdG={null}
          foldingStatus={null}
        />
        <InterfacesRail analysisResult={RESULT} />
      </div>
    </SettingsProvider>
  );
}

const container = document.getElementById("root")!;
(window as any).__errs = [];
window.addEventListener("error", e => { (window as any).__errs.push(String((e as ErrorEvent).message)); });
try {
  createRoot(container).render(<Harness />);
} catch (e) {
  (window as any).__errs.push("render-error: " + String(e));
}
