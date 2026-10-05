import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const ROOT = path.resolve(import.meta.dirname, '..');

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
  sessionSecret: process.env.SESSION_SECRET || 'change-me',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data-store'),
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
