/** Presentation contracts for the splicing and interface workspaces.
 * INVARIANTS: source identities survive filtering; unlike quantities are never combined;
 * selection changes neither the interface verdict nor an ACMG record. A schematic never
 * invents a chain contact or spatial position from an assembly statement.
 */
import type { EvidenceChartRow } from './evidenceComparison';
import { PARTNER_GROUP_LABEL, type InterfacesEvidence } from './interfacesEvidence';
import { variantNumberingView, type NumberingRemapLike } from './numbering';

export function interfaceNumberingNote(result: { metadata?: { variant?: string; uniprotId?: string } | null; numberingRemap?: NumberingRemapLike | null }) {
  const n = variantNumberingView({ variant: result.metadata?.variant ?? '', uniprotId: result.metadata?.uniprotId, numberingRemap: result.numberingRemap });
  return n.basisNote ?? 'UniProt residue numbering. No report-to-canonical remapping record is supplied; matching residue numbers alone do not verify isoform identity.';
}

export const INTERFACE_LAYERS = [
  ['domains', 'Domains & regions'], ['topology', 'Topology'], ['sites', 'Mapped sites'],
  ['native', 'Native interfaces'], ['fibril', 'Fibril contacts'], ['crystal', 'Outside assembly'], ['predicted', 'Predicted contacts'],
] as const;

export const INTERFACE_SUPPORT_ROWS = 6;
export function interfaceSupportGroups(ev: InterfacesEvidence) {
  return [
    { label: 'Native interfaces', kind: 'native', source: ev.observed.partners },
    { label: 'Fibril contacts', kind: 'fibril', source: ev.observed.fibrils },
    { label: 'Outside deposited assembly', kind: 'crystal', source: ev.observed.crystals },
  ].filter(g => g.source.length).map(g => ({ label: g.label, kind: g.kind, total: g.source.length,
    rows: g.source.slice(0, INTERFACE_SUPPORT_ROWS).map(p => ({ ...p, supportPercent: p.n > 0 && Number.isFinite(p.n) && Number.isFinite(p.k) ? Math.max(0, Math.min(100, p.k / p.n * 100)) : null })) }));
}

export function interfaceMapView(ev: InterfacesEvidence, near: boolean, hidden: string[] = []) {
  const length = Math.max(ev.sequenceLength ?? 0, ev.position ?? 0, 10,
    ...ev.track.flatMap(l => [...l.ranges.map(r => r.end), ...l.marks.map(m => m.residue)]));
  const centre = ev.position ?? 1;
  const bounds = near && ev.position !== null ? { start: Math.max(1, centre - 60), end: Math.min(length, centre + 60) } : { start: 1, end: length };
  const layer = (l: InterfacesEvidence['track'][number]) => l.kind !== 'solved' ? l.kind
    : ev.observed.fibrils.some(p => p.key === l.rowKey) ? 'fibril'
    : ev.observed.crystals.some(p => p.key === l.rowKey) ? 'crystal' : 'native';
  const layers = INTERFACE_LAYERS.map(([id, label]) => ({ id, label, count: ev.track.filter(l => layer(l) === id).length })).filter(l => l.count > 0);
  const track = ev.track.filter(l => !hidden.includes(layer(l))).map(l => ({ ...l,
    ranges: l.ranges.filter(r => r.end >= bounds.start && r.start <= bounds.end),
    marks: l.marks.filter(m => m.residue >= bounds.start && m.residue <= bounds.end),
  }));
  return { bounds, layers, evidence: { ...ev, track }, visibleKeys: track.map(l => l.rowKey ?? `track:${l.key}`) };
}

export function interfaceWorkspaceReadings(ev: InterfacesEvidence): EvidenceChartRow[] {
  const rows: EvidenceChartRow[] = ev.track.map(l => ({
    key: l.rowKey ?? `track:${l.key}`, name: l.label, value: null,
    valueText: l.readout ? `${l.readout.k} of ${l.readout.n}` : l.sub,
    description: l.summary, group: 'map', tone: 'neutral',
    facts: [{ label: 'Evidence', value: l.sub }, { label: 'Reference', value: `${ev.uniprotId ?? 'Unresolved accession'} · UniProt numbering` },
      { label: 'Variant residue', value: ev.residueLabel },
      ...(l.readout ? [{ label: 'Structures with this residue at the interface', value: `${l.readout.k} of ${l.readout.n}` }] : []),
      ...l.ranges.map(r => ({ label: r.name, value: `${r.start}–${r.end}` }))],
    notes: [l.kind === 'solved' ? 'Support is the share of returned structures for this partner pair. Structures are not independent experiments.'
      : l.kind === 'predicted' ? 'A contact in the variant model is not a measured contact lost.' : 'An annotated region provides positional context, not a measured binding effect.',
      'Sequence positions must refer to the same protein isoform. Check the reference and any recorded remapping above; matching residue numbers alone do not verify sequence identity.'],
  }));
  // Retain solved partners omitted from the bounded figure, using the same keys as source records.
  for (const p of [...ev.observed.partners, ...ev.observed.fibrils, ...ev.observed.crystals]) {
    if (rows.some(r => r.key === p.key)) continue;
    rows.push({ key: p.key, name: p.label, value: null, valueText: `${p.k} of ${p.n}`, group: 'map', tone: 'neutral',
      description: `${ev.residueLabel}: ${p.k} of ${p.n} structures in this context.`,
      facts: [{ label: 'Accession', value: p.accession }, { label: 'Context', value: p.context ?? 'Not reported' },
        { label: 'Entries containing the interface residue', value: p.variantEntries.join(', ') || 'None returned' }],
      notes: ['Fibril and outside-assembly contacts are read separately from native interfaces.'] });
  }
  for (const g of ev.groups) for (const p of [...g.rows, ...(g.folded?.rows ?? [])]) {
    rows.push({ knowledgeKey: p.physical.score !== null || p.functional.score !== null ? 'string' : 'interfaces', key: `partner:${p.key}`, name: p.gene, value: null, valueText: p.evidence,
      description: p.evidence, group: 'partners', tone: 'neutral',
      facts: [{ label: 'Accession', value: p.accession ?? 'Not supplied' }, { label: 'Evidence tier', value: PARTNER_GROUP_LABEL[p.group].title },
        { label: 'Species qualification', value: p.organism ?? 'No non-human qualification supplied' },
        { label: 'STRING physical', value: p.physical.score === null ? p.physical.note ?? 'No result' : String(p.physical.score) },
        { label: 'STRING functional', value: p.functional.score === null ? p.functional.note ?? 'No result' : String(p.functional.score) },
        { label: 'Mapped sites', value: p.sites.map(s => `${s.start}–${s.end}`).join(', ') || 'None returned' }],
      notes: [p.qualifier, 'Association scores are not binding energies. Different evidence sources can describe the same partner; they are not separate votes.'].filter((s): s is string => Boolean(s)) });
  }
  rows.push({ knowledgeKey: 'boltz2', key: 'complex-model', name: 'Predicted complex', value: ev.model.iptm, valueText: ev.model.iptm === null ? ev.model.stateLabel ?? 'No result' : String(ev.model.iptm),
    description: ev.model.reason ?? 'The returned complex model and its interface confidence.', group: 'model', tone: 'neutral',
    facts: [{ label: 'ipTM', value: ev.model.iptm === null ? 'Not reported' : String(ev.model.iptm) },
      { label: 'pTM', value: ev.model.ptm === null ? 'Not reported' : String(ev.model.ptm) },
      { label: 'Served model', value: ev.model.provenance ?? 'Not reported' }],
    notes: ['Confidence is not binding affinity. Contacts in the variant model do not establish loss of wild-type contacts.'] });
  rows.push({ knowledgeKey: 'ddmut_ppi', key: 'binding-change', name: 'Binding energy change', value: ev.binding.value,
    valueText: ev.binding.valueText ?? ev.binding.stateLabel ?? 'No result', description: ev.binding.reason ?? ev.binding.directionText ?? 'DDMut-PPI on a wild-type complex.', group: 'binding', tone: 'neutral',
    facts: [{ label: 'ΔΔG_bind (kcal/mol)', value: ev.binding.value === null ? 'Not measured' : String(ev.binding.value) },
      { label: 'Wild-type source', value: ev.binding.wildType?.provenance ?? 'Not available' }],
    notes: ['Negative values mean weaker binding under DDMut-PPI’s sign convention. This prediction is not an ACMG input.'] });
  return rows;
}
