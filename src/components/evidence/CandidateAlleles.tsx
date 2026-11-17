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

/** A column header whose description is visible to assistive technology, not only a hover title. */
function HeaderCell({ label, detail, className }: { label: string; detail: string; className?: string }) {
  return (
    <th scope="col" className={className} title={detail}>
      {label}<span className="sr-only"> — {detail}</span>
    </th>
  );
}

/** One allele's All of Us frequency, or which absence it is. Display only: it feeds no criterion. */
function AllOfUsCell({ reading }: { reading: CandidateAlleleRow["allOfUs"] }) {
  if (!reading) return <span className="pop-dim">—</span>;
  if (reading.af !== null) return <span title={reading.counts ? `AC / AN ${reading.counts}` : undefined}>{formatAlleleFrequency(reading.af)}</span>;
  return <span className="pop-dim">{reading.note}</span>;
}

/**
 * The Population tab's readings: allele, gnomAD counts, the frequency PM2 reads, All of Us (when the
 * local store was read), and the allele's verdict.
 */
export function CandidateAlleleTable({ rows }: { rows: CandidateAlleleRow[] }) {
  // A column of the same "not installed" sentence says nothing per allele: it is stated once instead.
  const showAllOfUs = rows.some(r => r.allOfUs?.af != null);
  const allOfUsNotes = showAllOfUs ? [] : [...new Set(rows.flatMap(r => r.allOfUs?.note ? [r.allOfUs.note] : []))];
  return (
    <div className="pop-table-wrap" data-testid="candidate-alleles">
      <table className="pop-table">
        <thead>
          <tr>
            <th scope="col">Candidate allele</th>
            <HeaderCell className="pop-num" label="gnomAD AC / AN" detail="allele count over allele number, across gnomAD exomes and genomes" />
            <HeaderCell className="pop-num" label="gnomAD AF" detail="the frequency PM2 reads for this allele: gnomAD's grouped maximum" />
            {showAllOfUs && <HeaderCell className="pop-num" label="All of Us AF" detail="from the local store; it feeds no criterion" />}
            <HeaderCell label="Supports" detail="what this allele's own reading supports" />
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
                {row.cdna && <span className="pop-subject__note pop-mono">{row.cdna}</span>}
                {row.note && <span className="pop-subject__note">{row.note}</span>}
              </th>
              <td className="pop-num">{row.counts ?? <span className="pop-dim">—</span>}</td>
              <td className="pop-num pop-num--af">{row.af !== null ? formatAlleleFrequency(row.af) : <span className="pop-dim">—</span>}</td>
              {showAllOfUs && <td className="pop-num"><AllOfUsCell reading={row.allOfUs} /></td>}
              <td><DecisionChip decision={row.decision} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {allOfUsNotes.length > 0 && <p className="pop-subject__note">All of Us: {allOfUsNotes.join(" ")}</p>}
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
          {row.allOfUs?.af != null && <> · All of Us <span className="pop-mono">{formatAlleleFrequency(row.allOfUs.af)}</span></>}
          {" "}
          <DecisionChip decision={row.decision} />
        </li>
      ))}
    </ul>
  );
}
