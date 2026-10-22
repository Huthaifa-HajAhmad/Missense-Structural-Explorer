import type { E2EConfig } from 'e2e';
import base from './e2e.config.ts';
import { agentModel, agentSystem } from './e2e.agent.ts';

/**
 * Bug-bash config: the project's config plus `tests/bugbash/**` for repro tests. Run with
 * `npx e2e explore --config e2e.bugbash.config.ts ...`; charters live in
 * .agents/skills/verify-missense-resolve/features/bugbash.md. A finding is a bug only once a
 * repro under tests/bugbash/ fails with ASSERTION_FAILED on the assertion that encodes it.
 */
const shared: E2EConfig = base;

const context =
  'The app is Missense & Fold, a variant-interpretation tool. AUTH_MODE=legacy: there is no sign-in. ' +
  'Not bugs: service tiles that read "offline", "fallback" or "responding slowly" (they reflect live upstream health); ' +
  'a missing or unconfigured Gemini key (AI synthesis is optional); links that open a new tab leave this one unchanged; ' +
  'accessible text splits around inline links, so judge copy by the rendered screen. ' +
  'Never paste patient identifiers. Analyses call real public APIs: do not start more than three.';

const persona = { model: agentModel, system: agentSystem, maxSteps: 40, maxModelCalls: 40, context };

export default {
  ...shared,
  tests: [
    ...[shared.tests ?? 'tests/**/*.e2e.ts'].flat().filter((glob) => !glob.startsWith('!tests/bugbash/')),
    'tests/bugbash/**/*.e2e.ts',
  ],
  retries: 0,
  agents: {
    default: persona,
    skeptic: {
      ...persona,
      system: `${agentSystem} Distrust every number, date, count and claim on screen; cross-check each against every other place it appears.`,
    },
    fuzzer: {
      ...persona,
      system: `${agentSystem} At every input, run the input matrix (empty, whitespace, huge, malformed notation, wrong gene/variant pairs) before the happy path.`,
    },
  },
} satisfies E2EConfig;
