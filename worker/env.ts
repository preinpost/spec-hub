import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

/** wrangler 바인딩(Env)에 OAuthProvider 가 넣어 주는 헬퍼를 더한 것. */
export interface AppEnv extends Env {
  OAUTH_PROVIDER: OAuthHelpers;
}

/** MCP 토큰에 암호화해 담는 값. 사용자 정보는 요청마다 DB 에서 다시 읽는다. */
export interface McpProps extends Record<string, unknown> {
  userId: string;
}
