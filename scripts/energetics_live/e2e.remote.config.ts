import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

/**
 * Attaches to an already running server (the energetics test container, reached through an SSH
 * tunnel on 127.0.0.1:3101) instead of starting the local dev server. Nothing is started or stopped.
 *
 *   ssh -N -L 3101:127.0.0.1:3100 ubuntu@<vm>
 */
const url = process.env.APP_URL ?? 'http://127.0.0.1:3101';

export default {
  tests: ['scripts/energetics_live/*.e2e.ts'],
  workers: 1,
  retries: 0,
  targets: [{ engine: web(), app: { url } }],
} satisfies E2EConfig;
