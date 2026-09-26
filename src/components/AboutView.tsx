import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  Dna,
  ExternalLink,
  GitBranch,
  Info,
  Settings2,
  ShieldAlert
} from "lucide-react";
import { motion } from "motion/react";
import { useSettings } from "../context/SettingsContext";
import { useDiagnostics } from "../hooks/useDiagnostics";
import {
  APP_REPOSITORY,
  PROVENANCE_DATA_SOURCES,
  PROVENANCE_MODEL_REVISIONS
} from "../shared/provenance";
import {
  ATTRIBUTION_ENTRY_COUNT,
  ATTRIBUTION_GROUPS,
  QUERY_TRANSMISSION,
  WORKSPACE_CITATION,
  type AttributionEntry,
  type AttributionKind
} from "../shared/attributions";

/**
 * Sidebar-mirroring description of the workspace zones, so the guide the reader just used
 * to get here is the guide the page explains.
 */
const WORKFLOW_ZONES = [
  {
    name: "Input · Search",
    desc: "Enter a gene symbol and an HGVS missense notation. The workspace resolves the transcript, UniProt accession and genomic coordinates before the pipeline runs."
  },
  {
    name: "Evidence & modeling",
    desc: "Population frequencies, in-silico predictors, AlphaGenome effects, RNA splicing, 3D structure (AlphaFold2 & ESMFold), ΔΔG energetics and the residue landscape."
  },
  {
    name: "Synthesis",
    desc: "AI interpretation and ACMG rules, literature mining, and a clinical narrative assembled from the run's own evidence."
  },
  {
    name: "Developer",
    desc: "Errors, logs and network telemetry for the services behind the pipeline."
  }
] as const;

/** The word shown on each credit's kind chip. Kept short so a row stays scannable. */
const KIND_LABELS: Record<AttributionKind, string> = {
  dataset: "Data",
  model: "Model",
  service: "Service",
  software: "Software"
};

/** Display labels for the provenance data-source keys (keys are lower-camel ids). */
const DATA_SOURCE_LABELS: Record<string, string> = {
  dbnsfp: "dbNSFP",
  gnomad: "gnomAD",
  clinvar: "ClinVar",
  foldx: "FoldX",
  cacheSchemaVersion: "Cache schema",
  stackerCalibration: "Stacker calibration"
};

const MODEL_REVISIONS = Object.entries(PROVENANCE_MODEL_REVISIONS) as [
  string,
  { model: string; commitSha?: string; weights?: string }
][];
const DATA_SOURCES = Object.entries(PROVENANCE_DATA_SOURCES) as [string, string][];

/**
 * The page's own table of contents, in document order. Built from the same ids the
 * sections render, so a heading cannot be added without appearing here.
 */
const CONTENTS: { id: string; label: string }[] = [
  { id: "about-overview", label: "Overview" },
  { id: "about-workflow", label: "How the workspace is organised" },
  ...ATTRIBUTION_GROUPS.map((group) => ({ id: group.id, label: group.title })),
  { id: "about-transmission", label: "Where a query is sent" },
  { id: "about-citation", label: "How to cite this workspace" },
  { id: "about-disclaimer", label: "Research use only" }
];

/** The bare host a credit links to, so the link reads as a destination rather than a URL. */
function creditHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}


/**
 * Marks the contents entry for the section currently being read.
 *
 * A page this long is unusable without it, and `aria-current` is the only cue a screen
 * reader can follow. The observer is created once and disconnects on unmount; where
 * `IntersectionObserver` is unavailable (jsdom, older browsers) the first entry simply
 * stays current rather than the page throwing.
 */
function useActiveSection(ids: string[]): [string, (id: string) => void] {
  const [observedId, setObservedId] = useState(ids[0]);
  const [clickedId, setClickedId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (sections.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const next = ids.find((id) => visible.has(id));
        if (next) {
          setObservedId(next);
          // The observer has caught up with the click, so it can be authoritative again.
          setClickedId(null);
        }
      },
      { rootMargin: "-10% 0px -65% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [ids]);

  /**
   * A click is authoritative for the moment it scrolls: smooth scrolling passes every
   * section in between, and the observer would otherwise highlight each one on the way.
   */
  const noteNavigation = useCallback((id: string) => {
    setClickedId(id);
    setObservedId(id);
  }, []);

  return [clickedId ?? observedId, noteNavigation];
}

function SectionHeading({
  children,
  id,
  count,
  blurb
}: {
  children: React.ReactNode;
  id: string;
  count?: number;
  blurb?: string;
}) {
  return (
    <div>
      <h2 id={id} className="about-section-title">
        {children}
        {typeof count === "number" && (
          <span className="about-section-count">{count}</span>
        )}
      </h2>
      {blurb && <p className="about-section-blurb">{blurb}</p>}
    </div>
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
          {/* The value cell is the point of the row: without it the rail lists model names with
              no revision beside them, which is the opposite of provenance. */}
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
 * One credited third party.
 *
 * The order inside a row is deliberate: who it is and how to reach it, then what this
 * workspace uses it FOR, then the two facts that make the credit auditable — the release
 * that was actually in force, and the file in this repository that calls it.
 */
function CreditEntry({ entry }: { entry: AttributionEntry }) {
  return (
    <li id={`credit-${entry.id}`} className="about-credit">
      <div className="about-credit-top">
        <h4 className="about-credit-name">
          <a
            className="about-credit-link"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${entry.name} — ${creditHost(entry.url)} (opens in a new tab)`}
          >
            {entry.name}
            <ArrowUpRight className="about-credit-arrow" aria-hidden="true" />
          </a>
        </h4>
        <span className={`about-kind about-kind-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
        <span className="about-credit-host">{creditHost(entry.url)}</span>
      </div>

      <p className="about-credit-role">{entry.role}</p>

      <p className="about-credit-meta">
        <span className="about-meta-label">Provider</span>
        <span>{entry.provider}</span>
        <span className="about-meta-sep" aria-hidden="true" />
        <span className="about-meta-label">Release</span>
        {entry.release
          ? <span className="font-mono about-meta-value">{entry.release}</span>
          : <span className="about-meta-unpinned">not pinned by this workspace</span>}
      </p>

      {entry.licence && (
        <p className="about-credit-note">
          <Info className="about-credit-icon" aria-hidden="true" />
          <span>{entry.licence}</span>
        </p>
      )}

      {entry.citation ? (
        <p className="about-credit-cite">
          <BookOpen className="about-credit-icon" aria-hidden="true" />
          <span>
            <span className="about-meta-label">Cite</span> {entry.citation}
          </span>
        </p>
      ) : (
        <p className="about-credit-cite about-credit-cite-empty">
          <BookOpen className="about-credit-icon" aria-hidden="true" />
          <span>
            <span className="about-meta-label">Cite</span> no formal citation is published for this
            service — the link above is the reference.
          </span>
        </p>
      )}

      <p className="about-credit-used">
        <GitBranch className="about-credit-icon" aria-hidden="true" />
        <span className="about-meta-label">Called from</span>
        {entry.usedBy.map((path) => (
          <code key={path}>{path}</code>
        ))}
      </p>
    </li>
  );
}

/**
 * The citation block.
 *
 * Copying is the whole point, so the control reports three states — idle, copied, and
 * failed — and the failure is stated in words rather than swallowed: over plain HTTP the
 * clipboard API is unavailable, and silently doing nothing would look like a broken page.
 */
function CitationBlock() {
  const [copied, setCopied] = useState<"plain" | "bibtex" | null>(null);
  const [failed, setFailed] = useState(false);

  const copy = async (text: string, which: "plain" | "bibtex") => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(which);
      window.setTimeout(() => {
        setCopied((current) => (current === which ? null : current));
      }, 2200);
    } catch {
      setCopied(null);
      setFailed(true);
    }
  };

  return (
    <div className="about-cite-block">
      <p className="about-cite-plain">{WORKSPACE_CITATION.plain}</p>
      <pre className="about-cite-bibtex" aria-label="BibTeX entry for this workspace">
        {WORKSPACE_CITATION.bibtex}
      </pre>
      <div className="about-cite-actions">
        <button
          type="button"
          className="cs-btn-ghost about-copy-btn"
          onClick={() => copy(WORKSPACE_CITATION.bibtex, "bibtex")}
        >
          <span className="about-copy-icon" aria-hidden="true">
            <motion.span
              className="about-copy-glyph"
              animate={{
                opacity: copied === "bibtex" ? 0 : 1,
                scale: copied === "bibtex" ? 0.25 : 1,
                filter: copied === "bibtex" ? "blur(4px)" : "blur(0px)"
              }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            >
              <Copy className="w-3.5 h-3.5" />
            </motion.span>
            <motion.span
              className="about-copy-glyph about-copy-glyph-live"
              animate={{
                opacity: copied === "bibtex" ? 1 : 0,
                scale: copied === "bibtex" ? 1 : 0.25,
                filter: copied === "bibtex" ? "blur(0px)" : "blur(4px)"
              }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            >
              <Check className="w-3.5 h-3.5" />
            </motion.span>
          </span>
          {copied === "bibtex" ? "BibTeX copied" : "Copy BibTeX"}
        </button>
        <button
          type="button"
          className="cs-btn-ghost about-copy-btn"
          onClick={() => copy(WORKSPACE_CITATION.plain, "plain")}
        >
          {copied === "plain" ? "Reference copied" : "Copy reference"}
        </button>
        <span className="about-copy-status" role="status" aria-live="polite">
          {failed ? "Copy failed — select the text above instead." : "\u00A0"}
        </span>
      </div>
    </div>
  );
}

/**
 * About view — the workspace guide, the third-party credit roll and the research-use framing.
 *
 * Content that used to live only inside the settings drawer ("About & data"), where a reader
 * had to discover it; the sidebar footer now routes here directly. The credits themselves come
 * from `shared/attributions.ts`, so a provider, a release or a citation is corrected in one
 * place and the recorded call sites stay beside the claim.
 */
export default function AboutView() {
  const { version } = useDiagnostics();
  const { openSettingsTab } = useSettings();
  const sectionIds = useMemo(() => CONTENTS.map((entry) => entry.id), []);
  const [activeId, noteNavigation] = useActiveSection(sectionIds);

  return (
    <div className="about-view">
      <div className="about-shell">
        {/* ── Brand block ── */}
        <header className="about-hero">
          <div className="about-mark" aria-hidden="true">
            <Dna className="w-6 h-6 text-white stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <h1 className="about-title">About Missense &amp; Fold</h1>
            <p className="about-version">
              <span className="font-mono">
                v{version?.version || "1.0.0"}
                {version?.env ? ` · ${version.env}` : ""}
              </span>
              <span className="about-version-sep" aria-hidden="true" />
              {ATTRIBUTION_ENTRY_COUNT} third-party sources credited below
            </p>
          </div>
        </header>

        <div className="about-layout">
          {/* ── Left column: the reading column ── */}
          <main className="about-prose">
            <section id="about-overview" className="about-section" aria-labelledby="about-overview-title">
              <SectionHeading id="about-overview-title">What this workspace is</SectionHeading>
              <p className="about-lede">
                Missense &amp; Fold is a structural exploration workspace for human missense
                variants. Give it a gene and an HGVS protein notation, and it resolves the
                variant's protein context — structure, energetics, splicing, conservation — then
                assembles the clinical evidence into an interpretation you can trace back to its
                sources.
              </p>
              <p className="about-lede">
                Every result carries its provenance: the data-source releases, the pinned
                foundation-model revisions and the service states behind each verdict are recorded
                in a manifest that ships with exported reports. This page is the other half of that
                promise — not what one run used, but everything the workspace depends on at all,
                and who to credit for it.
              </p>
            </section>

            <section id="about-workflow" className="about-section" aria-labelledby="about-workflow-title">
              <SectionHeading id="about-workflow-title">How the workspace is organised</SectionHeading>
              <ol className="about-zones">
                {WORKFLOW_ZONES.map((zone, index) => (
                  <li key={zone.name} className="about-zone">
                    <span className="about-zone-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="about-zone-name">{zone.name}</p>
                      <p className="about-zone-desc">{zone.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* ── Attribution & acknowledgments ── */}
            <section id="about-credits" className="about-section" aria-labelledby="about-credits-title">
              <SectionHeading
                id="about-credits-title"
                blurb="Nothing on this page is a logo wall. Each entry names the people who maintain the source, what this workspace uses it for, the release that was actually in force, the citation to use, and the file in this repository that calls it — so every claim here can be checked rather than taken on faith."
              >
                Attribution &amp; acknowledgments
              </SectionHeading>
              <p className="about-lede about-lede-tight">
                Missense &amp; Fold is a composition. The models, the databases and the services
                below were built by other groups and are used here under their own terms; the
                workspace's contribution is the pipeline that resolves a notation, keeps each
                source's own scale and calibration intact, and records which sources were asked
                when a verdict was formed. Where a source is unpinned, or offered under a licence
                that constrains reuse, the entry says so.
              </p>

              {ATTRIBUTION_GROUPS.map((group) => (
                <section
                  key={group.id}
                  id={group.id}
                  className="about-group"
                  aria-labelledby={`${group.id}-title`}
                >
                  <SectionHeading id={`${group.id}-title`} count={group.entries.length}>
                    {group.title}
                  </SectionHeading>
                  <p className="about-group-blurb">{group.blurb}</p>
                  <ul className="about-credits">
                    {group.entries.map((entry) => (
                      <CreditEntry key={entry.id} entry={entry} />
                    ))}
                  </ul>
                </section>
              ))}
            </section>

            {/* ── Where a query is sent ── */}
            <section id="about-transmission" className="about-section" aria-labelledby="about-transmission-title">
              <SectionHeading
                id="about-transmission-title"
                count={QUERY_TRANSMISSION.hosts.length}
                blurb={QUERY_TRANSMISSION.blurb}
              >
                Where a query is sent
              </SectionHeading>
              <dl className="about-hosts">
                {QUERY_TRANSMISSION.hosts.map((host) => (
                  <div key={host.host} className="about-host">
                    <dt className="about-host-name font-mono">{host.host}</dt>
                    <dd className="about-host-body">
                      <p className="about-host-sent">
                        <span className="about-meta-label">Sent</span>
                        <span>{host.sent}</span>
                      </p>
                      {host.note && <p className="about-host-note">{host.note}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="about-note-inline">
                <Info className="about-credit-icon" aria-hidden="true" />
                <span>
                  Caching runs ahead of most of this. A resolved variant is stored in a local cache
                  and re-analysis is answered from it, so repeating a query does not repeat the
                  third-party requests — which is why the rail below reports how many entries the
                  server caches are holding.
                </span>
              </p>
            </section>

            {/* ── How to cite ── */}
            <section id="about-citation" className="about-section" aria-labelledby="about-citation-title">
              <SectionHeading
                id="about-citation-title"
                blurb="One entry for this workspace — and a reminder that a report produced here also rests on the sources credited above. Cite the ones the run actually used; the exported provenance manifest names them."
              >
                How to cite this workspace
              </SectionHeading>
              <CitationBlock />
            </section>

            {/* ── Research-use disclaimer ── */}
            <section id="about-disclaimer" className="about-section" aria-labelledby="about-disclaimer-title">
              <div className="about-disclaimer" role="note">
                <div className="about-disclaimer-head">
                  <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <h2 id="about-disclaimer-title" className="about-disclaimer-title">
                    Research use only
                  </h2>
                </div>
                <p className="about-disclaimer-body">
                  This workspace is research software. Its pathogenicity predictions, ACMG/AMP
                  classifications and ΔΔG estimates are decision support, not a diagnosis, and can be
                  incomplete or wrong when upstream data is. A verdict is only as current as the
                  sources behind it — several are queried live, and none of them is controlled by
                  this workspace. Clinical decisions require qualified professional interpretation
                  and confirmatory testing.
                </p>
                <p className="about-disclaimer-body">
                  It is also not a system of record: nothing here is HIPAA-compliant, and no patient
                  identifier should ever be typed into it — including the optional directions field,
                  whose screening for identifiers is best-effort rather than a guarantee.
                </p>
              </div>
            </section>
          </main>

          {/* ── Right column: contents and the provenance rail (sticky on wide screens) ── */}
          <aside className="about-rail" aria-label="On this page and run provenance">
            <nav className="about-toc" aria-label="On this page">
              <h2 className="about-rail-title">On this page</h2>
              <ol className="about-toc-list">
                {CONTENTS.map((entry) => (
                  <li key={entry.id}>
                    <a
                      className="about-toc-link"
                      href={`#${entry.id}`}
                      aria-current={activeId === entry.id ? "true" : undefined}
                      onClick={() => noteNavigation(entry.id)}
                    >
                      <span className="about-toc-dot" aria-hidden="true" />
                      <span className="about-toc-label">{entry.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <section className="about-rail-section" aria-labelledby="about-models">
              <SectionHeading id="about-models">Pinned model revisions</SectionHeading>
              <p className="about-rail-hint">
                Weights are pinned so a result can be re-derived later. The pins in force for one
                run are copied into its exported manifest.
              </p>
              <KeyValueRows
                rows={MODEL_REVISIONS.map(([id, rev]) => [
                  rev.model,
                  rev.commitSha ? `@${rev.commitSha.slice(0, 10)}` : rev.weights || id
                ])}
              />
            </section>

            <section className="about-rail-section" aria-labelledby="about-sources">
              <SectionHeading id="about-sources">Data-source releases</SectionHeading>
              <KeyValueRows
                rows={DATA_SOURCES.map(([id, release]) => [
                  DATA_SOURCE_LABELS[id] || id,
                  release
                ])}
              />
            </section>

            <div className="about-actions">
              <a
                href={APP_REPOSITORY}
                target="_blank"
                rel="noreferrer"
                className="cs-btn-ghost"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                Repository
              </a>
              <button
                type="button"
                className="cs-btn-ghost"
                onClick={() => openSettingsTab("about")}
              >
                <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                Manage data &amp; caches
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

