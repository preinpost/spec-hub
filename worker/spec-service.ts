// 기능 명세의 읽기 · 쓰기 규칙. 웹 API 와 MCP 도구가 모두 이 클래스를 거친다.
import type {
  Activity,
  Comment,
  Decision,
  FeatureDetail,
  Question,
  SearchResult,
  Snapshot,
  SnapshotSummary,
} from '../shared/api';
import {
  type Sections,
  type Source,
  STATUS_LABELS,
  type Status,
  type Template,
  activeSections,
  canConfirmAs,
  canTransition,
  normalizeSections,
  sectionLabel,
  screenPathError,
  entryPathError,
} from '../shared/spec';
import { now } from './crypto';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { type UserRow, loadUserRefs } from './users';
import { type WorkspaceRow, findWorkspace, joinStatement, parseTemplate, requireText, roleOf } from './workspaces';

export interface Actor {
  user: UserRow;
  source: Source;
}

interface FeatureRow {
  id: number;
  key: string;
  workspace_id: number;
  category_id: number | null;
  title: string;
  screen_path: string | null;
  entry_path: string | null;
  status: Status;
  sections: string;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface Loaded {
  feature: FeatureRow;
  workspace: WorkspaceRow;
  template: Template;
  sections: Sections;
}

const MAX_TITLE = 200;
const MAX_TEXT = 50_000;

function parseScreenPath(value: string | null | undefined): string | null {
  const error = screenPathError(value);
  if (error) throw badRequest(error);
  return value || null;
}

function parseEntryPath(value: string | null | undefined): string | null {
  const error = entryPathError(value);
  if (error) throw badRequest(error);
  return value?.trim() || null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export class SpecService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: Actor,
  ) {}

  // ── 조회 ─────────────────────────────────────────────

  /** 기능 키 · 제목 · 메타정보 · 본문에서 찾는다. 데이터가 적어서 LIKE 로 충분하다. */
  async searchFeatures(query: string, workspaceKey?: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const ws = workspaceKey ? await findWorkspace(this.db, workspaceKey) : null;
    const { results } = await this.db
      .prepare(
        `SELECT f.key, f.title, f.screen_path, f.entry_path, f.status, f.category_id, f.updated_at, f.updated_by, w.key AS workspace_key, w.name AS workspace_name,
           (SELECT COUNT(*) FROM questions q WHERE q.feature_id = f.id AND q.resolved_at IS NULL) AS open_questions
         FROM features f JOIN workspaces w ON w.id = f.workspace_id
         WHERE (?2 IS NULL OR f.workspace_id = ?2)
           AND (f.key LIKE ?1 ESCAPE '\\' OR f.title LIKE ?1 ESCAPE '\\' OR f.sections LIKE ?1 ESCAPE '\\' OR f.screen_path LIKE ?1 ESCAPE '\\' OR f.entry_path LIKE ?1 ESCAPE '\\')
         ORDER BY f.updated_at DESC LIMIT 50`,
      )
      .bind(`%${escapeLike(q)}%`, ws?.id ?? null)
      .all<{
        key: string;
        title: string;
        screen_path: string | null;
        entry_path: string | null;
        status: Status;
        category_id: number | null;
        updated_at: string;
        updated_by: string;
        workspace_key: string;
        workspace_name: string;
        open_questions: number;
      }>();
    const userRef = await loadUserRefs(this.db, results.map((r) => r.updated_by), ws?.id ?? null);
    return results.map((r) => ({
      key: r.key,
      title: r.title,
      screenPath: r.screen_path,
      entryPath: r.entry_path,
      status: r.status,
      categoryId: r.category_id,
      openQuestions: r.open_questions,
      updatedAt: r.updated_at,
      updatedBy: userRef(r.updated_by),
      workspaceKey: r.workspace_key,
      workspaceName: r.workspace_name,
    }));
  }

  async getFeature(key: string): Promise<FeatureDetail> {
    const { feature, workspace, template, sections } = await this.load(key);
    const id = feature.id;
    const [path, comments, questions, decisions, activities, snapshots, last] = await this.db.batch([
      // 분류는 세 단계뿐이라 재귀 대신 부모를 두 번 따라간다.
      this.db
        .prepare(
          `SELECT c1.name AS n1, c2.name AS n2, c3.name AS n3 FROM categories c1
           LEFT JOIN categories c2 ON c2.id = c1.parent_id
           LEFT JOIN categories c3 ON c3.id = c2.parent_id
           WHERE c1.id = ?`,
        )
        .bind(feature.category_id),
      this.db.prepare('SELECT * FROM comments WHERE feature_id = ? ORDER BY id').bind(id),
      this.db.prepare('SELECT * FROM questions WHERE feature_id = ? ORDER BY id').bind(id),
      this.db.prepare('SELECT * FROM decisions WHERE feature_id = ? ORDER BY id').bind(id),
      this.db.prepare('SELECT * FROM activities WHERE feature_id = ? ORDER BY id DESC LIMIT 100').bind(id),
      this.db
        .prepare('SELECT revision, note, confirmed_by, confirmed_at FROM feature_snapshots WHERE feature_id = ? ORDER BY revision DESC')
        .bind(id),
      this.db.prepare('SELECT * FROM feature_snapshots WHERE feature_id = ? ORDER BY revision DESC LIMIT 1').bind(id),
    ]);

    type Row = Record<string, unknown>;
    const rows = (r: D1Result) => r.results as Row[];
    const userIds: (string | null)[] = [feature.created_by, feature.updated_by];
    for (const r of [...rows(comments), ...rows(questions)]) userIds.push(r.author_id as string, r.resolved_by as string | null);
    for (const r of rows(decisions)) userIds.push(r.author_id as string);
    for (const r of rows(activities)) userIds.push(r.actor_id as string);
    for (const r of rows(snapshots)) userIds.push(r.confirmed_by as string);
    const userRef = await loadUserRefs(this.db, userIds, workspace.id);
    const optionalRef = (uid: unknown) => (typeof uid === 'string' ? userRef(uid) : null);

    const snapshotSummary = (r: Row): SnapshotSummary => ({
      revision: r.revision as number,
      note: r.note as string | null,
      confirmedBy: userRef(r.confirmed_by as string),
      confirmedAt: r.confirmed_at as string,
    });
    const lastRow = rows(last)[0];
    const pathRow = rows(path)[0] as { n1: string; n2: string | null; n3: string | null } | undefined;
    const role = await roleOf(this.db, workspace.id, this.actor.user.id);

    return {
      key: feature.key,
      title: feature.title,
      screenPath: feature.screen_path,
      entryPath: feature.entry_path,
      status: feature.status,
      version: feature.version,
      workspace: { key: workspace.key, name: workspace.name },
      categoryId: feature.category_id,
      categoryPath: pathRow ? [pathRow.n3, pathRow.n2, pathRow.n1].filter((n): n is string => !!n) : [],
      template,
      sections,
      createdBy: userRef(feature.created_by),
      createdAt: feature.created_at,
      updatedBy: userRef(feature.updated_by),
      updatedAt: feature.updated_at,
      comments: rows(comments).map(
        (r): Comment => ({
          id: r.id as number,
          section: r.section as string | null,
          kind: r.kind as Comment['kind'],
          body: r.body as string,
          proposedText: r.proposed_text as string | null,
          author: userRef(r.author_id as string),
          source: r.source as Source,
          createdAt: r.created_at as string,
          resolvedAt: r.resolved_at as string | null,
          resolvedBy: optionalRef(r.resolved_by),
        }),
      ),
      questions: rows(questions).map(
        (r): Question => ({
          id: r.id as number,
          section: r.section as string | null,
          body: r.body as string,
          author: userRef(r.author_id as string),
          source: r.source as Source,
          createdAt: r.created_at as string,
          resolvedAt: r.resolved_at as string | null,
          resolvedBy: optionalRef(r.resolved_by),
        }),
      ),
      decisions: rows(decisions).map(
        (r): Decision => ({
          id: r.id as number,
          questionId: r.question_id as number | null,
          body: r.body as string,
          author: userRef(r.author_id as string),
          source: r.source as Source,
          createdAt: r.created_at as string,
        }),
      ),
      activities: rows(activities).map(
        (r): Activity => ({
          id: r.id as number,
          action: r.action as string,
          detail: r.detail as string | null,
          actor: userRef(r.actor_id as string),
          source: r.source as Source,
          createdAt: r.created_at as string,
        }),
      ),
      snapshots: rows(snapshots).map(snapshotSummary),
      lastConfirmed: lastRow ? this.toSnapshot(lastRow, snapshotSummary(lastRow)) : null,
      canConfirm: canConfirmAs(role),
    };
  }

  async getSnapshot(key: string, revision: number): Promise<Snapshot> {
    const { feature, workspace } = await this.load(key);
    const row = await this.db
      .prepare('SELECT * FROM feature_snapshots WHERE feature_id = ? AND revision = ?')
      .bind(feature.id, revision)
      .first<Record<string, unknown>>();
    if (!row) throw notFound(`${key} 의 ${revision}차 확정본`);
    const userRef = await loadUserRefs(this.db, [row.confirmed_by as string], workspace.id);
    return this.toSnapshot(row, {
      revision: row.revision as number,
      note: row.note as string | null,
      confirmedBy: userRef(row.confirmed_by as string),
      confirmedAt: row.confirmed_at as string,
    });
  }

  // ── 기능 본문 ────────────────────────────────────────

  async createFeature(input: {
    workspaceKey: string;
    title: string;
    screenPath?: string | null;
    entryPath?: string | null;
    categoryId?: number | null;
    sections?: Record<string, string>;
  }): Promise<{ key: string }> {
    const ws = await findWorkspace(this.db, input.workspaceKey);
    const template = parseTemplate(ws);
    const title = requireText(input.title, '기능 이름', MAX_TITLE);
    const screenPath = parseScreenPath(input.screenPath);
    const entryPath = parseEntryPath(input.entryPath);
    for (const k of Object.keys(input.sections ?? {})) this.checkSection(template, {}, k);
    const sections = normalizeSections(template, input.sections);
    this.checkSectionLengths(template, sections);
    const categoryId = await this.checkCategory(ws.id, input.categoryId ?? null);

    const at = now();
    const uid = this.actor.user.id;
    // batch 는 한 트랜잭션으로 돈다. 키 발급(next_seq)과 기능 생성이 함께 성공하거나 함께 실패한다.
    const [, inserted] = await this.db.batch([
      joinStatement(this.db, ws.id, uid),
      this.db
        .prepare(
          `INSERT INTO features (key, workspace_id, category_id, title, screen_path, entry_path, status, sections, version, created_by, updated_by, created_at, updated_at)
           SELECT key || '-' || next_seq, id, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?, ? FROM workspaces WHERE id = ?
           RETURNING key`,
        )
        .bind(categoryId, title, screenPath, entryPath, JSON.stringify(sections), uid, uid, at, at, ws.id),
      this.activityStatement('last_insert_rowid()', 'created', `"${title}" 기능을 만들었습니다.`, at),
      this.db.prepare('UPDATE workspaces SET next_seq = next_seq + 1 WHERE id = ?').bind(ws.id),
    ]);
    return { key: (inserted.results[0] as { key: string }).key };
  }

  /**
   * 제목, 메타정보와 섹션을 저장한다. 생략한 메타정보와 sections 에 없는 섹션은 그대로 둔다.
   * expectedVersion 이 현재 버전과 다르면 다른 사람이 먼저 저장한 것이므로 거절한다.
   */
  async updateFeature(
    key: string,
    input: {
      title?: string;
      screenPath?: string | null;
      entryPath?: string | null;
      sections?: Record<string, string>;
      expectedVersion: number;
      onlyDraft?: boolean;
    },
  ): Promise<{ version: number; status: Status }> {
    const { feature, template, sections: before } = await this.load(key);
    if (input.onlyDraft && feature.status !== 'draft') {
      throw forbidden(`${feature.key} 는 ${STATUS_LABELS[feature.status]} 상태라서 본문을 직접 고칠 수 없습니다. 의견이나 수정 제안으로 남겨 주세요.`);
    }
    for (const k of Object.keys(input.sections ?? {})) this.checkSection(template, before, k);
    const after = normalizeSections(template, { ...before, ...input.sections });
    this.checkSectionLengths(template, after);
    const title = input.title === undefined ? feature.title : requireText(input.title, '기능 이름', MAX_TITLE);
    const screenPath = input.screenPath === undefined ? feature.screen_path : parseScreenPath(input.screenPath);
    const entryPath = input.entryPath === undefined ? feature.entry_path : parseEntryPath(input.entryPath);

    const changed = Object.keys(after)
      .filter((k) => after[k] !== (before[k] ?? ''))
      .map((k) => sectionLabel(template, k));
    if (title !== feature.title) changed.unshift('기능 이름');
    if (screenPath !== feature.screen_path) changed.push('화면 경로');
    if (entryPath !== feature.entry_path) changed.push('접근 경로');
    if (changed.length === 0) return { version: feature.version, status: feature.status };

    const at = now();
    const [, updated] = await this.db.batch([
      joinStatement(this.db, feature.workspace_id, this.actor.user.id),
      this.db
        .prepare(
          `UPDATE features SET title = ?, screen_path = ?, entry_path = ?, sections = ?, version = version + 1,
             status = CASE WHEN status = 'confirmed' THEN 'draft' ELSE status END,
             updated_by = ?, updated_at = ?
           WHERE id = ? AND version = ? AND (? = 0 OR status = 'draft')
           RETURNING version, status`,
        )
        .bind(title, screenPath, entryPath, JSON.stringify(after), this.actor.user.id, at, feature.id, input.expectedVersion, input.onlyDraft ? 1 : 0),
      this.activityStatement(feature.id, 'edited', `${changed.join(', ')}을(를) 고쳤습니다.`, at, true),
    ]);
    const row = updated.results[0] as { version: number; status: Status } | undefined;
    if (!row) throw conflict('다른 사람이 먼저 저장했습니다. 새로고침해서 바뀐 내용을 확인한 뒤 다시 저장해 주세요.');
    return row;
  }

  /** 기능을 다른 분류로 옮긴다. 본문이 아니라서 버전을 올리지 않는다. */
  async moveFeature(key: string, categoryId: number | null): Promise<void> {
    const { feature } = await this.load(key);
    const target = await this.checkCategory(feature.workspace_id, categoryId);
    if (target === feature.category_id) return;
    const name = target
      ? (await this.db.prepare('SELECT name FROM categories WHERE id = ?').bind(target).first<{ name: string }>())!.name
      : '미분류';
    await this.db.batch([
      joinStatement(this.db, feature.workspace_id, this.actor.user.id),
      this.db.prepare('UPDATE features SET category_id = ? WHERE id = ?').bind(target, feature.id),
      this.activityStatement(feature.id, 'moved', `분류를 "${name}"(으)로 옮겼습니다.`, now()),
    ]);
  }

  async changeStatus(key: string, input: { to: Status; expectedVersion: number; note?: string }): Promise<{ version: number; status: Status }> {
    const { feature } = await this.load(key);
    if (!canTransition(feature.status, input.to)) {
      throw badRequest(`${STATUS_LABELS[feature.status]} 상태에서 ${STATUS_LABELS[input.to]} 상태로 바꿀 수 없습니다.`);
    }
    const at = now();
    const detail = `상태를 ${STATUS_LABELS[feature.status]}에서 ${STATUS_LABELS[input.to]}(으)로 바꿨습니다.`;
    const join = joinStatement(this.db, feature.workspace_id, this.actor.user.id);
    const update = this.db
      .prepare(
        `UPDATE features SET status = ?, version = version + 1, updated_by = ?, updated_at = ?
         WHERE id = ? AND version = ? AND status = ?
         RETURNING version, status`,
      )
      .bind(input.to, this.actor.user.id, at, feature.id, input.expectedVersion, feature.status);

    if (input.to !== 'confirmed') {
      const [, updated] = await this.db.batch([join, update, this.activityStatement(feature.id, 'status_changed', detail, at, true)]);
      const row = updated.results[0] as { version: number; status: Status } | undefined;
      if (!row) throw conflict('다른 사람이 먼저 상태를 바꿨습니다. 새로고침해 주세요.');
      return row;
    }

    const role = await roleOf(this.db, feature.workspace_id, this.actor.user.id);
    if (!canConfirmAs(role) || this.actor.source !== 'web') {
      throw forbidden('확정은 워크스페이스의 관리자나 확정권한자가 웹 화면에서만 할 수 있습니다.');
    }
    const open = await this.db
      .prepare('SELECT COUNT(*) AS n FROM questions WHERE feature_id = ? AND resolved_at IS NULL')
      .bind(feature.id)
      .first<{ n: number }>();
    if (open && open.n > 0) throw badRequest(`해결하지 않은 질문이 ${open.n}개 있습니다. 질문을 모두 해결한 뒤 확정해 주세요.`);

    const note = input.note?.trim() || null;
    const [updated] = await this.db.batch([
      update,
      // changes() 는 바로 앞 문장이 바꾼 행 수다. 상태 변경이 버전 충돌로 실패했으면 확정본도 남기지 않는다.
      // 그래서 이 문장은 반드시 update 바로 뒤에 둔다.
      this.db
        .prepare(
          `INSERT INTO feature_snapshots (feature_id, revision, title, screen_path, entry_path, sections, template, note, confirmed_by, confirmed_at)
           SELECT f.id, (SELECT COALESCE(MAX(revision), 0) + 1 FROM feature_snapshots WHERE feature_id = f.id),
                  f.title, f.screen_path, f.entry_path, f.sections, w.template, ?, ?, ?
           FROM features f JOIN workspaces w ON w.id = f.workspace_id
           WHERE f.id = ? AND changes() = 1`,
        )
        .bind(note, this.actor.user.id, at, feature.id),
      this.activityStatement(feature.id, 'confirmed', note ? `확정했습니다: ${note}` : '확정했습니다.', at, true),
    ]);
    const row = updated.results[0] as { version: number; status: Status } | undefined;
    if (!row) throw conflict('다른 사람이 먼저 수정했습니다. 새로고침해서 바뀐 내용을 확인한 뒤 확정해 주세요.');
    return row;
  }

  // ── 의견 · 질문 · 결정 ──────────────────────────────

  async addComment(key: string, input: { section?: string | null; body: string; proposedText?: string | null }): Promise<{ id: number }> {
    const { feature, template, sections } = await this.load(key);
    const section = this.checkSection(template, sections, input.section);
    const body = requireText(input.body, '의견', MAX_TEXT);
    const isProposal = input.proposedText !== undefined && input.proposedText !== null;
    if (isProposal && !section) throw badRequest('수정 제안은 어느 섹션을 바꿀지 정해야 합니다.');
    const proposed = isProposal ? (input.proposedText ?? '').slice(0, MAX_TEXT) : null;

    const at = now();
    const [, inserted] = await this.db.batch([
      joinStatement(this.db, feature.workspace_id, this.actor.user.id),
      this.db
        .prepare(
          `INSERT INTO comments (feature_id, section, kind, body, proposed_text, author_id, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(feature.id, section, isProposal ? 'proposal' : 'comment', body, proposed, this.actor.user.id, this.actor.source, at),
      this.activityStatement(
        feature.id,
        isProposal ? 'proposed' : 'commented',
        `${sectionLabel(template, section)}에 ${isProposal ? '수정 제안' : '의견'}을 남겼습니다.`,
        at,
      ),
    ]);
    return inserted.results[0] as { id: number };
  }

  async resolveComment(commentId: number): Promise<void> {
    const row = await this.db
      .prepare(
        `UPDATE comments SET resolved_by = ?, resolved_at = ? WHERE id = ? AND resolved_at IS NULL
         RETURNING feature_id, section, kind`,
      )
      .bind(this.actor.user.id, now(), commentId)
      .first<{ feature_id: number; section: string | null; kind: string }>();
    if (!row) throw notFound('해결하지 않은 의견');
    const ws = await this.db
      .prepare('SELECT w.template FROM workspaces w JOIN features f ON f.workspace_id = w.id WHERE f.id = ?')
      .bind(row.feature_id)
      .first<{ template: string }>();
    await this.activityStatement(
      row.feature_id,
      'comment_resolved',
      `${sectionLabel(parseTemplate(ws!), row.section)}의 ${row.kind === 'proposal' ? '수정 제안' : '의견'}을 해결 처리했습니다.`,
      now(),
    ).run();
  }

  /** 수정 제안의 본문을 해당 섹션에 넣고 제안을 해결 처리한다. */
  async applyProposal(commentId: number, expectedVersion: number): Promise<{ version: number; status: Status }> {
    const comment = await this.db
      .prepare(
        `SELECT c.section, c.proposed_text, c.resolved_at, f.key FROM comments c JOIN features f ON f.id = c.feature_id
         WHERE c.id = ? AND c.kind = 'proposal'`,
      )
      .bind(commentId)
      .first<{ section: string; proposed_text: string; resolved_at: string | null; key: string }>();
    if (!comment) throw notFound('수정 제안');
    if (comment.resolved_at) throw badRequest('이미 해결한 제안입니다.');
    const result = await this.updateFeature(comment.key, {
      sections: { [comment.section]: comment.proposed_text },
      expectedVersion,
    });
    await this.resolveComment(commentId);
    return result;
  }

  async addQuestion(key: string, input: { section?: string | null; body: string }): Promise<{ id: number }> {
    const { feature, template, sections } = await this.load(key);
    const section = this.checkSection(template, sections, input.section);
    const body = requireText(input.body, '질문', MAX_TEXT);
    const at = now();
    const [, inserted] = await this.db.batch([
      joinStatement(this.db, feature.workspace_id, this.actor.user.id),
      this.db
        .prepare(
          `INSERT INTO questions (feature_id, section, body, author_id, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(feature.id, section, body, this.actor.user.id, this.actor.source, at),
      this.activityStatement(feature.id, 'question_added', `${sectionLabel(template, section)}에 질문을 남겼습니다.`, at),
    ]);
    return inserted.results[0] as { id: number };
  }

  /** 질문을 해결하고 그 답을 결정으로 남긴다. */
  async resolveQuestion(questionId: number, answer: string): Promise<{ decisionId: number }> {
    const body = requireText(answer, '결정 내용', MAX_TEXT);
    const question = await this.db
      .prepare(
        `SELECT q.feature_id, f.workspace_id FROM questions q JOIN features f ON f.id = q.feature_id
         WHERE q.id = ? AND q.resolved_at IS NULL`,
      )
      .bind(questionId)
      .first<{ feature_id: number; workspace_id: number }>();
    if (!question) throw notFound('해결하지 않은 질문');
    const at = now();
    const [, , decision] = await this.db.batch([
      joinStatement(this.db, question.workspace_id, this.actor.user.id),
      this.db
        .prepare('UPDATE questions SET resolved_by = ?, resolved_at = ? WHERE id = ? AND resolved_at IS NULL')
        .bind(this.actor.user.id, at, questionId),
      // 동시에 두 사람이 해결하면 먼저 바꾼 쪽만 결정을 남긴다.
      this.db
        .prepare(
          `INSERT INTO decisions (feature_id, question_id, body, author_id, source, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1 RETURNING id`,
        )
        .bind(question.feature_id, questionId, body, this.actor.user.id, this.actor.source, at),
      this.activityStatement(question.feature_id, 'question_resolved', '질문을 해결하고 결정을 남겼습니다.', at, true),
    ]);
    const row = decision.results[0] as { id: number } | undefined;
    if (!row) throw conflict('다른 사람이 먼저 이 질문을 해결했습니다.');
    return { decisionId: row.id };
  }

  async addDecision(key: string, input: { body: string }): Promise<{ id: number }> {
    const { feature } = await this.load(key);
    const body = requireText(input.body, '결정 내용', MAX_TEXT);
    const at = now();
    const [, inserted] = await this.db.batch([
      joinStatement(this.db, feature.workspace_id, this.actor.user.id),
      this.db
        .prepare(
          `INSERT INTO decisions (feature_id, body, author_id, source, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(feature.id, body, this.actor.user.id, this.actor.source, at),
      this.activityStatement(feature.id, 'decision_added', '결정을 기록했습니다.', at),
    ]);
    return inserted.results[0] as { id: number };
  }

  // ── 내부 ─────────────────────────────────────────────

  private async load(key: string): Promise<Loaded> {
    const feature = await this.db.prepare('SELECT * FROM features WHERE key = ?').bind(key.trim().toUpperCase()).first<FeatureRow>();
    if (!feature) throw notFound(`기능 ${key}`);
    const workspace = (await this.db
      .prepare('SELECT id, key, name, description, template FROM workspaces WHERE id = ?')
      .bind(feature.workspace_id)
      .first<WorkspaceRow>())!;
    const template = parseTemplate(workspace);
    return { feature, workspace, template, sections: normalizeSections(template, JSON.parse(feature.sections)) };
  }

  private toSnapshot(row: Record<string, unknown>, summary: SnapshotSummary): Snapshot {
    const template = JSON.parse(row.template as string) as Template;
    return {
      ...summary,
      title: row.title as string,
      screenPath: row.screen_path as string | null,
      entryPath: row.entry_path as string | null,
      template,
      sections: normalizeSections(template, JSON.parse(row.sections as string)),
    };
  }

  /** 섹션 키는 지금 템플릿에 있거나, 템플릿에서 빠졌어도 본문이 남아 있는 것만 받는다. */
  private checkSection(template: Template, sections: Sections, section: string | null | undefined): string | null {
    if (section === null || section === undefined || section === '') return null;
    if (!activeSections(template).some((s) => s.key === section) && !(section in sections)) {
      throw badRequest(`이 워크스페이스에 없는 섹션입니다: ${section}. 섹션 키는 ${activeSections(template).map((s) => s.key).join(', ')} 입니다.`);
    }
    return section;
  }

  private async checkCategory(workspaceId: number, categoryId: number | null): Promise<number | null> {
    if (categoryId === null) return null;
    const found = await this.db.prepare('SELECT 1 FROM categories WHERE id = ? AND workspace_id = ?').bind(categoryId, workspaceId).first();
    if (!found) throw notFound('분류');
    return categoryId;
  }

  private checkSectionLengths(template: Template, sections: Sections): void {
    for (const [k, v] of Object.entries(sections)) {
      if (v.length > MAX_TEXT) throw badRequest(`${sectionLabel(template, k)}은(는) ${MAX_TEXT.toLocaleString()}자를 넘을 수 없습니다.`);
    }
  }

  /**
   * 활동 기록 문장. batch 의 다른 문장과 함께 쓴다.
   * afterChange 가 true 면 바로 앞 문장이 행을 바꿨을 때만 남긴다(버전 충돌로 실패한 저장은 기록하지 않는다).
   */
  private activityStatement(
    featureId: number | 'last_insert_rowid()',
    action: string,
    detail: string,
    at: string,
    afterChange = false,
  ): D1PreparedStatement {
    const idExpr = featureId === 'last_insert_rowid()' ? 'last_insert_rowid()' : '?';
    const binds: unknown[] = featureId === 'last_insert_rowid()' ? [] : [featureId];
    return this.db
      .prepare(
        `INSERT INTO activities (feature_id, actor_id, source, action, detail, created_at)
         SELECT ${idExpr}, ?, ?, ?, ?, ?${afterChange ? ' WHERE changes() = 1' : ''}`,
      )
      .bind(...binds, this.actor.user.id, this.actor.source, action, detail, at);
  }
}
