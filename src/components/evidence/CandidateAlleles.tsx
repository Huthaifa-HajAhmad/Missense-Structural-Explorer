/**
 * One row per candidate allele, for a protein-only input that several nucleotide alleles can produce.
 * Each row is that allele's own gnomAD reading and its own verdict; the input's verdict (shown
 * elsewhere) holds only when every row supports it.
 */
import React from "react";
import type { CandidateAlleleRow } from "../../shared/candidateFrequencyEvidence";
import { formatAlleleFrequency } from "../../shared/frequencyEvidence";
import { InspectReadingButton } from "./EvidenceWorkspace";

function DecisionChip({ decision }: { decision: CandidateAlleleRow["decision"] }) {
  if (decision === null) return <span className="pop-dim">No reading</span>;
  if (decision === "none") return <span className="pop-dim">No criterion</span>;
  return (
    <span className="ev-tier chip-code" data-tone={decision === "PM2" ? "danger" : "good"}>
      {decision === "PM2" ? "PM2 · Supporting" : decision}
    </span>
  );
}

/** The Population tab's readings: allele, counts, the frequency PM2 reads, and the allele's verdict. */
export function CandidateAlleleTable({ rows }: { rows: CandidateAlleleRow[] }) {
  return (
    <div className="pop-table-wrap" data-testid="candidate-alleles">
      <table className="pop-table">
        <thead>
          <tr>
            <th scope="col">Candidate allele</th>
            <th scope="col" className="pop-num" title="Allele count / allele number over gnomAD exomes and genomes">AC / AN</th>
            <th scope="col" className="pop-num" title="The frequency PM2 reads for this allele: gnomAD's grouped maximum">AF</th>
            <th scope="col" title="What this allele's own reading supports">Supports</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.key}>
              <th scope="row" className="pop-subject">
                <span className="pop-subject__line">
                  <span className="pop-subject__name pop-mono">
                    <InspectReadingButton tab="clinical" readingKey={`candidate:${row.key}`}>
                      {row.id}
                    </InspectReadingButton>
                  </span>
                  {row.change && <span className="pop-dim">{row.change}</span>}
                </span>
                {row.note && <span className="pop-subject__note">{row.note}</span>}
              </th>
              <td className="pop-num">{row.counts ?? <span className="pop-dim">—</span>}</td>
              <td className="pop-num pop-num--af">{row.af !== null ? formatAlleleFrequency(row.af) : <span className="pop-dim">—</span>}</td>
              <td><DecisionChip decision={row.decision} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The rail's compact form: one line per allele. */
export function CandidateAlleleList({ rows }: { rows: CandidateAlleleRow[] }) {
  return (
    <ul className="rail-candidates" data-testid="rail-candidate-alleles">
      {rows.map(row => (
        <li key={row.key}>
          <span className="pop-mono">{row.id}</span>
          {row.change && <span className="pop-dim"> {row.change}</span>}
          {" · "}
          <span className="pop-mono">{row.af === null ? "no reading" : row.af === 0 ? "no record" : formatAlleleFrequency(row.af)}</span>
          {" "}
          <DecisionChip decision={row.decision} />
        </li>
      ))}
    </ul>
  );
}
