// API for the Vectorizer page. Mounted at /api/vectors behind sign-in; independent of jobs.
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { deleteVector, getVector, listVectors, readVectorOptions, VECTOR_FILES, vectorizeFile, vectorRoot, type VectorFile, type VectorRecord } from './vectorize.js';
import { VECTOR_UPLOAD_MB } from '../shared/vectorize.js';
import { owns, userOf } from './auth.js';

export const vectorRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: VECTOR_UPLOAD_MB * 1024 * 1024 } });
const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many files in a minute. Please wait a moment.' } });

const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response) =>
    Promise.resolve().then(() => fn(req, res)).catch((e: Error) => {
      console.error(e);
      if (!res.headersSent) res.status(400).json({ error: e.message || 'Something went wrong.' });
    });

/** The vector file, if the signed-in person made it (someone else's reads as missing). */
function loadVector(req: Request): VectorRecord | null {
  const v = getVector(String(req.params.id));
  return v && owns(userOf(req), v.ownerId) ? v : null;
}

vectorRouter.get('/', (req, res) => {
  const user = userOf(req);
  res.json({ vectors: listVectors((v) => owns(user, v.ownerId)) });
});

vectorRouter.post('/', limiter, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? `That file is larger than ${VECTOR_UPLOAD_MB} MB.` : 'The upload did not arrive. Try again.' });
    next();
  });
}, ah(async (req, res) => {
  if (!req.file) throw new Error('Choose a picture or PDF to vectorize.');
  const user = userOf(req);
  const vector = await vectorizeFile({ name: req.file.originalname, buffer: req.file.buffer }, readVectorOptions(req.body), user.name, user.id);
  res.json({ vector });
}));

vectorRouter.get('/:id/:file', ah((req, res) => {
  const v = loadVector(req);
  const file = String(req.params.file) as VectorFile;
  if (!v || !VECTOR_FILES.includes(file)) return res.status(404).json({ error: 'Not found.' });
  if (req.query.download) {
    const ext = path.extname(file);
    return res.download(vectorRoot(v.id, file), `${v.name}-vector${ext}`);
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (file === 'result.pdf') res.type('application/pdf');
  if (file === 'result.svg') res.type('image/svg+xml');
  res.sendFile(path.resolve(vectorRoot(v.id, file)));
}));

vectorRouter.delete('/:id', ah((req, res) => {
  const v = loadVector(req);
  if (!v) return res.status(404).json({ error: 'Not found.' });
  deleteVector(v.id);
  res.json({ ok: true });
}));
