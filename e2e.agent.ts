import { createGoogleGenerativeAI } from '@ai-sdk/google';

// The runner does not read .env; the app does. Load it so the agent model can share the app's key.
// A CI runner has no .env and passes the key through the environment instead.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env: the environment already holds what it needs */
}

const gemini = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

/** Model behind every agent.* step and `e2e explore`. Tests under tests/ stay deterministic. */
export const agentModel = gemini(process.env.GEMINI_MODEL ?? 'gemini-3.7-flash');

export const agentSystem =
  'You are a QA agent for a clinical variant-interpretation web app (Missense & Fold). ' +
  'Service tiles that read "offline" or "fallback" reflect live upstream health and are not bugs; ' +
  'a missing Gemini key only disables the optional AI synthesis. Verify every outcome on screen.';
