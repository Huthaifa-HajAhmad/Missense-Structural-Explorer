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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevConsoleProvider>
      <SettingsProvider>
        <ErrorBoundary name="Missense Structural Explorer">
          <App />
        </ErrorBoundary>
      </SettingsProvider>
    </DevConsoleProvider>
  </StrictMode>,
);
