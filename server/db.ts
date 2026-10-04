// Storage: one SQLite file plus image/PDF files under DATA_DIR. Records are never overwritten:
// every concept, fix and output is a new row that points at its parent.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import type { ConceptRecord, OutputRecord, Project } from '../shared/types.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new Database(path.join(config.dataDir, 'studio.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spend (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, usd REAL NOT NULL);
CREATE INDEX IF NOT EXISTS concepts_project ON concepts(project_id);
CREATE INDEX IF NOT EXISTS outputs_project ON outputs(project_id);
`);

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
export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Project) : null;
}
export function listProjects(): Project[] {
  return (db.prepare('SELECT data FROM projects ORDER BY updated_at DESC LIMIT 500').all() as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function deleteProject(id: string) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
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
export function getConcept(id: string): ConceptRecord | null {
  const row = db.prepare('SELECT data FROM concepts WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
export function listConcepts(projectId: string): ConceptRecord[] {
  return (db.prepare('SELECT data FROM concepts WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as { data: string }[]).map((r) => JSON.parse(r.data));
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
