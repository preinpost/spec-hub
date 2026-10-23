-- 시각은 모두 ISO 8601 UTC 문자열로 저장한다.

-- Entra ID 로 한 번이라도 로그인한 사람.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- Entra 의 oid. oid 가 없는 IdP 면 sub.
  subject TEXT NOT NULL UNIQUE,
  tenant_id TEXT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);

-- /auth/login 에서 IdP 로 보낸 뒤 /auth/callback 으로 돌아올 때까지 들고 있는 값. 한 번 쓰면 지운다.
CREATE TABLE login_requests (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 제품 · 프로젝트 하나. key 는 기능 키의 접두사다(WCN → WCN-1).
CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 명세 섹션 구성 JSON 배열 [{key, label, hint}]. 기능 본문은 이 key 로 섹션을 저장한다.
  template TEXT NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL
);

-- 워크스페이스마다 정하는 팀(기획, 개발, 디자인 ...). 의견 옆에 누가 어느 팀인지 보여 주는 데 쓴다.
CREATE TABLE workspace_teams (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, name)
);

-- 워크스페이스에서 무언가를 쓴 사람은 자동으로 member 가 된다. 확정은 admin · approver 만 한다.
CREATE TABLE workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'member')),
  team_id INTEGER REFERENCES workspace_teams (id) ON DELETE SET NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_id ON workspace_members (user_id);

-- 대분류(depth 1) · 중분류(2) · 소분류(3). 대분류는 parent_id 가 NULL 이다.
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES categories (id),
  name TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 3),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX categories_workspace_id ON categories (workspace_id);

CREATE TABLE features (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  workspace_id INTEGER NOT NULL REFERENCES workspaces (id),
  -- NULL 이면 미분류. 분류를 옮겨도 key 는 바뀌지 않는다.
  category_id INTEGER REFERENCES categories (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'confirmed')),
  -- 섹션 key → 마크다운 본문 JSON. 템플릿에서 빠진 섹션의 본문도 지우지 않고 남긴다.
  sections TEXT NOT NULL,
  -- 저장할 때마다 1 씩 오른다. 저장 요청이 들고 온 값과 다르면 다른 사람이 먼저 저장한 것이다.
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users (id),
  updated_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX features_workspace_id ON features (workspace_id);
CREATE INDEX features_category_id ON features (category_id);

-- 확정할 때마다 그 시점의 본문과 템플릿을 남긴다. 템플릿이 나중에 바뀌어도 예전 확정본은 그때 모습대로 보인다.
CREATE TABLE feature_snapshots (
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  sections TEXT NOT NULL,
  template TEXT NOT NULL,
  note TEXT,
  confirmed_by TEXT NOT NULL REFERENCES users (id),
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (feature_id, revision)
);

-- section 이 NULL 이면 기능 전체에 단 의견이다.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  section TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'proposal')),
  body TEXT NOT NULL,
  -- kind = 'proposal' 일 때 섹션 본문을 이걸로 바꾸자는 제안.
  proposed_text TEXT,
  author_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('web', 'mcp')),
  created_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES users (id),
  resolved_at TEXT
);
CREATE INDEX comments_feature_id ON comments (feature_id);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  section TEXT,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('web', 'mcp')),
  created_at TEXT NOT NULL,
  resolved_by TEXT REFERENCES users (id),
  resolved_at TEXT
);
CREATE INDEX questions_feature_id ON questions (feature_id);

-- 질문을 해결하면 그 답이 결정으로 남는다. 질문 없이 바로 적은 결정은 question_id 가 NULL 이다.
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions (id),
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('web', 'mcp')),
  created_at TEXT NOT NULL
);
CREATE INDEX decisions_feature_id ON decisions (feature_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('web', 'mcp')),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX activities_feature_id ON activities (feature_id);
