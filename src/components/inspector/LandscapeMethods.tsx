import React from "react";
import type { LandscapeMeta } from "../../shared/contracts";
import { provenanceLine } from "../../shared/landscapeEvidence";

import { CALIBRATION_SOURCES, PP3_BP4_CALIBRATION } from "../../shared/thresholds/calibration";

const SOURCES = [
  { label: "REVEL — Ioannidis et al., Am J Hum Genet 2016", doi: "10.1016/j.ajhg.2016.08.016" },
  { label: "AlphaMissense — Cheng et al., Science 2023", doi: "10.1126/science.adg7492" },
  { label: `REVEL bands — ${CALIBRATION_SOURCES[PP3_BP4_CALIBRATION.revel.source].short}`, doi: CALIBRATION_SOURCES[PP3_BP4_CALIBRATION.revel.source].doi },
  { label: `AlphaMissense bands — ${CALIBRATION_SOURCES[PP3_BP4_CALIBRATION.alphaMissense.source].short}`, doi: CALIBRATION_SOURCES[PP3_BP4_CALIBRATION.alphaMissense.source].doi },
  { label: "GERP++ — Davydov et al., PLoS Comput Biol 2010", doi: "10.1371/journal.pcbi.1001025" },
  { label: "phyloP — Pollard et al., Genome Res 2010", doi: "10.1101/gr.097857.109" },
  { label: "dbNSFP — Liu et al., Genome Med 2020", doi: "10.1186/s13073-020-00803-9" }
];

export function LandscapeMethods({ meta }: { meta: LandscapeMeta | null }) {
  return (
      <details className="lsr-sources">
        <summary>Sources & method</summary>
          <section className="flex flex-col gap-2">
            <div className="text-[11px] text-cs-text-secondary leading-snug flex flex-col gap-1.5">
              <span className="font-mono text-[10px]">{provenanceLine(meta)}</span>
              {meta?.window && <span>Scores loaded for residues {meta.window.start}–{meta.window.end}{meta.retrievedAt ? `, retrieved ${new Date(meta.retrievedAt).toLocaleString()}` : ""}.</span>}
                <div className="flex flex-col gap-1.5 pt-2">
                  <span>
                    Each SNV is counted once, on one transcript. REVEL and AlphaMissense are summarised over a residue's
                    missense substitutions; GERP++ and phyloP are averaged over the codon's nucleotides.
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {SOURCES.map((s) => (
                      <li key={s.doi}>
                        <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" className="text-cs-accent-clay hover:underline">
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
            </div>
          </section>
      </details>
  );
}
