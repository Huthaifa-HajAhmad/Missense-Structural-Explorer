# Rendering a tab for visual review

The tabs need a backend to populate, so render the component directly with a fixture payload.

1. Get the source somewhere with a browser (a Linux copy with `npm ci --ignore-scripts`).
2. Add `src/preview/main.tsx` (do not commit it):

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../index.css';
import { SettingsProvider } from '../context/SettingsContext.tsx';
import { DevConsoleProvider } from '../context/DevConsoleContext.tsx';
import { PredictorsTab } from '../components/evidence/PredictorsTab';      // ← your tab
import { PredictorsRail } from '../components/inspector/PredictorsRail';   // ← your rail

const params = new URLSearchParams(location.search);
// SettingsProvider applies `.dark` from saved settings; force light when asked.
if (params.get('light')) setInterval(() => document.documentElement.classList.remove('dark'), 100);
const result: any = { /* the reference variant's payload: copy values from the user's screenshots */ };

createRoot(document.getElementById('root')!).render(
  <DevConsoleProvider><SettingsProvider>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', background: 'var(--cs-bg)', minHeight: '100vh' }}>
      <main style={{ padding: 24 }}>
        <PredictorsTab {...({ analysisState: { result, isLoading: false }, onTabChange: () => {} } as any)} />
      </main>
      <aside style={{ padding: 16, borderLeft: '1px solid var(--cs-border)', background: 'var(--cs-surface-2)' }}>
        <PredictorsRail analysisResult={result} />
      </aside>
    </div>
  </SettingsProvider></DevConsoleProvider>
);
```

3. `preview.html` at the repo root:
   `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/preview/main.tsx"></script></body></html>`
4. `npx vite --port 5174 --strictPort &`
5. Screenshot with Playwright (Chromium is preinstalled in Claude's cloud workspace at
   `/opt/pw-browsers/chromium`; use `playwright-core` with `executablePath`):
   default (dark), `?light=1`, and a 820px-wide viewport, `fullPage: true`. Collect `pageerror` and
   console errors.
6. Look at every screenshot. Fix and re-shoot before calling it done. Delete the harness afterwards.
