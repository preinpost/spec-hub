import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { type Source, activeSections, displaySections } from '../shared/spec';
import { safeReturnTo } from '../worker/auth/session';
import { addSeconds, now, sha256 } from '../worker/crypto';
import { AppError } from '../worker/errors';
import { SpecService } from '../worker/spec-service';
import { type UserRow, upsertUser } from '../worker/users';
import { WorkspaceService } from '../worker/workspaces';

// 웹 API 와 MCP 도구가 모두 이 서비스들을 거치므로 명세 규칙은 여기에서 실제 D1 으로 확인한다.

let seq = 0;

async function user(name: string): Promise<UserRow> {
  seq += 1;
  return upsertUser(env.DB, { subject: `oid-${name}-${seq}`, tenantId: 't', email: `${name}${seq}@inje.local`, name });
}

function as(actor: UserRow, source: Source = 'web') {
  return { specs: new SpecService(env.DB, { user: actor, source }), workspaces: new WorkspaceService(env.DB, { user: actor, source }) };
}

/** 테스트마다 새 워크스페이스를 만든다. 만든 사람(owner)이 관리자다. */
async function setup(sections: Record<string, string> = { rules: '원 단위 절사' }, metadata: { screenPath?: string | null; entryPath?: string | null } = {}) {
  seq += 1;
  const owner = await user('owner');
  const ws = `T${seq}`;
  await as(owner).workspaces.create({ key: ws, name: `테스트 ${seq}` });
  const { key } = await as(owner).specs.createFeature({ workspaceKey: ws, title: '수기 청구서', sections, ...metadata });
  return { owner, ws, key };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

async function snapshotCount(key: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM feature_snapshots s JOIN features f ON f.id = s.feature_id WHERE f.key = ?',
  )
    .bind(key)
    .first<{ n: number }>();
  return row!.n;
}

describe('기능 본문과 확정', () => {
  it('기능 키는 워크스페이스 키 뒤에 워크스페이스마다 1부터 번호를 붙인다', async () => {
    const kim = as(await user('kim'));
    await kim.workspaces.create({ key: 'KA', name: 'A' });
    await kim.workspaces.create({ key: 'KB', name: 'B' });

    const keys = [
      (await kim.specs.createFeature({ workspaceKey: 'KA', title: '하나' })).key,
      (await kim.specs.createFeature({ workspaceKey: 'KA', title: '둘' })).key,
      (await kim.specs.createFeature({ workspaceKey: 'kb', title: '셋' })).key,
    ];

    expect(keys).toEqual(['KA-1', 'KA-2', 'KB-1']);
  });

  it('다른 사람이 먼저 저장했으면 저장을 거절하고 본문과 활동 기록을 바꾸지 않는다', async () => {
    const { owner, key } = await setup();
    const park = as(await user('park'));
    await as(owner).specs.updateFeature(key, { sections: { rules: '1원 단위 절사' }, screenPath: '/invoice', entryPath: '청구 관리 → 목록', expectedVersion: 1 });

    const error = await rejection(park.specs.updateFeature(key, { sections: { rules: '반올림' }, screenPath: '/wrong', entryPath: '잘못된 접근 경로', expectedVersion: 1 }));

    expect(error.code).toBe('conflict');
    const after = await park.specs.getFeature(key);
    expect(after.sections.rules).toBe('1원 단위 절사');
    expect(after.screenPath).toBe('/invoice');
    expect(after.entryPath).toBe('청구 관리 → 목록');
    expect(after.version).toBe(2);
    expect(after.activities.filter((a) => a.action === 'edited')).toHaveLength(1);
  });

  it('질문이 남아 있으면 확정을 거절하고, 해결한 뒤 확정하면 확정본 차수가 1씩 오른다', async () => {
    const { owner, key } = await setup();
    const o = as(owner);
    await o.specs.changeStatus(key, { to: 'review', expectedVersion: 1 });
    const { id: questionId } = await as(await user('park')).specs.addQuestion(key, { section: 'rules', body: '10원 단위인가요?' });

    const blocked = await rejection(o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 }));
    expect(blocked.code).toBe('bad_request');
    expect(await snapshotCount(key)).toBe(0);

    await o.specs.resolveQuestion(questionId, '1원 단위로 한다');
    await o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2, note: '1차 합의' });
    await o.specs.updateFeature(key, { sections: { rules: '10원 단위 절사' }, expectedVersion: 3 });
    await o.specs.changeStatus(key, { to: 'review', expectedVersion: 4 });
    await o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 5 });

    const feature = await o.specs.getFeature(key);
    expect(feature.snapshots.map((s) => s.revision)).toEqual([2, 1]);
    expect(feature.lastConfirmed?.sections.rules).toBe('10원 단위 절사');
    expect((await o.specs.getSnapshot(key, 1)).sections.rules).toBe('원 단위 절사');
    expect(feature.decisions.map((d) => d.body)).toEqual(['1원 단위로 한다']);
  });

  it.each([
    { who: '확정 권한이 없는 멤버', role: 'member' as const, source: 'web' as const },
    { who: 'MCP 로 붙은 확정권한자', role: 'approver' as const, source: 'mcp' as const },
  ])('$who 의 확정은 거절한다', async ({ role, source }) => {
    const { owner, ws, key } = await setup();
    const other = await user('x');
    // 쓰기를 한 번 하면 멤버가 되고, 그다음 관리자가 역할을 정한다.
    await as(other).specs.addComment(key, { body: '봤습니다' });
    await as(owner).workspaces.setRole(ws, other.id, role);
    await as(owner).specs.changeStatus(key, { to: 'review', expectedVersion: 1 });

    const error = await rejection(as(other, source).specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 }));

    expect(error.code).toBe('forbidden');
    expect((await as(owner).specs.getFeature(key)).status).toBe('review');
    expect(await snapshotCount(key)).toBe(0);
  });

  it('버전이 낡은 확정 요청은 확정본을 남기지 않는다', async () => {
    const { owner, key } = await setup();
    const o = as(owner);
    await o.specs.changeStatus(key, { to: 'review', expectedVersion: 1 });
    // 관리자가 화면을 연 뒤(버전 2) 다른 사람이 본문을 고쳤다(버전 3).
    await as(await user('park')).specs.updateFeature(key, { sections: { rules: '고친 규칙' }, expectedVersion: 2 });

    const error = await rejection(o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 }));

    expect(error.code).toBe('conflict');
    expect(await snapshotCount(key)).toBe(0);
    const feature = await o.specs.getFeature(key);
    expect(feature.status).toBe('review');
    expect(feature.activities.some((a) => a.action === 'confirmed')).toBe(false);
  });

  it('확정본을 고치면 초안으로 돌아가고 마지막 확정본은 그대로 남는다', async () => {
    const { owner, key } = await setup();
    const o = as(owner);
    await o.specs.changeStatus(key, { to: 'review', expectedVersion: 1 });
    await o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 });

    const result = await o.specs.updateFeature(key, { sections: { flow: '목록에서 시작한다' }, expectedVersion: 3 });

    expect(result.status).toBe('draft');
    const feature = await o.specs.getFeature(key);
    expect(feature.sections.flow).toBe('목록에서 시작한다');
    expect(feature.lastConfirmed?.sections.flow).toBe('');
  });

  it('MCP 의 초안 수정은 검토 중인 기능의 본문을 바꾸지 못한다', async () => {
    const { owner, key } = await setup();
    await as(owner).specs.changeStatus(key, { to: 'review', expectedVersion: 1 });

    const error = await rejection(
      as(owner, 'mcp').specs.updateFeature(key, { sections: { rules: 'AI 가 바꾼 규칙' }, expectedVersion: 2, onlyDraft: true }),
    );

    expect(error.code).toBe('forbidden');
    expect((await as(owner).specs.getFeature(key)).sections.rules).toBe('원 단위 절사');
  });

  it('수정 제안을 반영하면 그 섹션만 바뀌고 제안은 해결 처리된다', async () => {
    const { owner, key } = await setup({ rules: '원 단위 절사', flow: '목록에서 시작' });
    const { id } = await as(await user('park')).specs.addComment(key, {
      section: 'rules',
      body: 'NHN 단위에 맞춘다',
      proposedText: '10원 단위 절사',
    });

    await as(owner).specs.applyProposal(id, 1);

    const feature = await as(owner).specs.getFeature(key);
    expect(feature.sections).toMatchObject({ rules: '10원 단위 절사', flow: '목록에서 시작' });
    expect(feature.comments[0].resolvedBy?.name).toBe('owner');
  });
});

describe('기능 메타정보', () => {
  it.each([{}, { screenPath: null, entryPath: null }, { screenPath: '', entryPath: '' }])('메타정보 $screenPath / $entryPath 로 만든 기능은 상세와 목록에서 null 로 조회된다', async (metadata) => {
    const { owner, ws, key } = await setup(undefined, metadata);
    const o = as(owner);
    expect(await o.specs.getFeature(key)).toMatchObject({ screenPath: null, entryPath: null });
    expect((await o.workspaces.get(ws)).features.find((f) => f.key === key)).toMatchObject({ screenPath: null, entryPath: null });
  });

  it('메타정보를 저장하고 상세, 워크스페이스 목록과 메타정보 검색에서 읽는다', async () => {
    const metadata = { screenPath: '/invoice/:id', entryPath: '청구 관리 → 청구서 목록\n행을 누르면 상세로 진입' };
    const { owner, ws, key } = await setup(undefined, metadata);
    const o = as(owner);
    expect(await o.specs.getFeature(key)).toMatchObject(metadata);
    expect((await o.workspaces.get(ws)).features.find((f) => f.key === key)).toMatchObject(metadata);
    expect(await o.specs.searchFeatures('/invoice/:id', ws)).toEqual([expect.objectContaining({ key, ...metadata })]);
    expect(await o.specs.searchFeatures('행을 누르면 상세로 진입', ws)).toEqual([expect.objectContaining({ key, ...metadata })]);
  });

  it('MCP 초안 수정에서 메타정보를 생략하면 기존 값을 유지하고, 경로만 고쳐도 버전이 오른다', async () => {
    const metadata = { screenPath: '/invoice', entryPath: '청구 관리 → 목록' };
    const { owner, key } = await setup(undefined, metadata);
    const ai = as(owner, 'mcp').specs;
    await ai.updateFeature(key, { title: '이름만 고침', expectedVersion: 1, onlyDraft: true });
    expect(await ai.getFeature(key)).toMatchObject({ ...metadata, version: 2 });
    await ai.updateFeature(key, { screenPath: '/invoice/:id', expectedVersion: 2, onlyDraft: true });
    expect(await ai.getFeature(key)).toMatchObject({ screenPath: '/invoice/:id', entryPath: metadata.entryPath, version: 3 });
    await ai.updateFeature(key, { entryPath: '목록 → 상세', expectedVersion: 3, onlyDraft: true });
    expect(await ai.getFeature(key)).toMatchObject({ screenPath: '/invoice/:id', entryPath: '목록 → 상세', version: 4 });
  });

  it.each([
    { field: 'screenPath' as const, value: null },
    { field: 'screenPath' as const, value: '' },
    { field: 'entryPath' as const, value: null },
    { field: 'entryPath' as const, value: '' },
    { field: 'entryPath' as const, value: ' \n ' },
  ])('$field 를 $value 로 명시하면 그 값만 삭제하고 다시 읽어도 null 이다', async ({ field, value }) => {
    const { owner, key } = await setup(undefined, { screenPath: '/invoice', entryPath: '청구 관리 → 목록' });
    const specs = as(owner).specs;
    await specs.updateFeature(key, { [field]: value, expectedVersion: 1 });
    expect(await specs.getFeature(key)).toMatchObject({
      screenPath: field === 'screenPath' ? null : '/invoice',
      entryPath: field === 'entryPath' ? null : '청구 관리 → 목록',
      version: 2,
    });
  });

  it.each([
    { label: '루트', screenPath: '/' },
    { label: '파라미터가 있는 화면', screenPath: '/invoice/:id' },
    { label: '한글 화면', screenPath: '/청구서/목록' },
    { label: '최대 512자', screenPath: '/' + 'a'.repeat(511) },
  ])('$label 경로와 URL 을 포함한 여러 줄 접근 설명을 저장할 수 있다', async ({ screenPath }) => {
    const entryPath = '메뉴를 누릅니다.\nhttps://help.example.com 설명을 참고합니다.';
    const { owner, key } = await setup(undefined, { screenPath, entryPath });
    expect(await as(owner).specs.getFeature(key)).toMatchObject({ screenPath, entryPath });
  });

  it.each([
    { label: 'http 전체 URL', value: 'http://example.com/invoice' },
    { label: 'https 전체 URL', value: 'https://example.com/invoice' },
    { label: '호스트만 포함한 URL', value: '//example.com/invoice' },
    { label: '상대 경로', value: 'invoice' },
    { label: '역슬래시', value: '/invoice\\detail' },
    { label: '공백', value: '/invoice detail' },
    { label: '앞뒤 공백', value: ' /invoice ' },
    { label: '공백만 있는 값', value: ' ' },
    { label: '줄바꿈', value: '/invoice\n/detail' },
    { label: '탭', value: '/invoice\t/detail' },
    { label: '제어문자', value: '/invoice\u0000' },
    { label: 'DEL 제어문자', value: '/invoice\u007f' },
    { label: '유니코드 제어문자', value: '/invoice\u0085' },
    { label: '보이지 않는 문자', value: '/invoice\u200b' },
    { label: 'query', value: '/invoice?page=1' },
    { label: 'hash', value: '/invoice#detail' },
    { label: '512자 초과', value: '/' + 'a'.repeat(512) },
  ])('$label 는 생성과 수정에서 거절하고 기존 명세를 보존한다', async ({ value }) => {
    const { owner, ws, key } = await setup(undefined, { screenPath: '/invoice', entryPath: '기존 접근 경로' });
    const o = as(owner);
    const updateError = await rejection(o.specs.updateFeature(key, { screenPath: value, expectedVersion: 1 }));
    const createError = await rejection(o.specs.createFeature({ workspaceKey: ws, title: '생성 실패', screenPath: value }));
    expect(updateError.code).toBe('bad_request');
    expect(createError.code).toBe('bad_request');
    expect(updateError.message).toContain('화면 경로');
    expect(await o.specs.getFeature(key)).toMatchObject({ screenPath: '/invoice', entryPath: '기존 접근 경로', version: 1 });
    expect((await o.workspaces.get(ws)).features).toHaveLength(1);
  });

  it('접근 경로는 2000자까지 저장하고 초과 값은 생성과 수정에서 거절한다', async () => {
    const { owner, ws, key } = await setup(undefined, { entryPath: '가'.repeat(2000) });
    const specs = as(owner).specs;
    expect((await specs.getFeature(key)).entryPath).toBe('가'.repeat(2000));
    expect((await rejection(specs.updateFeature(key, { entryPath: '가'.repeat(2001), expectedVersion: 1 }))).code).toBe('bad_request');
    expect((await rejection(specs.createFeature({ workspaceKey: ws, title: '너무 긴 설명', entryPath: '가'.repeat(2001) }))).code).toBe('bad_request');
    expect(await specs.getFeature(key)).toMatchObject({ entryPath: '가'.repeat(2000), version: 1 });
  });

  it('웹 API 의 요청 스키마가 두 메타정보의 생성, 수정, 생략과 삭제를 서비스에 전달한다', async () => {
    const { owner, ws } = await setup();
    const token = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), owner.id, now(), addSeconds(60))
      .run();
    const headers = { Cookie: `spec_session=${token}`, Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json' };
    const request = (path: string, method: string, body?: Record<string, unknown>) => SELF.fetch(`${env.PUBLIC_ORIGIN}/api${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const created = await request(`/workspaces/${ws}/features`, 'POST', { title: '웹 입력', screenPath: '/invoice', entryPath: '목록 → 상세' });
    expect(created.status).toBe(201);
    const { key } = await created.json<{ key: string }>();
    expect(await (await request(`/features/${key}`, 'GET')).json()).toMatchObject({ screenPath: '/invoice', entryPath: '목록 → 상세' });
    expect((await request(`/features/${key}`, 'PUT', { entryPath: '청구 관리 → 상세', expectedVersion: 1 })).status).toBe(200);
    expect((await request(`/features/${key}`, 'PUT', { title: '이름만 수정', expectedVersion: 2 })).status).toBe(200);
    expect(await (await request(`/features/${key}`, 'GET')).json()).toMatchObject({ screenPath: '/invoice', entryPath: '청구 관리 → 상세', version: 3 });
    const invalid = await request(`/features/${key}`, 'PUT', { screenPath: 'https://example.com/invoice', expectedVersion: 3 });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: 'bad_request', message: expect.stringContaining('도메인을 제외하고 /로 시작하는 화면 경로') });
    expect((await request(`/features/${key}`, 'PUT', { screenPath: null, entryPath: '', expectedVersion: 3 })).status).toBe(200);
    expect(await (await request(`/features/${key}`, 'GET')).json()).toMatchObject({ screenPath: null, entryPath: null, version: 4 });
  });

  it('메타정보의 null 상태와 각 확정 시점 값을 보존하고 이후 수정은 초안으로 돌아간다', async () => {
    const { owner, key } = await setup();
    const specs = as(owner).specs;
    await specs.changeStatus(key, { to: 'review', expectedVersion: 1 });
    await specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 });
    await specs.updateFeature(key, { screenPath: '/invoice', entryPath: '목록 → 상세', expectedVersion: 3 });
    expect((await specs.getFeature(key)).status).toBe('draft');
    await specs.changeStatus(key, { to: 'review', expectedVersion: 4 });
    await specs.changeStatus(key, { to: 'confirmed', expectedVersion: 5 });
    await specs.updateFeature(key, { screenPath: null, entryPath: '검색 결과 → 상세', expectedVersion: 6 });
    expect(await specs.getSnapshot(key, 1)).toMatchObject({ screenPath: null, entryPath: null });
    expect(await specs.getSnapshot(key, 2)).toMatchObject({ screenPath: '/invoice', entryPath: '목록 → 상세' });
    const current = await specs.getFeature(key);
    expect(current).toMatchObject({ screenPath: null, entryPath: '검색 결과 → 상세', status: 'draft', version: 7 });
    expect(current.lastConfirmed).toMatchObject({ screenPath: '/invoice', entryPath: '목록 → 상세' });
  });
});

describe('템플릿', () => {
  it('섹션을 템플릿에서 빼도 본문은 남고, 확정본은 확정할 때의 템플릿으로 보인다', async () => {
    const { owner, ws, key } = await setup({ rules: '원 단위 절사' });
    const o = as(owner);
    await o.specs.changeStatus(key, { to: 'review', expectedVersion: 1 });
    await o.specs.changeStatus(key, { to: 'confirmed', expectedVersion: 2 });

    await o.workspaces.setTemplate(ws, [{ key: 'purpose', label: '배경' }, { label: '화면 시안' }]);

    const feature = await o.specs.getFeature(key);
    expect(activeSections(feature.template).map((s) => s.label)).toEqual(['배경', '화면 시안']);
    expect(feature.sections.rules).toBe('원 단위 절사');
    // 빠진 섹션도 원래 이름으로 보인다.
    expect(displaySections(feature.template, feature.sections).filter((s) => s.removed).map((s) => s.label)).toEqual([
      '업무 규칙 (템플릿에서 빠진 섹션)',
    ]);
    expect(feature.lastConfirmed?.template.map((s) => s.label)).toContain('업무 규칙');
    // 템플릿에서 빠진 섹션에도 의견은 남길 수 있다. 템플릿에도 본문에도 없는 섹션은 거절한다.
    await o.specs.addComment(key, { section: 'rules', body: '어디로 옮길까요?' });
    expect((await rejection(o.specs.addComment(key, { section: 'flow', body: 'x' }))).code).toBe('bad_request');
  });

  it('관리자가 아니면 템플릿을 바꿀 수 없다', async () => {
    const { ws } = await setup();

    const error = await rejection(as(await user('park')).workspaces.setTemplate(ws, [{ label: '하나' }]));

    expect(error.code).toBe('forbidden');
  });
});

describe('분류와 멤버', () => {
  it('분류는 세 단계까지 만들 수 있고, 기능을 옮겨도 키는 바뀌지 않는다', async () => {
    const { owner, ws, key } = await setup();
    const w = as(owner).workspaces;
    const large = await w.createCategory(ws, { name: '청구서' });
    const middle = await w.createCategory(ws, { parentId: large.id, name: '발행' });
    const small = await w.createCategory(ws, { parentId: middle.id, name: '수기' });

    const tooDeep = await rejection(w.createCategory(ws, { parentId: small.id, name: '네 번째' }));
    expect(tooDeep.code).toBe('bad_request');

    await as(owner).specs.moveFeature(key, small.id);
    const feature = await as(owner).specs.getFeature(key);
    expect(feature.key).toBe(key);
    expect(feature.categoryPath).toEqual(['청구서', '발행', '수기']);
  });

  it('기능이나 하위 분류가 있는 분류는 지울 수 없다', async () => {
    const { owner, ws, key } = await setup();
    const w = as(owner).workspaces;
    const parent = await w.createCategory(ws, { name: '청구서' });
    const child = await w.createCategory(ws, { parentId: parent.id, name: '발행' });
    await as(owner).specs.moveFeature(key, child.id);

    expect((await rejection(w.deleteCategory(parent.id))).code).toBe('bad_request');
    expect((await rejection(w.deleteCategory(child.id))).code).toBe('bad_request');

    await as(owner).specs.moveFeature(key, null);
    await w.deleteCategory(child.id);
    await w.deleteCategory(parent.id);
    expect((await w.get(ws)).categories).toEqual([]);
  });

  it('마지막 관리자는 관리자에서 내릴 수 없다', async () => {
    const { owner, ws } = await setup();

    const error = await rejection(as(owner).workspaces.setRole(ws, owner.id, 'member'));

    expect(error.code).toBe('bad_request');
    expect((await as(owner).workspaces.get(ws)).myRole).toBe('admin');
  });

  it('워크스페이스에 무언가를 쓰면 멤버가 되고, 고른 팀이 작성자 옆에 붙는다', async () => {
    const { ws, key } = await setup();
    const park = as(await user('park'));
    expect((await park.workspaces.get(ws)).myRole).toBeNull();

    await park.specs.addComment(key, { body: '확인했습니다' });
    const detail = await park.workspaces.get(ws);
    await park.workspaces.setMyTeam(ws, detail.teams.find((t) => t.name === '개발')!.id);

    const feature = await park.specs.getFeature(key);
    expect((await park.workspaces.get(ws)).myRole).toBe('member');
    expect(feature.comments[0].author).toMatchObject({ name: 'park', team: '개발' });
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/features/WCN-1?tab=changes', '/features/WCN-1?tab=changes'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    [null, '/'],
  ])('로그인 뒤 돌아갈 경로 %s 는 %s 로 보낸다', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
