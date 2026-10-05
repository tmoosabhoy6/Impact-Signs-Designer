import { config } from './config.js';
import { authMode } from './auth.js';
import { createApp } from './app.js';
import { failAbandonedConcepts } from './db.js';

const abandoned = failAbandonedConcepts();
if (abandoned) console.warn(`${abandoned} image(s) were still rendering when the server last stopped; they are marked as failed.`);
createApp().listen(config.port, () => {
  console.log(`Plaque Proof Studio on http://localhost:${config.port} (${config.mockAI ? 'demo mode' : 'live OpenAI'})`);
  if (!config.openaiKey && !config.mockAI) console.warn('OPENAI_API_KEY is not set: generation will fail until it is added.');
  const mode = authMode();
  if (mode === 'open') console.warn('No sign-in is configured (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY, or APP_PASSWORD): anyone who can reach this server can use it.');
  if (mode === 'unconfigured') console.warn('Sign-in is not set up: nobody can sign in until SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or APP_PASSWORD) are added.');
  if (config.isProd && config.sessionSecret === 'change-me') console.warn('SESSION_SECRET is not set: sign-in cookies are signed with a known default. Set it in the server settings.');
});
