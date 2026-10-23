import { Link, useSearchParams } from 'react-router';

import type { SearchResult } from '../../shared/api';
import { Card, ErrorText, StatusBadge } from '../components/ui';
import { useFetch } from '../hooks';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const workspace = params.get('workspace');
  const { data, error, loading } = useFetch<SearchResult[]>(
    `/search?q=${encodeURIComponent(q)}${workspace ? `&workspace=${encodeURIComponent(workspace)}` : ''}`,
  );
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="page-title mb-2">"{q}" 검색 결과</h1>
      <p className="mb-6 text-sm text-ink-muted">
        {workspace ? (
          <>
            {workspace} 워크스페이스에서 찾았습니다. <Link className="text-accent hover:underline" to={`/search?q=${encodeURIComponent(q)}`}>전체에서 찾기</Link>
          </>
        ) : (
          '모든 워크스페이스에서 찾았습니다.'
        )}
      </p>
      <ErrorText message={error} />
      {!loading && data?.length === 0 && <p className="text-sm text-ink-muted">찾은 기능이 없습니다.</p>}
      {data && data.length > 0 && (
        <Card className="overflow-hidden">
          {data.map((f) => (
            <Link key={f.key} to={`/features/${f.key}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border p-5 last:border-0 hover:bg-slate-50">
              <span className="col-span-2 font-mono text-xs text-ink-muted">{f.key}</span>
              <span className="min-w-0 break-words font-semibold">{f.title}</span>
              <StatusBadge status={f.status} />
              <span className="col-span-2 text-xs text-ink-muted">{f.workspaceName}</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
