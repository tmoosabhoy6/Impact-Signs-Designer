import fs from 'node:fs';
import express from 'express';
import { config, fromRoot } from './config.js';
import { api } from './routes.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use('/api', api);
// Static libraries (icons, brand assets) so the app can show exactly what the proof will use.
app.use('/library/assets', express.static(fromRoot('assets'), { maxAge: '1h' }));
app.use('/library/brand', express.static(fromRoot('brand-assets'), { maxAge: '1h' }));

const dist = fromRoot('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(fromRoot('dist', 'index.html')));
}

app.listen(config.port, () => {
  console.log(`Plaque Proof Studio on http://localhost:${config.port} (${config.mockAI ? 'demo mode' : 'live OpenAI'})`);
  if (!config.openaiKey && !config.mockAI) console.warn('OPENAI_API_KEY is not set: generation will fail until it is added.');
  if (!config.appPassword) console.warn('APP_PASSWORD is not set: anyone who can reach this server can use it.');
});
