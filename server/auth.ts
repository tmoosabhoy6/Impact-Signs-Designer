// Sign-in, kept in a signed cookie. Three modes:
//  - supabase: username + password checked against the accounts in Supabase (app_login);
//  - password: one shared team password (APP_PASSWORD) plus the person's name (older setup);
//  - open: no sign-in, for local development only (never in production).
// Every signed-in person has their own jobs and upscales (see ownership in routes).
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

const COOKIE = 'pps_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

export interface SessionUser {
  /** Stable owner id for jobs and upscales. */
  id: string;
  username: string;
  /** Shown in the app and stored as "created by". */
  name: string;
}

export type AuthMode = 'supabase' | 'password' | 'open' | 'unconfigured';

export function authMode(): AuthMode {
  if (config.supabaseUrl && config.supabaseKey) return 'supabase';
  if (config.appPassword) return 'password';
  return config.isProd ? 'unconfigured' : 'open';
}

const OPEN_USER: SessionUser = { id: 'local', username: 'designer', name: 'Designer' };

const sign = (v: string) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');

export function issueSession(res: Response, user: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, mode: authMode(), exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE_MS });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE);
}

function readCookie(req: Request): string | null {
  const raw = req.headers.cookie ?? '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export function sessionUser(req: Request): SessionUser | null {
  const mode = authMode();
  if (mode === 'open') return OPEN_USER;
  if (mode === 'unconfigured') return null;
  const v = readCookie(req);
  if (!v) return null;
  const [payload, sig] = v.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<SessionUser> & { exp: number; mode?: AuthMode };
    // A cookie from another sign-in mode (e.g. before accounts were set up) is not valid.
    if (data.exp <= Date.now() || data.mode !== mode || !data.id || !data.username || !data.name) return null;
    return { id: data.id, username: data.username, name: data.name };
  } catch {
    return null;
  }
}

function sharedPasswordMatches(pw: string): boolean {
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Checks a sign-in. Returns the person, null for a wrong username/password, or throws a plain-English problem. */
export async function checkLogin(username: string, password: string): Promise<SessionUser | null> {
  const mode = authMode();
  const name = username.trim().slice(0, 60);
  if (mode === 'open') return { ...OPEN_USER, name: name || OPEN_USER.name };
  if (mode === 'unconfigured') throw new Error('Sign-in is not set up on this server. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the server settings.');
  if (!name || !password) return null;
  if (mode === 'password') {
    if (!sharedPasswordMatches(password)) return null;
    return { id: `name:${name.toLowerCase()}`, username: name, name };
  }
  let res: globalThis.Response;
  try {
    res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/app_login`, {
      method: 'POST',
      headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_username: name, p_password: password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Could not reach the sign-in service. Try again in a minute.');
  }
  const body = (await res.json().catch(() => null)) as { id: string; username: string; display_name: string }[] | { message?: string } | null;
  if (!res.ok) {
    const message = body && !Array.isArray(body) ? body.message ?? '' : '';
    if (/too many wrong passwords/i.test(message)) throw new Error(message);
    console.error(`Supabase sign-in failed (${res.status}).`);
    throw new Error('The sign-in service is not working right now. Try again in a minute.');
  }
  const row = Array.isArray(body) ? body[0] : null;
  return row ? { id: `sb:${row.id}`, username: row.username, name: row.display_name || row.username } : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  (req as Request & { user: SessionUser }).user = user;
  next();
}

export const userOf = (req: Request): SessionUser => (req as Request & { user?: SessionUser }).user ?? OPEN_USER;

/** Whether this person may see a job or upscale with this owner (open mode is single-user). */
export function owns(user: SessionUser, ownerId: string | undefined | null): boolean {
  if (authMode() === 'open') return true;
  if (ownerId) return ownerId === user.id;
  // Work from before sign-in accounts existed belongs to the legacy owner.
  return user.username.toLowerCase() === config.legacyOwner;
}
