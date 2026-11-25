import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "./harness.css";
import ClinicalReportBar from "../../src/components/ClinicalReportBar";
import ReportInspector from "../../src/components/inspector/ReportInspector";
import { SettingsProvider } from "../../src/context/SettingsContext";
import { useVariantAnalysisStore } from "../../src/stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../src/stores/slices/uiSlice";
import { narrowChecks, railChecks, screenChecks, type Check } from "./checks";

/**
 * Geometry assertions for the Report tab's screen and its builder rail.
 *
 * WHY A BROWSER: the promises are live-layout fact. A card title shares a left edge with its body, the
 * tier scale starts on the verdict's edge, the export bar is pinned with nothing scrolling above it,
 * and criterion codes stay on one line. jsdom has no layout engine.
 *
 * Fixture: NAE1 p.Asp116Gly, the Report tests' reference variant (one engine-counted PP3, a model-only
 * PS3, an uncertain tier). It is a stand-in for shape, not for biology.
 *
 * The page reports PASS/FAIL as base64 JSON in #geometry-result, which check.mjs reads back through the
 * browser's --dump-dom; it exits non-zero on any failure.
 */

const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard" },
  analysis: "### Clinical and Pathogenicity Interpretation\n\nThe model's own prose.",
  predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous", source: "Ensembl VEP", gnomadVariantId: "16-66823281-T-C", gnomadVariantAssembly: "GRCh38" },
  conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }], partialEvidence: { available: [], unavailable: [] } },
  insights: {
    acmgVerdict: "Variant of Uncertain Significance (VUS)", model: "gemini-test", source: "ai_inference",
    acmgCriteria: [
      { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
      { code: "PS3", reason: "assay in a cited abstract", source: "ai_suggested" },
    ],
  },
};

const nextFrame = () => new Promise<void>(r => setTimeout(() => setTimeout(() => r(), 0), 0));

const style = document.createElement("style");
style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.appendChild(style);

/* Console errors from the React tree must be visible in the report, not only in the console. */
const ERR_LOG: string[] = [];
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  ERR_LOG.push(args.map(a => String((a as any)?.message ?? a)).join(" ").slice(0, 300));
  origConsoleError(...args);
};

const store = useVariantAnalysisStore.getState();
store.setGene("NAE1");
store.setVariant("p.Asp116Gly");
store.setUniprotId("Q13564");
store.setReportSections({ ...DEFAULT_REPORT_SECTIONS });
store.loadReportDraft(null);

const analysisState: any = { result, isLoading: false, error: null };

/** The screen and the rail in the real frame: the app's own layout classes, a 760px-tall workspace. */
const Wide = () => (
  <SettingsProvider>
    <div className="data-screen-layout exploration-workspace report-workspace" style={{ width: 1440, height: 760 }}>
      <div className="data-screen-primary" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <ClinicalReportBar analysisState={analysisState} />
      </div>
      <aside data-workspace-inspector className="flex flex-col min-h-0" style={{ width: 380, minWidth: 380 }}>
        <div className="inspector-body flex-1 overflow-y-auto px-4 pt-4 pb-20 space-y-4">
          <ReportInspector analysisResult={result} gene="NAE1" variant="p.Asp116Gly" />
        </div>
      </aside>
    </div>
  </SettingsProvider>
);

const Narrow = () => (
  <SettingsProvider>
    <div style={{ width: 560, height: 760, display: "flex", flexDirection: "column" }}>
      <ClinicalReportBar analysisState={analysisState} />
    </div>
  </SettingsProvider>
);

interface Case { id: string; dark: boolean; view: React.FC; run: (host: HTMLElement) => Promise<Check[]>; expect: number }
const CASES: Case[] = [
  { id: "wide", dark: false, view: Wide, run: async h => [...screenChecks(h), ...(await railChecks(h))], expect: 21 },
  { id: "dark", dark: true, view: Wide, run: async h => [...screenChecks(h), ...(await railChecks(h))], expect: 21 },
  { id: "narrow", dark: false, view: Narrow, run: async h => narrowChecks(h), expect: 3 },
];

async function run(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  for (const c of CASES) {
    const host = document.createElement("div");
    host.id = `case-${c.id}`;
    document.body.appendChild(host);
    // SettingsProvider owns the `dark` class on <html> and reads the saved theme when it mounts, so the
    // theme has to be chosen there. Setting the class directly is undone by the provider.
    localStorage.setItem("theme", c.dark ? "dark" : "light");
    try {
      createRoot(host).render(<c.view />);
      // Two frames: the initial mount flushes, then observer and settle effects run.
      await nextFrame();
      await nextFrame();
      const dark = document.documentElement.classList.contains("dark");
      checks.push({ name: `${c.id}: the ${c.dark ? "dark" : "light"} theme is the one being measured`, pass: dark === c.dark, detail: `dark class ${dark}` });
      const produced = await c.run(host);
      for (const p of produced) checks.push({ ...p, name: `${c.id}: ${p.name}` });
      if (produced.length !== c.expect) {
        checks.push({ name: `${c.id}: harness produced ${produced.length} assertions, expected ${c.expect}`, pass: false, detail: "update expect if deliberate" });
      }
    } catch (err: any) {
      checks.push({ name: `${c.id}: case threw`, pass: false, detail: String(err?.stack ?? err).slice(0, 400) });
    }
  }
  checks.push({ name: "harness: cases rendered", pass: CASES.every(c => document.getElementById(`case-${c.id}`) !== null), detail: `${CASES.length} cases` });
  checks.push({ name: "harness: no console errors", pass: ERR_LOG.length === 0, detail: ERR_LOG.slice(0, 3).join(" | ") || "clean" });
  return { ok: checks.every(c => c.pass), checks };
}

const publish = (report: unknown) => {
  document.getElementById("geometry-result")!.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
};

run().then(report => {
  publish(report);
  const pre = document.createElement("pre");
  pre.id = "geometry-report";
  pre.textContent = report.checks.map(c => `${c.pass ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`).join("\n");
  document.body.appendChild(pre);
});

/* A crash inside a case must not look like an empty-but-passing run. */
window.addEventListener("error", e => {
  publish({ ok: false, checks: [{ name: "page error", pass: false, detail: String(e.error?.stack ?? e.message).slice(0, 500) }] });
});
