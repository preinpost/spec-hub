import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';

import type { WorkspaceDetail } from '../../shared/api';
import { ROLE_LABELS, workspaceKeyOf } from '../../shared/spec';
import { useFetch } from '../hooks';
import { WorkspaceContext, useSession } from '../session';
import { CategoryTree } from './CategoryTree';
import { Icon } from './Icon';
import { ErrorText } from './ui';

export function Layout() {
  const params = useParams();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wk = params.wk ?? (params.key ? workspaceKeyOf(params.key) : null);
  const { data: workspace, error, reload } = useFetch<WorkspaceDetail>(wk ? `/workspaces/${wk}` : null);
  const current = wk && workspace?.key === wk.toUpperCase() ? workspace : null;

  useEffect(() => { setMenuOpen(false); }, [location.key]);

  const page = (
    <div className="min-h-screen lg:flex">
      <a href="#main-content" className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-accent px-4 py-2 text-white focus:not-sr-only">본문으로 이동</a>
      <div className="hidden lg:block"><Sidebar workspace={current} /></div>
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-border bg-white/95 px-4 backdrop-blur-sm lg:hidden">
        <button ref={menuButton} type="button" aria-label="탐색 메뉴 열기" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-ink-soft"><Icon name="menu" /></button>
        <Link to={current ? `/w/${current.key}` : '/'} className="min-w-0 flex-1 truncate font-semibold">{current?.name ?? 'Spec Hub'}</Link>
        {current && <span className="shrink-0 font-mono text-xs text-ink-muted">{current.key}</span>}
      </header>
      {menuOpen && <MobileNavigation onClose={() => setMenuOpen(false)} onReturnFocus={() => menuButton.current?.focus()}><Sidebar workspace={current} onClose={() => setMenuOpen(false)} /></MobileNavigation>}
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-10 xl:py-10">
        {wk && error && <ErrorText message={error} />}
        {wk && !current && !error && <p role="status" className="py-12 text-center text-sm text-ink-muted">워크스페이스를 불러오는 중입니다.</p>}
        {(!wk || current) && <Outlet />}
      </main>
    </div>
  );
  return current ? <WorkspaceContext.Provider value={{ workspace: current, reload }}>{page}</WorkspaceContext.Provider> : page;
}

function MobileNavigation({ children, onClose, onReturnFocus }: { children: React.ReactNode; onClose: () => void; onReturnFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      document.body.style.overflow = overflow;
      element.close();
      onReturnFocus();
    };
  }, []);
  return <dialog ref={dialog} id="mobile-navigation" aria-label="워크스페이스 탐색" className="mobile-navigation" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dialog.current) onClose(); }}>{children}</dialog>;
}

function Sidebar({ workspace, onClose }: { workspace: WorkspaceDetail | null; onClose?: () => void }) {
  const { me, workspaces } = useSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const scope = workspace ? `&workspace=${workspace.key}` : '';
    navigate(`/search?q=${encodeURIComponent(query.trim())}${scope}`);
  };
  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  };

  return (
    <aside className={`flex h-dvh shrink-0 flex-col bg-white ${onClose ? 'w-full' : 'sticky top-0 w-64 border-r border-border xl:w-68'}`}>
      <div className="flex min-h-20 shrink-0 items-center gap-3 px-5">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 text-base font-bold"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-tint text-accent"><Icon name="document" /></span>Spec Hub</Link>
        {onClose && <button type="button" aria-label="탐색 메뉴 닫기" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-muted hover:bg-bg"><Icon name="close" /></button>}
      </div>
      <div className="space-y-3 px-4 pb-4">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-ink-muted">워크스페이스</span>
          <select aria-label="워크스페이스 전환" value={workspace?.key ?? ''} onChange={(e) => navigate(e.target.value ? `/w/${e.target.value}` : '/')} className="form-control font-medium">
            <option value="">워크스페이스 선택</option>
            {workspaces.map((w) => <option key={w.key} value={w.key}>{w.name} ({w.key})</option>)}
          </select>
        </label>
        <form onSubmit={search} role="search" className="relative">
          <span className="pointer-events-none absolute left-3 top-3 text-ink-faint"><Icon name="search" width="16" height="16" /></span>
          <input aria-label={workspace ? `${workspace.name}에서 검색` : '전체 검색'} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={workspace ? `${workspace.name}에서 검색` : '전체 검색'} className="form-control bg-bg pl-9 pr-9" />
          {query.trim() && <button type="submit" aria-label="검색" className="absolute right-1 top-1 flex h-9 w-8 items-center justify-center rounded text-accent"><Icon name="arrow" width="16" height="16" /></button>}
        </form>
      </div>
      <nav aria-label="워크스페이스 메뉴" className="space-y-1 border-y border-border px-3 py-3">
        <NavLink end to="/" className="nav-item"><Icon name="grid" />워크스페이스</NavLink>
        {workspace && <>
          <NavLink end to={`/w/${workspace.key}`} className="nav-item"><Icon name="document" />전체 목록<span className="ml-auto text-xs font-normal text-ink-muted">{workspace.features.length}</span></NavLink>
          <NavLink to={`/w/${workspace.key}/settings`} className="nav-item"><Icon name="settings" />워크스페이스 설정</NavLink>
        </>}
      </nav>
      <nav aria-label="기능 분류" className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        {workspace ? <CategoryTree key={workspace.key} /> : <>
          <p className="mb-2 px-2 text-xs font-semibold text-ink-muted">워크스페이스 목록</p>
          {workspaces.map((w) => <Link key={w.key} to={`/w/${w.key}`} className="nav-item"><span className="min-w-0 flex-1 truncate">{w.name}</span><span className="font-mono text-xs text-ink-muted">{w.key}</span></Link>)}
        </>}
      </nav>
      <div className="shrink-0 border-t border-border p-4">
        <NavLink to="/me" className="nav-item mb-3"><Icon name="link" />AI 연결</NavLink>
        <div className="flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg text-sm font-semibold text-ink-soft">{me.name.slice(0, 1)}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{me.name}</div><div className="truncate text-xs text-ink-muted">{workspace ? (workspace.myRole ? ROLE_LABELS[workspace.myRole] : '아직 참여하지 않음') : me.email}</div></div>
          <button type="button" onClick={logout} className="min-h-9 shrink-0 rounded px-1 text-xs text-ink-muted hover:text-accent">로그아웃</button>
        </div>
      </div>
    </aside>
  );
}
