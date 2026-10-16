import { describe, expect, it } from 'vitest';
import { expressionWorkspaceFinding } from '../shared/expressionWorkspaceFinding';
import { contextWorkspaceFixture } from './contextWorkspaceFixture';

describe('active-source expression finding', () => {
  const f = contextWorkspaceFixture();
  const input = { section: 'developmental', adult: { status: 'ready' as const, data: f.adult }, developmental: { status: 'ready' as const, data: f.developmental }, systems: [], cohort: 'all' };
  it('keeps pediatric zero, age cohort and adult findings separate', () => {
    const zero = expressionWorkspaceFinding({ ...input, cohort: '1' });
    expect(zero.headline).toBe('Brain · 0 TPM');
    expect(zero.detail).toContain('Infant (0 to 2 years)');
    expect(expressionWorkspaceFinding(input).headline).toBe('Brain · 36 TPM');
    expect(expressionWorkspaceFinding({ ...input, section: 'adult' }).headline).toContain('380 TPM');
  });
  it('distinguishes unavailable, error, absent gene and uncovered scope', () => {
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'error', data: null } }).headline).toContain('could not be read');
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'ready', data: { ...f.developmental, status: 'not-installed' } } }).headline).toContain('not available here');
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'ready', data: { ...f.developmental, status: 'not-found' } } }).headline).toContain('No pediatric gene reading');
    expect(expressionWorkspaceFinding({ ...input, systems: ['hearing'] }).headline).toContain('No pediatric measurements in this review scope');
  });
});
