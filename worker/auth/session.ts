import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { addSeconds, now, randomToken, sha256 } from '../crypto';
import type { AppEnv } from '../env';
import { type UserRow, getUser } from '../users';

type WithEnv = { Bindings: AppEnv };

const SESSION_COOKIE = 'spec_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const secure = (env: AppEnv) => env.PUBLIC_ORIGIN.startsWith('https://');

export async function startSession<E extends WithEnv>(c: Context<E>, userId: string): Promise<void> {
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now(), addSeconds(SESSION_TTL_SECONDS))
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c.env),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function sessionUser<E extends WithEnv>(c: Context<E>): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), now())
    .first<{ user_id: string }>();
  return row ? getUser(c.env.DB, row.user_id) : null;
}

export async function endSession<E extends WithEnv>(c: Context<E>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secure(c.env) });
}

/** 로그인 뒤 돌아갈 경로. 다른 사이트로 보내는 열린 리다이렉트를 막으려고 같은 출처의 경로만 받는다. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
