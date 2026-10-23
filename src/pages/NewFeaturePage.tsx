import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { entryPathError, screenPathError } from '../../shared/spec';
import { api, errorMessage } from '../api';
import { CategorySelect } from '../components/CategorySelect';
import { FeatureMetadataFields } from '../components/FeatureMetadataFields';
import { Button, Card, ErrorText, Input } from '../components/ui';
import { useSession, useWorkspace } from '../session';

export function NewFeaturePage() {
  const { workspace, reload } = useWorkspace();
  const { reloadWorkspaces } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialCategory = Number(params.get('category')) || null;
  const [categoryId, setCategoryId] = useState<number | null>(
    workspace.categories.some((c) => c.id === initialCategory) ? initialCategory : null,
  );
  const [title, setTitle] = useState('');
  const [screenPath, setScreenPath] = useState('');
  const [entryPath, setEntryPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pathError = screenPathError(screenPath) ?? entryPathError(entryPath);
    if (pathError) { setError(pathError); return; }
    setSaving(true);
    try {
      const { key } = await api.post<{ key: string }>(`/workspaces/${workspace.key}/features`, { title, screenPath: screenPath || null, entryPath: entryPath.trim() || null, categoryId });
      await Promise.all([reload(), reloadWorkspaces()]);
      navigate(`/features/${key}/edit`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="page-title mb-6">새 기능 · {workspace.name}</h1>
      <form onSubmit={submit} className="space-y-5">
        <Card className="space-y-5 p-5 sm:p-6">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">분류</span>
            <CategorySelect categories={workspace.categories} value={categoryId} onChange={setCategoryId} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">기능 이름</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 수기 청구서 만들기" autoFocus />
          </label>
        </Card>
        <Card className="space-y-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold">메타정보</h2>
          <FeatureMetadataFields screenPath={screenPath} entryPath={entryPath} onScreenPathChange={setScreenPath} onEntryPathChange={setEntryPath} />
        </Card>
          <ErrorText message={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => navigate(-1)}>취소</Button>
            <Button type="submit" variant="primary" disabled={saving || !title.trim() || !!screenPathError(screenPath) || !!entryPathError(entryPath)}>
              초안 만들기
            </Button>
          </div>
      </form>
    </div>
  );
}
