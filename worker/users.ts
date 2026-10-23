import type { Me, UserRef } from '../shared/api';
import type { Identity } from './auth/oidc';
import { now } from './crypto';

export interface UserRow {
  id: string;
  subject: string;
  email: string;
  name: string;
}

export async function upsertUser(db: D1Database, identity: Identity): Promise<UserRow> {
  const at = now();
  const row = await db
    .prepare(
      `INSERT INTO users (id, subject, tenant_id, email, name, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject) DO UPDATE SET
         email = excluded.email, name = excluded.name, tenant_id = excluded.tenant_id, last_login_at = excluded.last_login_at
       RETURNING id, subject, email, name`,
    )
    .bind(crypto.randomUUID(), identity.subject, identity.tenantId, identity.email, identity.name, at, at)
    .first<UserRow>();
  if (!row) throw new Error('사용자를 저장하지 못했습니다.');
  return row;
}

export function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT id, subject, email, name FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export function toMe(user: UserRow): Me {
  return { id: user.id, email: user.email, name: user.name };
}

/**
 * 여러 행에 흩어진 사용자 id 를 한 번에 읽는다. workspaceId 를 주면 그 워크스페이스에서 고른 팀도 함께 읽는다.
 * 없는 id 는 '(알 수 없음)' 으로 채운다.
 */
export async function loadUserRefs(
  db: D1Database,
  ids: Iterable<string | null>,
  workspaceId: number | null,
): Promise<(id: string) => UserRef> {
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  const map = new Map<string, UserRef>();
  if (unique.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT u.id, u.name, t.name AS team FROM users u
         LEFT JOIN workspace_members m ON m.user_id = u.id AND m.workspace_id = ?
         LEFT JOIN workspace_teams t ON t.id = m.team_id
         WHERE u.id IN (${unique.map(() => '?').join(',')})`,
      )
      .bind(workspaceId, ...unique)
      .all<UserRef>();
    for (const r of results) map.set(r.id, r);
  }
  return (id) => map.get(id) ?? { id, name: '(알 수 없음)', team: null };
}
