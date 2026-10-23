import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import type { Connection } from '../shared/api';
import { ROLES, STATUSES } from '../shared/spec';
import { OidcError, authorizationUrl, exchangeCode } from './auth/oidc';
import { endSession, safeReturnTo, sessionUser, startSession } from './auth/session';
import { consentPage, errorPage } from './consent';
import { addSeconds, now, randomToken, sha256 } from './crypto';
import type { AppEnv } from './env';
import { AppError } from './errors';
import { SpecService } from './spec-service';
import { type UserRow, toMe, upsertUser } from './users';
import { WorkspaceService } from './workspaces';

type Vars = { user: UserRow; specs: SpecService; workspaces: WorkspaceService };
type Ctx = Context<{ Bindings: AppEnv; Variables: Vars }>;

const LOGIN_COOKIE = 'spec_login';

export const app = new Hono<{ Bindings: AppEnv; Variables: Vars }>();

app.onError((error, c) => {
  if (error instanceof AppError) return c.json({ error: error.code, message: error.message }, error.status);
  if (error instanceof z.ZodError) {
    return c.json({ error: 'bad_request', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ') }, 400);
  }
  console.error(error);
  return c.json({ error: 'internal', message: '서버에서 오류가 났습니다.' }, 500);
});

// ── 로그인 (Entra ID OIDC) ──────────────────────────────

app.get('/auth/login', async (c) => {
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(48);
  await c.env.DB.prepare(
    'INSERT INTO login_requests (state_hash, nonce, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256(state), nonce, codeVerifier, safeReturnTo(c.req.query('return_to')), addSeconds(600))
    .run();
  // state 를 이 브라우저에 묶는다. 다른 브라우저에서 콜백 URL 을 열면 거절된다.
  setCookie(c, LOGIN_COOKIE, state, {
    httpOnly: true,
    secure: c.env.PUBLIC_ORIGIN.startsWith('https://'),
    sameSite: 'Lax',
    path: '/auth/callback',
    maxAge: 600,
  });
  return c.redirect(await authorizationUrl(c.env, { state, nonce, codeChallenge: await sha256(codeVerifier) }));
});

app.get('/auth/callback', async (c) => {
  const state = c.req.query('state');
  const code = c.req.query('code');
  const cookieState = getCookie(c, LOGIN_COOKIE);
  deleteCookie(c, LOGIN_COOKIE, { path: '/auth/callback' });
  if (c.req.query('error')) return loginFailed(c, `로그인이 취소됐거나 실패했습니다(${c.req.query('error')}).`);
  if (!state || !code || state !== cookieState) return loginFailed(c, '로그인 요청이 이 브라우저에서 시작되지 않았습니다. 다시 로그인해 주세요.');

  const pending = await c.env.DB.prepare(
    'DELETE FROM login_requests WHERE state_hash = ? AND expires_at > ? RETURNING nonce, code_verifier, return_to',
  )
    .bind(await sha256(state), now())
    .first<{ nonce: string; code_verifier: string; return_to: string }>();
  if (!pending) return loginFailed(c, '로그인 요청이 만료됐습니다. 다시 로그인해 주세요.');

  try {
    const identity = await exchangeCode(c.env, { code, codeVerifier: pending.code_verifier, nonce: pending.nonce });
    const user = await upsertUser(c.env.DB, identity);
    await startSession(c, user.id);
    return c.redirect(safeReturnTo(pending.return_to));
  } catch (error) {
    if (error instanceof OidcError) return loginFailed(c, error.message);
    throw error;
  }
});

function loginFailed(c: Context, message: string) {
  return c.redirect(`/login?error=${encodeURIComponent(message)}`);
}

app.post('/auth/logout', requireSameOrigin(), async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

// ── MCP 클라이언트 인가 (/authorize) ──────────────────────

app.get('/authorize', async (c) => {
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const request = await oauth.parseAuthRequest(c.req.raw);
    const user = await sessionUser(c);
    if (!user) {
      const url = new URL(c.req.url);
      return c.redirect(`/auth/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
    }
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    consent.headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(consentPage(details, consent.handle, user), { headers: consent.headers });
  } catch (error) {
    return authorizeError(error);
  }
});

app.post('/authorize', async (c) => {
  try {
    const oauth = c.env.OAUTH_PROVIDER;
    const user = await sessionUser(c);
    if (!user) return new Response(errorPage('로그인이 풀렸습니다. AI 클라이언트에서 연결을 다시 시작해 주세요.'), htmlError(401));
    const form = await c.req.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope: form.getAll('scope').map(String) });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { userName: user.name },
      scope: approved.request.scope,
      props: { userId: user.id },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    return authorizeError(error);
  }
});

const htmlError = (status: number) => ({ status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function authorizeError(error: unknown): Response {
  // 클라이언트와 redirect_uri 가 검증된 경우에만 클라이언트로 돌려보낸다. 나머지는 이 화면에서 보여 준다.
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return new Response(errorPage(error.description ?? error.message), htmlError(400));
  if (error instanceof CimdFetchError) return new Response(errorPage('앱 정보를 확인하지 못했습니다.'), htmlError(400));
  throw error;
}

// ── 웹 API ──────────────────────────────────────────────

/** 상태를 바꾸는 요청은 같은 출처에서 온 것만 받는다. 세션 쿠키가 SameSite=Lax 라서 이중으로 막는 셈이다. */
function requireSameOrigin() {
  return createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('Origin') !== c.env.PUBLIC_ORIGIN) {
      return c.json({ error: 'forbidden', message: '다른 출처에서 온 요청입니다.' }, 403);
    }
    await next();
  });
}

const api = new Hono<{ Bindings: AppEnv; Variables: Vars }>();

api.use(requireSameOrigin());
api.use(async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'unauthorized', message: '로그인이 필요합니다.' }, 401);
  const actor = { user, source: 'web' as const };
  c.set('user', user);
  c.set('specs', new SpecService(c.env.DB, actor));
  c.set('workspaces', new WorkspaceService(c.env.DB, actor));
  await next();
});

const body = async <T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> => schema.parse(await c.req.json());
const intParam = (c: Ctx, name: string) => z.coerce.number().int().positive().parse(c.req.param(name));
const optionalSection = z.string().nullish();

api.get('/me', (c) => c.json(toMe(c.var.user)));

// 워크스페이스 · 팀 · 멤버 · 템플릿
api.get('/workspaces', async (c) => c.json(await c.var.workspaces.list()));
api.post('/workspaces', async (c) => {
  const input = await body(c, z.object({ key: z.string(), name: z.string(), description: z.string().optional() }));
  return c.json(await c.var.workspaces.create(input), 201);
});
api.get('/workspaces/:wk', async (c) => c.json(await c.var.workspaces.get(c.req.param('wk'))));
api.patch('/workspaces/:wk', async (c) => {
  const input = await body(c, z.object({ name: z.string().optional(), description: z.string().optional() }));
  await c.var.workspaces.update(c.req.param('wk'), input);
  return c.body(null, 204);
});
api.put('/workspaces/:wk/template', async (c) => {
  const { sections } = await body(
    c,
    z.object({ sections: z.array(z.object({ key: z.string().optional(), label: z.string(), hint: z.string().optional() })) }),
  );
  return c.json(await c.var.workspaces.setTemplate(c.req.param('wk'), sections));
});
api.post('/workspaces/:wk/teams', async (c) => {
  const { name } = await body(c, z.object({ name: z.string() }));
  await c.var.workspaces.addTeam(c.req.param('wk'), name);
  return c.body(null, 201);
});
api.delete('/workspaces/:wk/teams/:id', async (c) => {
  await c.var.workspaces.deleteTeam(c.req.param('wk'), intParam(c, 'id'));
  return c.body(null, 204);
});
api.put('/workspaces/:wk/members/me', async (c) => {
  const { teamId } = await body(c, z.object({ teamId: z.number().int().nullable() }));
  await c.var.workspaces.setMyTeam(c.req.param('wk'), teamId);
  return c.body(null, 204);
});
api.put('/workspaces/:wk/members/:userId', async (c) => {
  const { role } = await body(c, z.object({ role: z.enum(ROLES) }));
  await c.var.workspaces.setRole(c.req.param('wk'), c.req.param('userId'), role);
  return c.body(null, 204);
});

// 분류
api.post('/workspaces/:wk/categories', async (c) => {
  const input = await body(c, z.object({ parentId: z.number().int().nullish(), name: z.string() }));
  return c.json(await c.var.workspaces.createCategory(c.req.param('wk'), input), 201);
});
api.patch('/categories/:id', async (c) => {
  const { name } = await body(c, z.object({ name: z.string() }));
  await c.var.workspaces.renameCategory(intParam(c, 'id'), name);
  return c.body(null, 204);
});
api.delete('/categories/:id', async (c) => {
  await c.var.workspaces.deleteCategory(intParam(c, 'id'));
  return c.body(null, 204);
});

// 기능
api.get('/search', async (c) => c.json(await c.var.specs.searchFeatures(c.req.query('q') ?? '', c.req.query('workspace') || undefined)));
api.post('/workspaces/:wk/features', async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string(),
      screenPath: z.string().nullish(),
      entryPath: z.string().nullish(),
      categoryId: z.number().int().nullish(),
      sections: z.record(z.string(), z.string()).optional(),
    }),
  );
  return c.json(await c.var.specs.createFeature({ workspaceKey: c.req.param('wk'), ...input }), 201);
});
api.get('/features/:key', async (c) => c.json(await c.var.specs.getFeature(c.req.param('key'))));
api.put('/features/:key', async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string().optional(),
      screenPath: z.string().nullish(),
      entryPath: z.string().nullish(),
      sections: z.record(z.string(), z.string()).optional(),
      expectedVersion: z.number().int(),
    }),
  );
  return c.json(await c.var.specs.updateFeature(c.req.param('key'), input));
});
api.put('/features/:key/category', async (c) => {
  const { categoryId } = await body(c, z.object({ categoryId: z.number().int().nullable() }));
  await c.var.specs.moveFeature(c.req.param('key'), categoryId);
  return c.body(null, 204);
});
api.post('/features/:key/status', async (c) => {
  const input = await body(c, z.object({ to: z.enum(STATUSES), expectedVersion: z.number().int(), note: z.string().optional() }));
  return c.json(await c.var.specs.changeStatus(c.req.param('key'), input));
});
api.get('/features/:key/snapshots/:revision', async (c) => {
  return c.json(await c.var.specs.getSnapshot(c.req.param('key'), intParam(c, 'revision')));
});

// 의견 · 질문 · 결정
api.post('/features/:key/comments', async (c) => {
  const input = await body(c, z.object({ section: optionalSection, body: z.string(), proposedText: z.string().nullish() }));
  return c.json(await c.var.specs.addComment(c.req.param('key'), input), 201);
});
api.post('/comments/:id/resolve', async (c) => {
  await c.var.specs.resolveComment(intParam(c, 'id'));
  return c.body(null, 204);
});
api.post('/comments/:id/apply', async (c) => {
  const { expectedVersion } = await body(c, z.object({ expectedVersion: z.number().int() }));
  return c.json(await c.var.specs.applyProposal(intParam(c, 'id'), expectedVersion));
});
api.post('/features/:key/questions', async (c) => {
  const input = await body(c, z.object({ section: optionalSection, body: z.string() }));
  return c.json(await c.var.specs.addQuestion(c.req.param('key'), input), 201);
});
api.post('/questions/:id/resolve', async (c) => {
  const { answer } = await body(c, z.object({ answer: z.string() }));
  return c.json(await c.var.specs.resolveQuestion(intParam(c, 'id'), answer));
});
api.post('/features/:key/decisions', async (c) => {
  const input = await body(c, z.object({ body: z.string() }));
  return c.json(await c.var.specs.addDecision(c.req.param('key'), input), 201);
});

// AI 연결: 이 사용자가 승인한 MCP 클라이언트 목록과 끊기.
api.get('/connections', async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  const { items } = await oauth.listUserGrants(c.var.user.id);
  const connections: Connection[] = await Promise.all(
    items.map(async (g) => ({
      grantId: g.id,
      clientName: (await oauth.lookupClient(g.clientId).catch(() => null))?.clientName ?? g.clientId,
      scopes: g.scope,
      createdAt: new Date(g.createdAt * 1000).toISOString(),
    })),
  );
  return c.json(connections);
});
api.delete('/connections/:grantId', async (c) => {
  await c.env.OAUTH_PROVIDER.revokeGrant(c.req.param('grantId'), c.var.user.id);
  return c.body(null, 204);
});

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'not_found', message: '없는 API 입니다.' }, 404));
