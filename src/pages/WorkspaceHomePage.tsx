import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { STATUSES, STATUS_LABELS, type Status } from '../../shared/spec';
import { ancestorsOf } from '../../shared/tree';
import { Icon } from '../components/Icon';
import { Author, Card, StatusBadge } from '../components/ui';
import { formatDate } from '../hooks';
import { useWorkspace } from '../session';

export function WorkspaceHomePage() {
  const { workspace } = useWorkspace();
  const [status, setStatus] = useState<Status | null>(null);
  const rows = useMemo(
    () => workspace.features
      .filter((f) => !status || f.status === status)
      .map((f) => ({ ...f, path: ancestorsOf(workspace.categories, f.categoryId).map((c) => c.name) }))
      .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'ko') || a.key.localeCompare(b.key, 'en', { numeric: true })),
    [workspace, status],
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, workspace.features.filter((f) => f.status === s).length]));
  const openQuestions = workspace.features.reduce((sum, f) => sum + f.openQuestions, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="page-header">
        <div className="min-w-0 flex-1">
          <div className="mb-2 font-mono text-xs font-medium tracking-wider text-ink-muted">{workspace.key}</div>
          <h1 className="page-title">{workspace.name}</h1>
          {workspace.description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{workspace.description}</p>}
        </div>
        <Link to={`/w/${workspace.key}/new`} className="button-link button-link-primary"><Icon name="plus" />새 기능</Link>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4 text-sm text-ink-muted">
        <span>전체 기능 <strong className="ml-1 text-ink">{workspace.features.length}</strong></span>
        <span>열린 질문 <strong className={`ml-1 ${openQuestions ? 'text-amber-800' : 'text-ink'}`}>{openQuestions}</strong></span>
      </div>
      <div role="group" aria-label="기능 상태 필터" className="flex flex-wrap gap-2 text-sm">
        <FilterChip active={status === null} onClick={() => setStatus(null)}>전체 <span className="ml-1 opacity-75">{workspace.features.length}</span></FilterChip>
        {STATUSES.map((s) => <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>{STATUS_LABELS[s]} <span className="ml-1 opacity-75">{counts[s]}</span></FilterChip>)}
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <div className="px-5 py-14 text-center"><p className="text-sm text-ink-muted">기능이 없습니다.</p>{!status && <Link to={`/w/${workspace.key}/new`} className="mt-3 inline-flex text-sm font-medium text-accent">+ 새 기능</Link>}</div> : (
          <>
            <div className="divide-y divide-border md:hidden">
              {rows.map((f) => <article key={f.key} className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-ink-muted">{f.key}</span><StatusBadge status={f.status} /></div>
                <div><Link to={`/features/${f.key}`} className="block text-base font-semibold hover:text-accent">{f.title}</Link><p className="mt-1 text-xs text-ink-muted">{f.path.length ? f.path.join(' › ') : '미분류'}</p></div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"><span className={f.openQuestions ? 'font-medium text-amber-800' : ''}>열린 질문 {f.openQuestions}개</span><span>{f.updatedBy.name} · {formatDate(f.updatedAt)}</span></div>
              </article>)}
            </div>
            <table className="hidden w-full table-fixed text-sm md:table">
              <caption className="sr-only">{workspace.name} 기능 목록</caption>
              <thead className="bg-slate-50/80 text-left text-xs text-ink-muted"><tr>
                <th scope="col" className="w-[48%] px-5 py-3.5 font-medium">기능 · 분류</th>
                <th scope="col" className="w-[14%] px-3 py-3.5 font-medium">상태</th>
                <th scope="col" className="w-[13%] px-3 py-3.5 font-medium">열린 질문</th>
                <th scope="col" className="w-[25%] px-4 py-3.5 font-medium">마지막 수정</th>
              </tr></thead>
              <tbody>{rows.map((f) => <tr key={f.key} className="border-t border-border hover:bg-slate-50/70">
                <td className="px-5 py-4"><span className="font-mono text-xs text-ink-muted">{f.key}</span><Link to={`/features/${f.key}`} className="mt-1 block break-words font-semibold leading-relaxed hover:text-accent">{f.title}</Link><p className="mt-1 text-xs text-ink-muted">{f.path.length ? f.path.join(' › ') : '미분류'}</p></td>
                <td className="px-3 py-4"><StatusBadge status={f.status} /></td>
                <td className="px-3 py-4"><span className={f.openQuestions ? 'inline-flex min-w-7 justify-center rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800' : 'text-ink-faint'}>{f.openQuestions || '-'}</span></td>
                <td className="px-4 py-4"><Author user={f.updatedBy} /><p className="mt-1 text-xs text-ink-muted">{formatDate(f.updatedAt)}</p></td>
              </tr>)}</tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-10 rounded-lg border px-3.5 py-2 font-medium transition ${active ? 'border-accent/25 bg-accent-tint text-accent-deep' : 'border-border bg-white text-ink-muted hover:border-border-strong hover:text-ink'}`}>{children}</button>;
}
