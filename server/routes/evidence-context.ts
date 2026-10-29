import type { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getClientIp } from '../middleware.ts';
import { loadGeneDiseaseContext } from '../services/evidence-context/store.ts';
import { sendError } from '../utils.ts';
import { fetchAdultExpression } from '../services/evidence-context/gtex.ts';
import { loadDevelopmentalExpression } from '../services/evidence-context/dgtex.ts';
import { loadMechanismContext } from '../services/evidence-context/g2p.ts';
import { loadDosageContext } from '../services/evidence-context/clingenDosage.ts';
import { loadModelOrganisms } from '../services/evidence-context/modelOrganisms.ts';
import { loadAlignment } from '../services/evidence-context/alignment.ts';
import { loadPext } from '../services/evidence-context/pext.ts';
import { loadHpa } from '../services/evidence-context/hpa.ts';
import { loadModelPhenotypes } from '../services/evidence-context/modelPhenotypes.ts';
import { loadHpoAnnotation } from '../services/evidence-context/hpo.ts';
import { loadHotspotContext } from '../services/evidence-context/hotspots.ts';
import { CONTEXT_SUFFIXES, type ContextSuffix } from '../../src/shared/contextRequest.ts';
import { addVerifiedMechanismChoices } from '../../src/shared/diseaseFrame.ts';

const GENE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,49}$/;

/**
 * The hotspots read is public and can spawn a 2,000-permutation 3D job, so it gets its own budget on top of
 * the shared `apiLimiter`. A cached answer is cheap, so a reader moving between a few genes never notices;
 * an unauthenticated loop of distinct `uniprot` values (each its own cache key) does.
 */
const hotspotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => req.principal?.kind === "agent",
  message: { error: { code: "RATE_LIMITED", message: "Hot-spot reads are limited: each one can run a 3D permutation test." } },
});

/**
 * Every reference read is `GET /evidence-context/:gene[/suffix]` with the same symbol check, so a new
 * source is one row here and one entry in CONTEXT_SUFFIXES (which also feeds the public-read gate);
 * add it to the keyless loop in evidence-context.http.test.ts. Official symbols only: aliases are
 * never resolved by guess.
 */
const SOURCES: Record<ContextSuffix, (gene: string, query: Record<string, unknown>) => Promise<unknown>> = {
  development: g => loadDevelopmentalExpression(g), dosage: g => loadDosageContext(g), models: g => loadModelOrganisms(g),
  alignment: g => loadAlignment(g), pext: g => loadPext(g), expression: g => fetchAdultExpression(g),
  hpa: g => loadHpa(g),
  phenotypes: g => loadModelPhenotypes(g),
  hpo: (g, q) => loadHpoAnnotation(g, q.disease),
  hotspots: (g, q) => loadHotspotContext(g, q),
};

export function registerEvidenceContextRoutes(router: Router) {
  for (const suffix of CONTEXT_SUFFIXES) {
    const load = SOURCES[suffix];
    const guards = suffix === 'hotspots' ? [hotspotLimiter] : [];
    router.get(`/evidence-context/:gene/${suffix}`, ...guards, async (req, res) => {
      const gene = req.params.gene;
      if (!GENE.test(gene)) { sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return; }
      // Express 4 does not forward a rejected async handler. Without this guard a throw from any source
      // (a missing bundled file, a malformed snapshot) becomes an unhandled rejection and Node's default
      // --unhandled-rejections=throw ends the process, taking every other request with it.
      try {
        res.json(await load(gene, req.query));
      } catch (error) {
        console.error(`[evidence-context] ${suffix} failed`, error);
        sendError(res, 502, 'CONTEXT_UNAVAILABLE', `${suffix} could not be read.`);
      }
    });
  }
  router.get('/evidence-context/:gene', async (req, res) => {
    const gene = req.params.gene;
    if (!GENE.test(gene)) { sendError(res, 400, 'INVALID_GENE', 'Use a human gene symbol.'); return; }
    try {
      const [context, mechanismContext] = await Promise.all([loadGeneDiseaseContext(gene), loadMechanismContext(gene)]);
      res.json(addVerifiedMechanismChoices({ ...context, mechanismContext }));
    } catch (error) {
      console.error('[evidence-context] gene context failed', error);
      sendError(res, 502, 'CONTEXT_UNAVAILABLE', 'The gene context could not be read.');
    }
  });
}
