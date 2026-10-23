# AGENTS.md

이 저장소(Spec Hub)에서 작업하는 에이전트가 지킬 규칙이다.

## 프로젝트

기획 · 개발 · 운영이 기능명세를 함께 쓰는 웹 앱이다. Cloudflare Workers 한 개(React + Hono + D1 + KV)로 돌고,
Microsoft Entra ID 로그인과 MCP 서버를 같은 워커가 제공한다. 구조와 결정 사항은
[docs/design-log.md](docs/design-log.md) 에 있다.

## 로컬 환경

- `task setup` → `task dev` 로 띄운다. 앱 `http://localhost:5185`, mock OIDC `http://localhost:9400`.
- 로컬 로그인은 mock OIDC 를 쓴다. claims 예시는 [README](README.md) 에 있다.
- `bash scripts/doctor.sh` 로 서버 · 설정 · 도구를 먼저 확인한다.

### 외부로 나가는 조작

- `.dev.vars` 에는 로컬 mock OIDC 용 가짜 암호만 둔다. 실제 Entra 클라이언트 암호를 커밋하지 않는다.
- 원격 D1 · KV 나 배포에 손대는 명령(`wrangler deploy`, `d1 migrations apply --remote`)은 사용자 확인 뒤에만 실행한다.

## 변경 검증

- 화면이나 API 동작을 바꾸면 [docs/verification.md](docs/verification.md) 의 경로를 agent-browser 로 직접 돌리고,
  결과를 `docs/ui-verification-<날짜>.md` 에 남긴다. 성공뿐 아니라 취소 · 오류 · 빈 상태 · 새로고침 후 유지를 확인한다.
- 백엔드 로직만 바꿨다면 `pnpm test` 와 `pnpm typecheck` 출력을 남긴다.
- 테스트는 동작이나 계약을 지키는 것만 남긴다. 소스를 되읊는 테스트, 구현에 묶인 테스트는 쓰지 않는다.

## 코드 규칙

- 명세 규칙(섹션 · 상태 전이 · 역할 · 템플릿)은 `shared/` 에 두고 웹과 워커가 함께 쓴다. 규칙을 화면에 다시 적지 않는다.
- 웹 API 와 MCP 가 같은 서비스(`worker/spec-service.ts`, `worker/workspaces.ts`)를 거친다. 한쪽에만 규칙을 넣지 않는다.
- 사용자에게 보이는 문구는 한국어로 쓴다. 커밋 메시지는 Conventional Commits 를 따른다.
