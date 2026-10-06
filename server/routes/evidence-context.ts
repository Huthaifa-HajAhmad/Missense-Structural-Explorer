import type { Router } from 'express';
import { loadGeneDiseaseContext } from '../services/evidence-context/store.ts';
import { sendError } from '../utils.ts';
import { fetchAdultExpression } from '../services/evidence-context/gtex.ts';
import { loadDevelopmentalExpression } from '../services/evidence-context/dgtex.ts';
import { loadMechanismContext } from '../services/evidence-context/g2p.ts';
import { addVerifiedMechanismChoices } from '../../src/shared/diseaseFrame.ts';
export function registerEvidenceContextRoutes(router: Router) {
  router.get('/evidence-context/:gene/development', async (req, res) => {
    const gene = req.params.gene;
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/.test(gene)) {
      sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return;
    }
    res.json(await loadDevelopmentalExpression(gene));
  });
  router.get('/evidence-context/:gene/expression', async (req, res) => {
    const gene = req.params.gene;
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/.test(gene)) {
      sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return;
    }
    res.json(await fetchAdultExpression(gene));
  });
  router.get('/evidence-context/:gene', async (req, res) => {
    const gene = req.params.gene;
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/.test(gene)) {
      sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return;
    }
    // Official symbol only: aliases are not resolved by an upper-case/name guess.
    const [context, mechanismContext] = await Promise.all([loadGeneDiseaseContext(gene), loadMechanismContext(gene)]);
    res.json(addVerifiedMechanismChoices({ ...context, mechanismContext }));
  });
}
