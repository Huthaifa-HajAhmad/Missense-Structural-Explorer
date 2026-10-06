/**
 * Dev-only harness: renders the Interfaces & PPI tab from the captured SOD1 fixture, with no
 * pipeline. Used for design review screenshots; never imported by the app. Served by
 * `ifc-harness.html` in `npm run dev` and deleted before commit.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { SettingsProvider } from "../context/SettingsContext";
import { InterfacesTab } from "../components/evidence/InterfacesTab";
import { InterfacesRail } from "../components/inspector/InterfacesRail";
import { SOD1_INTERFACES as F } from "../shared/__tests__/fixtures/sod1Interfaces";

const RESULT: any = { ...F.result, multimerData: F.assembly, ppiBindingData: F.ppi };

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
window.addEventListener("error", e => { (window as any).__errs.push(String((e as ErrorEvent).message) + " :: " + String((e as ErrorEvent).error?.stack ?? "").slice(0, 500)); });
window.addEventListener("unhandledrejection", e => { (window as any).__errs.push("rejection: " + String((e as PromiseRejectionEvent).reason?.stack ?? e.reason).slice(0, 500)); });
try {
  createRoot(container).render(<Harness />);
  (window as any).__HARNESS = "mounted";
} catch (e) {
  (window as any).__HARNESS = "render-error: " + String(e);
}
