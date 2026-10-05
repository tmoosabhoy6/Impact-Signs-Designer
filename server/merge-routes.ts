// API for the Proof Merger page. Mounted at /api/merge behind sign-in.
// Nothing is stored: the PDFs arrive, are joined in the order sent and go straight back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { PDFDocument } from 'pdf-lib';
import { mergeProofs } from './pdf/proofs/index.js';
import { pdfToPng } from './uploads.js';
import { MERGE_MAX_FILES, MERGE_UPLOAD_MB, type MergePreview } from '../shared/merge.js';

export const mergeRouter = express.Router();
const limits = { fileSize: MERGE_UPLOAD_MB * 1024 * 1024 };
const upload = multer({ storage: multer.memoryStorage(), limits });
const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many files in a minute. Please wait a moment.' } });

const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response) =>
    Promise.resolve().then(() => fn(req, res)).catch((e: Error) => {
      console.error(e);
      if (!res.headersSent) res.status(400).json({ error: e.message || 'Something went wrong.' });
    });

const tooBig = `That file is larger than ${MERGE_UPLOAD_MB} MB.`;
const looksLikePdf = (b: Buffer) => b.subarray(0, 1024).includes('%PDF-');

/** Opens a PDF or says, in plain words, which file is the problem. */
async function openPdf(name: string, buffer: Buffer): Promise<PDFDocument> {
  if (!looksLikePdf(buffer)) throw new Error(`"${name}" is not a PDF.`);
  try {
    return await PDFDocument.load(buffer);
  } catch {
    throw new Error(`"${name}" could not be read. It may be damaged or password-protected. Re-save it as a PDF and try again.`);
  }
}

// One PDF in, its page count and a small picture of page 1 out.
mergeRouter.post('/preview', limiter, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? tooBig : 'The upload did not arrive. Try again.' });
    next();
  });
}, ah(async (req, res) => {
  if (!req.file) throw new Error('Choose a PDF.');
  const name = req.file.originalname;
  const doc = await openPdf(name, req.file.buffer);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-merge-'));
  try {
    const file = path.join(tmp, 'in.pdf');
    fs.writeFileSync(file, req.file.buffer);
    const png = pdfToPng(file, 60);
    const preview: MergePreview = { pages: doc.getPageCount(), image: `data:image/png;base64,${png.toString('base64')}` };
    res.json(preview);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}));

// The PDFs, in the order they were sent, joined into one. All pages of every file are kept.
mergeRouter.post('/', limiter, (req, res, next) => {
  upload.array('files', MERGE_MAX_FILES + 1)(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: (err as { code?: string }).code === 'LIMIT_FILE_SIZE' ? tooBig : 'The upload did not arrive. Try again.' });
    next();
  });
}, ah(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length < 2) throw new Error('Choose at least two PDFs to merge.');
  if (files.length > MERGE_MAX_FILES) throw new Error(`You can merge up to ${MERGE_MAX_FILES} PDFs at a time.`);
  for (const f of files) await openPdf(f.originalname, f.buffer);
  const merged = await mergeProofs(files.map((f) => f.buffer));
  res.type('application/pdf').setHeader('Content-Disposition', 'attachment; filename="merged-proofs.pdf"').send(merged);
}));
