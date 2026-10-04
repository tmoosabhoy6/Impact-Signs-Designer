// Login: one shared team password (APP_PASSWORD) plus the person's name, kept in a signed cookie.
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

const COOKIE = 'pps_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

const sign = (v: string) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');

export function issueSession(res: Response, name: string) {
  const payload = Buffer.from(JSON.stringify({ name, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
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

export function sessionUser(req: Request): { name: string } | null {
  if (!config.appPassword) return { name: 'Designer' };
  const v = readCookie(req);
  if (!v) return null;
  const [payload, sig] = v.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { name: string; exp: number };
    return data.exp > Date.now() ? { name: data.name } : null;
  } catch {
    return null;
  }
}

export function checkPassword(pw: string): boolean {
  if (!config.appPassword) return true;
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  (req as Request & { user: { name: string } }).user = user;
  next();
}
