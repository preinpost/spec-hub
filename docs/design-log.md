# Spec Hub 설계와 진행 기록

기획 · 개발 · 운영이 기능명세를 한곳에서 쓰고 합의하는 웹 앱이다. 제품 · 프로젝트마다 워크스페이스를 두고
그 안에서 대 · 중 · 소 분류로 기능을 정리한다. Cloudflare Workers 에서 돌고, Microsoft Entra ID 로만 로그인하며,
AI 클라이언트가 MCP 로 명세를 읽고 의견을 남길 수 있다.

원래 CONE Watcher 모노레포 안(`watchern-spec-app/`)에서 만들었고, dogfooding 을 위해 2026-10-23 에 이 저장소로
분리했다. WatcherN 팀이 먼저 써 보고 회사 전체에 공유한다.

## 배경

- 기능명세가 `prd/features/`, `spec/`, `backlog/`, 대화 속에 흩어져 있다. 운영기획팀은 저장소를 보지
  않으므로 두 팀이 같은 문서를 보는 곳이 없다.
- 운영기획팀은 JIRA 를 쓰지 않는다. 그래서 이 앱은 일정 · 티켓 관리 없이 기능명세에만 집중한다.
- 개발팀은 Claude Code 로 작업하므로, 명세를 MCP 로 바로 읽을 수 있으면 "명세 읽고 작업해"가 된다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 정본 | 기능의 "무엇을, 왜"(요구사항 · 규칙 · 결정)는 이 앱이 정본이다. "어떻게"(구현 핸드오프)는 지금처럼 `backlog/` |
| 런타임 | Workers 하나(Static Assets + 워커). applyer 처럼 Pages Functions 가 아니라 Workers 로 한다. OAuth · MCP 라우트가 많아서다 |
| 로그인 | Entra ID OIDC 만. 단일 테넌트 앱 + `tid` 검사. 사용자 식별자는 앱마다 달라지는 `sub` 대신 `oid` |
| 세션 | 무작위 토큰 쿠키(HttpOnly, SameSite=Lax) + D1 에 해시 저장, 7일. 상태를 바꾸는 API 는 Origin 도 검사한다 |
| MCP 인가 | `@cloudflare/workers-oauth-provider` 로 워커가 인가 서버를 겸한다. `/authorize` 는 웹 세션이 없으면 Entra 로그인으로 보낸 뒤 동의 화면을 띄운다. DCR 과 CIMD 를 모두 받는다 |
| MCP 서버 | `agents` 의 무상태 `createMcpHandler()`. `McpAgent`(Durable Objects)는 지원이 멈춘 경로라서 쓰지 않는다 |
| 저장소 | D1(명세) + KV(OAuth 라이브러리 전용). Durable Objects 는 쓰지 않는다 |
| 범위 | 회사 전체. 워크스페이스 = 제품 · 프로젝트. 기능 키는 워크스페이스 키를 따른다(`WCN-12`) |
| 분류 | 워크스페이스 안에서 대 · 중 · 소 최대 3단계. 기능은 어느 단계에나 달 수 있고 분류가 없으면 미분류. 분류를 옮겨도 키는 그대로 |
| 권한 | 워크스페이스별 역할: 관리자 · 확정권한자 · 멤버. 만든 사람이 관리자. 무언가를 쓰면 자동으로 멤버. 확정은 관리자 · 확정권한자가 웹에서만 |
| 공개 범위 | 아직 없다. 로그인한 사람은 모든 워크스페이스를 읽고 쓴다. 기능이 자리 잡은 뒤에 만든다 |
| 팀 | 워크스페이스마다 팀 목록을 정한다(기본: 기획, 개발). 각자 고른 팀이 작성자 옆에 붙는다 |
| 템플릿 | 워크스페이스별 섹션 구성. 관리자가 바꾼다. 뺀 섹션은 `archived` 로 남겨 라벨을 기억하고, 본문도 지우지 않는다. 확정본에는 그때의 템플릿을 함께 저장한다 |
| AI 쓰기 범위 | `spec:write` 를 허용받은 연결만. 초안 만들기 · 초안 고치기 · 의견 · 수정 제안 · 질문까지. 검토 중이거나 확정된 본문은 못 고치고, 확정은 못 한다 |
| 동시 저장 | `features.version` 낙관적 잠금. 실시간 공동 편집은 하지 않는다 |
| 검색 | `LIKE`. 데이터가 적어서 FTS 는 아직 필요 없다(FTS5 기본 토크나이저는 한국어 조사를 못 나눈다) |

### 명세 구조와 상태

- 워크스페이스(키 `WCN`) → 분류(대 · 중 · 소) → 기능(키 `WCN-1`). 키는 워크스페이스마다 1부터 매기고 바뀌지 않는다.
- 섹션은 워크스페이스 템플릿을 따른다. 기본값은 `shared/spec.ts` 의 `DEFAULT_TEMPLATE` 다섯 개.
- 상태는 `초안 → 검토 중 → 확정`. 확정본을 고치면 저장할 때 초안으로 돌아간다.
- 확정은 열린 질문이 없어야 할 수 있고, 확정할 때마다 `feature_snapshots` 에 본문을 남긴다(1차, 2차 ...).
  화면과 MCP(`get_changes_since_confirmed`)는 마지막 확정본과 현재 본문의 차이를 보여 준다.
- 질문을 해결하면 답이 결정 기록으로 남는다. 수정 제안은 "본문에 반영"하면 그 섹션만 바뀐다.

### 데이터 모델 (D1)

```
users ──< sessions
workspaces ──< workspace_teams
           ├──< workspace_members >── users   (role, team_id)
           ├──< categories (parent_id, depth 1~3)
           └──< features ──< feature_snapshots (template 포함)
                         ├──< comments   (kind: comment | proposal)
                         ├──< questions ──< decisions
                         └──< activities
login_requests        (OIDC state · nonce · PKCE, 10분, 1회)
```

스키마는 `migrations/` 아래 SQL 이다.

## 진행 현황

### 완료 — 1차: 로컬에서 돌아가는 첫 버전

워크트리 `feat/feature-spec-app` 에서 로컬까지만 만들었다. 배포 설정은 아직 없다.

| 파일 | 내용 |
|---|---|
| `worker/index.ts` | OAuthProvider 진입점. `PUBLIC_ORIGIN` 으로 MCP 리소스 URL 을 정한다 |
| `worker/app.ts` | Hono 라우트: `/auth/*`(OIDC), `/authorize`(MCP 동의), `/api/*` |
| `worker/auth/oidc.ts` | discovery · PKCE · id_token 검증(jose) · tid 검사 |
| `worker/spec-service.ts` | 명세 규칙. 웹 API 와 MCP 가 모두 이 클래스를 거친다 |
| `worker/mcp.ts` | MCP 도구. 쓰기 도구는 `spec:write` 가 있을 때만 목록에 나온다 |
| `src/` | React 화면 |
| `test/spec-service.test.ts` | workerd + 실제 D1 으로 규칙 확인 |

확인한 것:

- 로그인: mock OIDC 로 로그인, 다른 `tid` 거절, 세션 없는 API 401, 다른 출처 POST 403.
- 명세 규칙: 버전 충돌 거절, 권한 없는 확정 거절, 열린 질문이 있을 때 확정 거절, 확정본 수정 시 초안 전환, 제안 반영.
- MCP: `/mcp` 401 → 메타데이터 → DCR → 로그인 → 동의 → 토큰 → `tools/list` · `tools/call` 까지 curl 로 확인.
  읽기만 허용한 연결은 쓰기 도구가 안 보이고, 화면에서 연결을 끊으면 토큰이 곧바로 401 이 된다.
- 테스트: `changes() = 1` 가드나 `onlyDraft` 를 지우면 해당 테스트가 실패하는 것을 확인했다.

⚠️ D1 `batch` 안에서 앞 문장의 성공 여부를 보려고 `WHERE changes() = 1` 을 쓴다. 문장 순서를 바꾸면 가드가
엉뚱한 문장을 보게 된다.

### 완료 — 2차: 회사 전체용 구조 (워크스페이스 · 분류 · 역할 · 템플릿)

WatcherN 전용이던 "도메인 → 기능" 을 "워크스페이스 → 대 · 중 · 소 분류 → 기능" 으로 바꿨다. 배포한 적이 없어서
마이그레이션은 `0001_init.sql` 을 고쳐 다시 만들었다.

| 파일 | 내용 |
|---|---|
| `worker/workspaces.ts` | 워크스페이스 · 팀 · 멤버 · 역할 · 분류 · 템플릿 |
| `worker/spec-service.ts` | 워크스페이스 기준으로 바꿈. 기능 분류 옮기기, 템플릿 기준 섹션 검사, 역할 기반 확정 |
| `shared/tree.ts` | 평평한 분류 목록을 트리로 묶기. 사이드바와 MCP 가 함께 쓴다 |
| `src/components/CategoryTree.tsx` | 사이드바 트리: 접기 · 펼치기(브라우저에 기억), 현재 기능까지 자동 펼침, 분류 추가 · 이름 바꾸기 · 빈 분류 삭제 |
| `src/pages/Workspace*.tsx` | 워크스페이스 목록 · 만들기, 기능 표(분류 경로 · 상태 필터), 설정(내 팀 · 기본 정보 · 팀 · 역할 · 템플릿) |
| `worker/mcp.ts` | `list_workspaces` · `get_workspace` 추가. 초안은 `"대 > 중 > 소"` 경로로 분류를 받고, 없는 분류는 만들지 않는다 |

확인한 것: 테스트 20개(역할별 확정 거절, 분류 깊이 제한 · 빈 분류만 삭제, 마지막 관리자 보호, 템플릿에서 뺀 섹션의
본문 · 라벨 유지, 확정본의 템플릿 보존, 자동 멤버 · 팀 표시). 브라우저로 워크스페이스 만들기 → 분류 3단계 →
기능 작성 → 템플릿 변경을 돌렸고, MCP 는 curl 로 `get_workspace` · 분류 경로로 초안 만들기를 확인했다.

### 다음 단계

- [ ] Entra 앱 등록(단일 테넌트, redirect URI `https://<도메인>/auth/callback`, 클라이언트 암호). IT 관리자 확인 필요
- [ ] 원격 D1 · KV 생성, `wrangler.jsonc` 를 환경별로 나누기, 도메인 정하기
- [ ] 배포 워크플로우(`.forgejo/workflows/`)와 `wrangler d1 migrations apply --remote`
- [ ] Cron Trigger 로 D1 export 를 R2 에 매일 백업, `purgeExpiredData()` 로 KV 정리
- [ ] Teams webhook 알림(확정, 새 질문, 내 의견에 단 답)
- [ ] 워크스페이스 공개 범위(사내 공개 / 멤버 전용)
- [ ] 분류 순서 바꾸기, 분류째 옮기기(드래그 앤 드롭)
- [ ] 의견에 답글 달기
- [ ] `prd/features/guide-management-design.md` 를 앱으로 옮기고 디렉토리 정리
- [ ] 실제 Claude Code · claude.ai 로 연결해 보기(로컬은 curl 로만 확인했다)

## 미결정 사항

- 워크스페이스 생성을 누구나 하게 둘지, 회사 공유 시점에 제한할지.
- 명세를 저장소에 마크다운으로 내보낼지(에이전트가 MCP 없이도 읽도록).
- 앱 이름과 도메인.
