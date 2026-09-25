import { Dna, ExternalLink, Settings2, ShieldAlert } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useDiagnostics } from "../hooks/useDiagnostics";
import {
  APP_REPOSITORY,
  PROVENANCE_DATA_SOURCES,
  PROVENANCE_MODEL_REVISIONS,
} from "../shared/provenance";

/**
 * Sidebar-mirroring description of the workspace zones, so the guide the reader
 * just used to get here is the guide the page explains.
 */
const WORKFLOW_ZONES = [
  {
    name: "Input · Search",
    desc: "Enter a gene symbol and an HGVS missense notation. The workspace resolves the transcript, UniProt accession and genomic coordinates before the pipeline runs.",
  },
  {
    name: "Evidence & modeling",
    desc: "Population frequencies, in-silico predictors, AlphaGenome effects, RNA splicing, 3D structure (AlphaFold2 & ESMFold), ΔΔG energetics and the residue landscape.",
  },
  {
    name: "Synthesis",
    desc: "AI interpretation and ACMG rules, literature mining, and a clinical narrative assembled from the run's own evidence.",
  },
  {
    name: "Developer",
    desc: "Errors, logs and network telemetry for the services behind the pipeline.",
  },
] as const;

/** Display labels for the provenance data-source keys (keys are lower-camel ids). */
const DATA_SOURCE_LABELS: Record<string, string> = {
  dbnsfp: "dbNSFP",
  gnomad: "gnomAD",
  clinvar: "ClinVar",
  foldx: "FoldX",
  cacheSchemaVersion: "Cache schema",
  stackerCalibration: "Stacker calibration",
};

const MODEL_REVISIONS = Object.entries(PROVENANCE_MODEL_REVISIONS) as [
  string,
  { model: string; commitSha?: string; weights?: string }
][];
const DATA_SOURCES = Object.entries(PROVENANCE_DATA_SOURCES) as [string, string][];

function SectionHeading({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={id}
      style={{
        fontFamily: "var(--cs-font-serif)",
        fontSize: 16,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        color: "var(--cs-text-primary)",
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}

/**
 * One label/value row per line, hairline-separated — the same reading grammar the
 * VariantHeader uses for its identifier meta line, rather than boxed table chrome.
 */
function KeyValueRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="flex flex-col">
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-4 py-2"
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--cs-border-subtle)" }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--cs-text-primary)" }}>
            {label}
          </span>
          <span
            className="font-mono text-right truncate"
            style={{ fontSize: 11.5, color: "var(--cs-text-muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * About view — the workspace guide, data-source manifest and research-use framing.
 * Content that used to live only inside the settings drawer ("About & data"), where
 * a reader had to discover it; the sidebar footer now routes here directly.
 */
export default function AboutView() {
  const { version } = useDiagnostics();
  const { openSettingsTab } = useSettings();

  return (
    <div
      className="w-full flex flex-col items-center justify-start px-4 sm:px-6 py-8 overflow-y-auto"
      style={{ background: "var(--cs-bg)", minHeight: "calc(100vh - var(--cs-chrome-height))" }}
    >
      <div className="w-full" style={{ maxWidth: 720 }}>
        {/* ── Brand block ── */}
        <div className="flex items-center gap-4" style={{ marginBottom: 28 }}>
          <div
            className="rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ width: 44, height: 44, background: "var(--cs-accent-clay)" }}
          >
            <Dna className="w-6 h-6 text-white stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <h1
              className="screen-title"
              style={{
                fontFamily: "var(--cs-font-serif)",
                fontSize: 22,
                letterSpacing: "-0.01em",
                lineHeight: 1.2,
              }}
            >
              About Missense &amp; Fold
            </h1>
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                color: "var(--cs-text-muted)",
                marginTop: 3,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              v{version?.version || "1.0.0"}
              {version?.env ? ` · ${version.env}` : ""}
            </div>
          </div>
        </div>

        {/* ── What this is ── */}
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--cs-text-secondary)",
            maxWidth: "65ch",
            margin: "0 0 8px",
          }}
        >
          Missense &amp; Fold is a structural exploration workspace for human missense
          variants. Give it a gene and an HGVS protein notation, and it resolves the
          variant's protein context — structure, energetics, splicing, conservation —
          then assembles the clinical evidence into an interpretation you can trace
          back to its sources.
        </p>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.65,
            color: "var(--cs-text-secondary)",
            maxWidth: "65ch",
            margin: "0 0 32px",
          }}
        >
          Every result carries its provenance: the data-source releases, the pinned
          foundation-model revisions and the service states behind each verdict are
          recorded in a manifest that ships with exported reports.
        </p>

        {/* ── How the workspace is organized ── */}
        <section aria-labelledby="about-workflow" style={{ marginBottom: 32 }}>
          <SectionHeading id="about-workflow">How the workspace is organized</SectionHeading>
          <div className="flex flex-col" style={{ marginTop: 8 }}>
            {WORKFLOW_ZONES.map((zone, i) => (
              <div
                key={zone.name}
                className="flex flex-col"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--cs-border-subtle)" }}
              >
                <div className="py-2.5">
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cs-text-primary)" }}>
                    {zone.name}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: "var(--cs-text-muted)",
                      marginTop: 2,
                      maxWidth: "65ch",
                    }}
                  >
                    {zone.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pinned model revisions ── */}
        <section aria-labelledby="about-models" style={{ marginBottom: 32 }}>
          <SectionHeading id="about-models">Pinned model revisions</SectionHeading>
          <p
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--cs-text-muted)",
              margin: "4px 0 8px",
            }}
          >
            Foundation-model weights are pinned to these revisions so a result can be
            re-derived later.
          </p>
          <KeyValueRows
            rows={MODEL_REVISIONS.map(([id, rev]) => [
              rev.model,
              rev.commitSha ? `@${rev.commitSha.slice(0, 10)}` : rev.weights || id,
            ])}
          />
        </section>

        {/* ── Data sources ── */}
        <section aria-labelledby="about-sources" style={{ marginBottom: 32 }}>
          <SectionHeading id="about-sources">Data sources</SectionHeading>
          <div style={{ height: 8 }} />
          <KeyValueRows
            rows={DATA_SOURCES.map(([id, release]) => [
              DATA_SOURCE_LABELS[id] || id,
              release,
            ])}
          />
        </section>

        {/* ── Research-use disclaimer ── */}
        <section aria-labelledby="about-disclaimer" style={{ marginBottom: 32 }}>
          <div
            className="rounded-xl"
            style={{
              background: "var(--cs-surface-2)",
              border: "1px solid var(--cs-border)",
              padding: 16,
              maxWidth: "65ch",
            }}
            role="note"
          >
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <ShieldAlert
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--cs-text-warning)" }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cs-text-primary)" }}>
                Research use only
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--cs-text-secondary)",
                margin: 0,
              }}
            >
              This workspace is research software. Its pathogenicity predictions,
              ACMG/AMP classifications and ΔΔG estimates are decision support, not a
              diagnosis, and can be incomplete or wrong when upstream data is. Clinical
              decisions require qualified professional interpretation and confirmatory
              testing.
            </p>
          </div>
        </section>

        {/* ── Footer actions ── */}
        <div className="flex flex-wrap items-center gap-2.5" style={{ paddingBottom: 24 }}>
          <a
            href={APP_REPOSITORY}
            target="_blank"
            rel="noreferrer"
            className="cs-btn-ghost"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Repository
          </a>
          <button
            type="button"
            className="cs-btn-ghost"
            onClick={() => openSettingsTab("about")}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Manage data &amp; caches
          </button>
        </div>
      </div>
    </div>
  );
}
