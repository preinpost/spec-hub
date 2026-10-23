#!/usr/bin/env bash
# Spec Hub 로컬 점검. 앱(:5185), mock OIDC(:9400), 설정, 도구를 확인한다.
# 기존 CONE Watcher backend(:8000)나 .env.local 과는 무관하다.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fails=0
ok() { printf '  ok   %s\n' "$1"; }
warn() { printf '  warn %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails + 1)); }
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null || true; }

echo '== 서버'
code=$(http_code http://localhost:5185/)
[ "$code" = 200 ] && ok 'app      :5185' || fail "app      :5185 응답 없음($code). pnpm dev"
code=$(http_code http://localhost:9400/entra/.well-known/openid-configuration)
[ "$code" = 200 ] && ok 'mock OIDC :9400' || fail "mock OIDC :9400 응답 없음($code). pnpm oidc:up"

echo '== 설정'
[ -f "$ROOT/.dev.vars" ] && ok '.dev.vars 있음 (값은 출력하지 않음)' || fail '.dev.vars 없음. cp .dev.vars.example .dev.vars'
[ -d "$ROOT/.wrangler/state/v3/d1" ] && ok '로컬 D1 상태 있음' || warn '로컬 D1 상태 없음. pnpm db:migrate:local'
grep -q '"PUBLIC_ORIGIN": "http://localhost:5185"' "$ROOT/wrangler.jsonc" \
  && ok 'PUBLIC_ORIGIN 이 로컬 주소' \
  || warn 'PUBLIC_ORIGIN 이 로컬 주소가 아니다. 로컬 검증 전에 확인한다'

echo '== 도구'
command -v pnpm >/dev/null 2>&1 && ok 'pnpm' || fail 'pnpm 없음'
agent-browser --version >/dev/null 2>&1 && ok 'agent-browser 실행 가능' || fail 'agent-browser 실행 불가'
docker info >/dev/null 2>&1 && ok 'docker 실행 중' || warn 'docker 응답 없음. mock OIDC 를 띄울 때 필요하다'

if [ "$fails" -gt 0 ]; then
  echo "FAIL ${fails}건. 고친 뒤 다시 실행한다."
  exit 1
fi
echo '준비 완료. 로컬 D1 과 mock OIDC 만 쓰는지 확인하고 docs/verification.md 를 따른다.'
