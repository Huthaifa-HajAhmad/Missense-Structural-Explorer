import type { Router } from 'express';
import { loadGeneDiseaseContext } from '../services/evidence-context/store.ts';
import { sendError } from '../utils.ts';
import { fetchAdultExpression } from '../services/evidence-context/gtex.ts';
import { loadDevelopmentalExpression } from '../services/evidence-context/dgtex.ts';
import { loadMechanismContext } from '../services/evidence-context/g2p.ts';
import { loadDosageContext } from '../services/evidence-context/clingenDosage.ts';
import { loadModelOrganisms } from '../services/evidence-context/modelOrganisms.ts';
import { loadAlignment } from '../services/evidence-context/alignment.ts';
import { loadPext } from '../services/evidence-context/pext.ts';
import { loadHpoAnnotation } from '../services/evidence-context/hpo.ts';
import { CONTEXT_SUFFIXES, type ContextSuffix } from '../../src/shared/contextRequest.ts';
import { addVerifiedMechanismChoices } from '../../src/shared/diseaseFrame.ts';

const GENE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/;

/**
 * Every reference read is `GET /evidence-context/:gene[/suffix]` with the same symbol check, so a new
 * source is one row here and one entry in CONTEXT_SUFFIXES (which also feeds the public-read gate);
 * add it to the keyless loop in evidence-context.http.test.ts. Official symbols only: aliases are
 * never resolved by guess.
 */
const SOURCES: Record<ContextSuffix, (gene: string, query: Record<string, unknown>) => Promise<unknown>> = {
  development: g => loadDevelopmentalExpression(g), dosage: g => loadDosageContext(g), models: g => loadModelOrganisms(g),
  alignment: g => loadAlignment(g), pext: g => loadPext(g), expression: g => fetchAdultExpression(g),
  hpo: (g, q) => loadHpoAnnotation(g, q.disease),
};

export function registerEvidenceContextRoutes(router: Router) {
  for (const suffix of CONTEXT_SUFFIXES) {
    const load = SOURCES[suffix];
    router.get(`/evidence-context/:gene/${suffix}`, async (req, res) => {
      const gene = req.params.gene;
      if (!GENE.test(gene)) { sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return; }
      res.json(await load(gene, req.query));
    });
  }
  router.get('/evidence-context/:gene', async (req, res) => {
    const gene = req.params.gene;
    if (!GENE.test(gene)) { sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return; }
    const [context, mechanismContext] = await Promise.all([loadGeneDiseaseContext(gene), loadMechanismContext(gene)]);
    res.json(addVerifiedMechanismChoices({ ...context, mechanismContext }));
  });
}
