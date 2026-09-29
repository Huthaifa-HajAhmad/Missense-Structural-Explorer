import React, { useMemo } from "react";
import { BookOpen, Database, GitBranch, Layers, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { resolveResidueShiftModel } from "../../lib/residueShiftModel";
import { THRESHOLDS } from "../../shared/thresholds/constants";
import { ENTROPY_MARKS, RANK_BANDS } from "../../shared/modelCalibration";
import { buildPerturbationEvidence } from "../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../shared/perturbationModels";

/**
 * PerturbationRail — the Evidence Lineage inspector for the Structural perturbation tab.
 *
 * The column states WHAT each model said; the rail states HOW the tab reads it — a five-step trace
 * (models → scale check → rank → physical model → engine record) — then every reading mark with
 * this variant's position marked, the selected model's registry row, method notes, and sources.
 *
 * It replaced PerturbationInspector, which:
 *   • said "Shared scale: No — mixed" while the column's 0–100 score averaged the same ΔLLRs;
 *   • computed its own pool without families, so its mixed-scale warning never showed;
 *   • printed "0 of the other 19 rank above it" for the least-preferred residue;
 *   • described ESM3 as "template-conditioned structure generation" (it is a sequence-embedding
 *     distance, with refinement off) and ESMC's shift as cosine (it is Euclidean);
 *   • showed embedding widths from the settings engine (SaProt 35M as 1280-dim).
 *
 * Built from the same `buildPerturbationEvidence` object as the column.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="ptb-step" data-state={state}>
      <span className="ptb-step__n" aria-hidden="true">{n}</span>
      <div className="ptb-step__body">
        <span className="ptb-step__label">{label}</span>
        <div className="ptb-step__value">{children}</div>
      </div>
    </li>
  );
}

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const REFERENCES: Array<{ citation: string; doi: string }> = [
  { citation: "Meier J, et al. Language models enable zero-shot prediction of the effects of mutations on protein function. NeurIPS 2021.", doi: "10.1101/2021.07.09.450648" },
  { citation: "Lin Z, et al. Evolutionary-scale prediction of atomic-level protein structure with a language model. Science 2023.", doi: "10.1126/science.ade2574" },
  { citation: "Su J, et al. SaProt: protein language modeling with structure-aware vocabulary. ICLR 2024.", doi: "10.1101/2023.10.01.560349" },
  { citation: "van Kempen M, et al. Fast and accurate protein structure search with Foldseek. Nat Biotechnol 2024.", doi: "10.1038/s41587-023-01773-0" },
  { citation: "Hayes T, et al. Simulating 500 million years of evolution with a language model. Science 2025.", doi: "10.1126/science.ads0018" },
  { citation: "Schymkowitz J, et al. The FoldX web server: an online force field. Nucleic Acids Res 2005.", doi: "10.1093/nar/gki387" }
];

export function PerturbationRail({
  analysisResult,
  activePerturbationModel = "saprot",
  saprotEngine = null,
  foldingEnergetics,
  structuralDiff,
  metrics
}: {
  analysisResult: AnalysisResult | null;
  activePerturbationModel?: PerturbationModelId;
  saprotEngine?: string | null;
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
}) {
  const r = analysisResult as any;
  const evidence = useMemo(() => {
    if (!r) return null;
    const m = resolveResidueShiftModel({ wildType: r.metadata?.wildType, mutant: r.metadata?.mutant, variant: r.metadata?.variant });
    return buildPerturbationEvidence({
      result: r,
      residues: { wtCode: m.wildTypeCode, mutCode: m.mutantCode, wtLabel: m.wildTypeLabel, mutLabel: m.mutantLabel },
      foldingEnergetics,
      structuralDiff,
      metrics,
      saprotEngine
    });
  }, [r, foldingEnergetics, structuralDiff, metrics, saprotEngine]);

  if (!evidence) {
    return <p className="ptb-empty">The trace appears once a variant has been analysed.</p>;
  }

  const selected =
    evidence.lms.find(l => l.id === activePerturbationModel && l.availability.state === "computed") ?? evidence.scored[0] ?? null;
  const { scored, lms, scale, consensus, physical, engine } = evidence;
  const vdw = physical.readings.find(x => x.key === "vdw");
  const clashMark = THRESHOLDS.vdwClash.significantClash;
  const drift = THRESHOLDS.esm3Drift;
  const sources = lms.filter(l => l.servedBy).map(l => [l.family, l.servedBy!] as const);
  if (evidence.esm3?.servedBy) sources.push(["ESM3", evidence.esm3.servedBy] as const);
  if (physical.available) sources.push(["Physical model", `FoldX BuildModel${physical.runs ? ` · ${physical.runs} runs` : ""}`] as const);

  return (
    <div className="ptb-rail" data-testid="perturbation-rail">
      {/* ── 1. Trace ── */}
      <section className="ptb-rsec" aria-labelledby="ptb-rail-trace">
        <h3 className="eyebrow" id="ptb-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Reading trace
        </h3>
        <ol className="ptb-steps" data-testid="perturbation-rule-trace">
          <Step n={1} label="Language models scored" state={scored.length === 0 ? "idle" : scored.some(l => l.caveats.includes("fallback-model")) ? "warn" : "done"}>
            <span>{scored.length} of {lms.length}</span>
            <ul className="ptb-step__list">
              {lms.map(l => (
                <li key={l.id}>
                  <span>{l.family}</span>
                  <span className="ptb-mono">{l.availability.state === "computed" ? (l.servedBy ?? "model not named") : l.availability.label}</span>
                </li>
              ))}
            </ul>
            {scored.some(l => l.caveats.includes("fallback-model")) && (
              <span className="ptb-step__warn">A fallback model served at least one row; its row describes the model that ran.</span>
            )}
          </Step>
          <Step n={2} label="Scale check" state={scored.length < 2 ? "idle" : "done"}>
            <span>
              {scored.length < 2
                ? "Fewer than two models — nothing to compare"
                : scale.mixed
                  ? `${scale.families.length} model families → no shared scale`
                  : "One model family"}
            </span>
            <span className="ptb-step__sub">ΔLLR is never averaged or pooled; models are compared by within-model rank.</span>
          </Step>
          <Step n={3} label="Within-model rank" state={consensus.nRanked === 0 ? "idle" : "done"}>
            <ul className="ptb-step__list">
              {scored.map(l => (
                <li key={l.id}>
                  <span>{l.family}</span>
                  <span className="ptb-mono">{l.rank !== null ? `${l.rank}/20 · ${l.bandLabel}` : "no rank"}</span>
                </li>
              ))}
            </ul>
            <span className="ptb-step__sub">
              {consensus.nRanked === 0 ? "No rank to read." : consensus.agree ? "All ranked models fall in the same band." : "The models fall in different bands."}
            </span>
          </Step>
          <Step n={4} label="Physical model" state={physical.available ? "done" : "idle"}>
            <span>
              {physical.available
                ? `FoldX${physical.rigidBackbone ? ", rigid backbone" : ""}${vdw?.value != null ? ` · VdW ${vdw.text} kcal/mol` : ""}`
                : physical.reason}
            </span>
            {vdw?.value != null && (
              <span className="ptb-step__sub">
                {vdw.value > clashMark ? "Above" : "Below"} the local {clashMark.toFixed(1)} kcal/mol clash mark. A ΔΔG component, not stability.
              </span>
            )}
          </Step>
          <Step n={5} label="Engine record" state={engine.informational ? "done" : "warn"}>
            <span>{engine.informational ? "Informational — not counted in PP3/BP4" : `Counted in PP3/BP4: ${engine.counted.join(", ")}`}</span>
            <span className="ptb-step__sub">Read from the PP3/BP4 rule&apos;s tool list. No FoldX term or ESM3 output reaches the engine.</span>
            {!engine.informational && (
              <span className="ptb-step__warn">A language model with no published cut-point is voting. Check the Predictors tab.</span>
            )}
          </Step>
        </ol>
      </section>

      {/* ── 2. Reading marks ── */}
      <section className="ptb-rsec" aria-labelledby="ptb-rail-marks">
        <h3 className="eyebrow" id="ptb-rail-marks">
          <Ruler className="w-3.5 h-3.5" />
          Reading marks · all app-defined
        </h3>
        <p className="ptb-cuts__title">Rank bands{selected ? ` · ${selected.family}` : ""}</p>
        <ul className="ptb-cuts" data-testid="perturbation-rank-bands">
          {[...RANK_BANDS].reverse().map(b => {
            const active = selected?.band === b.band;
            return (
              <li key={b.band} className="ptb-cut" data-active={active || undefined}>
                <span className="ptb-cut__name">{b.label}</span>
                <span className="ptb-cut__rule">rank {b.from}–{b.to}</span>
                {active && <span className="ptb-cut__here">this variant · {selected!.rank}/20</span>}
              </li>
            );
          })}
        </ul>
        <p className="ptb-cuts__title">Other marks</p>
        <ul className="ptb-cuts">
          <li className="ptb-cut" data-active={vdw?.value != null && vdw.value > clashMark ? true : undefined}>
            <span className="ptb-cut__name">FoldX clash</span>
            <span className="ptb-cut__rule">&gt; {clashMark.toFixed(1)} kcal/mol</span>
            {vdw?.value != null && <span className="ptb-cut__here">{vdw.text}</span>}
          </li>
          <li className="ptb-cut">
            <span className="ptb-cut__name">Entropy</span>
            <span className="ptb-cut__rule">≤{ENTROPY_MARKS.constrained} · ≥{ENTROPY_MARKS.tolerant} bits</span>
            {selected?.entropy != null && <span className="ptb-cut__here">{selected.entropy.toFixed(2)}</span>}
          </li>
          <li className="ptb-cut">
            <span className="ptb-cut__name">ESM3 drift</span>
            <span className="ptb-cut__rule">{drift.none} · {drift.minor} · {drift.moderate}</span>
            {evidence.esm3?.drift != null && <span className="ptb-cut__here">{evidence.esm3.drift.toFixed(3)}</span>}
          </li>
        </ul>
        <p className="ptb-step__sub">
          None of these is a published cut-point, and no language model here has one: they are reading aids, drawn dashed on the tab.
        </p>
      </section>

      {/* ── 3. Selected model ── */}
      {selected && (
        <section className="ptb-rsec" aria-labelledby="ptb-rail-model">
          <h3 className="eyebrow" id="ptb-rail-model">
            <Layers className="w-3.5 h-3.5" />
            Selected model · {selected.family}
          </h3>
          <dl className="ptb-kv">
            <div className="ptb-kv__row"><dt>Served by</dt><dd>{selected.servedBy ?? "not named in payload"}</dd></div>
            <div className="ptb-kv__row"><dt>Registry row</dt><dd>{selected.calibration?.label ?? "—"}{selected.served.inferred ? " (from settings)" : ""}</dd></div>
            <div className="ptb-kv__row"><dt>Cut-point</dt><dd>None published</dd></div>
            <div className="ptb-kv__row"><dt>Embedding width</dt><dd>{selected.embedding.dim ? `${selected.embedding.dim}-dim` : "unknown"}</dd></div>
            <div className="ptb-kv__row"><dt>ΔLLR</dt><dd className="ptb-mono">{selected.llr !== null ? `${signed(selected.llr, 3)} nats` : "—"}</dd></div>
          </dl>
          {selected.calibration && <p className="ptb-kv__note">{selected.calibration.note}</p>}
        </section>
      )}

      {/* ── 4. Method ── */}
      <section className="ptb-rsec" aria-labelledby="ptb-rail-notes">
        <h3 className="eyebrow" id="ptb-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="ptb-notes" open>
          <summary>Language models</summary>
          <ul>
            <li>
              ΔLLR = log P(variant) − log P(native) at the masked site (Meier 2021). Its range is a property of
              each model, so the same variant can differ by several nats between models without disagreement.
            </li>
            <li>
              Rank is where the variant falls among the 20 residues inside one model. It is scale-free, so it is
              the one statement that compares across models. It is not a probability of pathogenicity.
            </li>
            <li>
              Remote scoring renormalises the engine&apos;s top returned tokens over the 20 residues; a residue it
              did not return is given a 1e-9 floor, which bounds ΔLLR rather than measuring it.
            </li>
            <li>
              SaProt pairs each residue with its Foldseek 3Di letter; a &quot;#&quot; means no structure was supplied at
              that residue, and the score is sequence-only there.
            </li>
            <li>
              Embedding shift is a Euclidean distance between wild-type and mutant embeddings for all three
              models; its size scales with latent width, so it is compared only within a model.
            </li>
          </ul>
        </details>
        <details className="ptb-notes">
          <summary>FoldX and geometry</summary>
          <ul>
            <li>
              BuildModel mutates onto the wild-type backbone, so Cα positions are identical by construction; the
              tab reports Cα displacement as not measured rather than 0.
            </li>
            <li>
              The VdW clash and electrostatic terms are components of ΔΔG. Stability is the total ΔΔG, reported
              on the Energetics tab.
            </li>
            <li>
              Identical runs (SD 0.00) leave no run-to-run spread. They are expected when there are no
              rotamers to sample (a glycine, for example) and are not a measure of prediction error.
            </li>
            <li>
              Contacts are residues with a heavy atom within 4 Å of the site, ±1 neighbours excluded. Residue
              SASA change is absolute area and tracks side-chain size as much as exposure.
            </li>
          </ul>
        </details>
        <details className="ptb-notes">
          <summary>ESM3 and limits</summary>
          <ul>
            <li>
              ESM3 drift is the largest per-residue cosine distance between wild-type and mutant sequence
              embeddings. No structure is generated or refined for it.
            </li>
            <li>The confidence beside it is the input structure&apos;s pLDDT/B-factor at the site, not ESM3&apos;s.</li>
            <li>
              A structurally quiet variant can still be pathogenic (gain of function, interfaces, regulation); low
              perturbation is not evidence for benign.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 5. Sources ── */}
      <section className="ptb-rsec" aria-labelledby="ptb-rail-sources">
        <h3 className="eyebrow" id="ptb-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        {sources.length > 0 && (
          <dl className="ptb-kv">
            {sources.map(([label, value]) => (
              <div key={label} className="ptb-kv__row"><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        )}
        <ul className="ptb-refs">
          {REFERENCES.map(src => (
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

export default React.memo(PerturbationRail);
