# Spec Hub

기획 · 개발 · 운영이 기능명세를 함께 쓰는 웹 앱. 제품 · 프로젝트마다 워크스페이스를 만들고, 그 안에서
대 · 중 · 소 분류로 기능을 정리한다. Cloudflare Workers 한 개로 돈다.

- 로그인은 Microsoft Entra ID(OIDC)만 받는다. 허용한 테넌트(`OIDC_ALLOWED_TENANT_ID`)의 계정만 들어온다.
- 같은 워커가 MCP 서버(`/mcp`)도 연다. AI 클라이언트는 OAuth 로 붙고, 로그인은 같은 Entra 흐름을 탄다.
- 저장소는 D1(명세)과 KV(OAuth 클라이언트 · 토큰)다.
- 명세 본문과 별도로 기능마다 메타정보를 적을 수 있다. `화면 경로`에는 도메인을 뺀 `/invoice/:id` 같은 path 를,
  `접근 경로`에는 `청구 관리 → 청구서 목록 → 상세`처럼 화면에 들어가는 방법을 쓴다. 두 항목은 선택이며 확정본에도 남는다.

설계와 결정 사항은 [docs/design-log.md](docs/design-log.md) 에 있다.

## 로컬 실행

Docker 가 필요하다. 로컬에서는 Entra 대신 mock OIDC 서버(`docker-compose.yaml`)로 로그인한다.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local   # .wrangler/state 의 로컬 D1 에 스키마를 만든다
pnpm oidc:up            # mock OIDC 서버 :9400
pnpm dev                # http://localhost:5185
```

`task setup` · `task dev` 로도 같은 일을 한다.

### 로컬 로그인

로그인 버튼을 누르면 mock 서버의 로그인 화면이 뜬다. username 은 아무 값이나 넣고, claims 칸에 Entra 가 주는
클레임을 흉내 내 넣는다.

```json
{"oid": "oid-kim", "tid": "local-tenant", "email": "kim@inje.local", "name": "김기획"}
```

- `tid` 가 `local-tenant` 가 아니면 로그인이 거절된다.
- 워크스페이스를 만든 사람이 관리자가 된다. 확정은 관리자와 확정권한자만 한다. 역할은 워크스페이스 설정에서 바꾼다.
- `oid` 가 같으면 같은 사람으로 본다. 여러 사람을 흉내 내려면 `oid` 를 바꾼다.

### MCP 로 붙어 보기

```sh
claude mcp add --transport http spec-hub http://localhost:5185/mcp
```

Claude Code 가 브라우저를 열면 위와 같이 로그인하고 동의 화면에서 허용한다.

## 테스트

```sh
pnpm test        # workerd 안에서 실제 D1 으로 명세 규칙을 확인한다
pnpm typecheck
pnpm build
```

UI 검증 절차는 [docs/verification.md](docs/verification.md), 실행 결과는
[docs/ui-verification-2026-10-23.md](docs/ui-verification-2026-10-23.md) 에 있다.
점검 스크립트는 `bash scripts/doctor.sh` 다.

## 환경 변수

| 이름 | 종류 | 설명 |
|---|---|---|
| `PUBLIC_ORIGIN` | var | 앱 주소. OIDC redirect URI 와 MCP 리소스 URL 이 여기서 나온다 |
| `OIDC_ISSUER` | var | Entra 는 `https://login.microsoftonline.com/<테넌트 ID>/v2.0` |
| `OIDC_CLIENT_ID` | var | Entra 앱 등록의 애플리케이션(클라이언트) ID |
| `OIDC_ALLOWED_TENANT_ID` | var | 이 테넌트의 `tid` 만 로그인할 수 있다. 비우면 검사하지 않는다 |
| `OIDC_CLIENT_SECRET` | secret | Entra 앱의 클라이언트 암호 |

`wrangler.jsonc` 의 `vars` 와 D1 · KV id 는 지금 로컬 값이다. 배포할 때 환경별로 나눈다.
