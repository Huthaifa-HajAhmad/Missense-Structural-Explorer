import { describe, expect, it } from 'vitest';
import { layoutArchitecture } from '../architectureLayout';
import { buildFunctionEvidence } from '../../../../shared/functionEvidence';
import { functionEvidenceInputFrom } from '../../../../shared/functionEvidenceInput';
import { functionReadings } from '../../../../shared/molecularWorkspace';
import { molecularWorkspaceFixture } from '../../../../test/molecularWorkspaceFixture';

describe('domain overlap and source identity', () => {
  const ev = buildFunctionEvidence(functionEvidenceInputFrom(molecularWorkspaceFixture()));
  it.each([300, 720, 1200])('separates overlapping signatures and retains exact x coordinates at %i px', width => {
    const L = layoutArchitecture(ev, width, { start: 1, end: ev.length }, null);
    expect(L.domains.length).toBe(5);
    for (const [i, a] of L.domains.entries()) {
      expect(a.x).toBeCloseTo(L.x0 + (a.start - 1) / (ev.length - 1) * (L.x1 - L.x0));
      expect(functionReadings(ev).some(r => r.key === a.rowKey)).toBe(true);
      for (const b of L.domains.slice(i + 1)) {
        const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
        if (xOverlap) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(30);
      }
    }
    expect(L.query!.stemTo).toBeGreaterThan(Math.max(...L.domains.map(d => d.y + 30)));
  });
  it('keeps selection and source bounds when a signature is clipped by the view', () => {
    const key = 'match-SMART-DEMO3';
    const L = layoutArchitecture(ev, 500, { start: 55, end: 320 }, key);
    const segments = L.domains.filter(d => d.rowKey === key);
    expect(segments).toHaveLength(2);
    expect(segments.every(d => d.selected)).toBe(true);
    expect(segments.map(d => [d.start, d.end])).toEqual([[40, 80], [290, 380]]);
    expect(segments[0].x).toBe(L.x0);
    expect(segments[1].x + segments[1].width).toBe(L.x1);
  });
  it('counts the specific covering annotation and never pads it with a broad fold-level match', () => {
    // The 97% THIF fold also covers the residue; the count must not include it — it is not the
    // residue's domain (see the Function rail's own policy) — and the caveat still flags it.
    expect(ev.finding.lead).toContain('inside the Illustrative overlap (SMART, 90–245)');
    expect(ev.finding.lead).not.toContain('covering domain annotations');
    expect(ev.trace.map(s => s.text).join(' ')).toContain('Only the Illustrative overlap');
    expect(ev.caveats.some(c => c.lead.includes('% of the protein'))).toBe(true);
    expect(ev.pm1.status).not.toBe('met');
  });
});
