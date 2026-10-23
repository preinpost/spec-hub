import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ROLE_LABELS } from '../../shared/spec';
import { api, errorMessage } from '../api';
import { Icon } from '../components/Icon';
import { Button, Card, ErrorText, Input, TextArea } from '../components/ui';
import { useSession } from '../session';

export function WorkspacesPage() {
  const { workspaces } = useSession();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header><h1 className="page-title">워크스페이스</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">제품이나 프로젝트마다 하나씩 만듭니다. 기능 키는 워크스페이스 키로 시작합니다(WCN → WCN-1).</p></header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {workspaces.map((w) => (
          <Link key={w.key} to={`/w/${w.key}`} className="group flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5 transition hover:border-accent/40 hover:shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 break-words text-base font-semibold group-hover:text-accent">{w.name}</span>
              <span className="font-mono text-xs text-ink-faint">{w.key}</span>
            </div>
            {w.description && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-muted">{w.description}</p>}
            <p className="mt-auto pt-5 text-xs leading-relaxed text-ink-muted">
              기능 {w.featureCount}개 · 멤버 {w.memberCount}명{w.myRole && ` · 내 역할 ${ROLE_LABELS[w.myRole]}`}
            </p>
          </Link>
        ))}
      </div>
      {workspaces.length === 0 && <Card className="p-8 text-center text-sm text-ink-muted">아직 워크스페이스가 없습니다. 아래에서 첫 워크스페이스를 만드세요.</Card>}
      <NewWorkspaceForm />
    </div>
  );
}

function NewWorkspaceForm() {
  const { reloadWorkspaces } = useSession();
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.post<{ key: string }>('/workspaces', { key, name, description });
      await reloadWorkspaces();
      navigate(`/w/${created.key}`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Icon name="plus" />새 워크스페이스</h2>
      <p className="mb-5 mt-2 text-sm text-ink-muted">만든 사람이 관리자가 됩니다. 키는 나중에 바꿀 수 없습니다.</p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label className="block text-sm"><span className="mb-1.5 block font-medium">키</span>
            <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="예: WCN" />
          </label>
          <label className="block text-sm"><span className="mb-1.5 block font-medium">이름</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: CONE Watcher N" />
          </label>
        </div>
        <label className="block text-sm"><span className="mb-1.5 block font-medium">설명 <span className="font-normal text-ink-muted">(선택)</span></span><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="워크스페이스 설명" /></label>
        <ErrorText message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={saving || !key || !name.trim()}>
            만들기
          </Button>
        </div>
      </form>
    </Card>
  );
}
