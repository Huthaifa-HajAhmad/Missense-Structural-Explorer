import React, { useCallback, useState } from "react";
import { Activity, BookOpen, Database, GitBranch, PlugZap, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { useApiClient } from "../../apiClient";
import {
  ALPHAGENOME_SOURCES,
  PHRED_RANK_ROWS,
  buildAlphaGenomeEvidence,
} from "../../shared/alphagenomeEvidence";

/**
 * AlphaGenomeRail — the Evidence Lineage inspector for the AlphaGenome tab.
 *
 * The column states WHAT the score is; the rail states HOW it was obtained: the four-step trace from
 * the queried coordinate to the Phred (with the arithmetic shown), a Phred-to-rank reference with this
 * variant's row marked, the method caveats, the connection check, and the sources.
 *
 * The rank itself (top x%, 1 in N) is stated once, in the column; the rail shows only how it was
 * derived. The Method note names the conservation scores: the Predictors tab reads phyloP and GERP,
 * not the AVI's Cactus and PhastCons inputs, so "already read there" was true of the evidence and
 * false of the scores.
 *
 * It replaced a rail that listed five PP3/BP4 bands for the AVI, described a ten-row table of invented
 * magnitudes, and — because the fallback branch in EvidenceInspector did not exclude this tab — also
 * rendered a "placeholder, not a measurement" telemetry box under it.
 *
 * Built from the same `buildAlphaGenomeEvidence` object as the column.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="rail-step" data-state={state}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <div className="rail-step__value">{children}</div>
      </div>
    </li>
  );
}

export function AlphaGenomeRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const { settings } = useSettings();
  const { fetchWithAuth } = useApiClient();
  const hasKey = Boolean(settings.alphagenomeApiKey?.trim());
  const ev = buildAlphaGenomeEvidence({ result: analysisResult, configured: hasKey ? true : undefined });

  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; latencyMs: number; scorersCount?: number; error?: string } | null>(null);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetchWithAuth("/api/v1/alphagenome/verify-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      const raw = data?.error;
      const error =
        typeof raw === "object" && raw ? raw.message || JSON.stringify(raw)
        : typeof raw === "string" ? raw
        : !res.ok ? `HTTP ${res.status}` : undefined;
      setTest({ ok: Boolean(data?.ok), latencyMs: data?.latencyMs ?? 0, scorersCount: data?.scorersCount, error });
    } catch (err: any) {
      setTest({ ok: false, latencyMs: 0, error: err?.message || "The connection test could not reach the server." });
    } finally {
      setTesting(false);
    }
  }, [fetchWithAuth]);

  const scored = ev.assessed && ev.phred !== null;
  // The reference row this variant sits in: the highest row at or below its Phred.
  const activeRow = scored ? [...PHRED_RANK_ROWS].reverse().find(r => (ev.phred as number) >= r.phred)?.phred ?? null : null;

  return (
    <div className="ag-rail" data-testid="alphagenome-rail">
      {/* ── 1. How the rank was obtained ── */}
      <section className="rail-section" aria-labelledby="ag-rail-trace">
        <h3 className="eyebrow" id="ag-rail-trace">
          <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
          How the rank is computed
        </h3>
        <ol className="rail-steps" data-testid="avi-trace">
          <Step n={1} label="Coordinate queried" state={ev.atlas ? "done" : "warn"}>
            {ev.atlas ? (
              <span className="ag-mono">{ev.atlas.label}</span>
            ) : (
              <span>No GRCh38 coordinate</span>
            )}
            <span className="rail-step__sub">
              {ev.assessed ? "GRCh38 — the only build the Atlas indexes" : (ev.availability.reason ?? ev.availability.label)}
            </span>
          </Step>
          <Step n={2} label="Raw AVI score" state={scored ? "done" : "idle"}>
            <span className="ag-mono">{ev.raw !== null ? ev.raw.toFixed(4) : "—"}</span>
            <span className="rail-step__sub">Model output; the 18 feature contributions sum to it.</span>
          </Step>
          <Step n={3} label="Genome-wide quantile" state={scored ? "done" : "idle"}>
            <span className="ag-mono">{ev.quantile !== null ? ev.quantile.toFixed(5) : "—"}</span>
            <span className="rail-step__sub">Its position among all ~9 billion possible hg38 SNVs.</span>
          </Step>
          <Step n={4} label="Phred" state={scored ? "done" : "idle"}>
            {scored ? (
              <>
                <p className="ag-rail__formula">
                  {ev.quantile !== null
                    ? `−10 · log10(1 − ${ev.quantile.toFixed(5)}) = ${(ev.phred as number).toFixed(1)}`
                    : `Phred ${(ev.phred as number).toFixed(1)}`}
                </p>
              </>
            ) : (
              <span className="ag-dim">—</span>
            )}
          </Step>
        </ol>
      </section>

      {/* ── 2. Reading a Phred ── */}
      <section className="rail-section" aria-labelledby="ag-rail-phred">
        <h3 className="eyebrow" id="ag-rail-phred">
          <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
          Reading the Phred
        </h3>
        <ul className="rail-cuts" data-testid="avi-phred-rows">
          {PHRED_RANK_ROWS.map(r => {
            const active = r.phred === activeRow;
            return (
              <li key={r.phred} className="rail-cut" data-active={active || undefined}>
                <span className="rail-cut__rule">Phred ≥ {r.phred}</span>
                <span className="rail-cut__meaning">{r.top}</span>
                {active && <span className="rail-cut__here">this variant ({(ev.phred as number).toFixed(1)})</span>}
              </li>
            );
          })}
        </ul>
        <p className="rail-step__sub">
          A rank, not a cut-off: none of these rows is an evidence threshold.
        </p>
      </section>

      {/* ── 3. Method ── */}
      <section className="rail-section" aria-labelledby="ag-rail-method">
        <h3 className="eyebrow" id="ag-rail-method">
          <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
          Method
        </h3>
        <details className="rail-notes" open>
          <summary>What the score can and cannot say</summary>
          <ul>
            <li>
              Trained to tell variants rare in gnomAD (FAF95 grpmax &lt; 0.1%) from common ones. Its target is rarity
              under selection, not disease — so it overlaps with the population evidence (PM2/BS1).
            </li>
            <li>
              It contains AlphaMissense, which votes on the Predictors tab, and two conservation scores (Cactus 241-way,
              PhastCons 470-way) that measure the same thing as phyloP and GERP there. It is not independent of them.
            </li>
            <li>
              Each AlphaGenome feature is the largest predicted effect across all biosamples, so a feature can be driven
              by a tissue irrelevant to this gene.
            </li>
            <li>
              Contributions are SHAP values (expected-gradients approximation). They explain the model&apos;s score, not
              the biology.
            </li>
            <li>
              The splicing feature is AlphaGenome&apos;s own splicing prediction, not SpliceAI. The RNA splicing tab
              carries the splice-specific evidence.
            </li>
            <li>
              No ClinGen calibration of the AVI exists, so this app counts it toward no ACMG criterion.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 4. Connection ── */}
      <section className="rail-section" aria-labelledby="ag-rail-conn">
        <h3 className="eyebrow" id="ag-rail-conn">
          <PlugZap className="w-3.5 h-3.5" aria-hidden="true" />
          Connection
        </h3>
        <dl className="rail-kv">
          <div className="rail-kv__row">
            <dt>Key in this browser</dt>
            <dd>{hasKey ? "Set" : "None — the server may hold one"}</dd>
          </div>
          <div className="rail-kv__row">
            <dt>This variant</dt>
            <dd>{ev.assessed ? "Scored" : ev.availability.label}</dd>
          </div>
        </dl>
        <div>
          <button type="button" className="ag-btn" onClick={runTest} disabled={testing}>
            <Activity className={`w-3.5 h-3.5 ${testing ? "animate-spin" : ""}`} aria-hidden="true" />
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
        {test && (
          <p className="ag-rail__status" data-ok={String(test.ok)} role="status">
            {test.ok
              ? `Reached the Atlas in ${test.latencyMs} ms (${test.scorersCount ?? 0} scorers). This checks the channel only — not whether this variant was scored.`
              : `Connection failed: ${test.error ?? "no reason given"}.`}
          </p>
        )}
      </section>

      {/* ── 5. Sources ── */}
      <section className="rail-section" aria-labelledby="ag-rail-sources">
        <h3 className="eyebrow" id="ag-rail-sources">
          <Database className="w-3.5 h-3.5" aria-hidden="true" />
          Sources
        </h3>
        <dl className="rail-kv">
          <div className="rail-kv__row">
            <dt>Data</dt>
            <dd>AlphaGenome Atlas, Google DeepMind (gRPC)</dd>
          </div>
        </dl>
        <ul className="rail-refs">
          {ALPHAGENOME_SOURCES.map(src => (
            <li key={src.doi}>
              {src.citation}{" "}
              <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noopener noreferrer">
                doi:{src.doi}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default AlphaGenomeRail;
