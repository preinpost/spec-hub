import { useState } from 'react';
import { Link, useParams } from 'react-router';

import type { Comment, FeatureDetail, Question, Snapshot } from '../../shared/api';
import { STATUS_LABELS, type Status, displaySections, sectionLabel } from '../../shared/spec';
import { api, errorMessage } from '../api';
import { CategorySelect } from '../components/CategorySelect';
import { DiffView } from '../components/DiffView';
import { Author, Button, Card, ErrorText, MarkdownView, StatusBadge, TextArea } from '../components/ui';
import { formatDate, useFetch } from '../hooks';
import { useWorkspace } from '../session';

type Tab = 'spec' | 'changes' | 'activity';

export function FeaturePage() {
  const { key = '' } = useParams();
  const { data: feature, error, reload } = useFetch<FeatureDetail>(`/features/${key}`);
  const { reload: reloadWorkspace } = useWorkspace();
  const [tab, setTab] = useState<Tab>('spec');

  if (error) return <ErrorText message={error} />;
  if (!feature) return null;

  /** 바꾼 뒤에는 상세와 왼쪽 트리(상태 · 질문 수 · 분류)를 함께 다시 읽는다. */
  const refresh = async () => {
    await Promise.all([reload(), reloadWorkspace()]);
  };

  const last = feature.lastConfirmed;
  const changedSinceConfirm =
    last &&
    (last.title !== feature.title ||
      last.screenPath !== feature.screenPath ||
      last.entryPath !== feature.entryPath ||
      [...new Set([...Object.keys(last.sections), ...Object.keys(feature.sections)])].some((k) => (last.sections[k] ?? '') !== (feature.sections[k] ?? '')));

  return (
    <div className="mx-auto max-w-6xl">
      <Header feature={feature} onChanged={refresh} />
      {changedSinceConfirm && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {feature.lastConfirmed!.revision}차 확정본 이후 바뀐 내용이 있습니다.{' '}
          <button type="button" className="font-medium underline" onClick={() => setTab('changes')}>
            변경 내역 보기
          </button>
        </p>
      )}
      <div role="group" aria-label="명세 보기 전환" className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ['spec', '명세'],
            ['changes', `변경 내역${feature.snapshots.length ? ` (확정 ${feature.snapshots.length}회)` : ''}`],
            ['activity', '활동'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`-mb-px min-h-12 border-b-2 px-4 py-3 text-sm ${tab === t ? 'border-accent font-semibold text-accent' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'spec' && <SpecTab feature={feature} onChanged={refresh} />}
      {/* 새로 확정하면 다시 그려서 가장 최근 확정본을 기본으로 고른다. */}
      {tab === 'changes' && <ChangesTab key={feature.snapshots.length} feature={feature} />}
      {tab === 'activity' && <ActivityTab feature={feature} />}
    </div>
  );
}

// ── 머리글과 상태 변경 ───────────────────────────────────

function Header({ feature, onChanged }: { feature: FeatureDetail; onChanged: () => Promise<void> }) {
  const { workspace } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const openQuestions = feature.questions.filter((q) => !q.resolvedAt).length;

  const change = async (to: Status) => {
    try {
      await api.post(`/features/${feature.key}/status`, { to, expectedVersion: feature.version, note: to === 'confirmed' ? note : undefined });
      setConfirming(false);
      setNote('');
      setError(null);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const move = async (categoryId: number | null) => {
    try {
      await api.put(`/features/${feature.key}/category`, { categoryId });
      setMoving(false);
      setError(null);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-xs text-ink-muted">
        <Link to={`/w/${workspace.key}`} className="hover:text-accent">
          {feature.workspace.name}
        </Link>
        {(feature.categoryPath.length ? feature.categoryPath : ['미분류']).map((name, i) => (
          <span key={i}>› {name}</span>
        ))}
        <span className="ml-1 font-mono">· {feature.key}</span>
        {moving ? (
          <span className="inline-flex w-full max-w-sm items-center gap-2 sm:ml-2">
            <CategorySelect categories={workspace.categories} value={feature.categoryId} onChange={move} />
            <button type="button" className="shrink-0 text-xs hover:text-accent" onClick={() => setMoving(false)}>
              취소
            </button>
          </span>
        ) : (
          <button type="button" className="ml-1 min-h-8 rounded px-2 text-xs text-ink-muted hover:bg-white hover:text-accent" onClick={() => setMoving(true)}>
            분류 옮기기
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="page-title min-w-0">{feature.title}</h1>
        <StatusBadge status={feature.status} />
        <div className="flex w-full flex-wrap gap-2 pt-1 2xl:ml-auto 2xl:w-auto 2xl:pt-0">
          <Link to={`/features/${feature.key}/edit`} className="button-link">
            편집
          </Link>
          {feature.status === 'draft' && (
            <Button variant="primary" onClick={() => change('review')}>
              검토 요청
            </Button>
          )}
          {feature.status === 'review' && <Button onClick={() => change('draft')}>초안으로 되돌리기</Button>}
          {feature.status === 'review' && feature.canConfirm && (
            <Button variant="primary" onClick={() => setConfirming(true)} disabled={openQuestions > 0} title={openQuestions ? '열린 질문을 모두 해결해야 확정할 수 있습니다.' : ''}>
              확정
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-ink-muted">
        {feature.updatedBy.name} · {formatDate(feature.updatedAt)} 수정 · 버전 {feature.version}
        {feature.status === 'review' && openQuestions > 0 && <span className="ml-2 text-amber-700">열린 질문 {openQuestions}개를 해결해야 확정할 수 있습니다.</span>}
      </div>
      <Card className="mt-5 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">메타정보</h2><Link to={`/features/${feature.key}/edit`} className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-tint">편집</Link></div>
        {feature.screenPath || feature.entryPath ? <dl className="space-y-4">
          {feature.screenPath && <div className="grid min-w-0 gap-2 sm:grid-cols-[84px_minmax(0,1fr)]"><dt className="pt-1 text-xs text-ink-muted">화면 경로</dt><dd className="min-w-0"><code className="inline-block max-w-full break-all rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-sm text-ink-soft">{feature.screenPath}</code></dd></div>}
          {feature.entryPath && <div className="grid min-w-0 gap-2 sm:grid-cols-[84px_minmax(0,1fr)]"><dt className="text-xs text-ink-muted">접근 경로</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{feature.entryPath}</dd></div>}
        </dl> : <p className="text-sm text-ink-muted">메타정보 미등록</p>}
      </Card>
      {confirming && (
        <Card className="mt-3 p-4">
          <p className="mb-2 text-sm">
            지금 본문을 {feature.snapshots.length + 1}차 확정본으로 남깁니다. 무엇을 합의했는지 한 줄로 적어 두면 나중에 찾기 쉽습니다.
          </p>
          <TextArea aria-label="확정 메모" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 1원 단위 절사로 합의" />
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)}>취소</Button>
            <Button variant="primary" onClick={() => change('confirmed')}>
              {STATUS_LABELS.confirmed}
            </Button>
          </div>
        </Card>
      )}
      <div className="mt-2">
        <ErrorText message={error} />
      </div>
    </header>
  );
}

// ── 명세 탭 ──────────────────────────────────────────────

function SpecTab({ feature, onChanged }: { feature: FeatureDetail; onChanged: () => Promise<void> }) {
  const openQuestions = feature.questions.filter((q) => !q.resolvedAt);
  const generalComments = feature.comments.filter((c) => c.section === null);
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-5">
        <a href="#collaboration" className="button-link w-full xl:hidden">열린 질문 {openQuestions.length}개 · 결정 기록 보기</a>
        {displaySections(feature.template, feature.sections).map((s) => (
          <Card key={s.key} className={`p-5 sm:p-6 ${s.removed ? 'border-dashed opacity-80' : ''}`}>
            <h2 className="mb-4 text-base font-semibold">{s.label}</h2>
            <MarkdownView text={feature.sections[s.key] ?? ''} empty="아직 작성하지 않았습니다." />
            <SectionThread feature={feature} section={s.key} onChanged={onChanged} />
          </Card>
        ))}
      </div>
      <aside id="collaboration" aria-label="명세 협업" className="min-w-0 scroll-mt-24 space-y-4 rounded-xl border border-border bg-slate-100/60 p-3 sm:p-4 xl:p-3">
        <p className="px-1 text-xs font-semibold tracking-wide text-ink-muted">질문과 결정</p>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">열린 질문 {openQuestions.length > 0 && <span className="text-amber-700">{openQuestions.length}</span>}</h2>
          {openQuestions.length === 0 && <p className="text-sm text-ink-faint">없습니다.</p>}
          <div className="space-y-3">
            {openQuestions.map((q) => (
              <QuestionItem key={q.id} feature={feature} question={q} onChanged={onChanged} />
            ))}
          </div>
          <div className="mt-3">
            <Composer feature={feature} section={null} modes={['question']} onChanged={onChanged} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">결정 기록</h2>
          {feature.decisions.length === 0 && <p className="text-sm text-ink-faint">없습니다.</p>}
          <ul className="space-y-3">
            {feature.decisions.map((d) => {
              const question = feature.questions.find((q) => q.id === d.questionId);
              return (
                <li key={d.id} className="text-sm">
                  {question && <p className="text-xs text-ink-muted">Q. {question.body}</p>}
                  <p className="whitespace-pre-wrap">{d.body}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    <Author user={d.author} source={d.source} /> · {formatDate(d.createdAt)}
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <Composer feature={feature} section={null} modes={['decision']} onChanged={onChanged} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">기능 전체 의견</h2>
          <CommentList feature={feature} comments={generalComments} onChanged={onChanged} />
          <div className="mt-3">
            <Composer feature={feature} section={null} modes={['comment']} onChanged={onChanged} />
          </div>
        </Card>
      </aside>
    </div>
  );
}

function SectionThread({ feature, section, onChanged }: { feature: FeatureDetail; section: string; onChanged: () => Promise<void> }) {
  const comments = feature.comments.filter((c) => c.section === section);
  const questions = feature.questions.filter((q) => q.section === section && !q.resolvedAt);
  return (
    <div className="mt-6 border-t border-border pt-4">
      {questions.map((q) => (
        <p key={q.id} className="mb-2 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
          질문: {q.body} <span className="text-xs">({q.author.name})</span>
        </p>
      ))}
      <CommentList feature={feature} comments={comments} onChanged={onChanged} />
      <Composer feature={feature} section={section} modes={['comment', 'proposal', 'question']} onChanged={onChanged} />
    </div>
  );
}

function CommentList({ feature, comments, onChanged }: { feature: FeatureDetail; comments: Comment[]; onChanged: () => Promise<void> }) {
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);
  return (
    <div className="space-y-2">
      {open.map((c) => (
        <CommentItem key={c.id} feature={feature} comment={c} onChanged={onChanged} />
      ))}
      {resolved.length > 0 && (
        <button type="button" className="text-xs text-ink-muted hover:text-accent" onClick={() => setShowResolved(!showResolved)}>
          해결한 의견 {resolved.length}개 {showResolved ? '숨기기' : '보기'}
        </button>
      )}
      {showResolved && resolved.map((c) => <CommentItem key={c.id} feature={feature} comment={c} onChanged={onChanged} />)}
    </div>
  );
}

function CommentItem({ feature, comment, onChanged }: { feature: FeatureDetail; comment: Comment; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(true);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const isProposal = comment.kind === 'proposal';
  return (
    <div className={`rounded-md border px-3 py-2 ${comment.resolvedAt ? 'border-border bg-slate-50 opacity-70' : isProposal ? 'border-violet-200 bg-violet-50/40' : 'border-border bg-white'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <Author user={comment.author} source={comment.source} />
        {isProposal && <span className="rounded bg-violet-100 px-1 text-violet-700">수정 제안</span>}
        <span>{formatDate(comment.createdAt)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
      {isProposal && comment.proposedText !== null && comment.section && (
        <div className="mt-2">
          <button type="button" className="text-xs text-ink-muted hover:text-accent" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? '제안 내용 접기' : '제안 내용 보기'}
          </button>
          {showDiff && <DiffView before={feature.sections[comment.section] ?? ''} after={comment.proposedText} />}
        </div>
      )}
      {comment.resolvedAt ? (
        <p className="mt-1 text-xs text-ink-muted">{comment.resolvedBy?.name} 님이 해결 처리 · {formatDate(comment.resolvedAt)}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {isProposal && (
            <Button variant="primary" className="min-h-9 px-2.5 text-xs" onClick={() => act(() => api.post(`/comments/${comment.id}/apply`, { expectedVersion: feature.version }))}>
              본문에 반영
            </Button>
          )}
          <Button className="min-h-9 px-2.5 text-xs" onClick={() => act(() => api.post(`/comments/${comment.id}/resolve`))}>
            {isProposal ? '반영하지 않고 닫기' : '해결'}
          </Button>
        </div>
      )}
      <ErrorText message={error} />
    </div>
  );
}

function QuestionItem({ feature, question, onChanged }: { feature: FeatureDetail; question: Question; onChanged: () => Promise<void> }) {
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolve = async () => {
    try {
      await api.post(`/questions/${question.id}/resolve`, { answer });
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
      <div className="text-xs text-ink-muted">
        {sectionLabel(feature.template, question.section)} · <Author user={question.author} source={question.source} />
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{question.body}</p>
      {open ? (
        <div className="mt-2 space-y-2">
          <TextArea aria-label="질문에 대한 결정" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="정한 내용. 결정 기록에 남습니다." />
          <div className="flex justify-end gap-2">
            <Button className="min-h-9 px-2.5 text-xs" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button variant="primary" className="min-h-9 px-2.5 text-xs" disabled={!answer.trim()} onClick={resolve}>
              결정하고 해결
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3 min-h-9 px-2.5 text-xs" onClick={() => setOpen(true)}>
          답하고 해결
        </Button>
      )}
      <ErrorText message={error} />
    </div>
  );
}

type Mode = 'comment' | 'proposal' | 'question' | 'decision';
const MODE_LABELS: Record<Mode, string> = { comment: '의견', proposal: '수정 제안', question: '질문', decision: '결정 기록' };

/** 의견 · 수정 제안 · 질문 · 결정을 남기는 입력창. */
function Composer({
  feature,
  section,
  modes,
  onChanged,
}: {
  feature: FeatureDetail;
  section: string | null;
  modes: Mode[];
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [body, setBody] = useState('');
  const [proposed, setProposed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const start = (m: Mode) => {
    setMode(m);
    setError(null);
    if (m === 'proposal' && section) setProposed(feature.sections[section] ?? '');
  };

  const submit = async () => {
    setSaving(true);
    try {
      const base = `/features/${feature.key}`;
      if (mode === 'comment') await api.post(`${base}/comments`, { section, body });
      if (mode === 'proposal') await api.post(`${base}/comments`, { section, body, proposedText: proposed });
      if (mode === 'question') await api.post(`${base}/questions`, { section, body });
      if (mode === 'decision') await api.post(`${base}/decisions`, { body });
      setMode(null);
      setBody('');
      setProposed('');
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!mode) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {modes.map((m) => (
          <button key={m} type="button" className="min-h-9 rounded-lg border border-border bg-slate-50/70 px-2.5 py-1.5 font-medium text-ink-muted hover:border-accent/30 hover:bg-accent-tint hover:text-accent" onClick={() => start(m)}>
            + {MODE_LABELS[m]}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      {mode === 'proposal' && (
        <>
          <p className="text-xs text-ink-muted">바꿀 본문 전체를 고쳐 주세요. 작성자가 보고 반영하거나 닫습니다.</p>
          <TextArea aria-label="수정 제안 본문" rows={6} value={proposed} onChange={(e) => setProposed(e.target.value)} className="font-mono" />
        </>
      )}
      <TextArea
        aria-label={`${MODE_LABELS[mode]} 내용`}
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={mode === 'proposal' ? '왜 바꾸자는지' : `${MODE_LABELS[mode]}을(를) 적어 주세요`}
        autoFocus
      />
      <ErrorText message={error} />
      <div className="flex justify-end gap-2">
        <Button className="min-h-9 px-2.5 text-xs" onClick={() => setMode(null)}>
          취소
        </Button>
        <Button variant="primary" className="min-h-9 px-2.5 text-xs" disabled={saving || !body.trim()} onClick={submit}>
          {MODE_LABELS[mode]} 남기기
        </Button>
      </div>
    </div>
  );
}

// ── 변경 내역 탭 ─────────────────────────────────────────

function ChangesTab({ feature }: { feature: FeatureDetail }) {
  const [revision, setRevision] = useState<number | null>(feature.snapshots[0]?.revision ?? null);
  const { data: snapshot } = useFetch<Snapshot>(revision ? `/features/${feature.key}/snapshots/${revision}` : null);

  if (feature.snapshots.length === 0) return <p className="text-sm text-ink-muted">아직 한 번도 확정하지 않았습니다. 확정하면 그 시점의 본문이 남고, 이후 바뀐 내용을 여기서 비교할 수 있습니다.</p>;

  // 확정 뒤 템플릿이 바뀌었을 수 있어서 두 쪽 섹션을 모두 본다. 라벨은 지금 템플릿을 먼저 쓴다.
  const changed = snapshot
    ? [...new Set([...Object.keys(snapshot.sections), ...Object.keys(feature.sections)])]
        .filter((k) => (snapshot.sections[k] ?? '') !== (feature.sections[k] ?? ''))
        .map((k) => ({
          key: k,
          label: feature.template.some((s) => s.key === k) ? sectionLabel(feature.template, k) : sectionLabel(snapshot.template, k),
        }))
    : [];
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden">
        {feature.snapshots.map((s) => (
          <button
            key={s.revision}
            type="button"
            onClick={() => setRevision(s.revision)}
            className={`block w-full border-b border-border px-3 py-2 text-left text-sm last:border-0 ${revision === s.revision ? 'bg-accent-tint' : 'hover:bg-slate-50'}`}
          >
            <div className="font-medium">{s.revision}차 확정본</div>
            <div className="text-xs text-ink-muted">
              {s.confirmedBy.name} · {formatDate(s.confirmedAt)}
            </div>
            {s.note && <div className="mt-0.5 text-xs text-ink-soft">{s.note}</div>}
          </button>
        ))}
      </Card>
      <div className="space-y-4">
        {snapshot && (
          <>
            <p className="text-sm text-ink-muted">
              {snapshot.revision}차 확정본과 현재 본문을 비교합니다. {changed.length === 0 && snapshot.title === feature.title && snapshot.screenPath === feature.screenPath && snapshot.entryPath === feature.entryPath && '바뀐 내용이 없습니다.'}
            </p>
            {snapshot.title !== feature.title && (
              <Card className="p-4 text-sm">
                기능 이름: <span className="text-red-700 line-through">{snapshot.title}</span> → <span className="text-emerald-800">{feature.title}</span>
              </Card>
            )}
            {snapshot.screenPath !== feature.screenPath && (
              <Card className="space-y-3 p-4 text-sm">
                <h3 className="font-semibold">화면 경로</h3>
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-ink-muted">확정본</span><code className="break-all rounded bg-red-50 px-2 py-1 text-red-800">{snapshot.screenPath ?? '미등록'}</code></div>
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-ink-muted">현재</span><code className="break-all rounded bg-emerald-50 px-2 py-1 text-emerald-800">{feature.screenPath ?? '미등록'}</code></div>
              </Card>
            )}
            {snapshot.entryPath !== feature.entryPath && (
              <Card className="space-y-3 p-4 text-sm">
                <h3 className="font-semibold">접근 경로</h3>
                <div className="space-y-1"><span className="text-xs text-ink-muted">확정본</span><p className="whitespace-pre-wrap rounded bg-red-50 px-3 py-2 text-red-800">{snapshot.entryPath ?? '미등록'}</p></div>
                <div className="space-y-1"><span className="text-xs text-ink-muted">현재</span><p className="whitespace-pre-wrap rounded bg-emerald-50 px-3 py-2 text-emerald-800">{feature.entryPath ?? '미등록'}</p></div>
              </Card>
            )}
            {changed.map((s) => (
              <Card key={s.key} className="p-4">
                <h3 className="mb-3 text-sm font-semibold">{s.label}</h3>
                <DiffView before={snapshot.sections[s.key] ?? ''} after={feature.sections[s.key] ?? ''} />
              </Card>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── 활동 탭 ──────────────────────────────────────────────

function ActivityTab({ feature }: { feature: FeatureDetail }) {
  return (
    <Card>
      {feature.activities.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border px-5 py-4 text-sm last:border-0">
          <span className="w-full text-xs text-ink-muted sm:w-36 sm:shrink-0 sm:pt-0.5">{formatDate(a.createdAt)}</span>
          <Author user={a.actor} source={a.source} />
          <span className="min-w-0 flex-1 break-words text-ink-soft">{a.detail}</span>
        </div>
      ))}
    </Card>
  );
}
