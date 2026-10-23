import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

import { SCOPE_READ, SCOPE_WRITE } from './mcp';
import type { UserRow } from './users';

// 동의 화면은 SPA 가 아니라 워커가 직접 그린다. 클라이언트 이름 · 주소는 등록한 쪽이 마음대로 정한 값이라 모두 이스케이프한다.

const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const SCOPE_TEXT: Record<string, string> = {
  [SCOPE_READ]: '기능명세 읽기',
  [SCOPE_WRITE]: '초안 작성, 의견 · 수정 제안 · 질문 남기기 (확정은 할 수 없음)',
};

const page = (title: string, body: string) => `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: Pretendard, -apple-system, system-ui, sans-serif; background: #f1f4f9; color: #1a1f36; margin: 0; }
  main { max-width: 480px; margin: 64px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  p { line-height: 1.6; margin: 8px 0; }
  .muted { color: #718096; font-size: 14px; }
  .warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px; font-size: 14px; }
  label { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; }
  .actions { display: flex; gap: 8px; margin-top: 24px; }
  button { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 15px; cursor: pointer; }
  button[value=approve] { background: #2d6ff5; border-color: #2d6ff5; color: #fff; }
</style>
<main>${body}</main>
</html>`;

export function consentPage(details: ConsentDescription, handle: string, user: UserRow): string {
  const name = escape(details.clientName);
  const origin = details.clientDomain
    ? `<strong>${escape(details.clientDomain)}</strong> 가 배포한 앱입니다.`
    : '스스로 등록한 앱이라서 이름이 진짜인지 확인할 수 없습니다.';
  const scopes = [SCOPE_READ, SCOPE_WRITE]
    .map((scope) => {
      // 읽기는 MCP 를 쓰려면 꼭 필요해서 끌 수 없다. 쓰기는 사용자가 뺄 수 있다.
      const required = scope === SCOPE_READ;
      return `<label><input type="checkbox" name="scope" value="${scope}" checked ${required ? 'disabled' : ''}>
        ${required ? `<input type="hidden" name="scope" value="${scope}">` : ''}
        <span>${escape(SCOPE_TEXT[scope])}</span></label>`;
    })
    .join('');
  return page(
    `${name} 연결`,
    `<h1>${name} 이(가) 기능명세에 접근하려고 합니다</h1>
<p class="muted">${escape(user.name)} (${escape(user.email)}) 계정으로 연결합니다.</p>
<p>${origin} 권한은 <strong>${escape(details.redirectHost)}</strong> 로 전달됩니다.</p>
${details.redirectIsLoopback ? '<p class="warn">이 컴퓨터에서 실행 중인 앱으로 권한이 전달됩니다. 방금 직접 연결을 시작한 경우에만 허용하세요.</p>' : ''}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  ${scopes}
  <div class="actions">
    <button name="decision" value="deny">거부</button>
    <button name="decision" value="approve">허용</button>
  </div>
</form>`,
  );
}

export function errorPage(message: string): string {
  return page('연결할 수 없습니다', `<h1>연결할 수 없습니다</h1><p>${escape(message)}</p>`);
}
