import { useState } from 'react';

import type { Connection } from '../../shared/api';
import { api, errorMessage } from '../api';
import { Button, Card, ErrorText } from '../components/ui';
import { formatDate, useFetch } from '../hooks';

const SCOPE_LABELS: Record<string, string> = { 'spec:read': '읽기', 'spec:write': '쓰기', offline_access: '자동 갱신' };

export function MePage() {
  const connections = useFetch<Connection[]>('/connections');
  const [error, setError] = useState<string | null>(null);
  const mcpUrl = `${location.origin}/mcp`;

  const disconnect = async (grantId: string) => {
    try {
      await api.delete(`/connections/${grantId}`);
      await connections.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="page-title">AI 연결 (MCP)</h1>
      <ErrorText message={error} />
      <Card className="p-5 sm:p-6">
        <p className="text-sm leading-relaxed text-ink-muted">
          Claude, ChatGPT, Cursor 같은 AI 클라이언트에서 아래 주소를 MCP 서버로 추가하면 Microsoft 계정으로 로그인한 뒤 연결됩니다.
          AI 는 모든 워크스페이스의 명세를 읽고, 초안을 쓰고, 의견 · 수정 제안 · 질문을 남길 수 있습니다. 확정은 웹에서 사람이 합니다.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-sm">{mcpUrl}</code>
          <Button onClick={() => navigator.clipboard.writeText(mcpUrl)}>복사</Button>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-bg p-4 text-sm">
          <div className="font-medium">Claude Code</div>
          <code className="mt-2 block break-all font-mono text-xs leading-relaxed">claude mcp add --transport http spec {mcpUrl}</code>
        </div>

        <h2 className="mb-3 mt-8 text-base font-semibold">연결된 앱</h2>
        {connections.data?.length === 0 && <p className="text-sm text-ink-faint">연결된 앱이 없습니다.</p>}
        {connections.data?.map((c) => (
          <div key={c.grantId} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4 text-sm">
            <div>
              <div className="font-medium">{c.clientName}</div>
              <div className="text-xs text-ink-muted">
                {c.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ')} · {formatDate(c.createdAt)} 연결
              </div>
            </div>
            <Button variant="danger" onClick={() => disconnect(c.grantId)}>
              연결 끊기
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
