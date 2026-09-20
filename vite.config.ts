import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vitest/config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      minify: true,
      sourcemap: false
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/temp_jobs/**',
          '**/tools/**',
          '**/data/**',
          '**/logs/**',
          '**/graphify-out/**',
          '**/*.sqlite*',
          '**/*.sqlite-shm',
          '**/*.sqlite-wal',
          '**/.venv/**',
          '**/brain/**'
        ]
      },
    },
    test: {
      environment: 'node',
      globals: true,
      setupFiles: './src/test/setup.ts',
      /**
       * A real margin over the retry backoff, because the default is thinner than it looks.
       *
       * `fetchWithRetry` sleeps `delay * jitter` per attempt with `jitter = 0.5 + random * 0.5`
       * (server/services/infra/http-client.ts:205), so a test that drives deliberately-failing providers
       * spends 1500-3000 ms of REAL wall clock per call. With vitest's unconfigured 5000 ms default, one
       * such test has under 2x headroom — which is how a suite passes locally and fails in CI. This is
       * the mechanism behind the intermittent failures observed during the audit; it is a timing bound,
       * not a network dependency (those tests mock `fetch`).
       */
      testTimeout: 20000,
      hookTimeout: 20000,
      coverage: {
        provider: 'v8' as const,
        /**
         * `text` (for the job log) and `json` (machine-readable). The HTML report is NOT generated:
         * nothing consumes it — CI uploads no coverage artifact — and writing it costs I/O on every
         * run for a report no one opens.
         */
        reporter: ['text', 'json'],
        thresholds: {
          statements: 35,
          branches: 30,
          functions: 40,
          lines: 35,
        },
        exclude: [
          'node_modules/**',
          'dist/**',
          'src/test/**',
          '**/*.test.ts',
          '**/*.test.tsx',
        ],
      },
    },
  };
});
