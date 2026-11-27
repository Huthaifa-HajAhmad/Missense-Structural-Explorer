/** Presentation models only. No new classification, cut-points or cross-model normalisation.
 * Every selectable mark resolves to the same record in the figure, records and inspector.
 * Domain overlap is retained as source annotation, never merged into a biological consensus. */
import type { EvidenceChartRow } from './evidenceComparison';
import type { FunctionEvidence } from './functionEvidence';
import { HOTSPOT_GRADE_LABEL, HOTSPOT_LANE_LABEL, HOTSPOT_NOT_MODELLED_NOTE, HOTSPOT_STATE_WORD, RSA_UNIT_NOTE, hotspotRungKey, isInterfaceUnmodelled, type HotspotEvidence } from './hotspotEvidence';
import type { ResidueContextEvidence } from './residueContextEvidence';
import { RESIDUE_SCALE_SOURCES } from './residueScales';
import { reviewStarsText } from './populationFormat';
import { formatPlddt } from './plddtFormat';

export function hotspotReadings(ev: HotspotEvidence): (EvidenceChartRow & { reportUrl?: string | null })[] {
  if (ev.state !== 'ready') return [];
  const rungs = ev.rungs.map(r => {
    const provenanceFacts =
      r.key === 'per-rerun'
        ? [
            { label: 'Method', value: r.source.label },
            { label: 'Data', value: 'ClinVar and gnomAD v4 in this entry' },
          ]
        : r.key === 'spatial'
          ? [
              { label: 'Method', value: r.source.label },
              { label: 'Data', value: 'ClinVar, gnomAD v4 and AlphaFold DB in this entry' },
            ]
          : [{ label: 'Source', value: r.source.label }];
    return {
      key: hotspotRungKey(r.key),
      name: r.name,
      value: null,
      valueText: HOTSPOT_GRADE_LABEL[r.grade],
      group: 'Hot-spot definitions',
      tone: 'neutral' as const,
      knowledgeKey: r.explain,
      description: r.headline,
      facts: [
        { label: 'Grade', value: HOTSPOT_GRADE_LABEL[r.grade] },
        { label: 'Status', value: HOTSPOT_STATE_WORD[r.state] },
        { label: 'At variant', value: r.atVariant === 'inside' ? `${ev.residueLabel} inside` : r.atVariant === 'outside' ? `${ev.residueLabel} outside` : 'Not applicable' },
        ...provenanceFacts,
      ],
      notes: [...r.details, ev.pm1Note].filter((n): n is string => Boolean(n)),
      reportUrl: r.source.url,
    };
  });
  const cols = ev.columns;
  const distRung = ev.rungs.find(x => x.key === 'distribution');
  const modelName = ev.model ? `${ev.model.entryId}${ev.model.version ? ` ${ev.model.version}` : ''}` : null;
  const rows = ev.rows.map(r => {
    const dist3d =
      r.residue === ev.residue
        ? '0 Å (variant residue)'
        : r.distanceA !== null
          ? `${r.distanceA.toFixed(1)} Å`
          : ev.modelNote
            ? 'Withheld (numbering mismatch)'
            : ev.model
              ? 'Not on the model'
              : 'No model';
    const starsText = r.maxStars === null ? '' : ` · ${reviewStarsText(r.maxStars)}`;
    return {
      key: r.key,
      name: `${r.label} · ClinVar P/LP`,
      value: r.plp,
      valueText: `${r.plp} P/LP`,
      group: 'ClinVar P/LP residues',
      tone: (r.residue === ev.residue ? 'accent' : 'neutral') as 'accent' | 'neutral',
      knowledgeKey: 'hotspots',
      description: `${r.plp} ClinVar P/LP missense variant${r.plp === 1 ? '' : 's'} (${r.changes.join(', ')}).`,
      facts: [
        { label: 'ClinVar P/LP', value: `${r.plp}${starsText}` },
        { label: 'gnomAD missense', value: r.gnomad === null ? 'Not read' : String(r.gnomad) },
        { label: 'Sequence distance', value: r.sequenceDistance === 0 ? `0 (at ${ev.residueLabel})` : `${r.sequenceDistance > 0 ? `+${r.sequenceDistance}` : r.sequenceDistance} from ${ev.residueLabel}` },
        { label: '3D Cα–Cα distance', value: dist3d },
        { label: 'pLDDT', value: r.plddt === null ? 'Not available' : `${formatPlddt(r.plddt)} / 100` },
        { label: 'RSA', value: r.rsa === null ? (cols.rsa.reason ?? 'Not measured') : `${Math.round(r.rsa * 100)}%` },
        { label: 'Sites', value: cols.sites.state !== 'ok' ? (cols.sites.reason ?? 'Not read') : r.sites.length ? r.sites.map(s => `${s.name} (${s.evidence})`).join('; ') : 'None' },
        { label: 'Native interfaces', value: cols.interface.state !== 'ok' ? (cols.interface.reason ?? 'Not read') : r.interfaceSupport.length ? r.interfaceSupport.map(x => `${x.label} (${x.k} of ${x.n} structures)`).join('; ') : isInterfaceUnmodelled(r) ? `Not modelled. ${HOTSPOT_NOT_MODELLED_NOTE}` : 'None' },
        ...(r.pathprox !== null ? [{ label: 'PathProx', value: `${r.pathprox >= 0 ? '+' : ''}${r.pathprox.toFixed(2)} (> 0 favours pathogenic neighbours)` }] : []),
        { label: 'In regions', value: r.inRegions.length ? r.inRegions.map(k => HOTSPOT_LANE_LABEL[k] ?? k).join(', ') : 'None' },
        { label: 'Source', value: distRung?.source.label ?? 'ClinVar germline (via gnomAD v4)' },
        ...(modelName ? [{ label: 'Model', value: modelName }] : []),
      ],
      notes: [
        cols.rsa.state === 'ok' && r.rsa !== null ? RSA_UNIT_NOTE : null,
        ev.modelNote,
        ev.pm1Note,
      ].filter((n): n is string => Boolean(n)),
      reportUrl: ev.model?.url ?? distRung?.source.url ?? null,
    };
  });
  return [...rungs, ...rows];
}

export function functionReadings(ev: FunctionEvidence, hotspots?: HotspotEvidence | null): (EvidenceChartRow & { reportUrl?: string | null })[] {
  const boxes = [...ev.domains, ...ev.motifs, ...ev.structuralDomains];
  const annotations = ev.groups.flatMap(g => g.rows.map(r => {
    const box = boxes.find(d => `match-${d.key}` === r.key);
    // One drawn box stands for every database that models the domain: name them on whichever row is pinned.
    const unit = ev.domainUnits.find(u => u.memberKeys.includes(r.key));
    const agreed = unit && unit.sources.length > 1 && (unit.core.start !== unit.start || unit.core.end !== unit.end)
      ? `The databases agree on residues ${unit.core.start}–${unit.core.end}; only some extend to ${unit.start}–${unit.end}.` : null;
    return { key: r.key, name: r.name, value: null, valueText: r.residuesText, group: g.label, tone: 'neutral' as const,
      description: r.note ?? `${r.type} annotation`,
      facts: [{ label: 'Residues', value: r.residuesText }, { label: 'Variant position', value: r.covers ? `Includes ${ev.residue}` : `${Math.abs(r.distance)} residues away in sequence` },
        { label: 'Evidence', value: r.evidenceLabel }, { label: 'Source', value: box ? `${box.source} ${box.accession}` : `UniProtKB ${ev.uniprotId}` },
        ...(unit ? [{ label: 'Matched by', value: unit.sources.map(s => `${s.source} ${s.accession}`).join(', ') }] : [])],
      notes: [r.detail, agreed, r.evidenceCodes.length ? `Evidence codes: ${r.evidenceCodes.join(', ')}` : null,
        ...r.parts.map(p => [p.name, p.note, p.detail, p.citation?.label].filter(Boolean).join(' · ')),
        box || unit ? 'Overlapping database signatures can describe the same region. Track order separates annotations for reading; it is not a physical layer or additional independent evidence.' : null,
        r.group === 'variants' ? 'A reported variant at this position is context; it is not an experimental functional assay.' : 'An annotation alone does not establish pathogenicity. The rule trace below gives the recorded PM1 decision.'].filter((n): n is string => Boolean(n)),
      reportUrl: box?.url ?? r.citation?.url };
  }));
  return hotspots ? [...annotations, ...hotspotReadings(hotspots)] : annotations;
}

/** The other residues on one published scale, so a pinned row can be read against the alphabet
 *  without a second table in the figure. Null when the scale context was never built. */
function alphabetNote(ev: ResidueContextEvidence, key: keyof ResidueContextEvidence['scaleContext']): string | null {
  const ticks = ev.scaleContext[key] ?? [];
  if (ticks.length === 0) return null;
  const unit = RESIDUE_SCALE_SOURCES[key].unit;
  return `Other residues on this scale: ${ticks.map(t => `${t.codes.join(', ')} ${t.native}${unit ? ` ${unit}` : ''}`).join(' · ')}.`;
}

export function residueReadings(ev: ResidueContextEvidence): EvidenceChartRow[] {
  const properties: EvidenceChartRow[] = (ev.properties ?? []).map(r => ({ key: r.key, name: r.label, value: null, knowledgeKey: 'residue_properties',
    valueText: `${r.wildTypeNative ?? r.wildTypeValue} → ${r.mutantNative ?? r.mutantValue}${r.unit ? ` ${r.unit}` : ''}`,
    description: r.interpretation, group: 'Residue properties', tone: 'neutral',
    facts: [{ label: ev.pair.wildType, value: `${r.wildTypeNative ?? r.wildTypeValue} ${r.unit}`.trim() },
      { label: ev.pair.mutant, value: `${r.mutantNative ?? r.mutantValue} ${r.unit}`.trim() },
      { label: 'Change', value: r.plainChange }, { label: 'Source', value: RESIDUE_SCALE_SOURCES[r.key].citation }],
    notes: [r.source, alphabetNote(ev, r.key), 'Each row has its own published scale. Position describes a residue property, not a measured change in this protein or a probability of disease.'].filter((n): n is string => Boolean(n)) }));
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
