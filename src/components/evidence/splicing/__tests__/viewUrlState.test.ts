import { describe, expect, it } from 'vitest';
import {
  SPLICE_URL_DEFAULTS,
  parseSplicingUrl,
  parseSpliceTranscript,
  parseSpliceView,
  parseSpliceWindow,
  withSplicingParams,
  type SpliceUrlState,
} from '../viewUrlState';

const BASE = 'https://example.test/?gene=NAE1&variant=p.Asp116Gly&uniprot=Q9UBE0';
const SET: SpliceUrlState = { transcript: 'NM_003905.4', halfWidth: 200, focusedScore: true, showSmallSignals: true, view: 'records' };

describe('splicing half-width parameter', () => {
  it.each(['50', '100', '200', '500', '1000', '2000'])('accepts the offered width %s', raw => {
    expect(parseSpliceWindow(raw)).toBe(Number(raw));
  });
  it.each(['', ' 100', '100 ', '100abc', 'abc', '1.5', '1e2', '0x10', '+100', '-50', '0', '49', '150', '2001', '99999', '99999999999999999999'])(
    'rejects %j (garbage, negative, out of bounds, huge, or off the offered steps)',
    raw => {
      expect(parseSpliceWindow(raw)).toBeNull();
    },
  );
  it('treats an absent parameter as auto', () => {
    expect(parseSpliceWindow(null)).toBeNull();
  });
});

describe('splicing transcript parameter', () => {
  it.each(['NM_003905.4', 'ENST00000123456', 'a', 'a'.repeat(40)])('accepts %s', raw => {
    expect(parseSpliceTranscript(raw)).toBe(raw);
  });
  it.each(['', 'a'.repeat(41), '<script>', 'NM_1;DROP TABLE', '../../etc', 'NM 1', 'NM/1', 'javascript:alert(1)', 'NM%1'])(
    'rejects %j',
    raw => {
      expect(parseSpliceTranscript(raw)).toBeNull();
    },
  );
  it('treats an absent parameter as no transcript', () => {
    expect(parseSpliceTranscript(null)).toBeNull();
  });
});

describe('splicing view parameter', () => {
  it.each(['comparison', 'records', 'scales'] as const)('accepts %s', view => {
    expect(parseSpliceView(view)).toBe(view);
  });
  it.each(['embeddings', 'partners', 'RECORDS', '', '<b>', null, undefined])('reads %j as the comparison view', raw => {
    expect(parseSpliceView(raw)).toBe('comparison');
  });
});

describe('splicing URL state', () => {
  it('reads the defaults from a URL that carries none of its parameters', () => {
    expect(parseSplicingUrl(BASE)).toEqual(SPLICE_URL_DEFAULTS);
  });
  it('reads the defaults from a URL whose parameters are all invalid', () => {
    expect(parseSplicingUrl(`${BASE}&spw=-5&spf=yes&sps=0&spt=bad%20id&spv=embeddings`)).toEqual(SPLICE_URL_DEFAULTS);
  });
  it('round-trips a full state through the URL', () => {
    const href = withSplicingParams(BASE, SET);
    expect(parseSplicingUrl(href)).toEqual(SET);
  });
  it('keeps the variant identity parameters untouched', () => {
    const href = withSplicingParams(BASE, SET);
    const url = new URL(href);
    expect(url.searchParams.get('gene')).toBe('NAE1');
    expect(url.searchParams.get('variant')).toBe('p.Asp116Gly');
    expect(url.searchParams.get('uniprot')).toBe('Q9UBE0');
  });
  it('removes every parameter when the state is back at its defaults', () => {
    const set = withSplicingParams(BASE, SET);
    expect(withSplicingParams(set, SPLICE_URL_DEFAULTS)).toBe(BASE);
  });
  it('writes a transcript only with the state it qualifies', () => {
    const href = withSplicingParams(BASE, { ...SPLICE_URL_DEFAULTS, transcript: 'NM_003905.4' });
    expect(new URL(href).searchParams.has('spt')).toBe(true);
    expect(parseSplicingUrl(href).halfWidth).toBeNull();
  });
  it('never writes an invalid value, even when handed one', () => {
    expect(withSplicingParams(BASE, { ...SPLICE_URL_DEFAULTS, halfWidth: 150, transcript: '../x' })).toBe(BASE);
  });
  it('is idempotent: an unchanged state returns the input href', () => {
    expect(withSplicingParams(BASE, SPLICE_URL_DEFAULTS)).toBe(BASE);
    const once = withSplicingParams(BASE, SET);
    expect(withSplicingParams(once, SET)).toBe(once);
  });
  it('returns the input href byte for byte when nothing changes, even for a non-canonical query', () => {
    const odd = 'https://example.test/?gene=NAE1&note=a+b%20c';
    expect(withSplicingParams(odd, SPLICE_URL_DEFAULTS)).toBe(odd);
  });
});
