import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { AppEnv } from '../env';

// Microsoft Entra ID 를 기준으로 썼지만 표준 OIDC 만 쓰므로 로컬 mock 서버에도 그대로 붙는다.

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface Identity {
  /** Entra 의 oid. 앱마다 값이 달라지는 sub 대신 테넌트 안에서 고정된 oid 를 쓴다. */
  subject: string;
  tenantId: string | null;
  email: string;
  name: string;
}

export class OidcError extends Error {}

const discoveryCache = new Map<string, Promise<Discovery>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function discover(issuer: string): Promise<Discovery> {
  let pending = discoveryCache.get(issuer);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      if (!res.ok) throw new OidcError(`OIDC discovery 응답이 ${res.status} 입니다.`);
      const doc = (await res.json()) as Discovery;
      if (doc.issuer !== issuer) throw new OidcError(`discovery 문서의 issuer(${doc.issuer})가 설정값과 다릅니다.`);
      return doc;
    })();
    // 실패한 결과는 캐시하지 않는다. 다음 요청에서 다시 시도한다.
    pending.catch(() => discoveryCache.delete(issuer));
    discoveryCache.set(issuer, pending);
  }
  return pending;
}

function jwks(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

export const callbackUrl = (env: AppEnv) => `${env.PUBLIC_ORIGIN}/auth/callback`;

export async function authorizationUrl(
  env: AppEnv,
  params: { state: string; nonce: string; codeChallenge: string },
): Promise<string> {
  const doc = await discover(env.OIDC_ISSUER);
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: env.OIDC_CLIENT_ID,
    response_type: 'code',
    redirect_uri: callbackUrl(env),
    scope: 'openid profile email',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** 인가 코드를 토큰으로 바꾸고 id_token 을 검증해서 사용자 정보를 꺼낸다. */
export async function exchangeCode(
  env: AppEnv,
  params: { code: string; codeVerifier: string; nonce: string },
): Promise<Identity> {
  const doc = await discover(env.OIDC_ISSUER);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: callbackUrl(env),
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) throw new OidcError(`토큰 엔드포인트 응답이 ${res.status} 입니다: ${await res.text()}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new OidcError('토큰 응답에 id_token 이 없습니다.');

  const { payload } = await jwtVerify(body.id_token, jwks(doc.jwks_uri), {
    issuer: doc.issuer,
    audience: env.OIDC_CLIENT_ID,
  });
  if (payload.nonce !== params.nonce) throw new OidcError('id_token 의 nonce 가 로그인 요청과 다릅니다.');

  const claim = (name: string) => (typeof payload[name] === 'string' ? (payload[name] as string) : null);
  const tenantId = claim('tid');
  if (env.OIDC_ALLOWED_TENANT_ID && tenantId !== env.OIDC_ALLOWED_TENANT_ID) {
    throw new OidcError(`허용되지 않은 테넌트입니다(tid=${tenantId ?? '없음'}).`);
  }
  const subject = claim('oid') ?? payload.sub;
  // Entra 는 선택적 클레임을 켜지 않으면 email 을 주지 않는다. 그때는 UPN 이 담긴 preferred_username 을 쓴다.
  const email = claim('email') ?? claim('preferred_username') ?? claim('upn');
  if (!subject || !email) throw new OidcError('id_token 에 사용자 식별자나 이메일이 없습니다.');
  return { subject, tenantId, email: email.toLowerCase(), name: claim('name') ?? email };
}
