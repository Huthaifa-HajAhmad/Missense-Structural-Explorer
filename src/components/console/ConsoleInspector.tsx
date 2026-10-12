import React from "react";
import { Check, Copy, FileText, Terminal, X } from "lucide-react";
import type { ConsoleEntry } from "../../types/devConsole";
import { buildCurl, buildMarkdownReport, effectiveImpact, formatClock, stringifyPayload } from "./consoleUtils";
import { useCopy } from "./useCopy";

interface Props {
  entry: ConsoleEntry;
  onClose: () => void;
}

export function ImpactBadge({ entry }: { entry: Pick<ConsoleEntry, "impact" | "level"> }) {
  const impact = effectiveImpact(entry);
  if (impact === "info") return null;
  const tone = impact === "fatal" ? "danger" : impact === "degraded" ? "warn" : "info";
  return (
    <span className="cx-badge" data-tone={tone}>
      {impact}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{children}</td>
    </tr>
  );
}

function CopyButton({
  label,
  doneLabel,
  icon,
  status,
  onClick,
  title,
}: {
  label: string;
  doneLabel: string;
  icon: React.ReactNode;
  status: "copied" | "failed" | null;
  onClick: () => void;
  title: string;
}) {
  return (
    <button type="button" className="cx-btn" onClick={onClick} title={title}>
      {status === "copied" ? <Check style={{ color: "var(--cs-good)" }} /> : icon}
      <span>{status === "copied" ? doneLabel : status === "failed" ? "Copy failed" : label}</span>
    </button>
  );
}

/** Right-hand detail pane for one log entry: every fact in one scrollable column, no sub-tabs. */
export default function ConsoleInspector({ entry, onClose }: Props) {
  const { copy, status } = useCopy();
  const http = entry.httpMeta;
  const ctx = entry.sessionContext;
  const curl = buildCurl(entry);
  const meta = entry.meta && Object.keys(entry.meta).length > 0 ? Object.entries(entry.meta) : [];

  return (
    <aside className="cx-aside" aria-label="Entry detail inspector">
      <div className="cx-aside-head">
        <span className="dev-console-source-tag" data-source={entry.source}>
          {entry.source}
        </span>
        <span className="cx-mono" style={{ fontWeight: 700, textTransform: "uppercase" }}>
          {entry.level}
        </span>
        <ImpactBadge entry={entry} />
        <span className="cx-mono" style={{ color: "var(--cs-text-muted)" }} title={new Date(entry.timestamp).toISOString()}>
          {formatClock(entry.timestamp)}
          {entry.count > 1 ? ` · ×${entry.count}` : ""}
        </span>
        <span className="cx-spacer" />
        <button type="button" className="cx-icon-btn" onClick={onClose} aria-label="Close entry inspector">
          <X />
        </button>
      </div>

      <div className="cx-aside-body">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <CopyButton
            label="Copy Report"
            doneLabel="Copied report"
            icon={<FileText style={{ color: "var(--cs-text-indigo-on-soft)" }} />}
            status={status("report")}
            onClick={() => copy(buildMarkdownReport(entry), "report")}
            title="Copy as a Markdown bug report"
          />
          {curl && (
            <CopyButton
              label="Copy cURL"
              doneLabel="Copied cURL"
              icon={<Terminal />}
              status={status("curl")}
              onClick={() => copy(curl, "curl")}
              title="Copy as a cURL command"
            />
          )}
          <CopyButton
            label="Copy JSON"
            doneLabel="Copied JSON"
            icon={<Copy />}
            status={status("json")}
            onClick={() => copy(JSON.stringify(entry, null, 2), "json")}
            title="Copy the raw entry"
          />
        </div>

        <section>
          <h4 className="cx-section-title">Message</h4>
          <div className="cx-message">{entry.message}</div>
        </section>

        {http && (
          <section>
            <h4 className="cx-section-title">HTTP exchange</h4>
            <table className="dev-console-meta-table cx-mono">
              <tbody>
                {http.url && (
                  <Row label="Endpoint">
                    <b>
                      {http.method || "GET"} {http.url}
                    </b>
                  </Row>
                )}
                <Row label="Status">
                  {http.status ? `${http.status} ${http.statusText ?? ""}`.trim() : "No response (network failure)"}
                </Row>
                {http.durationMs !== undefined && <Row label="Latency">{http.durationMs}ms</Row>}
                {http.cached && <Row label="Cache">Served from cache</Row>}
              </tbody>
            </table>
            {http.requestBody !== undefined && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 className="cx-section-title" style={{ margin: 0 }}>Request body</h4>
                  <button
                    type="button"
                    className="cx-btn"
                    style={{ padding: "2px 7px", fontSize: 10.5 }}
                    onClick={() => copy(stringifyPayload(http.requestBody), "reqBody")}
                    title="Copy request body"
                  >
                    {status("reqBody") === "copied" ? <Check style={{ width: 11, height: 11, color: "var(--cs-good)" }} /> : <Copy style={{ width: 11, height: 11 }} />}
                    <span>{status("reqBody") === "copied" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <pre className="dev-console-stack-trace">{stringifyPayload(http.requestBody)}</pre>
              </div>
            )}
            {Boolean(http.responseBody) && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 className="cx-section-title" style={{ margin: 0 }}>Response body</h4>
                  <button
                    type="button"
                    className="cx-btn"
                    style={{ padding: "2px 7px", fontSize: 10.5 }}
                    onClick={() => copy(stringifyPayload(http.responseBody), "resBody")}
                    title="Copy response body"
                  >
                    {status("resBody") === "copied" ? <Check style={{ width: 11, height: 11, color: "var(--cs-good)" }} /> : <Copy style={{ width: 11, height: 11 }} />}
                    <span>{status("resBody") === "copied" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <pre className="dev-console-stack-trace">{stringifyPayload(http.responseBody)}</pre>
              </div>
            )}
          </section>
        )}

        {entry.detail && (
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <h4 className="cx-section-title" style={{ margin: 0 }}>Stack trace / detail</h4>
              <button
                type="button"
                className="cx-btn"
                style={{ padding: "2px 7px", fontSize: 10.5 }}
                onClick={() => copy(entry.detail!, "detail")}
                title="Copy detail / stack trace"
              >
                {status("detail") === "copied" ? <Check style={{ width: 11, height: 11, color: "var(--cs-good)" }} /> : <Copy style={{ width: 11, height: 11 }} />}
                <span>{status("detail") === "copied" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <pre className="dev-console-stack-trace">{entry.detail}</pre>
          </section>
        )}

        {meta.length > 0 && (
          <section>
            <h4 className="cx-section-title">Metadata</h4>
            <table className="dev-console-meta-table cx-mono">
              <tbody>
                {meta.map(([k, v]) => (
                  <Row key={k} label={k}>
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </Row>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {ctx && (
          <section>
            <h4 className="cx-section-title">Session when captured</h4>
            <table className="dev-console-meta-table cx-mono">
              <tbody>
                {ctx.gene && (
                  <Row label="Variant">
                    <b>
                      {ctx.gene} {ctx.variant}
                    </b>
                  </Row>
                )}
                {ctx.uniprotId && <Row label="UniProt">{ctx.uniprotId}</Row>}
                {ctx.activeView && <Row label="View">{ctx.activeView}</Row>}
                {ctx.memoryMB ? <Row label="JS heap">~{ctx.memoryMB} MB</Row> : null}
                <Row label="Network">{ctx.online !== false ? "Online" : "Offline"}</Row>
              </tbody>
            </table>
          </section>
        )}
      </div>
    </aside>
  );
}
