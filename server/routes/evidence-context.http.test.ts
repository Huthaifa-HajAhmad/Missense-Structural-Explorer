import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiRouter } from '../routes';
import { loadGeneDiseaseContext } from '../services/evidence-context/store';
import { fetchAdultExpression } from '../services/evidence-context/gtex';
import { loadDevelopmentalExpression } from '../services/evidence-context/dgtex';
import { loadHpa } from '../services/evidence-context/hpa';
import { loadModelPhenotypes } from '../services/evidence-context/modelPhenotypes';
import { loadHpoAnnotation } from '../services/evidence-context/hpo';
import { loadAlignment } from '../services/evidence-context/alignment';
import { loadPext } from '../services/evidence-context/pext';
import { loadModelOrganisms } from '../services/evidence-context/modelOrganisms';
import { loadDosageContext } from '../services/evidence-context/clingenDosage';
vi.mock('../services/evidence-context/store', () => ({ loadGeneDiseaseContext: vi.fn(async (gene: string) => ({ gene, status: 'not-installed', frames: [], provenance: null, message: 'Missing snapshot' })) }));
vi.mock('../services/evidence-context/g2p', () => ({ loadMechanismContext: vi.fn(async () => ({ status: 'not-installed', records: [], provenance: null, message: 'Missing snapshot' })) }));
vi.mock('../services/evidence-context/gtex', () => ({ fetchAdultExpression: vi.fn(async (gene: string) => ({ gene, status: 'not-found', tissues: [], provenance: null, message: null })) }));
vi.mock('../services/evidence-context/dgtex', () => ({ loadDevelopmentalExpression: vi.fn(async (gene: string) => ({ gene, status: 'not-installed', observations: [], provenance: null, message: 'Missing snapshot' })) }));
vi.mock('../services/evidence-context/modelOrganisms', () => ({ loadModelOrganisms: vi.fn(async (gene: string) => ({ gene, status: 'ready', hgncId: null, orthologs: [], impc: null, provenance: [], message: null })) }));
vi.mock('../services/evidence-context/hpa', () => ({ loadHpa: vi.fn(async (gene: string) => ({ gene, status: 'not-found' })) }));
vi.mock('../services/evidence-context/modelPhenotypes', () => ({ loadModelPhenotypes: vi.fn(async (gene: string) => ({ gene, status: 'not-found', species: [] })) }));
vi.mock('../services/evidence-context/hpo', () => ({ loadHpoAnnotation: vi.fn(async (gene: string) => ({ gene, status: 'not-found', terms: [] })) }));
vi.mock('../services/evidence-context/alignment', () => ({ loadAlignment: vi.fn(async (gene: string) => ({ gene, status: 'not-found', homologies: [] })) }));
vi.mock('../services/evidence-context/pext', () => ({ loadPext: vi.fn(async (gene: string) => ({ gene, status: 'no-pext', regions: [] })) }));
vi.mock('../services/evidence-context/clingenDosage', () => ({ loadDosageContext: vi.fn(async (gene: string) => ({ gene, status: 'not-found', record: null, provenance: null, message: null })) }));

describe('public reference evidence through the API router', () => {
  let server: Server; let base: string;
  const prior = process.env.APP_API_TOKEN; const token = 'context-http-test-token-fixed-32-chars';
  beforeAll(async () => {
    process.env.APP_API_TOKEN = token;
    const app = express(); app.use('/api/v1', apiRouter);
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/evidence-context`; resolve(); }); });
  });
  afterAll(async () => {
    if (prior === undefined) delete process.env.APP_API_TOKEN; else process.env.APP_API_TOKEN = prior;
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const request = (suffix: string, authenticated = true) => fetch(base + suffix, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
  it('serves every reference sources without an API token or Gemini key', async () => {
    for (const suffix of ['/RGS9', '/RGS9/expression', '/RGS9/development', '/RGS9/dosage', '/RGS9/models', '/RGS9/alignment', '/RGS9/pext', '/RGS9/hpo?disease=OMIM:1', '/RGS9/phenotypes', '/RGS9/hpa']) expect((await request(suffix, false)).status).toBe(200);
    expect(loadGeneDiseaseContext).toHaveBeenCalledWith('RGS9');
    expect(loadDosageContext).toHaveBeenCalledWith('RGS9');
    expect(loadModelOrganisms).toHaveBeenCalledWith('RGS9'); expect(loadAlignment).toHaveBeenCalledWith('RGS9'); expect(loadPext).toHaveBeenCalledWith('RGS9'); expect(loadHpoAnnotation).toHaveBeenCalledWith('RGS9', 'OMIM:1'); expect(loadModelPhenotypes).toHaveBeenCalledWith('RGS9'); expect(loadHpa).toHaveBeenCalledWith('RGS9');
    expect(fetchAdultExpression).toHaveBeenCalledWith('RGS9');
    expect(loadDevelopmentalExpression).toHaveBeenCalledWith('RGS9');
    vi.clearAllMocks();
  });
  it('keeps writes and unrelated context paths authenticated', async () => {
    expect((await fetch(base + '/RGS9', { method: 'POST' })).status).toBe(401);
    expect((await request('/RGS9/private', false)).status).toBe(401);
  });
  it('rejects malformed symbols before source retrieval', async () => {
    expect((await request('/bad%20symbol', false)).status).toBe(400);
    expect(loadGeneDiseaseContext).not.toHaveBeenCalled();
  });
  it('retains distinct unavailable states and passes the exact symbol to each adapter', async () => {
    const validity = await request('/TEST'); expect(validity.status).toBe(200);
    expect(await validity.json()).toMatchObject({ gene: 'TEST', status: 'not-installed', mechanismContext: { status: 'not-installed' } });
    expect(await (await request('/TEST/expression')).json()).toMatchObject({ gene: 'TEST', status: 'not-found' });
    expect(await (await request('/TEST/development')).json()).toMatchObject({ gene: 'TEST', status: 'not-installed' });
    expect(loadGeneDiseaseContext).toHaveBeenCalledWith('TEST'); expect(fetchAdultExpression).toHaveBeenCalledWith('TEST'); expect(loadDevelopmentalExpression).toHaveBeenCalledWith('TEST');
  });
});
