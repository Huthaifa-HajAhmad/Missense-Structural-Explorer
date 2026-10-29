/** Presentation records for linked splice exploration. Scores and provenance always come from
 * the current payload, never a pinned snapshot. Display filters do not alter these records,
 * thresholds or the engine. Provider offsets remain genomic; transcript offsets require a strand. */
import type { AnalysisResult } from './contracts';
import type { EvidenceChartRow } from './evidenceComparison';
import { evidenceWorkspaceIdentity } from './evidenceContextIdentity';
import { annotatedSpliceSite, SPLICE_CHANNEL_NAME, SPLICE_MAP_FLOOR, type SpliceChannelKey, type SplicingEvidence } from './splicingEvidence';

export interface SplicingWorkspaceReading extends EvidenceChartRow {
  channel: SpliceChannelKey | null;
  position: string;
  site: string;
  reportUrl?: string;
}
const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
const offsetText = (n: number | null) => n === null ? 'Not reported' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} bp`;

/** Resolve the same locus shown in the header, always retaining its declared build. */
export function spliceRequestCoordinate(result: AnalysisResult) {
  const md = result.metadata as AnalysisResult['metadata'] & { genomicCoordinates?: string | null; assembly?: 'GRCh37' | 'GRCh38' | null };
  if (md?.genomicCoordinates) return { coordinates: md.genomicCoordinates, assembly: md.assembly ?? 'GRCh38' as const };
  const pred = result.predictorData;
  return pred?.gnomadVariantId && pred.gnomadVariantAssembly
    ? { coordinates: pred.gnomadVariantId, assembly: pred.gnomadVariantAssembly } : null;
}

/** A late reply must not cross the requested locus or build. */
export function spliceRequestIdentity(result: AnalysisResult | null): string {
  return JSON.stringify([evidenceWorkspaceIdentity(result), result ? spliceRequestCoordinate(result) : null]);
}

export function splicingReadings(ev: SplicingEvidence, result: AnalysisResult): SplicingWorkspaceReading[] {
  const sai = result.conservationData?.spliceai;
  const keys = ['spliceai', ...Object.keys(SPLICE_CHANNEL_NAME).map(k => `spliceai-${k}`), ...ev.readings.filter(r => r.group === 'context').map(r => r.key)];
  return keys.map(key => {
    const reading = ev.readings.find(r => r.key === key);
    const channel = key.startsWith('spliceai-ds_') ? key.slice('spliceai-'.length) as SpliceChannelKey : null;
    const isSpliceAI = key === 'spliceai' || channel !== null;
    const value = channel ? finite(sai?.[channel]) : reading?.score ?? null;
    const genomic = channel ? finite(sai?.dp?.[channel]) : null;
    const transcript = genomic === null || ev.geometry.strand === null ? null : genomic * (ev.geometry.strand === '-' ? -1 : 1);
    const siteType = channel?.endsWith('ag') || channel?.endsWith('al') ? 'acceptor' : 'donor';
    const annotated = transcript === null || !ev.map ? null : annotatedSpliceSite(ev.map.sites, siteType, transcript);
    const site = !channel ? '' : value === null ? 'No score returned'
      : value === 0 ? 'Measured zero; no predicted site is placed'
      // A delta under the floor does not locate a predicted effect — neither placement nor
      // coincidence is asserted, whichever display filter is in effect.
      : value < SPLICE_MAP_FLOOR ? `Below the ${SPLICE_MAP_FLOOR} default display floor`
      : genomic === null ? 'Delta position not reported'
      : ev.geometry.strand === null ? 'Strand unresolved; genomic offset only'
      : !ev.map ? 'Annotated junction geometry unavailable'
      : annotated ? `Coincides with an annotated ${siteType} (within 1 bp)` : `Does not coincide with an annotated ${siteType}`;
    const availability = reading?.availability ?? ev.spliceai.availability;
    const source = isSpliceAI ? ev.spliceai.sourceText : reading?.key.startsWith('dbscsnv') ? 'dbscSNV · Jian et al. 2014' : 'AlphaGenome · returned feature attribution';
    // Below-floor and zero deltas carry no reliable location: SpliceAI's position near zero is
    // arbitrary, so the offset is provenance only, never a place on an axis.
    const placeless = channel !== null && value !== null && value < SPLICE_MAP_FLOOR;
    const rawPosition = transcript !== null ? `${offsetText(transcript)} · transcript` : genomic !== null ? `${offsetText(genomic)} · genomic` : 'Not reported';
    const predictionTranscript = ev.spliceai.provenance?.transcriptId ?? null;
    return {
      key, channel, name: channel ? SPLICE_CHANNEL_NAME[channel] : reading?.name ?? key,
      value, valueText: value === null ? availability.label ?? 'No result' : String(value),
      position: channel
        ? value === null ? 'Not reported' : placeless ? 'No meaningful position' : rawPosition
        : 'Not reported',
      site, group: channel ? 'SpliceAI channels' : isSpliceAI ? 'Splicing rule input' : 'Context', tone: 'neutral',
      description: channel ? 'Change in the model’s splice-site probability for this channel.' : reading?.description ?? '',
      facts: [
        { label: channel || key === 'spliceai' ? 'Exact delta score' : key === 'alphagenome-splicing' ? 'Attribution share (fraction)' : 'Exact reading', value: value === null ? 'No result' : String(value) },
        { label: 'Source', value: source },
        ...(key === 'alphagenome-splicing' ? [{ label: 'Signed SHAP contribution', value: ev.alphagenome.shap === null ? 'Not reported' : String(ev.alphagenome.shap) }] : []),
        ...(isSpliceAI ? [
          { label: 'Reporting window', value: ev.spliceai.windowText },
          { label: 'Masking', value: ev.spliceai.maskText },
          ...(predictionTranscript ? [{ label: 'Prediction transcript', value: predictionTranscript }] : []),
          { label: 'Prediction annotation set', value: ev.spliceai.provenance?.annotationSet ?? 'Not stated' },
        ] : []),
        ...(channel ? (placeless ? [
          // The raw offset survives as a labelled provenance fact; it is never shown as a position.
          { label: 'Raw genomic offset (not a position)', value: offsetText(genomic) },
          { label: 'Raw transcript offset (not a position)', value: ev.geometry.strand === null ? 'Strand unresolved' : offsetText(transcript) },
        ] : [
          { label: 'Genomic offset from variant', value: offsetText(genomic) },
          { label: 'Transcript offset from variant', value: ev.geometry.strand === null ? 'Strand unresolved' : offsetText(transcript) },
          { label: 'Annotated-site relationship', value: site },
          { label: 'Geometry transcript', value: ev.geometry.transcriptId ?? 'Not resolved' },
          { label: 'Strand', value: ev.geometry.strandLabel },
        ]) : []),
      ],
      notes: [
        ...(value === null ? [availability.reason ?? 'This source returned no score for the reading.'] : []),
        ...(channel && placeless ? ['A delta this close to zero has no meaningful position, so no offset above is presented as a location; the raw offset is kept as provenance only.'] : []),
        ...(channel ? placeless ? ['Coincidence is positional context, not experimental confirmation. The resolver transcript and prediction annotation set can differ.'] : ['Offsets are the raw returned location and its strand-aware conversion; a zero score does not locate a predicted effect.',
          'Coincidence is positional context, not experimental confirmation. The resolver transcript and prediction annotation set can differ.'] : []),
        ...(reading?.scaleSource ? [reading.scaleSource] : []),
        ...(reading?.call ? [`${reading.call.label}${reading.call.unapplied ? ' · not applied by the engine' : ''}`] : []),
        ...(isSpliceAI ? ['Delta scores are model predictions, not observed splicing effects or probabilities of disease.',
          'The engine does not apply splicing criteria. Its recorded PP3/BP4 comes from the missense vote.'] : [reading?.note ?? 'Context only; not counted as splicing evidence.']),
      ],
      reportUrl: isSpliceAI ? 'https://github.com/Illumina/SpliceAI' : undefined,
    };
  });
}
