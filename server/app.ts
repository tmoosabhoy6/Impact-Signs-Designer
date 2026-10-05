// The Express app: API, static libraries and the built web app. index.ts starts it listening;
// tests mount it on a free port.
import fs from 'node:fs';
import express from 'express';
import { fromRoot } from './config.js';
import { api } from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use('/api', api);
  // Static libraries (icons, brand assets) so the app can show exactly what the proof will use.
  app.use('/library/assets', express.static(fromRoot('assets'), { maxAge: '1h' }));
  // Only the logo is public: brand-assets/fonts/ may hold licensed font files, which stay on the server.
  app.use('/library/brand', (req, res, next) => (/^\/logo\.(png|svg)$/.test(req.path) ? next() : res.status(404).end()), express.static(fromRoot('brand-assets'), { maxAge: '1h' }));

  const dist = fromRoot('dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(fromRoot('dist', 'index.html')));
  }
  return app;
}
