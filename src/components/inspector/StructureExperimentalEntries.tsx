import type { useStructure3dEvidence } from "../../lib/useStructure3dEvidence";

/** The RCSB entries a reader can load on the wild-type canvas instead of the AlphaFold model. Always listed. */
export function StructureExperimentalEntries({ experimental, setCustomPdbUrl }: {
  experimental: ReturnType<typeof useStructure3dEvidence>["experimental"];
  setCustomPdbUrl: (url: string | null) => void;
}) {
  return (
    <>
      <ul className="s3d-entries" data-testid="structure-entries">
        {experimental.rows.map(row => (
          <li key={row.pdbId} className="s3d-entry" data-loaded={row.loaded || undefined}>
            <span className="s3d-entry__id">
              {row.pdbId}
              {experimental.best?.pdbId === row.pdbId && <span className="s3d-entry__tag">closest covering entry</span>}
            </span>
            <button
              type="button" className="s3d-entry__load" aria-pressed={row.loaded}
              onClick={() => setCustomPdbUrl(row.loaded ? null : row.url)}
              aria-label={row.loaded ? `Return to the AlphaFold model from PDB ${row.pdbId}` : `Load PDB ${row.pdbId} on the canvas`}
            >{row.loaded ? "Shown" : "Show"}</button>
            <span className="s3d-entry__meta">
              {[
                row.identity === "Not reported" ? "identity not reported" : `identity ${row.identity}`,
                row.range ? `aligned ${row.range}` : "range not reported",
                row.coversSite === "yes" ? "covers the site" : row.coversSite === "no" ? "does not cover the site" : null,
                row.method ? row.method.toLowerCase() : null, row.resolution, row.organism,
              ].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="s3d-empty s3d-dim">{experimental.note}</p>
    </>
  );
}
