// API for the AI Upscaler page. Mounted at /api/upscales behind sign-in; independent of jobs.
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { deleteUpscale, getUpscale, listUpscales, upscaleImage, upscaleRoot, UPSCALE_TARGETS, type UpscaleTarget } from './ai/upscale.js';

export const upscaleRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many upscales in a minute. Please wait a moment.' } });
const FILES = { 'upscaled.png': 'upscaled', 'standard.png': 'standard', 'original.png': 'original', 'thumb.jpg': null } as const;

const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response) =>
    Promise.resolve(fn(req, res)).catch((e: Error) => {
      console.error(e);
      if (!res.headersSent) res.status(400).json({ error: e.message || 'Something went wrong.' });
    });

upscaleRouter.get('/', (_req, res) => res.json({ upscales: listUpscales() }));

upscaleRouter.post('/', limiter, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 30 MB.' : 'The upload did not arrive. Try again.' });
    next();
  });
}, ah(async (req, res) => {
  if (!req.file) throw new Error('Choose an image to upscale.');
  const target = String(req.body?.target || '720p') as UpscaleTarget;
  if (!(target in UPSCALE_TARGETS)) throw new Error('Choose 720p or 1080p.');
  const user = (req as Request & { user?: { name: string } }).user?.name ?? 'Designer';
  const upscale = await upscaleImage({ name: req.file.originalname, buffer: req.file.buffer }, target, user);
  res.json({ upscale });
}));

upscaleRouter.get('/:id/:file', ah((req, res) => {
  const u = getUpscale(String(req.params.id));
  const file = String(req.params.file) as keyof typeof FILES;
  if (!u || !(file in FILES)) return res.status(404).json({ error: 'Not found.' });
  const label = FILES[file];
  if (req.query.download && label) {
    const suffix = label === 'upscaled' ? `upscaled-${u.target}` : label === 'standard' ? `standard-${u.target}` : 'original';
    return res.download(upscaleRoot(u.id, file), `${u.name}-${suffix}.png`);
  }
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(upscaleRoot(u.id, file)));
}));

upscaleRouter.delete('/:id', ah((req, res) => {
  const u = getUpscale(String(req.params.id));
  if (!u) return res.status(404).json({ error: 'Not found.' });
  deleteUpscale(u.id);
  res.json({ ok: true });
}));
