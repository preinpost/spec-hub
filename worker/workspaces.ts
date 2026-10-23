// 워크스페이스 · 팀 · 멤버 · 분류 · 템플릿. 기능 명세 규칙은 spec-service.ts 에 있다.
import type { Category, Member, Team, WorkspaceDetail, WorkspaceSummary } from '../shared/api';
import {
  DEFAULT_TEMPLATE,
  MAX_CATEGORY_DEPTH,
  type Role,
  SECTION_KEY_PATTERN,
  type Status,
  type Template,
  WORKSPACE_KEY_PATTERN,
} from '../shared/spec';
import { now } from './crypto';
import { badRequest, conflict, forbidden, notFound } from './errors';
import type { Actor } from './spec-service';
import { loadUserRefs } from './users';

export interface WorkspaceRow {
  id: number;
  key: string;
  name: string;
  description: string;
  template: string;
}

const DEFAULT_TEAMS = ['기획', '개발'];

export function requireText(value: string | null | undefined, what: string, max: number): string {
  const text = (value ?? '').trim();
  if (!text) throw badRequest(`${what}을(를) 입력해 주세요.`);
  if (text.length > max) throw badRequest(`${what}은(는) ${max.toLocaleString()}자를 넘을 수 없습니다.`);
  return text;
}

export const parseTemplate = (row: { template: string }): Template => JSON.parse(row.template) as Template;

export async function findWorkspace(db: D1Database, key: string): Promise<WorkspaceRow> {
  const row = await db
    .prepare('SELECT id, key, name, description, template FROM workspaces WHERE key = ?')
    .bind(key.trim().toUpperCase())
    .first<WorkspaceRow>();
  if (!row) throw notFound(`워크스페이스 ${key}`);
  return row;
}

export async function roleOf(db: D1Database, workspaceId: number, userId: string): Promise<Role | null> {
  const row = await db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/** 워크스페이스에서 무언가를 쓴 사람을 멤버로 넣는다. 이미 멤버면 역할을 건드리지 않는다. */
export function joinStatement(db: D1Database, workspaceId: number, userId: string): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)`)
    .bind(workspaceId, userId, now());
}

export class WorkspaceService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: Actor,
  ) {}

  async list(): Promise<WorkspaceSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT w.key, w.name, w.description,
           (SELECT COUNT(*) FROM features f WHERE f.workspace_id = w.id) AS feature_count,
           (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
           (SELECT role FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ?) AS my_role
         FROM workspaces w ORDER BY w.name`,
      )
      .bind(this.actor.user.id)
      .all<{ key: string; name: string; description: string; feature_count: number; member_count: number; my_role: Role | null }>();
    return results.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      featureCount: r.feature_count,
      memberCount: r.member_count,
      myRole: r.my_role,
    }));
  }

  async create(input: { key: string; name: string; description?: string }): Promise<{ key: string }> {
    const key = input.key.trim().toUpperCase();
    if (!WORKSPACE_KEY_PATTERN.test(key)) throw badRequest('워크스페이스 키는 영문 대문자로 시작하는 2~10자여야 합니다(예: WCN).');
    const name = requireText(input.name, '워크스페이스 이름', 60);
    const description = (input.description ?? '').trim().slice(0, 500);
    if (await this.db.prepare('SELECT 1 FROM workspaces WHERE key = ?').bind(key).first()) {
      throw conflict(`워크스페이스 키 ${key} 는 이미 있습니다.`);
    }
    const at = now();
    const wsId = '(SELECT id FROM workspaces WHERE key = ?)';
    await this.db.batch([
      this.db
        .prepare('INSERT INTO workspaces (key, name, description, template, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(key, name, description, JSON.stringify(DEFAULT_TEMPLATE), this.actor.user.id, at),
      ...DEFAULT_TEAMS.map((team, i) =>
        this.db.prepare(`INSERT INTO workspace_teams (workspace_id, name, sort_order) VALUES (${wsId}, ?, ?)`).bind(key, team, i),
      ),
      // 만든 사람이 첫 관리자다.
      this.db
        .prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${wsId}, ?, 'admin', ?)`)
        .bind(key, this.actor.user.id, at),
    ]);
    return { key };
  }

  async get(key: string): Promise<WorkspaceDetail> {
    const ws = await findWorkspace(this.db, key);
    const [teams, members, categories, features] = await this.db.batch([
      this.db.prepare('SELECT id, name FROM workspace_teams WHERE workspace_id = ? ORDER BY sort_order, id').bind(ws.id),
      this.db
        .prepare(
          `SELECT m.user_id, u.email, m.role, m.team_id, m.joined_at FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'approver' THEN 1 ELSE 2 END, u.name`,
        )
        .bind(ws.id),
      this.db
        .prepare('SELECT id, parent_id, name, depth, sort_order FROM categories WHERE workspace_id = ? ORDER BY sort_order, id')
        .bind(ws.id),
      this.db
        .prepare(
          `SELECT f.key, f.title, f.screen_path, f.entry_path, f.status, f.category_id, f.updated_at, f.updated_by,
             (SELECT COUNT(*) FROM questions q WHERE q.feature_id = f.id AND q.resolved_at IS NULL) AS open_questions
           FROM features f WHERE f.workspace_id = ? ORDER BY f.id`,
        )
        .bind(ws.id),
    ]);
    const memberRows = members.results as { user_id: string; email: string; role: Role; team_id: number | null; joined_at: string }[];
    const featureRows = features.results as {
      key: string;
      title: string;
      screen_path: string | null;
      entry_path: string | null;
      status: Status;
      category_id: number | null;
      updated_at: string;
      updated_by: string;
      open_questions: number;
    }[];
    const userRef = await loadUserRefs(this.db, [...memberRows.map((m) => m.user_id), ...featureRows.map((f) => f.updated_by)], ws.id);
    const me = memberRows.find((m) => m.user_id === this.actor.user.id);
    return {
      key: ws.key,
      name: ws.name,
      description: ws.description,
      template: parseTemplate(ws),
      teams: teams.results as unknown as Team[],
      members: memberRows.map(
        (m): Member => ({ user: userRef(m.user_id), email: m.email, role: m.role, teamId: m.team_id, joinedAt: m.joined_at }),
      ),
      categories: (categories.results as { id: number; parent_id: number | null; name: string; depth: number; sort_order: number }[]).map(
        (c): Category => ({ id: c.id, parentId: c.parent_id, name: c.name, depth: c.depth, sortOrder: c.sort_order }),
      ),
      features: featureRows.map((f) => ({
        key: f.key,
        title: f.title,
        screenPath: f.screen_path,
        entryPath: f.entry_path,
        status: f.status,
        categoryId: f.category_id,
        openQuestions: f.open_questions,
        updatedAt: f.updated_at,
        updatedBy: userRef(f.updated_by),
      })),
      myRole: me?.role ?? null,
      myTeamId: me?.team_id ?? null,
    };
  }

  async update(key: string, input: { name?: string; description?: string }): Promise<void> {
    const ws = await this.requireAdmin(key);
    const name = input.name === undefined ? ws.name : requireText(input.name, '워크스페이스 이름', 60);
    const description = input.description === undefined ? ws.description : input.description.trim().slice(0, 500);
    await this.db.prepare('UPDATE workspaces SET name = ?, description = ? WHERE id = ?').bind(name, description, ws.id).run();
  }

  /**
   * 템플릿의 활성 섹션을 통째로 바꾼다. key 가 없는 섹션은 새로 만든 섹션이라 key 를 지어 준다.
   * 빠진 섹션은 archived 로 남겨 라벨을 기억한다. 그 본문은 기능에 그대로 있고 화면에서 "템플릿에서 빠진 섹션"으로 보인다.
   */
  async setTemplate(key: string, sections: { key?: string; label: string; hint?: string }[]): Promise<Template> {
    const ws = await this.requireAdmin(key);
    if (sections.length === 0) throw badRequest('섹션이 하나는 있어야 합니다.');
    if (sections.length > 20) throw badRequest('섹션은 20개까지 둘 수 있습니다.');
    const seen = new Set<string>();
    const template: Template = sections.map((s) => {
      const sectionKey = s.key ?? `s_${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      if (!SECTION_KEY_PATTERN.test(sectionKey)) throw badRequest(`섹션 키 형식이 잘못됐습니다: ${sectionKey}`);
      if (seen.has(sectionKey)) throw badRequest(`섹션 키가 겹칩니다: ${sectionKey}`);
      seen.add(sectionKey);
      return { key: sectionKey, label: requireText(s.label, '섹션 이름', 40), hint: (s.hint ?? '').trim().slice(0, 200) };
    });
    const archived = parseTemplate(ws)
      .filter((s) => !seen.has(s.key))
      .map((s) => ({ ...s, archived: true }));
    const next = [...template, ...archived];
    await this.db.prepare('UPDATE workspaces SET template = ? WHERE id = ?').bind(JSON.stringify(next), ws.id).run();
    return next;
  }

  // ── 팀 · 멤버 ────────────────────────────────────────

  async addTeam(key: string, name: string): Promise<void> {
    const ws = await this.requireAdmin(key);
    const teamName = requireText(name, '팀 이름', 20);
    const exists = await this.db.prepare('SELECT 1 FROM workspace_teams WHERE workspace_id = ? AND name = ?').bind(ws.id, teamName).first();
    if (exists) throw conflict(`${teamName} 팀은 이미 있습니다.`);
    await this.db
      .prepare(
        `INSERT INTO workspace_teams (workspace_id, name, sort_order)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM workspace_teams WHERE workspace_id = ?))`,
      )
      .bind(ws.id, teamName, ws.id)
      .run();
  }

  async deleteTeam(key: string, teamId: number): Promise<void> {
    const ws = await this.requireAdmin(key);
    // 이 팀을 고른 멤버는 팀 미선택이 된다(ON DELETE SET NULL).
    const r = await this.db.prepare('DELETE FROM workspace_teams WHERE id = ? AND workspace_id = ?').bind(teamId, ws.id).run();
    if (r.meta.changes === 0) throw notFound('팀');
  }

  /** 내 팀을 고른다. 멤버가 아니면 이때 멤버가 된다. */
  async setMyTeam(key: string, teamId: number | null): Promise<void> {
    const ws = await findWorkspace(this.db, key);
    if (teamId !== null) {
      const team = await this.db.prepare('SELECT 1 FROM workspace_teams WHERE id = ? AND workspace_id = ?').bind(teamId, ws.id).first();
      if (!team) throw notFound('팀');
    }
    await this.db.batch([
      joinStatement(this.db, ws.id, this.actor.user.id),
      this.db.prepare('UPDATE workspace_members SET team_id = ? WHERE workspace_id = ? AND user_id = ?').bind(teamId, ws.id, this.actor.user.id),
    ]);
  }

  async setRole(key: string, userId: string, role: Role): Promise<void> {
    const ws = await this.requireAdmin(key);
    const current = await roleOf(this.db, ws.id, userId);
    if (!current) throw notFound('멤버');
    if (current === 'admin' && role !== 'admin') {
      const admins = await this.db
        .prepare(`SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'admin'`)
        .bind(ws.id)
        .first<{ n: number }>();
      if (admins!.n <= 1) throw badRequest('관리자가 한 명은 있어야 합니다. 다른 사람을 먼저 관리자로 지정해 주세요.');
    }
    await this.db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').bind(role, ws.id, userId).run();
  }

  // ── 분류 ─────────────────────────────────────────────

  async createCategory(key: string, input: { parentId?: number | null; name: string }): Promise<{ id: number }> {
    const ws = await findWorkspace(this.db, key);
    const name = requireText(input.name, '분류 이름', 40);
    let depth = 1;
    if (input.parentId) {
      const parent = await this.db
        .prepare('SELECT depth FROM categories WHERE id = ? AND workspace_id = ?')
        .bind(input.parentId, ws.id)
        .first<{ depth: number }>();
      if (!parent) throw notFound('상위 분류');
      depth = parent.depth + 1;
      if (depth > MAX_CATEGORY_DEPTH) throw badRequest('분류는 대 · 중 · 소 세 단계까지만 만들 수 있습니다.');
    }
    const [, inserted] = await this.db.batch([
      joinStatement(this.db, ws.id, this.actor.user.id),
      this.db
        .prepare(
          `INSERT INTO categories (workspace_id, parent_id, name, depth, sort_order, created_at)
           VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE workspace_id = ?), ?)
           RETURNING id`,
        )
        .bind(ws.id, input.parentId ?? null, name, depth, ws.id, now()),
    ]);
    return inserted.results[0] as { id: number };
  }

  async renameCategory(categoryId: number, name: string): Promise<void> {
    const newName = requireText(name, '분류 이름', 40);
    const r = await this.db.prepare('UPDATE categories SET name = ? WHERE id = ?').bind(newName, categoryId).run();
    if (r.meta.changes === 0) throw notFound('분류');
  }

  /** 비어 있는 분류만 지운다. 하위 분류나 기능이 있으면 먼저 옮겨야 한다. */
  async deleteCategory(categoryId: number): Promise<void> {
    const usage = await this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM categories WHERE parent_id = ?1) AS children,
                (SELECT COUNT(*) FROM features WHERE category_id = ?1) AS features`,
      )
      .bind(categoryId)
      .first<{ children: number; features: number }>();
    if (usage!.children > 0 || usage!.features > 0) {
      throw badRequest(`하위 분류 ${usage!.children}개, 기능 ${usage!.features}개가 있어서 지울 수 없습니다. 먼저 옮기거나 지워 주세요.`);
    }
    const r = await this.db.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
    if (r.meta.changes === 0) throw notFound('분류');
  }

  private async requireAdmin(key: string): Promise<WorkspaceRow> {
    const ws = await findWorkspace(this.db, key);
    if ((await roleOf(this.db, ws.id, this.actor.user.id)) !== 'admin') throw forbidden('워크스페이스 관리자만 할 수 있습니다.');
    return ws;
  }
}
