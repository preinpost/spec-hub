import { useSearchParams } from 'react-router';

import { Icon } from '../components/Icon';
import { ErrorText } from '../components/ui';

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = location.pathname === '/login' ? '/' : location.pathname + location.search;
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-sm sm:px-10">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-tint text-accent"><Icon name="document" width="26" height="26" /></span>
        <h1 className="text-2xl font-bold">Spec Hub</h1>
        <p className="mt-2 text-sm text-ink-muted">회사 Microsoft 계정으로 로그인합니다.</p>
        <div className="mt-4">
          <ErrorText message={params.get('error')} />
        </div>
        <a
          href={`/auth/login?return_to=${encodeURIComponent(returnTo)}`}
          className="button-link button-link-primary mt-6 w-full"
        >
          Microsoft 계정으로 로그인
        </a>
      </div>
    </div>
  );
}
