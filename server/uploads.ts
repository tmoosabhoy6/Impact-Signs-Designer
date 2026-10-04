// Customer files: photo, logo, sketch. Originals are kept untouched; a normalized PNG
// copy is made for previews and for sending to the image model.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { projectDir } from './db.js';
import type { Project } from '../shared/types.js';

export type UploadKind = 'photo' | 'logo' | 'sketch';

const VECTOR_EXT = /\.(svg|pdf|ai|eps)$/i;

/** Rasterizes the first page of a PDF / .ai file with Poppler (installed in the Docker image). */
export function pdfToPng(file: string, dpi = 300): Buffer {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pps-'));
  try {
    execFileSync('pdftocairo', ['-png', '-singlefile', '-r', String(dpi), '-f', '1', '-l', '1', file, path.join(tmp, 'out')], { timeout: 60_000 });
    return fs.readFileSync(path.join(tmp, 'out.png'));
  } catch {
    throw new Error('Could not read this PDF/.ai file. Export it as PNG, JPG or SVG and upload again.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function storeUpload(project: Project, kind: UploadKind, originalName: string, data: Buffer): Promise<Project> {
  const dir = projectDir(project.id, 'uploads');
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const stamp = Date.now().toString(36);
  const origFile = path.join(dir, `${kind}-${stamp}-original${ext}`);
  fs.writeFileSync(origFile, data);

  let png: Buffer;
  if (/\.(pdf|ai|eps)$/i.test(ext)) png = pdfToPng(origFile, kind === 'logo' ? 600 : 200);
  else if (ext === '.svg') png = await sharp(data, { density: 600 }).png().toBuffer();
  else png = await sharp(data).rotate().png().toBuffer();

  // Keep a sensible working size (the original is preserved).
  const maxEdge = kind === 'logo' ? 3000 : 2400;
  png = await sharp(png).resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(png).metadata();
  const pngName = `${kind}-${stamp}.png`;
  fs.writeFileSync(path.join(dir, pngName), png);

  const uploads = { ...project.uploads };
  if (kind === 'photo') uploads.photo = { file: pngName, name: originalName, width: meta.width ?? 0, height: meta.height ?? 0 };
  if (kind === 'logo') uploads.logo = { file: pngName, name: originalName, width: meta.width ?? 0, height: meta.height ?? 0, vectorSource: VECTOR_EXT.test(ext) };
  if (kind === 'sketch') uploads.sketch = { file: pngName, name: originalName };
  return { ...project, uploads };
}

export function uploadPath(project: Project, kind: UploadKind): string | null {
  const u = project.uploads[kind];
  return u ? path.join(projectDir(project.id, 'uploads'), u.file) : null;
}

/** Effective resolution of the photo at its printed size, in pixels per inch. */
export function photoPpi(project: Project, frameWidthIn: number): number | null {
  const p = project.uploads.photo;
  if (!p || !frameWidthIn) return null;
  return Math.round(p.width / frameWidthIn);
}
