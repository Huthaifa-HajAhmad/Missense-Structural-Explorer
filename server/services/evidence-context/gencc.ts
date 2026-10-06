import { geneDiseaseResponseSchema, diseaseFrameKey, type DiseaseFrame, type ContextProvenance } from '../../../src/shared/diseaseFrame.ts';
import { z } from 'zod';

export const GENCC_DOWNLOAD_URL = 'https://thegencc.org/download/action/submissions-export-csv';
export const genccSnapshotSchema = z.object({
  schemaVersion: z.literal(1), provenance: geneDiseaseResponseSchema.shape.provenance.unwrap(),
  rowCount: z.number().int().positive(), genes: z.record(z.string(), z.array(geneDiseaseResponseSchema.shape.frames.element)),
}).superRefine((snapshot, ctx) => {
  const frames = new Set<string>(); const assertions = new Set<string>(); let count = 0;
  for (const [gene, list] of Object.entries(snapshot.genes)) for (const frame of list) {
    if (frame.geneSymbol !== gene || frame.key !== diseaseFrameKey(frame.geneId, frame.diseaseId, frame.inheritance.id) || frames.has(frame.key) || !frame.validity.length) {
      ctx.addIssue({ code: 'custom', message: 'GenCC frame index or identity mismatch' });
    }
    frames.add(frame.key);
    for (const assertion of frame.validity) {
      if (assertions.has(assertion.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate GenCC assertion identity' });
      assertions.add(assertion.id); count++;
    }
  }
  if (count !== snapshot.rowCount) ctx.addIssue({ code: 'custom', message: 'GenCC assertion count mismatch' });
});

/** RFC4180 quoted fields, including embedded newlines and doubled quotes; no line-splitting. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (closedQuote && c !== ',' && c !== '\n' && c !== '\r') throw new Error('Invalid CSV text after closing quote');
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field.length) throw new Error('Invalid CSV quote');
      else { closedQuote = quoted; quoted = !quoted; }
    } else if (c === ',' && !quoted) { row.push(field); field = ''; closedQuote = false; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; closedQuote = false;
    } else field += c;
  }
  if (quoted) throw new Error('Truncated CSV quoted field');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function buildGenccSnapshot(csv: string, provenance: ContextProvenance) {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
  const required = ['uuid', 'gene_curie', 'gene_symbol', 'disease_curie', 'disease_title', 'moi_curie', 'moi_title', 'classification_title', 'submitter_title', 'submitter_curie'];
  if (!header || required.some(name => !header.includes(name)) || new Set(header).size !== header.length) throw new Error('GenCC CSV schema changed');
  const columns = Object.fromEntries(header.map((name, index) => [name, index]));
  const genes: Record<string, DiseaseFrame[]> = Object.create(null);
  const frames = new Map<string, DiseaseFrame>(); const assertionIds = new Set<string>();
  for (const row of rows) {
    if (row.length !== header.length) throw new Error('GenCC CSV row has wrong column count');
    const get = (name: string) => row[columns[name]]?.trim() ?? '';
    const gene = get('gene_symbol'); const geneId = get('gene_curie'); const diseaseId = get('disease_curie'); const moi = get('moi_curie');
    if (!/^HGNC:\d+$/.test(geneId) || !gene || !diseaseId || !moi || !get('uuid')) throw new Error('GenCC assertion lacks identity');
    if (assertionIds.has(get('uuid'))) throw new Error('Duplicate GenCC assertion identity');
    assertionIds.add(get('uuid'));
    const key = diseaseFrameKey(geneId, diseaseId, moi);
    let frame = frames.get(key);
    if (frame && frame.geneSymbol !== gene) throw new Error('GenCC gene symbol conflicts within a stable frame');
    if (!frame) {
      frame = { key, geneId, geneSymbol: gene, diseaseId, label: get('disease_title'), xrefs: [],
        inheritance: { id: moi, label: get('moi_title') }, validity: [], mechanisms: [], suggestedSystems: [] };
      frames.set(key, frame); (genes[gene] ??= []).push(frame);
    }
    const xref = get('disease_original_curie');
    if (xref && xref !== diseaseId && !frame.xrefs.includes(xref)) frame.xrefs.push(xref);
    // Never copy original/submitted OMIM narrative, notes or labels into the snapshot.
    const reportUrl = get('submitted_as_public_report_url');
    frame.validity.push({ id: get('uuid'), level: get('classification_title'),
      submitter: get('submitter_title'), submitterId: get('submitter_curie'),
      evaluatedAt: get('submitted_as_date') || null,
      reportUrl: /^https?:\/\//.test(reportUrl) ? reportUrl : null });
  }
  for (const list of Object.values(genes)) list.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return genccSnapshotSchema.parse({ schemaVersion: 1, provenance, rowCount: rows.length, genes });
}
