import { describe, expect, it } from 'vitest';
import { buildModelEvidence, groupOrthologs, screenCellForSystem, unmappedScreenTerms, type ImpcScreen, type Ortholog } from '../modelOrganisms';

const o = (id: string, species: string, taxonId: string): Ortholog => ({ id, symbol: id, taxonId, species, bestForward: true, bestReverse: true, confidence: 'high', methodCount: 3 });
const screen: ImpcScreen = { mgiId: 'MGI:1', symbol: 'Rgs9', phenotypeStatus: 'Phenotyping data available', phenotypingDataAvailable: true, embryoDataAvailable: false,
  significant: ['vision/eye phenotype', 'immune system phenotype', 'custom phenotype'], notSignificant: ['muscle phenotype', 'hematopoietic system phenotype'] };

describe('model-organism evidence', () => {
  it('keeps every ortholog, groups per species and orders mouse first', () => {
    const groups = groupOrthologs([o('rgs9b', 'Zebrafish', 'NCBITaxon:7955'), o('Rgs9', 'Mouse', 'NCBITaxon:10090'), o('rgs9a', 'Zebrafish', 'NCBITaxon:7955')]);
    expect(groups.map(g => g.species)).toEqual(['Mouse', 'Zebrafish']);
    expect(groups[1]).toMatchObject({ oneToMany: true }); expect(groups[1].rows).toHaveLength(2);
  });
  it('separates significant, no-significant-difference, mixed and unreported without calling anything normal', () => {
    expect(screenCellForSystem(screen, 'vision')).toBe('significant');
    expect(screenCellForSystem(screen, 'muscle')).toBe('not-significant');
    expect(screenCellForSystem(screen, 'immune')).toBe('mixed');
    expect(screenCellForSystem(screen, 'hearing')).toBe('not-reported');
    expect(unmappedScreenTerms(screen)).toEqual(['custom phenotype']);
  });
  it('treats a complete empty ortholog list as no ortholog, but a missing response as unknown', () => {
    const base = { gene: 'X', status: 'ready' as const, hgncId: 'HGNC:1', orthologs: [], impc: null, provenance: [], message: null };
    expect(buildModelEvidence(base, []).noOrtholog).toBe(true);
    expect(buildModelEvidence(null, []).noOrtholog).toBe(false);
  });
});
