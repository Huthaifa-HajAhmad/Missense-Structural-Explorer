# Capture diagnostics

## The 720,000 ms timeouts

`tools/capture.mjs:280?285` waits for a **visible button whose accessible name matches `/^Evidence .*Complete/`**, with a 12-minute timeout. It does not wait for a particular endpoint response. `meta.analysis.complete=false` therefore means this UI condition was not seen, not that every server calculation hung.

ABCG1_G358R meta records 720027 ms; TP53_K132N records 720014 ms. Both Evidence row texts explicitly say population evidence was not assessed because a unique nucleotide allele was not established. Both run.log files end with timeout, 29 tabs, 8 views, zero capture-step errors; neither meta has API errors. Their stream captures contain `isFinal:true`, and structural captures contain `type:final`, HTTP 200. Final payloads withhold population evidence (unsupported-build) and contain completed criterion results. Thus the 12-minute wait belongs to the harness completion-label condition in an unresolved-allele state, not evidence of an analysis HTTP hang. These final responses do not prove every later background calculation completed. A stopped capture cannot establish eventual completion; report readiness and any remaining computations still need the Release Gate #3 replay.

## HTTP errors

BRCA2_N277K captured three AlphaFold P51587 404s (015, 030, 040): the response says no full-length model because 3,418 residues exceed its stated 2,700-residue single-chain limit. Treat that as the returned service explanation, not an independently tested universal database limit. Generate-mutant 022 returned 422 `NO_STRUCTURE`: no usable structure for residue 277, so structure engines did not run. PDB requests 024, 028, 031, 032, 033 returned 502 `BAD_GATEWAY`: the response says PDBe, AlphaFold EBI and homolog search all failed. These are structure availability failures, not a failed core evidence stream. The captures cannot distinguish upstream outage from absence for every attempted fallback.

MYH7_R787H 012 numbering-proof returned 422 `UNVERIFIED_RESIDUE_NUMBERING`: isoform model unreachable or timed out, so that analysis attempt was refused. The console records the same refusal. Later captured stream/structural responses are 200 with resolved GRCh38 14-23425345-C-T and final evidence. Do not describe the entire capture as analysis never run, or erase the initial refusal. It is a transient numbering check failure followed by later successful captured results; the files do not establish the upstream cause beyond the returned explanation.

## GBA1 symbol check

The sole retired-symbol phrase is `GBA-related disorder` inside the ClinVar condition list at clinical__clinical-assertion.txt:17 and view__report.txt:117. The stream payload's `clinvar.trait` contains that exact condition list, including the old phrase alongside GBA1 conditions. This is source-provided condition text, not the app changing the queried gene label to GBA. The fact-matrix text search is a terminology hit, not proof of a gene-identity defect. Preserve source provenance if displayed; do not silently rewrite the underlying assertion title.

## Verification limits

Checked saved metadata, logs, API responses, tab text and the capture wait code. No live recapture, figure inspection, export replay, keyboard check or independent reviewer sign-off was performed here. Those Release Gate #3/#4 checks remain separate work.
