import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { RESEARCH_GUIDES, EVIDENCE_GUIDES, PHYSICAL_EXPLANATIONS, GUIDE_ALIASES, resolveResearchGuide } from '../../../shared/researchGuides';
import { EXPLANATION_TEACHING } from '../../../shared/explanationTeaching';
import { METRIC_EXPLANATIONS } from '../../evidence/MetricExplanations';
import { buildPredictorEvidence } from '../../../shared/predictorEvidence';
import type { AnalysisResult } from '../../../shared/contracts';
import { EVIDENCE_SUB_ITEMS } from '../../MasterSidebar';

describe('contextual scientific explanations', () => {
  it('covers every existing metric/model notice and every evidence workspace', () => {
    for (const key of Object.keys(METRIC_EXPLANATIONS)) expect(resolveResearchGuide(key), key).toBeDefined();
    for (const { id } of EVIDENCE_SUB_ITEMS) expect(resolveResearchGuide(EVIDENCE_GUIDES[id]), id).toBeDefined();
  });
  it('every returned predictor has a working explanation, even without a score', () => {
    for (const reading of buildPredictorEvidence({ result: {} as AnalysisResult }).readings) {
      expect(reading.knowledgeKey, reading.name).toBeTruthy();
      expect(resolveResearchGuide(reading.knowledgeKey!), reading.name).toBeDefined();
    }
  });
  it('validates literal component topics without treating metadata entries as rendered controls', () => {
    const componentRoot = resolve(process.cwd(), 'src/components');
    for (const file of readdirSync(componentRoot, { recursive: true }).filter(f => String(f).endsWith('.tsx') && !String(f).includes('__tests__'))) {
      const code = readFileSync(resolve(componentRoot, String(file)), 'utf8');
      for (const match of code.matchAll(/topic="([a-z0-9_]+)"/g)) expect(resolveResearchGuide(match[1]), `${String(file)}: ${match[1]}`).toBeDefined();
    }
    for (const key of Object.values(PHYSICAL_EXPLANATIONS)) expect(resolveResearchGuide(key)).toBeDefined();
  });
  it('has no dangling related explanations, aliases or teaching figures', () => {
    for (const [key, topic] of Object.entries(RESEARCH_GUIDES)) {
      for (const field of ['title', 'question', 'answer', 'reading', 'limit', 'next'] as const) expect(topic[field].trim(), `${key}.${field}`).not.toBe('');
      for (const related of topic.related) expect(RESEARCH_GUIDES[related], `${key} → ${related}`).toBeDefined();
      if (topic.source) expect(topic.source.url, key).toMatch(/^https:\/\//);
    }
    for (const target of Object.values(GUIDE_ALIASES)) expect(RESEARCH_GUIDES[target]).toBeDefined();
    for (const key of Object.keys(EXPLANATION_TEACHING)) expect(RESEARCH_GUIDES[key], key).toBeDefined();
  });
});
