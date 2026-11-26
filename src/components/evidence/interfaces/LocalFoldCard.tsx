import { useRef, useState } from "react";
import { Download, ExternalLink, Upload } from "lucide-react";
import type { InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { downloadBlob } from "../../../lib/download";
import { LOCALFOLD_EGRESS_NOTE, LOCALFOLD_MAX_RESIDUES, LOCALFOLD_MAX_UPLOAD_BYTES, LOCALFOLD_MSA_NOTE, LOCALFOLD_URL } from "../../../shared/multimerHandoff";
import type { MultimerHandoff } from "../../../shared/contracts";

/**
 * LocalFold: the same Boltz-2 fold, free, on the reader's GPU. localfold.org has no API, so the hand-off
 * is a job file out and a PDB back.
 *
 * WHAT CHANGED (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, H3). One button used to open LocalFold first and
 * download the job ~1.4 s later into the tab the reader had just left, with the size warning after both,
 * and its instructions never said that "Load job JSON…" is an item of LocalFold's MSA menu. ABCG1's
 * 1,356-residue dimer was offered although a browser fold of that size is not expected to finish. Now the
 * size is checked before anything is offered, and the hand-off is three numbered steps, each its own
 * control: save the file, open LocalFold, load the model back. The card is keyed by variant by its
 * parent, so nothing said about one variant survives onto the next.
 */
interface LocalFoldProps {
  ev: InterfacesEvidence;
  requestHandoff: () => Promise<MultimerHandoff | null>;
  importModel: (pdb: string) => Promise<boolean>;
  handoffBusy: boolean;
  importBusy: boolean;
  error: string | null;
}

export function LocalFoldCard({ ev, requestHandoff, importModel, handoffBusy, importBusy, error }: LocalFoldProps) {
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const { model } = ev;

  const saveJob = async () => {
    if (handoffBusy) return;
    const handoff = await requestHandoff();
    if (!handoff) return;
    downloadBlob(handoff.filename, "application/json", handoff.jobJson);
    setNote(`Saved ${handoff.filename} (${handoff.residues} residues across ${ev.chains.length} chains). If it does not appear, allow downloads for this page.`);
  };

  const loadFile = async (file: File | undefined) => {
    if (!file || importBusy) return;
    if (file.size > LOCALFOLD_MAX_UPLOAD_BYTES) {
      setNote(`That file is ${Math.round(file.size / 1e6)} MB; this reader takes up to ${LOCALFOLD_MAX_UPLOAD_BYTES / 1e6} MB. Save the folded PDB, not LocalFold's .zip archive.`);
      return;
    }
    // `Blob.text()` settles on the microtask queue, so the control does not sit busy behind an IO callback.
    const read = await importModel(await file.text());
    setNote(read ? `Read ${file.name}. Its contacts are the model's, measured here as heavy-atom contacts within 4.5 Å.` : null);
  };

  const loadButton = (label: string) => (
    <button type="button" className="ifc-link" onClick={() => { if (!importBusy) input.current?.click(); }} aria-busy={importBusy || undefined} aria-disabled={importBusy || undefined}>
      <Upload className="w-3 h-3" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="ifc-local-fold" data-testid="local-fold">
      <p className="ifc-local-fold__title">{model.browserFoldable ? "Fold it yourself, free, with LocalFold" : "LocalFold, the free browser fold"}</p>
      {model.browserFoldable ? (
        <>
          <ol className="ifc-steps">
            <li>
              <button type="button" className="ifc-link" onClick={() => { void saveJob(); }} aria-busy={handoffBusy || undefined} aria-disabled={handoffBusy || undefined}>
                <Download className="w-3 h-3" aria-hidden="true" />
                Save the job file
              </button>
              <span>{model.residues ? `${model.residues.toLocaleString("en-GB")} residues, chains ${ev.chains.map(c => c.id).join(" and ")}; the variant is on A.` : "The chains this assembly folds; the variant is on A."}</span>
            </li>
            <li>
              <a className="ifc-link" href={LOCALFOLD_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                Open LocalFold
              </a>
              <span>{LOCALFOLD_MSA_NOTE} Check the model is Boltz-2, then fold.</span>
            </li>
            <li>
              {loadButton("Load a model from LocalFold")}
              <span>Press PDB in LocalFold and load that file here.</span>
            </li>
          </ol>
          <p className="ifc-local-fold__note">{LOCALFOLD_EGRESS_NOTE}</p>
        </>
      ) : (
        <p className="ifc-local-fold__note">
          Not offered for this complex: {model.residues?.toLocaleString("en-GB")} residues, more than the roughly {LOCALFOLD_MAX_RESIDUES} past which a browser fold is not expected to finish.
          That limit is an extrapolation from the device memory LocalFold's published benchmarks report for larger complexes, not a measured cutoff. A PDB of these chains folded elsewhere can still be read: {loadButton("Load a model (PDB)")}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept=".pdb,.ent,text/plain"
        hidden
        aria-label="A PDB model saved from LocalFold"
        onChange={event => {
          const file = event.target.files?.[0];
          // Cleared before the read, so picking the same file again fires a change event.
          event.target.value = "";
          void loadFile(file);
        }}
      />
      {/* Mounted empty and filled on change, so assistive technology announces the transition. */}
      <p className="sr-only" role="status" aria-live="polite">{note ?? ""}</p>
      {note && <p className="ifc-local-fold__note" data-testid="local-fold-note">{note}</p>}
      {error && <p className="ifc-local-fold__note" role="alert">{error}</p>}
    </div>
  );
}
