import { ExternalLink } from "lucide-react";
import { signedDdg, type EnergeticsEvidence, type EnergeticsReading } from "../../shared/energeticsEvidence";
import type { EnergyUnit } from "../../shared/engineStatus";
import { returnedEnergyEstimates } from "../../shared/energeticsComparison";

/** Engines as a tally: one segment per engine, grouped by call, each name once. */
const TALLY_GROUPS = [
  { call: "high", word: "destabilizing" },
  { call: "moderate", word: "moderately destabilizing" },
  { call: "neutral", word: "not destabilizing" },
  { call: "running", word: "running" },
  { call: "none", word: "no value" },
] as const;
type TallyCall = (typeof TALLY_GROUPS)[number]["call"];

function tallyCall(r: EnergeticsReading): TallyCall {
  if (r.outcome.state === "running") return "running";
  if (r.ddg === null || !r.counted) return "none";
  const id = r.outcome.risk?.id;
  return id === "high" ? "high" : id === "moderate" ? "moderate" : "neutral";
}

export function EngineTally({ evidence, unit }: { evidence: EnergeticsEvidence; unit: EnergyUnit }) {
  // The tally counts engines; the ProtVar reference row is in the table, not in the count.
  const shown = evidence.readings.filter(r => !(r.outcome.state === "skipped") && !r.outcome.engine.referenceOnly);
  const groups = TALLY_GROUPS.map(g => ({ ...g, rows: shown.filter(r => tallyCall(r) === g.call) })).filter(
    g => g.rows.length > 0
  );
  return (
    <div className="nrg-frow" data-testid="energetics-tally">
      <div className="nrg-frow__label">
        <span className="nrg-frow__name">Engines</span>
        {/* The tally's own vocabulary is the count that RETURNED vs the count that COUNTED — the
            same two numbers the summary sentence uses, so the tile and the sentence cannot disagree
            when an excluded FoldX value is on screen. */}
        <span className="nrg-frow__sub">
          {`${returnedEnergyEstimates(evidence)} of ${evidence.coverage.intended} engines returned a value`}
          {evidence.agreement.nCounted !== returnedEnergyEstimates(evidence) ? `, ${evidence.agreement.nCounted} counted in the agreement` : ""}
          {" · each judged on its own local mark"}
        </span>
      </div>
      <div className="nrg-frow__body">
        <ol className="nrg-tally" aria-label="Stability engines by call">
          {groups.map(g => (
            <li key={g.call} className="nrg-tally__group" data-call={g.call} style={{ flexGrow: g.rows.length }}>
              <ul className="nrg-tally__tools">
                {g.rows.map(r => (
                  <li key={r.key} className="nrg-tally__tool" title={`${r.name}: ${r.ddg !== null ? signedDdg(r.ddg, unit) : r.outcome.label}`}>
                    <i className="nrg-tally__seg" aria-hidden="true" />
                    <span className="nrg-tally__name">{r.name}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="nrg-tally__key" data-testid="energetics-tally-key">
          {groups.map(g => (
            <span key={g.call}>
              <i className="nrg-tally__swatch" data-call={g.call} aria-hidden="true" />
              {g.rows.length} {g.word}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

export function StructureFact({ evidence }: { evidence: EnergeticsEvidence }) {
  const s = evidence.structure;
  if (!s || evidence.isFolding) {
    return (
      <div className="nrg-fact">
        <span className="nrg-fact__label">Structure</span>
        <span className="nrg-fact__value">{evidence.isFolding ? "Resolving…" : "—"}</span>
      </div>
    );
  }
  return (
    <div className="nrg-fact" data-testid="energetics-structure">
      <span className="nrg-fact__label">{s.label}</span>
      <span className="nrg-fact__value">
        {s.pdbId ? (
          <a href={`https://www.rcsb.org/structure/${s.pdbId}`} target="_blank" rel="noopener noreferrer" title={`Open ${s.pdbId} in RCSB PDB`}>
            {s.pdbId}
            {s.chainId ? `:${s.chainId}` : ""}
            <ExternalLink className="inline w-3 h-3 ml-1 -mt-0.5" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : s.href ? (
          <a href={s.href} target="_blank" rel="noopener noreferrer" title="Open the AlphaFold DB entry">
            AlphaFold model
            <ExternalLink className="inline w-3 h-3 ml-1 -mt-0.5" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          "Model"
        )}
      </span>
      <span className="nrg-fact__sub">
        {[
          s.resolution !== null ? `${s.resolution.toFixed(1)} Å` : null,
          s.source === "homolog" && s.identity !== null ? `${s.identity.toFixed(0)}% identity` : null,
          s.afdbVersion,
          s.repair,
        ]
          .filter(Boolean)
          .join(" · ") || " "}
      </span>
      {/*
        A mutating engine needs the wild type. When the experimental entry was refused for that
        reason, the screen says which entry and why, and links the model it used instead — the
        AlphaFold DB entry — rather than presenting the predicted template as if it were a crystal.
      */}
      {s.excludedExperimental && (
        <span className="nrg-fact__sub" data-testid="energetics-excluded-template">
          {s.excludedExperimental.pdbId}
          {s.excludedExperimental.chainId ? `:${s.excludedExperimental.chainId}` : ""} was not used:{" "}
          {s.excludedExperimental.unverified
            ? "it could not be checked against UniProt."
            : `${s.excludedExperimental.differences.join(", ")} — not the wild type.`}
        </span>
      )}
      {s.sequenceDifferences.length > 0 && (
        <span className="nrg-fact__sub" data-testid="energetics-template-differences">
          Template differs from UniProt: {s.sequenceDifferences.join(", ")}.
        </span>
      )}
    </div>
  );
}
