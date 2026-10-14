/** Presentation models only. No new classification, cut-points or cross-model normalisation.
 * Every selectable mark resolves to the same record in the figure, records and inspector.
 * Domain overlap is retained as source annotation, never merged into a biological consensus. */
import type { EvidenceChartRow, EvidenceChartModel } from './evidenceComparison';
import type { FunctionEvidence } from './functionEvidence';
import type { ResidueContextEvidence } from './residueContextEvidence';
import { RESIDUE_SCALE_SOURCES } from './residueScales';
import { LM_CAVEAT_TEXT, type PerturbationEvidence } from './perturbationEvidence';

export function functionReadings(ev: FunctionEvidence): (EvidenceChartRow & { reportUrl?: string | null })[] {
  const boxes = [...ev.domains, ...ev.motifs, ...ev.structuralDomains];
  return ev.groups.flatMap(g => g.rows.map(r => {
    const box = boxes.find(d => `match-${d.key}` === r.key);
    return { key: r.key, name: r.name, value: null, valueText: r.residuesText, group: g.label, tone: 'neutral' as const,
      description: r.note ?? `${r.type} annotation`,
      facts: [{ label: 'Residues', value: r.residuesText }, { label: 'Variant position', value: r.covers ? `Includes ${ev.residue}` : `${Math.abs(r.distance)} residues away in sequence` },
        { label: 'Evidence', value: r.evidenceLabel }, { label: 'Source', value: box ? `${box.source} ${box.accession}` : `UniProtKB ${ev.uniprotId}` }],
      notes: [r.detail, r.evidenceCodes.length ? `Evidence codes: ${r.evidenceCodes.join(', ')}` : null,
        ...r.parts.map(p => [p.name, p.note, p.detail, p.citation?.label].filter(Boolean).join(' · ')),
        box ? 'Overlapping database signatures can describe the same region. Track order separates annotations for reading; it is not a physical layer or additional independent evidence.' : null,
        r.group === 'variants' ? 'A reported variant at this position is context; it is not an experimental functional assay.' : 'An annotation alone does not establish pathogenicity. The rule trace below gives the recorded PM1 decision.'].filter((n): n is string => Boolean(n)),
      reportUrl: box?.url ?? r.citation?.url };
  }));
}

export function residueReadings(ev: ResidueContextEvidence): EvidenceChartRow[] {
  const properties: EvidenceChartRow[] = (ev.properties ?? []).map(r => ({ key: r.key, name: r.label, value: null, knowledgeKey: 'residue_properties',
    valueText: `${r.wildTypeNative ?? r.wildTypeValue} → ${r.mutantNative ?? r.mutantValue}${r.unit ? ` ${r.unit}` : ''}`,
    description: r.interpretation, group: 'Residue properties', tone: 'neutral',
    facts: [{ label: ev.pair.wildType, value: `${r.wildTypeNative ?? r.wildTypeValue} ${r.unit}`.trim() },
      { label: ev.pair.mutant, value: `${r.mutantNative ?? r.mutantValue} ${r.unit}`.trim() },
      { label: 'Change', value: r.plainChange }, { label: 'Source', value: RESIDUE_SCALE_SOURCES[r.key].citation }],
    notes: [r.source, 'Each row has its own published scale. Position describes a residue property, not a measured change in this protein or a probability of disease.'] }));
  const rsa = ev.burial?.indicators.rsa;
  return [...properties, { knowledgeKey: 'burial_status', key: 'burial', name: 'Solvent accessibility', value: null, valueText: rsa?.valueLabel ?? 'No result',
    description: ev.burial?.label ?? 'No accessibility reading returned.', group: 'Structural context', tone: 'neutral',
    facts: [{ label: 'Accessibility', value: rsa?.valueLabel ?? 'No result' }, { label: 'Structure', value: ev.burial?.structure ?? 'Not reported' }],
    notes: [ev.burial?.reason, 'The burial cut-points are app-defined. Cα neighbour counts alone do not determine burial.'].filter((n): n is string => Boolean(n)) },
    { knowledgeKey: 'p2rank', key: 'pocket', name: 'Predicted pocket', value: null, valueText: ev.pocket.proximity.distance === null ? ev.pocket.headline : `${ev.pocket.proximity.distance} Å`,
      description: ev.pocket.plainLanguage ?? ev.pocket.headline, group: 'Structural context', tone: 'neutral',
      facts: [{ label: 'Distance', value: ev.pocket.proximity.distance === null ? 'No result' : `${ev.pocket.proximity.distance} Å` }, { label: 'Reference', value: ev.pocket.proximity.reference },
        { label: 'Profile', value: ev.pocket.ranking.profile ?? 'Not reported' }],
      notes: [ev.pocket.bottomLine, ...ev.pocket.caveats, 'A predicted cavity does not establish ligand binding or a functional effect.'].filter((n): n is string => Boolean(n)) }];
}

export function perturbationReadings(ev: PerturbationEvidence): EvidenceChartRow[] {
  return ev.lms.flatMap(l => {
    const model: EvidenceChartRow = { key: l.id, name: l.family, value: l.llr, valueText: l.llr === null ? l.availability.label : l.llr.toFixed(2),
      description: l.description, group: 'Language model', tone: 'neutral',
      knowledgeKey: /vesm/i.test(l.servedBy ?? '') ? 'vesm' : l.id,
      facts: [{ label: 'Served model', value: l.servedBy ?? 'Not reported' }, { label: 'Status', value: l.availability.label },
        { label: 'ΔLLR', value: l.llr === null ? 'No result' : String(l.llr) },
        { label: 'Reference / variant rank', value: `${l.nativeRank ?? '—'} / ${l.rank ?? '—'}` }],
      notes: [l.rankSentence, l.availability.reason, ...l.caveats.map(c => LM_CAVEAT_TEXT[c].detail),
        'ΔLLR compares the variant with the reference within this model. Raw magnitudes from different model families are not a common scale or clinical evidence.'].filter((s): s is string => Boolean(s)) };
    return [model, ...l.preferences.map(p => ({ ...model, key: `${l.id}:${p.aa}`, name: `${l.family} · ${p.aa}`, value: p.prob,
      valueText: String(p.prob), description: `Model probability for amino acid ${p.aa} at residue ${ev.residues.position ?? 'under study'}.`,
      facts: [{ label: 'Amino acid', value: p.aa }, { label: 'Probability', value: String(p.prob) }, { label: 'Served model', value: l.servedBy ?? 'Not reported' }],
      notes: [...model.notes, 'This is a model distribution over amino acids at one position, not the probability that the variant causes disease.'] }))];
  });
}

/** Bound the overview without dropping the reference/variant, renormalising, or changing the axis.
 * Return original row objects so the overview and full distribution have identical source keys. */
export function probabilityOverview(model: EvidenceChartModel, expanded: boolean): EvidenceChartModel {
  if (expanded || model.rows.length <= 8) return model;
  const ranked = [...model.rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const keep = new Set(ranked.slice(0, 6).map(r => r.key));
  for (const row of model.rows) if (row.name.endsWith(' · reference') || row.name.endsWith(' · variant')) keep.add(row.key);
  return { ...model, rows: ranked.filter(r => keep.has(r.key)) };
}

export function residueProbabilityComparison(ev: PerturbationEvidence, modelId: string): EvidenceChartModel {
  const prefix = `${modelId}:`;
  const rows = perturbationReadings(ev).filter(r => r.key.startsWith(prefix)).map(r => {
    const aa = r.key.slice(prefix.length);
    return { ...r, name: `${aa}${aa === ev.residues.wtCode ? ' · reference' : aa === ev.residues.mutCode ? ' · variant' : ''}`,
      valueText: r.value === 0 ? '0%' : r.value !== null && r.value < .0001 ? `${(r.value * 100).toExponential(2)}%` : `${((r.value ?? 0) * 100).toFixed(2)}%`,
      tone: aa === ev.residues.mutCode ? 'accent' as const : 'neutral' as const };
  });
  return { rows, domain: [0, 1], ticks: [0, .25, .5, .75, 1], tickLabels: ['0%', '25%', '50%', '75%', '100%'],
    axisLabel: 'Probability assigned to an amino acid by this model',
    unplottedHeading: 'Not plotted',
    unplottedBody: 'Residues this model gave no returned probability have no mark here; a missing probability is not zero.',
    emptyCopy: 'No amino-acid probabilities were returned for this residue. Inspect the model record below for its own status.',
    summary: `${rows.length} returned amino-acid probabilities at the variant position. Missing residues are not imputed as zero; these values are not disease probabilities.` };
}
