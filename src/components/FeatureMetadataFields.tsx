import { useId } from 'react';

import { ENTRY_PATH_MAX_LENGTH, SCREEN_PATH_MAX_LENGTH, entryPathError, screenPathError } from '../../shared/spec';
import { Input, TextArea } from './ui';

function ScreenPathField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const error = screenPathError(value);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">화면 경로 <span className="font-normal text-ink-muted">(선택)</span></label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: /invoice 또는 /invoice/:id"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        className="font-mono"
      />
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-ink-muted">도메인과 https://를 제외하고 /로 시작하는 제품 화면 경로를 입력하세요. 공백, 쿼리(?), 해시(#)는 사용할 수 없습니다. 최대 {SCREEN_PATH_MAX_LENGTH}자이며, 비우면 삭제됩니다.</p>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function FeatureMetadataFields({ screenPath, entryPath, onScreenPathChange, onEntryPathChange }: {
  screenPath: string;
  entryPath: string;
  onScreenPathChange: (value: string) => void;
  onEntryPathChange: (value: string) => void;
}) {
  const id = useId();
  const error = entryPathError(entryPath);
  return <>
    <ScreenPathField value={screenPath} onChange={onScreenPathChange} />
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">접근 경로 <span className="font-normal text-ink-muted">(선택)</span></label>
      <TextArea id={id} rows={3} value={entryPath} onChange={(e) => onEntryPathChange(e.target.value)} placeholder="예: 청구 관리 → 청구서 목록 → 상세" aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} />
      <p id={`${id}-hint`} className="text-xs leading-relaxed text-ink-muted">이 화면에 들어가는 메뉴와 조작 순서를 적어 주세요. 기능 분류와는 별개이며, 여러 줄로 쓸 수 있습니다. 최대 {ENTRY_PATH_MAX_LENGTH.toLocaleString()}자이며, 비우면 삭제됩니다.</p>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  </>;
}
