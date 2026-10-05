// Customer files: photos, logos, sketches (several of each), the site photo and a font.
// Originals are kept untouched; a normalized PNG copy is made for previews and for
// sending to the image model. Files are never deleted from disk while the job exists:
// older versions keep pointing at the files they were made with.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { projectDir } from './db.js';
import { isMultiKind, KIND_LABEL, LIST_KEY, UPLOAD_LIMITS, type MultiUploadKind, type UploadKind } from '../shared/uploads.js';
import type { Project, UploadedFile, UploadedImage, UploadedLogo, Uploads } from '../shared/types.js';

export type { UploadKind, MultiUploadKind };

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

/** A processed file, written to disk, not yet part of the job. */
export type PreparedUpload =
  | { kind: 'photo'; entry: UploadedImage }
  | { kind: 'logo'; entry: UploadedLogo }
  | { kind: 'sketch'; entry: UploadedFile }
  | { kind: 'site'; entry: NonNullable<Uploads['site']> }
  | { kind: 'font'; entry: NonNullable<Uploads['font']> };

export const listOf = (project: Project, kind: MultiUploadKind): UploadedFile[] => project.uploads[LIST_KEY[kind]];

/** Refuses before any work when the job is full or the file is already on it. */
export function checkCanAdd(project: Project, kind: UploadKind, originalName: string, hash?: string) {
  if (!isMultiKind(kind)) return;
  const list = listOf(project, kind);
  const { one, many } = KIND_LABEL[kind];
  if (list.length >= UPLOAD_LIMITS[kind]) {
    throw new Error(`${originalName} was not added: a job can have up to ${UPLOAD_LIMITS[kind]} ${many}. Remove one first.`);
  }
  const same = hash ? list.find((f) => f.hash === hash) : undefined;
  if (same) throw new Error(`${originalName} was not added: this ${one} is already on the job${same.name !== originalName ? ` (as ${same.name})` : ''}.`);
}

export const fileHash = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * Reads, normalizes and writes one uploaded file. Nothing about the job changes here, so a
 * slow file (a big TIFF or PDF) never holds the job: the caller adds the result to a freshly
 * loaded copy afterwards (`addUpload`).
 */
export async function prepareUpload(projectId: string, kind: UploadKind, originalName: string, data: Buffer): Promise<PreparedUpload> {
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  if (kind === 'font' && !/\.(otf|ttf|woff)$/i.test(ext)) throw new Error('Font files must be .otf, .ttf or .woff.');
  if (!data.length) throw new Error(`${originalName} is empty. Export it again and upload the new copy.`);
  const dir = projectDir(projectId, 'uploads');
  // Time plus random: several files of one kind can arrive in the same millisecond.
  const id = `${kind}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const hash = fileHash(data);
  const origFile = path.join(dir, `${id}-original${ext}`);

  if (kind === 'font') {
    fs.writeFileSync(origFile, data);
    return { kind, entry: { file: path.basename(origFile), name: originalName } };
  }

  let png: Buffer;
  try {
    if (/\.(pdf|ai|eps)$/i.test(ext)) {
      fs.writeFileSync(origFile, data);
      png = pdfToPng(origFile, kind === 'logo' ? 600 : 200);
    } else if (ext === '.svg') png = await sharp(data, { density: 600 }).png().toBuffer();
    else png = await sharp(data).rotate().png().toBuffer();
    // Keep a sensible working size (the original is preserved).
    const maxEdge = kind === 'logo' ? 3000 : 2400;
    png = await sharp(png).resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch (e) {
    if (/PDF\/\.ai/.test((e as Error).message)) throw new Error(`${originalName}: ${(e as Error).message}`);
    throw new Error(`${originalName} could not be read as an image. Upload a JPG, PNG, TIFF, SVG or PDF.`);
  }
  if (!fs.existsSync(origFile)) fs.writeFileSync(origFile, data);
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error(`${originalName} has no visible size. Export it again and upload the new copy.`);
  const pngName = `${id}.png`;
  fs.writeFileSync(path.join(dir, pngName), png);

  const base = { id, file: pngName, name: originalName, hash };
  if (kind === 'photo') return { kind, entry: { ...base, width, height } };
  if (kind === 'logo') return { kind, entry: { ...base, width, height, vectorSource: VECTOR_EXT.test(ext) } };
  if (kind === 'sketch') return { kind, entry: base };
  return { kind, entry: { file: pngName, name: originalName, width, height } };
}

/** The job with the file added (lists grow; the site photo and font are replaced). */
export function addUpload(project: Project, prepared: PreparedUpload): Project {
  const u = project.uploads;
  if (isMultiKind(prepared.kind)) checkCanAdd(project, prepared.kind, prepared.entry.name, (prepared.entry as UploadedFile).hash);
  switch (prepared.kind) {
    case 'photo':
      return { ...project, uploads: { ...u, photos: [...u.photos, prepared.entry] } };
    case 'logo':
      return { ...project, uploads: { ...u, logos: [...u.logos, prepared.entry] } };
    case 'sketch':
      return { ...project, uploads: { ...u, sketches: [...u.sketches, prepared.entry] } };
    case 'site':
      return { ...project, uploads: { ...u, site: prepared.entry } };
    case 'font':
      return { ...project, uploads: { ...u, font: prepared.entry } };
  }
}

/** Prepare and add in one step (example jobs and tests; routes use the two steps). */
export async function storeUpload(project: Project, kind: UploadKind, originalName: string, data: Buffer): Promise<Project> {
  checkCanAdd(project, kind, originalName, fileHash(data));
  return addUpload(project, await prepareUpload(project.id, kind, originalName, data));
}

/** Removes one file from the job (or the single site photo / font). The file stays on disk for older versions. */
export function removeUpload(project: Project, kind: UploadKind, id?: string): Project {
  const uploads: Uploads = { ...project.uploads };
  if (isMultiKind(kind)) {
    if (!id) throw new Error(`Say which ${KIND_LABEL[kind].one} to remove.`);
    const key = LIST_KEY[kind];
    const list = uploads[key] as UploadedFile[];
    if (!list.some((f) => f.id === id)) throw new Error(`That ${KIND_LABEL[kind].one} is no longer on this job. Reload the page.`);
    (uploads[key] as UploadedFile[]) = list.filter((f) => f.id !== id);
  } else {
    delete uploads[kind];
  }
  return { ...project, uploads };
}

/** Puts the files of one kind in the given order (left to right on the plaque). */
export function reorderUploads(project: Project, kind: MultiUploadKind, ids: unknown): Project {
  const key = LIST_KEY[kind];
  const list = project.uploads[key] as UploadedFile[];
  const want = Array.isArray(ids) ? ids.map(String) : [];
  // The new order must name exactly the files on the job, so a stale page cannot drop one.
  if (want.length !== list.length || new Set(want).size !== want.length || !want.every((id) => list.some((f) => f.id === id))) {
    throw new Error(`The ${KIND_LABEL[kind].many} on this job have changed. Reload the page and try again.`);
  }
  return { ...project, uploads: { ...project.uploads, [key]: want.map((id) => list.find((f) => f.id === id)!) } };
}

/** Path of a stored file: a list item by id (the first when no id is given), or the site photo / font. */
export function uploadPath(project: Project, kind: UploadKind, id?: string): string | null {
  const u = isMultiKind(kind) ? (id ? listOf(project, kind).find((f) => f.id === id) : listOf(project, kind)[0]) : project.uploads[kind];
  return u ? path.join(projectDir(project.id, 'uploads'), u.file) : null;
}

/** Effective resolution of a photo at its printed size, in pixels per inch. */
export function photoPpi(photo: { width: number } | undefined, frameWidthIn: number): number | null {
  if (!photo || !frameWidthIn) return null;
  return Math.round(photo.width / frameWidthIn);
}
