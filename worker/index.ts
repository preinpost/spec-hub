import { OAuthProvider } from '@cloudflare/workers-oauth-provider';

import { app } from './app';
import type { AppEnv } from './env';
import { SCOPE_READ, SCOPE_WRITE, mcpApiHandler } from './mcp';

// 리소스 URL 이 PUBLIC_ORIGIN 에 따라 달라서 첫 요청에서 만든다. 환경마다 값이 하나뿐이라 한 번 만들면 계속 쓴다.
let provider: OAuthProvider<AppEnv> | null = null;

function getProvider(env: AppEnv): OAuthProvider<AppEnv> {
  provider ??= new OAuthProvider<AppEnv>({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler: app,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [SCOPE_READ, SCOPE_WRITE, 'offline_access'],
    requiredScopes: [SCOPE_READ],
    resourceMetadata: {
      resource: `${env.PUBLIC_ORIGIN}/mcp`,
      authorization_servers: [env.PUBLIC_ORIGIN],
      bearer_methods_supported: ['header'],
      resource_name: 'Spec Hub',
    },
  });
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
