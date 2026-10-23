import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import type { FeatureDetail } from '../../shared/api';
import { type Sections, displaySections, entryPathError, screenPathError } from '../../shared/spec';
import { RequestError, api, errorMessage } from '../api';
import { FeatureMetadataFields } from '../components/FeatureMetadataFields';
import { Button, Card, ErrorText, Input, MarkdownView, TextArea } from '../components/ui';
import { useFetch } from '../hooks';
import { useWorkspace } from '../session';

export function EditFeaturePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { reload: reloadWorkspace } = useWorkspace();
  const { data: feature, error: loadError } = useFetch<FeatureDetail>(`/features/${key}`);
  const [title, setTitle] = useState('');
  const [screenPath, setScreenPath] = useState('');
  const [entryPath, setEntryPath] = useState('');
  const [sections, setSections] = useState<Sections | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (feature && !sections) {
      setTitle(feature.title);
      setScreenPath(feature.screenPath ?? '');
      setEntryPath(feature.entryPath ?? '');
      setSections(feature.sections);
    }
  }, [feature, sections]);

  const dirty =
    !!feature && !!sections && (title !== feature.title || screenPath !== (feature.screenPath ?? '') || entryPath.trim() !== (feature.entryPath ?? '') || Object.keys(sections).some((k) => sections[k] !== (feature.sections[k] ?? '')));

  // 저장하지 않고 탭을 닫으면 쓴 내용이 사라지므로 한 번 묻는다.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loadError) return <ErrorText message={loadError} />;
  if (!feature || !sections) return null;

  const save = async () => {
    const pathError = screenPathError(screenPath) ?? entryPathError(entryPath);
    if (pathError) { setError(pathError); return; }
    setSaving(true);
    try {
      await api.put(`/features/${feature.key}`, { title, screenPath: screenPath || null, entryPath: entryPath.trim() || null, sections, expectedVersion: feature.version });
      await reloadWorkspace();
      navigate(`/features/${feature.key}`);
    } catch (e) {
      setError(
        e instanceof RequestError && e.status === 409
          ? `${e.message} 지금 쓴 내용은 이 화면에 그대로 남아 있으니 다른 곳에 복사해 두세요.`
          : errorMessage(e),
      );
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm text-ink-muted">{feature.key}</span>
        <h1 className="page-title">명세 편집</h1>
        <label className="ml-auto flex min-h-10 items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> 미리보기
        </label>
        <Button onClick={() => navigate(`/features/${feature.key}`)}>취소</Button>
        <Button variant="primary" onClick={save} disabled={saving || !dirty || !title.trim() || !!screenPathError(screenPath) || !!entryPathError(entryPath)}>
          저장
        </Button>
      </div>
      {feature.status === 'confirmed' && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          확정된 명세입니다. 저장하면 초안으로 돌아가고, 다시 검토를 거쳐 확정해야 합니다.
        </p>
      )}
      <ErrorText message={error} />
      <div className="mt-2 space-y-4">
        <Card className="space-y-5 p-5 sm:p-6">
          <label className="block text-sm font-semibold">
            기능 이름
            <Input className="mt-2" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </Card>
        <Card className="space-y-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold">메타정보</h2>
          <FeatureMetadataFields screenPath={screenPath} entryPath={entryPath} onScreenPathChange={setScreenPath} onEntryPathChange={setEntryPath} />
        </Card>
        {displaySections(feature.template, sections).map((s) => (
          <Card key={s.key} className={`p-5 sm:p-6 ${s.removed ? 'border-dashed' : ''}`}>
            <h2 className="text-base font-semibold">{s.label}</h2>
            <p className="mb-4 mt-2 text-sm leading-relaxed text-ink-muted">
              {s.removed ? '템플릿에서 빠진 섹션입니다. 내용을 다른 섹션으로 옮긴 뒤 비우면 사라집니다.' : s.hint} 마크다운을 쓸 수 있습니다.
            </p>
            {preview ? (
              <MarkdownView text={sections[s.key] ?? ''} />
            ) : (
              <TextArea
                aria-label={`${s.label} 본문`}
                rows={Math.max(5, (sections[s.key] ?? '').split('\n').length + 1)}
                value={sections[s.key] ?? ''}
                onChange={(e) => setSections({ ...sections, [s.key]: e.target.value })}
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
