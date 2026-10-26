import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  GitBranch,
  Info,
  Link2,
  Search,
  Settings2,
  ShieldAlert,
  X
} from "lucide-react";
import { BrandMark } from "./ui/BrandMark";
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
import {
  EVIDENCE_SUB_ITEMS,
  MASTER_VIEW_ITEMS,
  NAV_ZONES,
  STRUCTURE_SUB_ITEMS,
  type MasterView,
  type NavItem,
  type NavZone
} from "./MasterSidebar";

/**
 * What each sidebar zone is for. The views listed under each zone are read from the sidebar's
 * own registry (`NAV_ZONES`), so the map on this page cannot drift from the navigation it
 * describes — only this one sentence per zone is written here.
 *
 * Keyed by the zone's stable id, not by the label it prints: naming the heading once renamed it
 * ("Search" → "Variant query") and silently deleted this paragraph from the page.
 */
const ZONE_PURPOSE: Record<NavZone["id"] | "tools", string> = {
  query:
    "Enter a gene symbol and an HGVS missense notation. The workspace resolves the transcript, UniProt accession and genomic coordinates before the pipeline runs.",
  evidence:
    "What is known and what can be modelled: population data, predictors, splicing and the structural tabs, the 3D models, ΔΔG energetics and the residue landscape.",
  synthesis:
    "The run's evidence assembled for a reader: ACMG criteria and interpretation, the literature behind the gene, and the exportable clinical report.",
  tools: "Pinned at the foot of the sidebar: the network and error telemetry behind the pipeline, and this guide."
};

const FOOTER_VIEW_IDS: MasterView[] = ["console", "about"];

/**
 * `index` is the number the sidebar prints beside the zone (its CSS counter counts labelled zones
 * only), so the map and the rail never disagree: the query page and the pinned tools carry no number there,
 * and none here.
 */
const WORKSPACE_ZONES: { id: NavZone["id"] | "tools"; title: string; index?: string; items: NavItem[] }[] = [
  ...NAV_ZONES.map((zone) => ({
    id: zone.id,
    /* An unlabelled zone is named after the page it holds, so the rail's rename reaches the map. */
    title: zone.zoneLabel ?? zone.items[0].label,
    index: zone.zoneLabel
      ? String(NAV_ZONES.filter((z) => z.zoneLabel).indexOf(zone) + 1).padStart(2, "0")
      : undefined,
    items: zone.items
  })),
  { id: "tools", title: "Tools", items: MASTER_VIEW_ITEMS.filter((item) => FOOTER_VIEW_IDS.includes(item.id)) }
];

/** Sub-tabs a top-level view opens onto, named so the map shows where each tab lives. */
const VIEW_SUB_ITEMS: Partial<Record<MasterView, readonly { label: string }[]>> = {
  evidence: EVIDENCE_SUB_ITEMS,
  structure: STRUCTURE_SUB_ITEMS
};

/** The word shown on each credit's kind chip. Kept short so a row stays scannable. */
const KIND_LABELS: Record<AttributionKind, string> = {
  dataset: "Data",
  model: "Model",
  service: "Service",
  software: "Software"
};
const KIND_ORDER: AttributionKind[] = ["dataset", "model", "service", "software"];

/** Display labels for the provenance data-source keys (keys are lower-camel ids). */
const DATA_SOURCE_LABELS: Record<string, string> = {
  dbnsfp: "dbNSFP",
  gnomad: "gnomAD",
  clinvar: "ClinVar",
  foldx: "FoldX",
  cacheSchemaVersion: "Cache schema"
};

/**
 * Manifest strings the code does not establish, mapped to the credit that explains why.
 *
 * The rail prints `PROVENANCE_DATA_SOURCES` verbatim because that is what an export carries.
 * Without this, the rail would state "4.4a" as fact a few hundred pixels from the credit that
 * says the release is unresolved — the page contradicting itself.
 */
const DATA_SOURCE_CAVEATS: Record<string, string> = {
  dbnsfp: "dbnsfp",
  clinvar: "clinvar"
};

const MODEL_REVISIONS = Object.entries(PROVENANCE_MODEL_REVISIONS) as [
  string,
  { model: string; commitSha?: string; weights?: string }
][];
const DATA_SOURCES = Object.entries(PROVENANCE_DATA_SOURCES) as [string, string][];

const ALL_ENTRIES = ATTRIBUTION_GROUPS.flatMap((group) => group.entries);

/** Every disclosed host, one per name — a transmission row may list several. */
const DISCLOSED_HOST_COUNT = QUERY_TRANSMISSION.hosts.reduce(
  (total, row) => total + row.host.split("·").filter((part) => part.trim()).length,
  0
);

/**
 * The page's own table of contents, in document order. Built from the same ids the sections
 * render, so a heading cannot be added without appearing here. `level: 2` entries sit under
 * the attribution section and are indented.
 */
const CONTENTS: { id: string; label: string; level: 1 | 2; count?: number }[] = [
  { id: "about-overview", label: "Overview", level: 1 },
  { id: "about-workflow", label: "Workspace map", level: 1 },
  { id: "about-credits", label: "Attribution", level: 1, count: ATTRIBUTION_ENTRY_COUNT },
  ...ATTRIBUTION_GROUPS.map((group) => ({
    id: group.id,
    label: group.title,
    level: 2 as const,
    count: group.entries.length
  })),
  { id: "about-transmission", label: "Where a query is sent", level: 1, count: DISCLOSED_HOST_COUNT },
  { id: "about-citation", label: "How to cite", level: 1 },
  { id: "about-disclaimer", label: "Research use only", level: 1 }
];
const GROUP_IDS = new Set(ATTRIBUTION_GROUPS.map((group) => group.id));

/** The bare host a credit links to, so the link reads as a destination rather than a URL. */
function creditHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Text a filter query is matched against: everything a reader could plausibly type. */
function entryHaystack(entry: AttributionEntry): string {
  return [
    entry.name,
    entry.provider,
    entry.role,
    entry.release ?? "",
    entry.citation ?? "",
    KIND_LABELS[entry.kind],
    creditHost(entry.url),
    ...entry.usedBy
  ]
    .join(" ")
    .toLowerCase();
}
const HAYSTACKS = new Map(ALL_ENTRIES.map((entry) => [entry.id, entryHaystack(entry)]));

/** Renders the URLs inside a citation as links, so a DOI is one click rather than a copy. */
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return part;
        const url = part.replace(/[.,;)]+$/, "");
        const trailing = part.slice(url.length);
        return (
          <span key={i}>
            <a className="about-inline-link" href={url} target="_blank" rel="noreferrer">
              {url.replace(/^https?:\/\/(dx\.)?doi\.org\//, "doi:")}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}

/**
 * Marks the contents entry for the section currently being read.
 *
 * A page this long is unusable without it, and `aria-current` is the only cue a screen reader
 * can follow. The LAST visible section in document order wins: the attribution section
 * contains the groups, so "first visible" would pin the highlight on the parent for the whole
 * credit roll. Where `IntersectionObserver` is unavailable (jsdom, older browsers) the first
 * entry stays current rather than the page throwing.
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
        const next = [...ids].reverse().find((id) => visible.has(id));
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
   * A click is authoritative for the moment it scrolls: smooth scrolling passes every section
   * in between, and the observer would otherwise highlight each one on the way.
   */
  const noteNavigation = useCallback((id: string) => {
    setClickedId(id);
    setObservedId(id);
  }, []);

  return [clickedId ?? observedId, noteNavigation];
}

/**
 * Clipboard writes with a stated outcome.
 *
 * Over plain HTTP the Clipboard API is absent and `navigator.clipboard.writeText` throws
 * synchronously; a rejected write fails asynchronously. Both land in `failed`, so a control
 * never silently does nothing.
 */
function useCopy<K extends string>() {
  const [copied, setCopied] = useState<K | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, which: K) => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(which);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setCopied((current) => (current === which ? null : current));
      }, 2200);
    } catch {
      setCopied(null);
      setFailed(true);
    }
  }, []);

  return { copied, failed, copy };
}

/** Copy icon that cross-fades to a check; both glyphs stay mounted so the swap can interrupt. */
function CopyGlyph({ done }: { done: boolean }) {
  return (
    <span className="about-copy-icon" aria-hidden="true">
      <motion.span
        className="about-copy-glyph"
        animate={{ opacity: done ? 0 : 1, scale: done ? 0.25 : 1, filter: done ? "blur(4px)" : "blur(0px)" }}
        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
      >
        <Copy className="w-3.5 h-3.5" />
      </motion.span>
      <motion.span
        className="about-copy-glyph about-copy-glyph-live"
        animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.25, filter: done ? "blur(0px)" : "blur(4px)" }}
        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
      >
        <Check className="w-3.5 h-3.5" />
      </motion.span>
    </span>
  );
}

/** A credit group's title: the one serif rank inside the attribution panel. */
function GroupHeading({ children, id, count }: { children: React.ReactNode; id: string; count: number | string }) {
  return (
    <h3 id={id} className="about-group-title">
      {children}
      <span className="about-section-count">{count}</span>
    </h3>
  );
}

/**
 * One numbered About section, in the workspace's panel grammar (the Variant query composer is the
 * reference): a header strip carrying the index and the title, then a bright body. The section id
 * stays on the outer element, so the contents list and deep links land on the panel's top edge.
 */
function AboutPanel({
  id,
  index,
  title,
  count,
  blurb,
  children
}: {
  id: string;
  index: number;
  title: React.ReactNode;
  count?: number | string;
  blurb?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="about-section about-panel" aria-labelledby={titleId}>
      <div className="about-panel-head">
        <span className="workbench-index" aria-hidden="true">{String(index).padStart(2, "0")}</span>
        <h2 id={titleId} className="about-section-title">
          {title}
          {count !== undefined && <span className="about-section-count">{count}</span>}
        </h2>
      </div>
      <div className="about-panel-body">
        {blurb && <p className="about-section-blurb">{blurb}</p>}
        {children}
      </div>
    </section>
  );
}

interface KeyValueRow {
  label: string;
  value: string;
  /** Full value for the tooltip when the visible one is shortened. */
  title?: string;
  href?: string;
  /** Credit id that explains why this value is not established by the code. */
  caveat?: string;
}

/**
 * One label/value row per line, hairline-separated — the same reading grammar the
 * VariantHeader uses for its identifier meta line, rather than boxed table chrome. Each row
 * has exactly two children (label, value) so the value can never drift away from its label.
 */
function KeyValueRows({ rows }: { rows: KeyValueRow[] }) {
  return (
    <div className="about-kv">
      {rows.map((row) => {
        const valueClass = `about-kv-value${row.caveat ? " about-kv-value-caveat" : ""}`;
        const content = (
          <>
            {row.caveat && (
              <AlertTriangle className="about-kv-flag" aria-label="Not established by the code" />
            )}
            <span className="about-kv-text">{row.value}</span>
          </>
        );
        return (
          <div key={row.label} className="about-kv-row">
            <span className="about-kv-label">{row.label}</span>
            {row.href || row.caveat ? (
              <a
                className={`${valueClass} about-kv-link`}
                href={row.href ?? `#credit-${row.caveat}`}
                title={row.caveat ? `${row.title ?? row.value} — declared, not established. See the credit.` : row.title ?? row.value}
                {...(row.href ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                {content}
              </a>
            ) : (
              <span className={valueClass} title={row.title ?? row.value}>
                {content}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One credited third party.
 *
 * The order inside a row is deliberate: who it is and how to reach it, then what this
 * workspace uses it FOR, then the facts that make the credit auditable — the release that was
 * actually in force, the citation, and (one click away) the files in this repository that
 * call it.
 */
function CreditEntry({ entry }: { entry: AttributionEntry }) {
  const host = creditHost(entry.url);
  const [copiedLink, setCopiedLink] = useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const handleCopyLink = useCallback(async () => {
    const anchorUrl = `${window.location.origin}${window.location.pathname}#credit-${entry.id}`;
    let success = false;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(anchorUrl);
        success = true;
      } catch {
        success = false;
      }
    }
    if (!success && typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = anchorUrl;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        success = false;
      }
    }
    if (success) {
      setCopiedLink(true);
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedLink(false), 2000);
    }
  }, [entry.id]);

  return (
    <li id={`credit-${entry.id}`} className="about-credit">
      <div className="about-credit-top">
        <h4 className="about-credit-name">
          <a
            className="about-credit-link"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`${entry.name} — ${host} (opens in a new tab)`}
          >
            {entry.name}
            <ArrowUpRight className="about-credit-arrow" aria-hidden="true" />
          </a>
          <button
            type="button"
            className={`about-credit-anchor-btn${copiedLink ? " about-credit-anchor-copied" : ""}`}
            onClick={handleCopyLink}
            title={copiedLink ? "Deep link copied" : `Copy deep link to ${entry.name}`}
            aria-label={copiedLink ? "Deep link copied" : `Copy link to ${entry.name}`}
          >
            {copiedLink ? <Check className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
          </button>
        </h4>
        <span className={`about-kind about-kind-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
        <span className="about-credit-host" aria-hidden="true">{host}</span>
      </div>

      <p className="about-credit-role">{entry.role}</p>

      <dl className="about-credit-facts">
        <div className="about-fact">
          <dt className="about-meta-label">Provider</dt>
          <dd>{entry.provider}</dd>
        </div>
        <div className="about-fact">
          <dt className="about-meta-label">Release</dt>
          <dd>
            {entry.release
              ? <span className="font-mono about-meta-value">{entry.release}</span>
              : <span className="about-meta-unpinned">not pinned by this workspace</span>}
            {entry.releaseNote && <span className="about-release-note">{entry.releaseNote}</span>}
          </dd>
        </div>
      </dl>

      {entry.licence && (
        <p className="about-credit-note">
          <Info className="about-credit-icon" aria-hidden="true" />
          <span>{entry.licence}</span>
        </p>
      )}

      <p className={`about-credit-cite${entry.citation ? "" : " about-credit-cite-empty"}`}>
        <BookOpen className="about-credit-icon" aria-hidden="true" />
        <span>
          <span className="about-meta-label">Cite</span>{" "}
          {entry.citation
            ? <LinkedText text={entry.citation} />
            : "no formal citation is published for this service — the link above is the reference."}
        </span>
      </p>

      <details className="about-credit-used">
        <summary>
          <ChevronRight className="about-disclosure-chevron" aria-hidden="true" />
          <GitBranch className="about-credit-icon" aria-hidden="true" />
          <span className="about-meta-label">Called from</span>
          <span className="about-used-count">
            {entry.usedBy.length} {entry.usedBy.length === 1 ? "file" : "files"}
          </span>
        </summary>
        <ul className="about-used-list">
          {entry.usedBy.map((path) => (
            <li key={path}><code>{path}</code></li>
          ))}
        </ul>
      </details>
    </li>
  );
}

const TOPIC_PRESETS = [
  { label: "Structure 3D", query: "structure" },
  { label: "Biophysics", query: "stability" },
  { label: "Predictors", query: "predictor" },
  { label: "Genomics", query: "genom" },
  { label: "Clinical", query: "clin" }
] as const;

/**
 * Filter bar for the credit roll: a text query, a kind filter, and a bibliography copy for
 * whatever is currently shown. Fifty-odd entries is a list a reader searches, not one they
 * read top to bottom.
 */
function CreditToolbar({
  query,
  onQuery,
  kind,
  onKind,
  kindCounts,
  shown,
  citations
}: {
  query: string;
  onQuery: (value: string) => void;
  kind: AttributionKind | "all";
  onKind: (value: AttributionKind | "all") => void;
  kindCounts: Record<AttributionKind | "all", number>;
  shown: number;
  citations: string[];
}) {
  const inputId = useId();
  const { copied, failed, copy } = useCopy<"bib">();
  const filtering = query.trim() !== "" || kind !== "all";

  return (
    <div className="about-toolbar" role="search" aria-label="Filter credited sources">
      <div className="about-toolbar-row">
        <div className="about-filter">
          <Search className="about-filter-icon" aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            aria-label="Filter sources"
            className="about-filter-input"
            placeholder="Filter by name, provider, role or file…"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                onQuery("");
              }
            }}
          />
          {query && (
            <button type="button" className="about-filter-clear" onClick={() => onQuery("")} aria-label="Clear filter">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="cs-btn-ghost about-copy-btn"
          disabled={citations.length === 0}
          onClick={() => copy(citations.join("\n\n"), "bib")}
          title={filtering ? "Copy the citations of the sources shown" : "Copy every citation on this page"}
        >
          <CopyGlyph done={copied === "bib"} />
          {copied === "bib"
            ? `${citations.length} citations copied`
            : filtering
              ? `Copy ${citations.length} citations`
              : "Copy all citations"}
        </button>
      </div>
      <div className="about-toolbar-row">
        <div className="about-kind-filter" role="group" aria-label="Kind of source">
          {(["all", ...KIND_ORDER] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="about-kind-pill"
              aria-pressed={kind === value}
              onClick={() => onKind(value)}
            >
              {value === "all" ? "All" : KIND_LABELS[value]}
              <span className="about-kind-pill-count">{kindCounts[value]}</span>
            </button>
          ))}
        </div>
        <div className="about-topic-chips" role="group" aria-labelledby="about-topic-chips-label">
          <span id="about-topic-chips-label" className="about-topic-chips-label">Topics</span>
          {TOPIC_PRESETS.map((preset) => {
            const isActive = query.toLowerCase() === preset.query.toLowerCase();
            return (
              <button
                key={preset.label}
                type="button"
                className="about-topic-chip"
                data-active={isActive}
                aria-pressed={isActive}
                onClick={() => onQuery(isActive ? "" : preset.query)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <span className="about-toolbar-status" role="status" aria-live="polite">
          {failed
            ? "Copy failed — select the citations instead."
            : filtering
              ? `Showing ${shown} of ${ATTRIBUTION_ENTRY_COUNT}`
              : " "}
        </span>
      </div>
    </div>
  );
}

/**
 * The citation block.
 *
 * Copying is the whole point, so the control reports three states — idle, copied, and failed
 * — and the failure is stated in words rather than swallowed.
 */
function CitationBlock() {
  const { copied, failed, copy } = useCopy<"plain" | "bibtex">();

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
          <CopyGlyph done={copied === "bibtex"} />
          {copied === "bibtex" ? "BibTeX copied" : "Copy BibTeX"}
        </button>
        <button
          type="button"
          className="cs-btn-ghost about-copy-btn"
          onClick={() => copy(WORKSPACE_CITATION.plain, "plain")}
        >
          <CopyGlyph done={copied === "plain"} />
          {copied === "plain" ? "Reference copied" : "Copy reference"}
        </button>
        <span className="about-copy-status" role="status" aria-live="polite">
          {failed ? "Copy failed — select the text above instead." : " "}
        </span>
      </div>
    </div>
  );
}

/**
 * About view — the workspace guide, the third-party credit roll and the research-use framing.
 *
 * The credits come from `shared/attributions.ts`, so a provider, a release or a citation is
 * corrected in one place and the recorded call sites stay beside the claim. The workspace map
 * reads the sidebar's own registry, so it cannot describe a navigation that no longer exists.
 */
interface AboutViewProps {
  onOpenOnboarding?: () => void;
  /** When supplied, the workspace map's views become links into the workspace. */
  onNavigateToView?: (view: MasterView) => void;
}

export default function AboutView({ onOpenOnboarding, onNavigateToView }: AboutViewProps = {}) {
  const { version } = useDiagnostics();
  const { openSettingsTab } = useSettings();
  const sectionIds = useMemo(() => CONTENTS.map((entry) => entry.id), []);
  const [activeId, noteNavigation] = useActiveSection(sectionIds);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AttributionKind | "all">("all");
  const needle = query.trim().toLowerCase();

  const matchesQuery = useCallback(
    (entry: AttributionEntry) => !needle || (HAYSTACKS.get(entry.id) ?? "").includes(needle),
    [needle]
  );
  const visibleIds = useMemo(
    () =>
      new Set(
        ALL_ENTRIES.filter((entry) => (kind === "all" || entry.kind === kind) && matchesQuery(entry)).map(
          (entry) => entry.id
        )
      ),
    [kind, matchesQuery]
  );
  const kindCounts = useMemo(() => {
    const counts = { all: 0, dataset: 0, model: 0, service: 0, software: 0 } as Record<
      AttributionKind | "all",
      number
    >;
    for (const entry of ALL_ENTRIES) {
      if (!matchesQuery(entry)) continue;
      counts.all += 1;
      counts[entry.kind] += 1;
    }
    return counts;
  }, [matchesQuery]);
  const visibleCitations = useMemo(
    () => [
      ...new Set(
        ALL_ENTRIES.filter((entry) => visibleIds.has(entry.id) && entry.citation).map(
          (entry) => entry.citation as string
        )
      )
    ],
    [visibleIds]
  );
  const filtering = needle !== "" || kind !== "all";
  const activeInCredits = GROUP_IDS.has(activeId);

  const versionLabel = `v${version?.version || "1.0.0"}${version?.env ? ` · ${version.env}` : ""}`;

  return (
    <div className="about-view">
      <div className="about-shell">
        {/* ── Page heading: the same framing as "Analyse a variant." ── */}
        <header className="about-masthead">
          <div className="about-masthead-row">
            <div className="about-mark" aria-hidden="true">
              <BrandMark size={40} />
            </div>
            <div className="min-w-0">
              <h1 className="about-title">
                About Missense &amp; Fold<span aria-hidden="true">.</span>
              </h1>
              <p className="about-tagline">
                A structural exploration workspace for human missense variants: what it is built on,
                where a query is sent, and how to cite it.
              </p>
            </div>
          </div>
          <div className="about-stats">
            <div className="about-stat">
              <span className="about-stat-label">Version</span>
              <span className="about-stat-value font-mono">{versionLabel}</span>
            </div>
            <a className="about-stat about-stat-link" href="#about-credits" onClick={() => noteNavigation("about-credits")}>
              <span className="about-stat-label">Sources credited</span>
              <span className="about-stat-value">{ATTRIBUTION_ENTRY_COUNT}</span>
            </a>
            <a className="about-stat about-stat-link" href="#about-transmission" onClick={() => noteNavigation("about-transmission")}>
              <span className="about-stat-label">External hosts</span>
              <span className="about-stat-value">{DISCLOSED_HOST_COUNT}</span>
            </a>
            <a className="about-stat about-stat-link about-stat-warn" href="#about-disclaimer" onClick={() => noteNavigation("about-disclaimer")}>
              <span className="about-stat-label">Intended use</span>
              <span className="about-stat-value">
                <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                Research only
              </span>
            </a>
          </div>
        </header>

        <div className="about-layout">
          {/* ── Left column: the reading column ── */}
          {/* Not a <main>: the app shell already provides the page's one main landmark. */}
          <div className="about-prose">
            <AboutPanel id="about-overview" index={1} title="What this workspace is">
              <div className="about-lede-pair">
              <p className="about-lede">
                Give Missense &amp; Fold a gene and an HGVS protein notation, and it resolves the
                variant's protein context — structure, energetics, splicing, conservation — then
                assembles the clinical evidence into an interpretation you can trace back to its
                sources.
              </p>
              <p className="about-lede">
                Each exported report carries a provenance manifest: the data-source releases, model
                revisions and service states behind that one run. This page covers the rest —
                everything the workspace depends on, where a query is sent, and who to credit.
              </p>
              </div>
            </AboutPanel>

            <AboutPanel
              id="about-workflow"
              index={2}
              title="Workspace map"
              blurb="Follow the workflow from a variant query to evidence, modelling and interpretation."
            >
              <ol className="about-zones">
                {WORKSPACE_ZONES.map((zone) => (
                  <li key={zone.id} className="about-zone">
                    <div className="about-zone-head">
                      {zone.index && (
                        <span className="about-zone-index" aria-hidden="true">
                          {zone.index}
                        </span>
                      )}
                      <h3 className="about-zone-name">{zone.title}</h3>
                    </div>
                    {ZONE_PURPOSE[zone.id] && <p className="about-zone-desc">{ZONE_PURPOSE[zone.id]}</p>}
                    <ul className="about-zone-views">
                      {zone.items.map((item) => {
                        const subItems = VIEW_SUB_ITEMS[item.id];
                        const navigable = Boolean(onNavigateToView) && item.id !== "about";
                        const body = (
                          <>
                            {/* The glyph is aria-hidden inside the registry; the label carries the name. */}
                            <item.Icon className="about-view-icon" />
                            <span className="min-w-0">
                              <span className="about-view-label">{item.label}</span>
                              {item.sublabel && <span className="about-view-sub">{item.sublabel}</span>}
                            </span>
                            {navigable && <ArrowUpRight className="about-view-go" aria-hidden="true" />}
                          </>
                        );
                        return (
                          <li key={item.id}>
                            {navigable ? (
                              <button
                                type="button"
                                className="about-view-row about-view-row-link"
                                onClick={() => onNavigateToView?.(item.id)}
                              >
                                {body}
                              </button>
                            ) : (
                              <div className="about-view-row">{body}</div>
                            )}
                            {subItems && (
                              <p className="about-view-tabs">
                                {subItems.map((sub) => sub.label).join(" · ")}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            </AboutPanel>

            {/* ── Attribution & acknowledgments ── */}
            <AboutPanel
              id="about-credits"
              index={3}
              title={<>Attribution &amp; acknowledgments</>}
              count={ATTRIBUTION_ENTRY_COUNT}
              blurb={
                  <>
                    Missense &amp; Fold is a composition: the models, databases and services below
                    were built by other groups and are used under their own terms. Each entry names
                    who maintains it, what the workspace uses it for, the release in force — or says
                    plainly that none is pinned — the citation to use, and the file in this
                    repository that calls it, so every claim can be checked rather than taken on
                    faith.
                  </>
                }
              >
              <CreditToolbar
                query={query}
                onQuery={setQuery}
                kind={kind}
                onKind={setKind}
                kindCounts={kindCounts}
                shown={visibleIds.size}
                citations={visibleCitations}
              />

              {filtering && visibleIds.size === 0 && (
                <div className="about-empty" role="note">
                  <p>No credited source matches{needle ? <> “{query.trim()}”</> : null}{kind !== "all" ? ` among ${KIND_LABELS[kind].toLowerCase()} sources` : ""}.</p>
                  <button
                    type="button"
                    className="cs-btn-ghost"
                    onClick={() => {
                      setQuery("");
                      setKind("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}

              {ATTRIBUTION_GROUPS.map((group) => {
                const entries = group.entries.filter((entry) => visibleIds.has(entry.id));
                // A group with no matches stays mounted, collapsed to its heading, so the
                // contents link pointing at it never becomes a dead anchor.
                const hidden = filtering && entries.length === 0;
                return (
                  <section
                    key={group.id}
                    id={group.id}
                    className={`about-group${hidden ? " about-group-empty" : ""}`}
                    aria-labelledby={`${group.id}-title`}
                  >
                    <GroupHeading
                      id={`${group.id}-title`}
                      count={filtering ? `${entries.length} / ${group.entries.length}` : group.entries.length}
                    >
                      {group.title}
                    </GroupHeading>
                    {hidden ? (
                      <p className="about-group-blurb">No matches in this group.</p>
                    ) : (
                      <>
                        <p className="about-group-blurb">{group.blurb}</p>
                        <ul className="about-credits">
                          {entries.map((entry) => (
                            <CreditEntry key={entry.id} entry={entry} />
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                );
              })}
            </AboutPanel>

            {/* ── Where a query is sent ── */}
            <AboutPanel
              id="about-transmission"
              index={4}
              title="Where a query is sent"
              count={DISCLOSED_HOST_COUNT}
              blurb={QUERY_TRANSMISSION.blurb}
            >
              <dl className="about-hosts">
                {QUERY_TRANSMISSION.hosts.map((host) => (
                  <div key={host.host} className="about-host">
                    <dt className="about-host-names">
                      {host.host.split("·").map((name) => (
                        <code key={name} className="about-host-name">{name.trim()}</code>
                      ))}
                    </dt>
                    <dd className="about-host-body">
                      <p className="about-host-sent">{host.sent}</p>
                      {host.note && <p className="about-host-note">{host.note}</p>}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="about-note-inline">
                <Info className="about-credit-icon" aria-hidden="true" />
                <span>
                  Caching runs ahead of most of this: a resolved variant is stored in a local cache
                  and re-analysis is answered from it, so repeating a query does not repeat the
                  third-party requests. The caches can be inspected and cleared under{" "}
                  <button type="button" className="about-inline-link" onClick={() => openSettingsTab("data")}>
                    Settings → Data
                  </button>
                  .
                </span>
              </p>
            </AboutPanel>

            {/* ── How to cite ── */}
            <AboutPanel
              id="about-citation"
              index={5}
              title="How to cite this workspace"
              blurb="One entry for this workspace. A report produced here also rests on the sources credited above — cite the ones the run actually used; its exported provenance manifest names them."
            >
              <CitationBlock />
            </AboutPanel>

            {/* ── Research-use disclaimer ── */}
            <section id="about-disclaimer" className="about-section about-section-last" aria-labelledby="about-disclaimer-title">
              <div className="about-disclaimer" role="note">
                <div className="about-disclaimer-head">
                  <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <h2 id="about-disclaimer-title" className="about-disclaimer-title">
                    Research use only
                  </h2>
                </div>
                <div className="about-lede-pair">
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
              </div>
            </section>
          </div>

          {/* ── Right column: contents and the provenance rail (sticky on wide screens) ── */}
          <aside className="about-rail" aria-label="On this page and run provenance">
            <nav className="about-rail-panel about-toc" aria-label="On this page">
              <h2 className="about-rail-head">On this page</h2>
              <ol className="about-toc-list">
                {CONTENTS.map((entry) => (
                  <li key={entry.id} data-level={entry.level}>
                    <a
                      className="about-toc-link"
                      href={`#${entry.id}`}
                      aria-current={activeId === entry.id ? "true" : undefined}
                      data-within={entry.id === "about-credits" && activeInCredits ? "true" : undefined}
                      onClick={() => noteNavigation(entry.id)}
                    >
                      <span className="about-toc-label">{entry.label}</span>
                      {entry.count !== undefined && <span className="about-toc-count">{entry.count}</span>}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="about-rail-panel">
            <h2 className="about-rail-head">Run provenance</h2>
            <section className="about-rail-section" aria-labelledby="about-rail-models">
              <h3 id="about-rail-models" className="about-rail-title">Pinned model revisions</h3>
              <p className="about-rail-hint">
                Weights are pinned so a result can be re-derived later; one run's pins are copied
                into its exported manifest.
              </p>
              <KeyValueRows
                rows={MODEL_REVISIONS.map(([id, rev]) => ({
                  label: rev.model,
                  value: rev.commitSha ? `@${rev.commitSha.slice(0, 10)}` : rev.weights || id,
                  title: rev.commitSha ?? rev.weights,
                  href: rev.commitSha ? `https://huggingface.co/${rev.model}/tree/${rev.commitSha}` : undefined
                }))}
              />
            </section>

            <section className="about-rail-section" aria-labelledby="about-rail-sources">
              <h3 id="about-rail-sources" className="about-rail-title">Manifest data sources</h3>
              <p className="about-rail-hint">
                The release strings an export declares.{" "}
                <AlertTriangle className="about-kv-flag about-kv-flag-inline" aria-hidden="true" /> marks
                a string the code does not establish — its credit explains why.
              </p>
              <KeyValueRows
                rows={DATA_SOURCES.map(([id, release]) => ({
                  label: DATA_SOURCE_LABELS[id] || id,
                  value: release,
                  caveat: DATA_SOURCE_CAVEATS[id]
                }))}
              />
            </section>

            <div className="about-actions">
              {onOpenOnboarding && (
                <button
                  type="button"
                  className="cs-btn-ghost active:scale-[0.97] transition-transform duration-150"
                  onClick={onOpenOnboarding}
                >
                  <Compass className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" aria-hidden="true" />
                  Take the tour
                </button>
              )}
              <a href={APP_REPOSITORY} target="_blank" rel="noreferrer" className="cs-btn-ghost">
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                Repository
              </a>
              <button
                type="button"
                className="cs-btn-ghost active:scale-[0.97] transition-transform duration-150"
                onClick={() => openSettingsTab("data")}
              >
                <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                Manage data &amp; caches
              </button>
            </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
