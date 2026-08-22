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
      minify: false,
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
      coverage: {
        provider: 'v8' as const,
        reporter: ['text', 'json', 'html'],
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
