// Storage: one SQLite file plus image/PDF files under DATA_DIR. Records are never overwritten:
// every concept, fix and output is a new row that points at its parent.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { normalizeUploads } from '../shared/uploads.js';
import type { ConceptRecord, OutputRecord, Project } from '../shared/types.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, 'studio.db'));

/**
 * Switching a fresh database to WAL needs a moment of exclusive access, and SQLite answers
 * "database is locked" at once (without waiting) if another connection opens it at the same
 * time, e.g. parallel test workers. Retry briefly instead of failing.
 */
function whenUnlocked<T>(run: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return run();
    } catch (e) {
      if ((e as { code?: string }).code !== 'SQLITE_BUSY' || attempt >= 50) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
whenUnlocked(() => db.pragma('journal_mode = WAL'));
whenUnlocked(() => db.exec(`
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, usd REAL NOT NULL);
CREATE INDEX IF NOT EXISTS concepts_project ON concepts(project_id);
CREATE INDEX IF NOT EXISTS outputs_project ON outputs(project_id);
`));

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();

export function projectDir(projectId: string, ...sub: string[]) {
  if (!/^[a-z]+_[a-f0-9]+$/.test(projectId)) throw new Error('Bad project id');
  const dir = path.join(config.dataDir, 'projects', projectId, ...sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Projects
export function saveProject(p: Project) {
  p.updatedAt = now();
  db.prepare('INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(
    p.id,
    JSON.stringify(p),
    p.updatedAt,
  );
  return p;
}
/** Fills fields added in later versions, so jobs saved earlier keep working. */
export function upgrade(p: Project): Project {
  p.proofDescription ??= null;
  p.imageAfterBlock ??= null;
  p.proofNote ??= null;
  // Jobs from before several images could be proofed had at most one image on the proof.
  p.proofConceptIds ??= p.selectedConceptId ? [p.selectedConceptId] : [];
  p.logoSlot ??= 'auto';
  // One photo / logo / sketch per job became lists; old jobs read as one-item lists.
  p.uploads = normalizeUploads(p.uploads);
  if (p.spec) {
    p.spec.process ??= 'cast';
    p.spec.thicknessIn ??= null;
    p.spec.stakeLengthIn ??= null;
    p.spec.customFontName ??= null;
    p.spec.customPaint ??= null;
    p.spec.logoTreatment ??= 'raised-cast';
  }
  return p;
}

/** A new, empty job with every field at its default. */
export function blankProject(fields: Pick<Project, 'jobNumber' | 'name' | 'createdBy'> & Partial<Pick<Project, 'ownerId'>>): Project {
  const t = now();
  return upgrade({
    id: newId('p'),
    specText: '',
    parse: null,
    spec: null,
    wordingText: '',
    wording: null,
    uploads: normalizeUploads(null),
    selectedConceptId: null,
    proofConceptIds: [] as string[],
    createdAt: t,
    updatedAt: t,
    ...fields,
  } as Project);
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? upgrade(JSON.parse(row.data) as Project) : null;
}
export function listProjects(): Project[] {
  return (db.prepare('SELECT data FROM projects ORDER BY updated_at DESC LIMIT 5000').all() as { data: string }[]).map((r) => upgrade(JSON.parse(r.data)));
}
/** Removes a job with its concepts, outputs and stored files. */
export function deleteProject(id: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM concepts WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM outputs WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  })();
  if (/^[a-z]+_[a-f0-9]+$/.test(id)) fs.rmSync(path.join(config.dataDir, 'projects', id), { recursive: true, force: true });
}

// Concepts
export function saveConcept(c: ConceptRecord) {
  db.prepare('INSERT INTO concepts (id, project_id, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(
    c.id,
    c.projectId,
    JSON.stringify(c),
    c.createdAt,
  );
  return c;
}
/**
 * Versions freeze the job's files. Snapshots from before upload lists hold single files;
 * upgrading them here keeps "Use this version", Undo and the snapshot comparison working.
 */
export function upgradeConcept(c: ConceptRecord): ConceptRecord {
  for (const snap of [c.snapshot, c.previous]) if (snap?.uploads) snap.uploads = normalizeUploads(snap.uploads);
  return c;
}
export function getConcept(id: string): ConceptRecord | null {
  const row = db.prepare('SELECT data FROM concepts WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? upgradeConcept(JSON.parse(row.data)) : null;
}
export function listConcepts(projectId: string): ConceptRecord[] {
  return (db.prepare('SELECT data FROM concepts WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as { data: string }[]).map((r) => upgradeConcept(JSON.parse(r.data)));
}

/**
 * Versions still "queued" or "running" when the server starts were cut off by a restart: no
 * image is coming. They are marked as failed so the job is not blocked for ever.
 */
export function failAbandonedConcepts(): number {
  const rows = db.prepare('SELECT data FROM concepts').all() as { data: string }[];
  let n = 0;
  for (const r of rows) {
    const c = upgradeConcept(JSON.parse(r.data) as ConceptRecord);
    if (c.status !== 'queued' && c.status !== 'running') continue;
    c.status = 'error';
    c.error = 'The server restarted while this image was rendering. Generate it again.';
    saveConcept(c);
    n++;
  }
  return n;
}

// Outputs
export function saveOutput(o: OutputRecord) {
  db.prepare('INSERT INTO outputs (id, project_id, data, created_at) VALUES (?, ?, ?, ?)').run(o.id, o.projectId, JSON.stringify(o), o.createdAt);
  return o;
}
export function getOutput(id: string): OutputRecord | null {
  const row = db.prepare('SELECT data FROM outputs WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
export function listOutputs(projectId: string): OutputRecord[] {
  return (db.prepare('SELECT data FROM outputs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as { data: string }[]).map((r) => JSON.parse(r.data));
}

// Spend tracking for the daily budget
export function addSpend(usd: number) {
  db.prepare('INSERT INTO spend (day, usd) VALUES (?, ?)').run(now().slice(0, 10), usd);
}
export function spentToday(): number {
  const row = db.prepare('SELECT COALESCE(SUM(usd), 0) AS s FROM spend WHERE day = ?').get(now().slice(0, 10)) as { s: number };
  return row.s;
}
