import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '@fontsource-variable/lora';
import '@fontsource-variable/lora/wght-italic.css';
import './index.css';
import { SettingsProvider } from './context/SettingsContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { DevConsoleProvider } from './context/DevConsoleContext.tsx';
import { AccountProvider } from './context/AccountContext.tsx';
import { AccountGate } from './components/account/AccountGate.tsx';

const VITE_PRELOAD_RELOAD_KEY = 'missenseVitePreloadLastReloadAt';
const VITE_PRELOAD_RELOAD_COOLDOWN_MS = 30_000;

// Auto-recover if dynamic code-split chunk hashes change across production deployments
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const now = Date.now();
    try {
      const last = Number(sessionStorage.getItem(VITE_PRELOAD_RELOAD_KEY) || '0');
      if (Number.isFinite(last) && now - last < VITE_PRELOAD_RELOAD_COOLDOWN_MS) {
        console.error('[Vite Preload] Suppressed repeat reload after recent preload failure.', event);
        return;
      }
      sessionStorage.setItem(VITE_PRELOAD_RELOAD_KEY, String(now));
    } catch {
      console.error('[Vite Preload] sessionStorage is unavailable; skipping automatic reload to avoid a reload loop.', event);
      return;
    }
    console.warn('[Vite Preload] Outdated dynamic chunk detected after deployment. Auto-reloading...', event);
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevConsoleProvider>
      <SettingsProvider>
        <AccountProvider>
          <ErrorBoundary name="Missense Structural Explorer">
            <AccountGate>
              <App />
            </AccountGate>
          </ErrorBoundary>
        </AccountProvider>
      </SettingsProvider>
    </DevConsoleProvider>
  </StrictMode>,
);
