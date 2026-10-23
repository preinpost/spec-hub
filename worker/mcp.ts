// AI 클라이언트(Claude, ChatGPT, Cursor ...)가 OAuth 로 붙는 MCP 서버.
// 확정은 사람이 웹에서만 한다. AI 는 초안을 쓰거나 의견 · 수정 제안 · 질문을 남길 수만 있다.
import type { OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';

import type { FeatureDetail, FeatureSummary, WorkspaceDetail } from '../shared/api';
import { DEPTH_LABELS, ROLE_LABELS, STATUSES, STATUS_LABELS, activeSections, displaySections, sectionLabel } from '../shared/spec';
import { type TreeNode, buildTree } from '../shared/tree';
import type { AppEnv, McpProps } from './env';
import { AppError, badRequest } from './errors';
import { SpecService } from './spec-service';
import { type UserRow, getUser } from './users';
import { WorkspaceService } from './workspaces';

export const SCOPE_READ = 'spec:read';
export const SCOPE_WRITE = 'spec:write';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

// 빈 본문에 줄바꿈을 붙이면 빈 줄을 지운 것처럼 나온다.
const withNewline = (s: string) => (s === '' || s.endsWith('\n') ? s : `${s}\n`);

/** 서비스가 던진 AppError 는 AI 가 읽고 고칠 수 있도록 도구 오류로 돌려준다. */
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (error) {
    if (error instanceof AppError) return { ...text(error.message), isError: true };
    throw error;
  }
}

const sectionsSchema = z
  .record(z.string(), z.string())
  .describe('섹션 키 → 마크다운 본문. 섹션 키는 get_workspace 의 템플릿에서 확인한다. 넣은 섹션만 바뀐다.');

const featureLine = (f: FeatureSummary) =>
  `${f.key} ${f.title}${f.screenPath ? ` (화면 경로: ${f.screenPath})` : ''} [${STATUS_LABELS[f.status]}]${f.openQuestions ? ` 열린 질문 ${f.openQuestions}개` : ''}`;

function treeMarkdown(ws: WorkspaceDetail, status?: string): string {
  const { roots, uncategorized } = buildTree(ws.categories, ws.features.filter((f) => !status || f.status === status));
  const lines: string[] = [];
  const walk = (node: TreeNode, indent: string) => {
    lines.push(`${indent}- 📁 ${node.category.name} (${DEPTH_LABELS[node.category.depth]})`);
    for (const child of node.children) walk(child, `${indent}  `);
    for (const f of node.features) lines.push(`${indent}  - ${featureLine(f)}`);
  };
  for (const r of roots) walk(r, '');
  if (uncategorized.length) {
    lines.push('- 📁 미분류');
    for (const f of uncategorized) lines.push(`  - ${featureLine(f)}`);
  }
  return lines.length ? lines.join('\n') : '(분류와 기능이 없습니다)';
}

/** "대분류 > 중분류 > 소분류" 경로를 분류 id 로 바꾼다. 없는 분류는 AI 가 만들지 않는다. */
function resolveCategory(ws: WorkspaceDetail, path: string | undefined): number | null {
  if (!path?.trim()) return null;
  const names = path.split('>').map((s) => s.trim()).filter(Boolean);
  let parentId: number | null = null;
  for (const name of names) {
    const found = ws.categories.find((c) => c.parentId === parentId && c.name === name);
    if (!found) throw badRequest(`분류 "${path}" 가 없습니다. get_workspace 로 분류 트리를 확인하세요. 새 분류는 사람이 웹에서 만듭니다.`);
    parentId = found.id;
  }
  return parentId;
}

function featureMarkdown(f: FeatureDetail, origin: string): string {
  const lines = [
    `# ${f.key} ${f.title}`,
    '',
    `- 워크스페이스: ${f.workspace.name} (${f.workspace.key})`,
    `- 분류: ${f.categoryPath.length ? f.categoryPath.join(' > ') : '미분류'}`,
    `- 화면 경로: ${f.screenPath ?? '미등록'}`,
    `- 접근 경로: ${f.entryPath ?? '미등록'}`,
    `- 상태: ${STATUS_LABELS[f.status]}`,
    `- 버전: ${f.version} (본문을 고칠 때 expected_version 으로 넘긴다)`,
    `- 마지막 수정: ${f.updatedBy.name}, ${f.updatedAt}`,
    `- 마지막 확정: ${f.lastConfirmed ? `${f.lastConfirmed.revision}차, ${f.lastConfirmed.confirmedAt}` : '없음'}`,
    `- 웹: ${origin}/features/${f.key}`,
    '',
  ];
  for (const s of displaySections(f.template, f.sections)) {
    lines.push(`## ${s.label} (섹션 키: ${s.key})`, '', f.sections[s.key]?.trim() || '(비어 있음)', '');
  }
  const openQuestions = f.questions.filter((q) => !q.resolvedAt);
  if (openQuestions.length > 0) {
    lines.push('## 열린 질문', '');
    for (const q of openQuestions) lines.push(`- [${sectionLabel(f.template, q.section)}] ${q.body} (${q.author.name})`);
    lines.push('');
  }
  if (f.decisions.length > 0) {
    lines.push('## 결정 기록', '');
    for (const d of f.decisions) lines.push(`- ${d.body} (${d.author.name}, ${d.createdAt.slice(0, 10)})`);
    lines.push('');
  }
  const openComments = f.comments.filter((c) => !c.resolvedAt);
  if (openComments.length > 0) {
    lines.push('## 해결하지 않은 의견', '');
    for (const c of openComments) {
      lines.push(`- [${sectionLabel(f.template, c.section)}] ${c.kind === 'proposal' ? '수정 제안: ' : ''}${c.body} (${c.author.name})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildServer(env: AppEnv, user: UserRow, scopes: string[]): McpServer {
  const server = new McpServer({ name: 'spec-hub', version: '0.1.0' });
  const actor = { user, source: 'mcp' as const };
  const specs = new SpecService(env.DB, actor);
  const workspaces = new WorkspaceService(env.DB, actor);

  server.registerTool(
    'list_workspaces',
    {
      description: '워크스페이스(제품 · 프로젝트) 목록. 기능 키는 워크스페이스 키로 시작한다(예: WCN-12).',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const list = await workspaces.list();
        if (list.length === 0) return '워크스페이스가 없습니다. 웹 화면에서 먼저 만들어야 합니다.';
        return list
          .map((w) => `- ${w.key} ${w.name} · 기능 ${w.featureCount}개${w.myRole ? ` · 내 역할 ${ROLE_LABELS[w.myRole]}` : ''}${w.description ? `\n  ${w.description}` : ''}`)
          .join('\n');
      }),
  );

  server.registerTool(
    'get_workspace',
    {
      description: '워크스페이스의 명세 템플릿(섹션 키), 분류 트리, 기능 목록을 보여 준다. 초안을 쓰기 전에 먼저 부른다.',
      inputSchema: z.object({
        workspace: z.string().describe('워크스페이스 키(예: WCN)'),
        status: z.enum(STATUSES).optional().describe('이 상태의 기능만 보기. draft(초안) · review(검토 중) · confirmed(확정)'),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ workspace, status }) =>
      run(async () => {
        const ws = await workspaces.get(workspace);
        return [
          `# ${ws.name} (${ws.key})`,
          ws.description,
          '',
          '## 명세 템플릿',
          ...activeSections(ws.template).map((s) => `- ${s.key}: ${s.label} — ${s.hint}`),
          '',
          '## 분류와 기능',
          treeMarkdown(ws, status),
        ].join('\n');
      }),
  );

  server.registerTool(
    'search_features',
    {
      description: '기능 키 · 이름 · 메타정보 · 본문에서 검색어가 들어간 기능을 찾는다.',
      inputSchema: z.object({ query: z.string().min(1), workspace: z.string().optional().describe('비우면 모든 워크스페이스') }),
      annotations: { readOnlyHint: true },
    },
    ({ query, workspace }) =>
      run(async () => {
        const found = await specs.searchFeatures(query, workspace);
        if (found.length === 0) return `"${query}" 이(가) 들어간 기능이 없습니다.`;
        return found.map((f) => `- ${featureLine(f)} · ${f.workspaceName}`).join('\n');
      }),
  );

  server.registerTool(
    'get_feature',
    {
      description: '기능명세 전체를 마크다운으로 가져온다. 열린 질문, 결정 기록, 해결하지 않은 의견도 함께 온다.',
      inputSchema: z.object({ key: z.string().describe('기능 키(예: WCN-12)') }),
      annotations: { readOnlyHint: true },
    },
    ({ key }) => run(async () => featureMarkdown(await specs.getFeature(key), env.PUBLIC_ORIGIN)),
  );

  server.registerTool(
    'get_changes_since_confirmed',
    {
      description: '마지막 확정본 이후 바뀐 내용을 섹션별 unified diff 로 보여 준다. 개발 중인 기능의 명세가 바뀌었는지 확인할 때 쓴다.',
      inputSchema: z.object({ key: z.string().describe('기능 키(예: WCN-12)') }),
      annotations: { readOnlyHint: true },
    },
    ({ key }) =>
      run(async () => {
        const f = await specs.getFeature(key);
        if (!f.lastConfirmed) return `${f.key} 는 아직 한 번도 확정되지 않았습니다. get_feature 로 현재 초안을 보세요.`;
        const base = f.lastConfirmed;
        const parts: string[] = [];
        if (base.title !== f.title) parts.push(`기능 이름: "${base.title}" → "${f.title}"`);
        if (base.screenPath !== f.screenPath) parts.push(`화면 경로: ${base.screenPath ?? '미등록'} → ${f.screenPath ?? '미등록'}`);
        if (base.entryPath !== f.entryPath) parts.push(`접근 경로: ${base.entryPath ?? '미등록'} → ${f.entryPath ?? '미등록'}`);
        const keys = [...new Set([...Object.keys(base.sections), ...Object.keys(f.sections)])];
        for (const k of keys) {
          const before = base.sections[k] ?? '';
          const after = f.sections[k] ?? '';
          if (before === after) continue;
          // diff 라이브러리는 비 ASCII 파일명을 8진수로 이스케이프한다. 파일명은 섹션 키로 두고 라벨은 제목 줄로 보여 준다.
          const patch = createTwoFilesPatch(`confirmed-r${base.revision}/${k}`, `current/${k}`, withNewline(before), withNewline(after), '', '', {
            context: 3,
          });
          parts.push(`## ${sectionLabel(f.template, k)}`, patch);
        }
        const head = `${f.key} ${f.title}: ${base.revision}차 확정본(${base.confirmedAt}) 대비 현재 상태 ${STATUS_LABELS[f.status]}`;
        return parts.length ? [head, '', ...parts].join('\n') : `${head}\n\n바뀐 내용이 없습니다.`;
      }),
  );

  if (!scopes.includes(SCOPE_WRITE)) return server;

  server.registerTool(
    'create_feature_draft',
    {
      description: '새 기능명세를 초안 상태로 만든다. 확정은 사람이 웹에서 한다. 먼저 get_workspace 로 템플릿과 분류를 확인한다.',
      inputSchema: z.object({
        workspace: z.string().describe('워크스페이스 키(예: WCN)'),
        title: z.string().describe('기능 이름'),
        category: z.string().optional().describe('"대분류 > 중분류 > 소분류" 처럼 이미 있는 분류 경로. 비우면 미분류'),
        screenPath: z.string().nullish().describe('도메인을 제외하고 /로 시작하는 화면 경로(예: /invoice/:id), 최대 512자. 공백·역슬래시·제어문자·query·hash는 제외한다. 생략하면 유지, 빈 문자열이나 null이면 삭제한다.'),
        entryPath: z.string().nullish().describe('메뉴와 조작 순서를 설명하는 접근 경로(예: 청구 관리 → 청구서 목록 → 상세). 기능 분류와 별개이며 여러 줄을 허용한다. 최대 2000자. 생략하면 유지, 빈 문자열이나 null이면 삭제한다.'),
        sections: sectionsSchema.optional(),
      }),
    },
    ({ workspace, title, category, screenPath, entryPath, sections }) =>
      run(async () => {
        const ws = await workspaces.get(workspace);
        const { key } = await specs.createFeature({ workspaceKey: ws.key, title, screenPath, entryPath, categoryId: resolveCategory(ws, category), sections });
        return `${key} 초안을 만들었습니다. ${env.PUBLIC_ORIGIN}/features/${key}`;
      }),
  );

  server.registerTool(
    'update_draft',
    {
      description:
        '초안 상태인 기능의 이름, 메타정보나 섹션 본문을 고친다. 검토 중이거나 확정된 기능은 고칠 수 없으니 propose_change 를 쓴다. expected_version 은 get_feature 가 알려 준 버전이다.',
      inputSchema: z.object({
        key: z.string(),
        expected_version: z.number().int(),
        title: z.string().optional(),
        screenPath: z.string().nullish().describe('도메인을 제외하고 /로 시작하는 화면 경로(예: /invoice/:id), 최대 512자. 공백·역슬래시·제어문자·query·hash는 제외한다. 생략하면 유지, 빈 문자열이나 null이면 삭제한다.'),
        entryPath: z.string().nullish().describe('메뉴와 조작 순서를 설명하는 접근 경로(예: 청구 관리 → 청구서 목록 → 상세). 기능 분류와 별개이며 여러 줄을 허용한다. 최대 2000자. 생략하면 유지, 빈 문자열이나 null이면 삭제한다.'),
        sections: sectionsSchema.optional(),
      }),
    },
    ({ key, expected_version, title, screenPath, entryPath, sections }) =>
      run(async () => {
        const r = await specs.updateFeature(key, { title, screenPath, entryPath, sections, expectedVersion: expected_version, onlyDraft: true });
        return `${key} 를 저장했습니다. 새 버전은 ${r.version} 입니다.`;
      }),
  );

  server.registerTool(
    'propose_change',
    {
      description: '한 섹션의 본문을 바꾸자는 수정 제안을 남긴다. 사람이 웹에서 보고 반영하거나 닫는다.',
      inputSchema: z.object({
        key: z.string(),
        section: z.string().describe('섹션 키. get_feature 에 나온다'),
        proposed_text: z.string().describe('섹션 본문 전체를 대신할 마크다운'),
        reason: z.string().describe('왜 바꾸자는지'),
      }),
    },
    ({ key, section, proposed_text, reason }) =>
      run(async () => {
        await specs.addComment(key, { section, body: reason, proposedText: proposed_text });
        return `${key} 의 ${section} 섹션에 수정 제안을 남겼습니다.`;
      }),
  );

  server.registerTool(
    'add_comment',
    {
      description: '기능이나 섹션에 의견을 남긴다.',
      inputSchema: z.object({
        key: z.string(),
        section: z.string().optional().describe('섹션 키. 비우면 기능 전체에 대한 의견'),
        body: z.string(),
      }),
    },
    ({ key, section, body }) =>
      run(async () => {
        await specs.addComment(key, { section, body });
        return `${key} 에 의견을 남겼습니다.`;
      }),
  );

  server.registerTool(
    'add_question',
    {
      description: '명세에서 정해지지 않은 점을 질문으로 남긴다. 질문이 모두 해결되어야 확정할 수 있다.',
      inputSchema: z.object({
        key: z.string(),
        section: z.string().optional().describe('섹션 키. 비우면 기능 전체에 대한 질문'),
        body: z.string(),
      }),
    },
    ({ key, section, body }) =>
      run(async () => {
        await specs.addQuestion(key, { section, body });
        return `${key} 에 질문을 남겼습니다.`;
      }),
  );

  return server;
}

/** OAuthProvider 가 토큰을 검증한 뒤 /mcp 요청을 넘겨 준다. */
export const mcpApiHandler = {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    const { props, auth } = ctx as ExecutionContext & { props: McpProps; auth?: OAuthResourceAuth };
    // 토큰에는 사용자 id 만 담는다. 지금도 있는 사용자인지는 요청마다 확인한다.
    const user = await getUser(env.DB, props.userId);
    if (!user) return Response.json({ error: 'unknown_user' }, { status: 403 });
    const scopes = auth?.scope ?? [];
    const host = new URL(env.PUBLIC_ORIGIN).hostname;
    return createMcpHandler(() => buildServer(env, user, scopes), {
      route: '/mcp',
      allowedHostnames: [host],
      allowedOriginHostnames: [host],
    })(request, env, ctx);
  },
};
