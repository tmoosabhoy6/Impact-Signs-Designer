import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const ROOT = path.resolve(import.meta.dirname, '..');

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || './data-store');

/** The cookie-signing secret. If SESSION_SECRET is not set in production, a random one is made once and kept on the data disk, so the app never signs logins with a guessable value and a redeploy does not sign everyone out. */
function loadSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV !== 'production') return 'change-me';
  const file = path.join(dataDir, '.session-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {
    // not made yet
  }
  const made = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, made, { mode: 0o600 });
  } catch {
    console.warn('SESSION_SECRET is not set and the data disk is not writable: everyone will be signed out on each restart.');
  }
  return made;
}

export const config = {
  port: num(process.env.PORT, 8080),
  isProd: process.env.NODE_ENV === 'production',
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-5.4-mini',
  /** Reads designer Fix instructions into a checked plan (falls back to the vision model). */
  plannerModel: process.env.OPENAI_PLANNER_MODEL || 'gpt-5.4',
  imageQuality: 'max' as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  imageLongEdge: 1536,
  appPassword: process.env.APP_PASSWORD ?? '',
  /** Supabase project holding the sign-in accounts (username + password). */
  supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  /** Jobs made before sign-in accounts existed belong to this username. */
  legacyOwner: (process.env.LEGACY_JOBS_OWNER || 'taher').toLowerCase(),
  sessionSecret: loadSessionSecret(),
  dataDir,
  mockAI: process.env.MOCK_AI === '1',
  /** Image renders running at once across ALL users. Each one holds several large pictures in memory, so a small server needs a low number. */
  maxParallelImages: Math.min(2, Math.max(1, Math.floor(num(process.env.MAX_PARALLEL_IMAGES, 2)))),
  maxImageCallsPerProject: num(process.env.MAX_IMAGE_CALLS_PER_PROJECT, 40),
  dailyBudgetUsd: num(process.env.DAILY_BUDGET_USD, 40),
  prices: {
    textIn: num(process.env.PRICE_TEXT_IN, 5),
    imageIn: num(process.env.PRICE_IMAGE_IN, 8),
    imageOut: num(process.env.PRICE_IMAGE_OUT, 30),
  },
};

export const fromRoot = (...p: string[]) => path.join(ROOT, ...p);
