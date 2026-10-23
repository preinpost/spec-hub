import { diffLines } from 'diff';

/** 두 마크다운 본문의 줄 단위 차이. 지운 줄은 빨강, 넣은 줄은 초록으로 보여 준다. */
export function DiffView({ before, after }: { before: string; after: string }) {
  // 마지막 줄에 줄바꿈이 없으면 같은 줄도 바뀐 줄로 잡힌다. 빈 본문은 그대로 둬야 빈 줄이 지운 줄로 나오지 않는다.
  const withNewline = (s: string) => (s === '' || s.endsWith('\n') ? s : `${s}\n`);
  const parts = diffLines(withNewline(before), withNewline(after));
  return (
    <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-white p-4 font-mono text-sm leading-relaxed">
      {parts.map((p, i) => (
        <span
          key={i}
          className={p.added ? 'block bg-emerald-50 text-emerald-900' : p.removed ? 'block bg-red-50 text-red-800 line-through decoration-red-300' : 'block text-ink-muted'}
        >
          {p.value.replace(/\n$/, '')
            .split('\n')
            .map((line) => `${p.added ? '+ ' : p.removed ? '- ' : '  '}${line}`)
            .join('\n')}
        </span>
      ))}
    </pre>
  );
}
