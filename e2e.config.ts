import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agentModel, agentSystem } from './e2e.agent.ts';

/**
 * Local dev server (`tsx server.ts`: Express + Vite middleware + ML sidecar). Cold start
 * is slow (RaSP index check, sidecar grace window), so `reuseExisting` attaches to a
 * server already on the port instead of starting a second one that would fight over
 * the sidecar (:8000) and Vite HMR (:24678) ports. Override with APP_URL / PORT.
 * AUTH_MODE=legacy needs no sign-in.
 */
const url = process.env.APP_URL ?? 'http://127.0.0.1:3917';

export default {
  tests: 'tests/**/*.e2e.ts',
  // One worker: every page shares 127.0.0.1, and apiLimiter (server/middleware.ts) allows 120
  // API calls a minute per IP. Parallel pages trip it with 429s that read as flaky UI.
  workers: 1,
  retries: 1,
  // Model behind every agent.* step and `e2e explore` (bug bash). The tests under tests/ stay
  // deterministic and never spend a token; only an explicit agent step or an explore run does.
  agents: { default: { model: agentModel, system: agentSystem } },
  targets: [{
    engine: web(),
    app: {
      url,
      command: {
        // `npm run dev` is `tsx server.ts`; spawning tsx's CLI through node avoids npm.cmd,
        // which a Windows spawn cannot resolve (ENOENT).
        executable: process.execPath,
        args: ['node_modules/tsx/dist/cli.mjs', 'server.ts'],
        env: {
          PORT: new URL(url).port || '3917',
          // The runner hands the app only this block, not its own environment. Locally the app reads
          // .env itself; on a runner (no .env) the server refuses to start without these, so forward
          // whichever are set (e2e.yml supplies throwaways).
          ...Object.fromEntries(
            ['NODE_ENV', 'AUTH_MODE', 'APP_API_TOKEN', 'APP_SESSION_SECRET']
              .filter((name) => process.env[name])
              .map((name) => [name, process.env[name] as string]),
          ),
        },
        reuseExisting: true,
        log: '.e2e/logs/app.log',
      },
    },
  }],
} satisfies E2EConfig;
