import { type FormEvent, useState } from 'react';

import { ROLES, ROLE_LABELS, type Role, type TemplateSection, activeSections } from '../../shared/spec';
import { api, errorMessage } from '../api';
import { Author, Button, Card, ErrorText, Input, TextArea } from '../components/ui';
import { useSession, useWorkspace } from '../session';

export function WorkspaceSettingsPage() {
  const { workspace } = useWorkspace();
  const isAdmin = workspace.myRole === 'admin';
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="page-title">{workspace.name} 설정</h1>
      {!isAdmin && <p className="-mt-3 text-sm text-ink-muted">내 팀만 바꿀 수 있습니다. 나머지는 워크스페이스 관리자가 바꿉니다.</p>}
      <MyTeam />
      {/* 저장한 뒤 다시 읽은 값으로 입력칸을 새로 채우려고 key 를 내용에 묶는다. */}
      {isAdmin && <BasicInfo key={workspace.name + workspace.description} />}
      <Teams isAdmin={isAdmin} />
      <Members isAdmin={isAdmin} />
      <TemplateEditor key={JSON.stringify(workspace.template)} isAdmin={isAdmin} />
    </div>
  );
}

function useAction() {
  const { reload } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      await reload();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };
  return { error, run };
}

function MyTeam() {
  const { workspace } = useWorkspace();
  const { reloadWorkspaces } = useSession();
  const { error, run } = useAction();
  const choose = (teamId: number | null) =>
    run(async () => {
      await api.put(`/workspaces/${workspace.key}/members/me`, { teamId });
      await reloadWorkspaces();
    });
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-semibold">내 팀</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-ink-muted">이 워크스페이스에서 남기는 의견과 질문 옆에 표시됩니다.</p>
      <div className="flex flex-wrap gap-2">
        {workspace.teams.map((t) => (
          <Button key={t.id} variant={workspace.myTeamId === t.id ? 'primary' : 'secondary'} onClick={() => choose(t.id)}>
            {t.name}
          </Button>
        ))}
        {workspace.myTeamId !== null && (
          <Button variant="ghost" onClick={() => choose(null)}>
            선택 안 함
          </Button>
        )}
      </div>
      <ErrorText message={error} />
    </Card>
  );
}

function BasicInfo() {
  const { workspace } = useWorkspace();
  const { reloadWorkspaces } = useSession();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description);
  const { error, run } = useAction();
  const dirty = name !== workspace.name || description !== workspace.description;
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="text-base font-semibold">기본 정보</h2>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">이름</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">설명</span>
        <TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={!dirty}
          onClick={() =>
            run(async () => {
              await api.patch(`/workspaces/${workspace.key}`, { name, description });
              await reloadWorkspaces();
            })
          }
        >
          저장
        </Button>
      </div>
    </Card>
  );
}

function Teams({ isAdmin }: { isAdmin: boolean }) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState('');
  const { error, run } = useAction();
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.post(`/workspaces/${workspace.key}/teams`, { name }))) setName('');
  };
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-semibold">팀</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-ink-muted">멤버가 고를 수 있는 팀 목록입니다.</p>
      <div className="flex flex-wrap gap-2">
        {workspace.teams.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-3 py-1 text-sm">
            {t.name}
            {isAdmin && (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-base text-ink-muted hover:bg-red-50 hover:text-danger"
                title="팀 지우기"
                onClick={() => confirm(`${t.name} 팀을 지울까요? 이 팀을 고른 멤버는 팀 미선택이 됩니다.`) && run(() => api.delete(`/workspaces/${workspace.key}/teams/${t.id}`))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {isAdmin && (
        <form onSubmit={add} className="mt-3 flex gap-2">
          <div className="min-w-0 max-w-sm flex-1">
            <Input aria-label="새 팀 이름" value={name} onChange={(e) => setName(e.target.value)} placeholder="팀 이름 (예: 디자인)" />
          </div>
          <Button type="submit" disabled={!name.trim()}>
            추가
          </Button>
        </form>
      )}
      <ErrorText message={error} />
    </Card>
  );
}

function Members({ isAdmin }: { isAdmin: boolean }) {
  const { workspace } = useWorkspace();
  const { error, run } = useAction();
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-semibold">멤버와 역할</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-ink-muted">
        워크스페이스에서 무언가를 쓰면 자동으로 멤버가 됩니다. 확정은 관리자와 확정권한자만 할 수 있습니다.
      </p>
      {workspace.members.map((m) => (
        <div key={m.user.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4 text-sm">
          <div className="min-w-0 flex-1">
            <Author user={m.user} />
            <div className="mt-1 break-all text-xs text-ink-muted">{m.email}</div>
          </div>
          {isAdmin ? (
            <select
              aria-label={`${m.user.name} 역할`}
              value={m.role}
              onChange={(e) => run(() => api.put(`/workspaces/${workspace.key}/members/${m.user.id}`, { role: e.target.value as Role }))}
              className="form-control w-auto shrink-0"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-ink-muted">{ROLE_LABELS[m.role]}</span>
          )}
        </div>
      ))}
      <ErrorText message={error} />
    </Card>
  );
}

type Draft = Omit<TemplateSection, 'key'> & { key?: string; id: string };

function TemplateEditor({ isAdmin }: { isAdmin: boolean }) {
  const { workspace } = useWorkspace();
  const active = activeSections(workspace.template);
  const toDraft = () => active.map((s) => ({ ...s, id: s.key }));
  const [sections, setSections] = useState<Draft[]>(toDraft);
  const { error, run } = useAction();
  const dirty = JSON.stringify(sections.map(({ id: _, ...s }) => s)) !== JSON.stringify(active);

  const update = (i: number, patch: Partial<Draft>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...sections];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    setSections(next);
  };

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-semibold">명세 템플릿</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-ink-muted">
        기능 명세가 어떤 섹션으로 이루어질지 정합니다. 섹션을 지워도 이미 쓴 본문은 지워지지 않고 "템플릿에서 빠진 섹션"으로 남습니다.
        확정본은 확정할 때의 템플릿으로 보입니다.
      </p>
      <div className="space-y-2">
        {sections.map((s, i) => (
          <div key={s.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-border bg-slate-50/50 p-3 sm:p-4">
            <div className="min-w-0 flex-1 space-y-3">
              <Input aria-label={`섹션 ${i + 1} 이름`} value={s.label} onChange={(e) => update(i, { label: e.target.value })} disabled={!isAdmin} placeholder="섹션 이름" />
              <Input aria-label={`섹션 ${i + 1} 작성 안내`} value={s.hint} onChange={(e) => update(i, { hint: e.target.value })} disabled={!isAdmin} placeholder="작성 안내 (선택)" />
            </div>
            {isAdmin && (
              <div className="flex shrink-0 flex-col gap-1 text-xs">
                <button type="button" aria-label={`${s.label || `섹션 ${i + 1}`} 위로 이동`} className="h-8 w-9 rounded border border-border bg-white text-ink-muted hover:text-accent disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>
                  ▲
                </button>
                <button type="button" aria-label={`${s.label || `섹션 ${i + 1}`} 아래로 이동`} className="h-8 w-9 rounded border border-border bg-white text-ink-muted hover:text-accent disabled:opacity-30" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                  ▼
                </button>
                <button type="button" aria-label={`${s.label || `섹션 ${i + 1}`} 삭제`} className="min-h-8 rounded text-ink-muted hover:bg-red-50 hover:text-danger" onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {isAdmin && (
        <div className="mt-5 flex flex-wrap justify-between gap-3">
          <Button onClick={() => setSections([...sections, { id: crypto.randomUUID(), label: '', hint: '' }])}>+ 섹션 추가</Button>
          <div className="flex flex-wrap gap-2">
            {dirty && <Button onClick={() => setSections(toDraft())}>되돌리기</Button>}
            <Button
              variant="primary"
              disabled={!dirty || sections.some((s) => !s.label.trim())}
              onClick={() => run(() => api.put(`/workspaces/${workspace.key}/template`, { sections: sections.map(({ id: _, ...s }) => s) }))}
            >
              템플릿 저장
            </Button>
          </div>
        </div>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
