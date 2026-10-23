import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router';

import type { FeatureSummary } from '../../shared/api';
import { DEPTH_LABELS, MAX_CATEGORY_DEPTH } from '../../shared/spec';
import { type TreeNode, allFeatures, ancestorsOf, buildTree } from '../../shared/tree';
import { api, errorMessage } from '../api';
import { useWorkspace } from '../session';
import { StatusDot } from './ui';

/** 펼친 분류는 워크스페이스마다 브라우저에 기억한다. */
function useExpanded(workspaceKey: string) {
  const storageKey = `tree-expanded:${workspaceKey}`;
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as number[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...expanded]));
  }, [storageKey, expanded]);
  const toggle = (id: number, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  return { expanded, toggle, setExpanded };
}

type CategoryMenu = { node: TreeNode; x: number; y: number; trigger: HTMLElement };

type Editing = { kind: 'new'; parentId: number | null } | { kind: 'rename'; id: number; name: string } | null;

export function CategoryTree() {
  const { workspace, reload } = useWorkspace();
  const params = useParams();
  const location = useLocation();
  const menuId = useId();
  const [menu, setMenu] = useState<CategoryMenu | null>(null);
  const { roots, uncategorized } = useMemo(() => buildTree(workspace.categories, workspace.features), [workspace]);
  const { expanded, toggle, setExpanded } = useExpanded(workspace.key);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  // 기능 화면에 들어오면 그 기능이 있는 분류까지 펼친다.
  const currentCategory = workspace.features.find((f) => f.key === params.key?.toUpperCase())?.categoryId ?? null;
  useEffect(() => {
    const path = ancestorsOf(workspace.categories, currentCategory);
    if (path.length) setExpanded((prev) => new Set([...prev, ...path.map((c) => c.id)]));
  }, [currentCategory, workspace.categories, setExpanded]);

  const save = async (name: string) => {
    if (!editing) return;
    try {
      if (editing.kind === 'new') {
        await api.post(`/workspaces/${workspace.key}/categories`, { parentId: editing.parentId, name });
        if (editing.parentId) toggle(editing.parentId, true);
      } else {
        await api.patch(`/categories/${editing.id}`, { name });
      }
      setEditing(null);
      setError(null);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (node: TreeNode) => {
    if (!confirm(`"${node.category.name}" 분류를 지울까요?`)) return;
    try {
      await api.delete(`/categories/${node.category.id}`);
      setError(null);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => { setMenu(null); }, [location.key]);

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus && menu?.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
    setMenu(null);
  };
  const openMenu = (node: TreeNode, trigger: HTMLElement, point?: { x: number; y: number }) => {
    const rect = trigger.getBoundingClientRect();
    setMenu({ node, trigger, x: point?.x ?? rect.left, y: point?.y ?? rect.bottom + 4 });
  };
  const ctx = { workspaceKey: workspace.key, expanded, toggle, editing, setEditing, save, remove, openMenu, menuId, menuCategoryId: menu?.node.category.id };


  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs font-semibold text-ink-muted">
        <span>분류</span>
        <button type="button" className="min-h-8 rounded px-1 hover:text-accent" onClick={() => setEditing({ kind: 'new', parentId: null })}>
          + 대분류
        </button>
      </div>
      {error && <p className="mx-2 mb-1 rounded bg-red-50 px-2 py-1 text-xs text-danger">{error}</p>}
      {editing?.kind === 'new' && editing.parentId === null && <NameInput depth={1} onSubmit={save} onCancel={() => setEditing(null)} />}
      {roots.map((node) => (
        <Node key={node.category.id} node={node} ctx={ctx} />
      ))}
      {uncategorized.length > 0 && (
        <div className="mt-2">
          <div className="px-2 py-1 text-xs font-semibold text-ink-faint">미분류</div>
          {uncategorized.map((f) => (
            <FeatureRow key={f.key} feature={f} indent={0} />
          ))}
        </div>
      )}
      {roots.length === 0 && uncategorized.length === 0 && !editing && (
        <p className="px-2 py-2 text-xs text-ink-faint">분류도 기능도 아직 없습니다. 대분류를 만들거나 바로 기능을 추가하세요.</p>
      )}
      {menu && <CategoryContextMenu menu={menu} id={menuId} ctx={ctx} onClose={closeMenu} />}
      <Link to={`/w/${workspace.key}/new`} className="button-link mt-4 w-full text-sm">
        + 기능 추가
      </Link>
    </div>
  );
}

interface Ctx {
  workspaceKey: string;
  expanded: Set<number>;
  toggle: (id: number, open?: boolean) => void;
  editing: Editing;
  setEditing: (e: Editing) => void;
  save: (name: string) => Promise<void>;
  remove: (node: TreeNode) => Promise<void>;
  openMenu: (node: TreeNode, trigger: HTMLElement, point?: { x: number; y: number }) => void;
  menuId: string;
  menuCategoryId?: number;
}

function Node({ node, ctx }: { node: TreeNode; ctx: Ctx }) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const { category } = node;
  const open = ctx.expanded.has(category.id);
  const indent = (category.depth - 1) * 14;
  const total = allFeatures(node);
  const openQuestions = total.reduce((n, f) => n + f.openQuestions, 0);
  const renaming = ctx.editing?.kind === 'rename' && ctx.editing.id === category.id;

  return (
    <div>
      {renaming ? (
        <div style={{ paddingLeft: indent }}>
          <NameInput depth={category.depth} initial={category.name} onSubmit={ctx.save} onCancel={() => ctx.setEditing(null)} />
        </div>
      ) : (
        <div
          className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-50"
          style={{ paddingLeft: 8 + indent }}
          onContextMenu={(e) => {
            e.preventDefault();
            const trigger = (e.target as HTMLElement).closest('button') ?? menuButton.current!;
            ctx.openMenu(node, trigger, { x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
              e.preventDefault();
              ctx.openMenu(node, (e.target as HTMLElement).closest('button') ?? menuButton.current!);
            }
          }}
        >
          <button type="button" onClick={() => ctx.toggle(category.id)} aria-expanded={open} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left">
            <span className={`inline-block w-3 text-[10px] text-ink-faint transition ${open ? 'rotate-90' : ''}`}>▶</span>
            <span className="truncate font-medium text-ink-soft">{category.name}</span>
            {!open && total.length > 0 && <span className="text-xs text-ink-faint">{total.length}</span>}
            {!open && openQuestions > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{openQuestions}</span>}
          </button>
          <button
            ref={menuButton}
            type="button"
            aria-label={`${category.name} 분류 메뉴`}
            title={`${category.name} 분류 메뉴`}
            aria-haspopup="menu"
            aria-expanded={ctx.menuCategoryId === category.id}
            aria-controls={ctx.menuCategoryId === category.id ? ctx.menuId : undefined}
            onClick={(e) => ctx.openMenu(node, e.currentTarget)}
            className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md text-lg leading-none text-ink-muted hover:bg-slate-100 hover:text-ink"
          >
            ⋯
          </button>
        </div>
      )}
      {open && (
        <div>
          {ctx.editing?.kind === 'new' && ctx.editing.parentId === category.id && (
            <div style={{ paddingLeft: indent + 14 }}>
              <NameInput depth={category.depth + 1} onSubmit={ctx.save} onCancel={() => ctx.setEditing(null)} />
            </div>
          )}
          {node.children.map((child) => (
            <Node key={child.category.id} node={child} ctx={ctx} />
          ))}
          {node.features.map((f) => (
            <FeatureRow key={f.key} feature={f} indent={indent + 14} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryContextMenu({ menu, id, ctx, onClose }: { menu: CategoryMenu; id: string; ctx: Ctx; onClose: (restoreFocus?: boolean) => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { node } = menu;
  const { category } = node;
  const canAddCategory = category.depth < MAX_CATEGORY_DEPTH;
  const canDelete = node.children.length === 0 && node.features.length === 0;

  useLayoutEffect(() => {
    const element = ref.current!;
    element.showPopover();
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => { element.hidePopover(); };
  }, [menu]);

  useEffect(() => {
    const dismiss = () => onClose(true);
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) onClose(true);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    onClose(true);
    action();
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const scope = menu.trigger.closest('dialog') ?? document;
      const focusable = [...scope.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length && !ref.current?.contains(element));
      const current = focusable.indexOf(menu.trigger);
      onClose();
      (focusable[current + (event.shiftKey ? -1 : 1)] ?? menu.trigger).focus({ preventScroll: true });
    }
  };
  const itemClass = 'flex min-h-10 w-full items-center rounded-md px-3 py-2 text-left text-sm text-ink-soft hover:bg-accent-tint focus:bg-accent-tint focus:outline-none disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent';

  return createPortal(
    <div ref={ref} id={id} popover="manual" role="menu" aria-label={`${category.name} 분류 메뉴`} onKeyDown={keyDown} className="fixed inset-auto m-0 max-h-[calc(100dvh-16px)] w-60 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-border-strong bg-white p-1.5 text-ink shadow-xl">
      <div className="truncate border-b border-border px-3 py-2 text-xs font-semibold text-ink-muted" title={category.name}>{category.name}</div>
      <button type="button" role="menuitem" tabIndex={-1} disabled={!canAddCategory} aria-describedby={!canAddCategory ? `${id}-depth-limit` : undefined} title={canAddCategory ? `${DEPTH_LABELS[category.depth + 1]} 추가` : '분류는 최대 3단계까지 만들 수 있습니다.'} className={itemClass} onClick={() => run(() => { ctx.toggle(category.id, true); ctx.setEditing({ kind: 'new', parentId: category.id }); })}>하위 분류 추가</button>
      {!canAddCategory && <p id={`${id}-depth-limit`} className="px-3 pb-2 text-xs text-ink-muted">분류는 최대 3단계까지 만들 수 있습니다.</p>}
      <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(() => navigate(`/w/${ctx.workspaceKey}/new?category=${category.id}`))}>기능 추가</button>
      <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(() => ctx.setEditing({ kind: 'rename', id: category.id, name: category.name }))}>이름 변경</button>
      <div className="my-1 border-t border-border" />
      <button type="button" role="menuitem" tabIndex={-1} disabled={!canDelete} aria-describedby={!canDelete ? `${id}-delete-limit` : undefined} title={canDelete ? '분류 삭제' : '하위 분류와 기능이 없는 분류만 삭제할 수 있습니다.'} className={`${itemClass} enabled:text-danger enabled:hover:bg-red-50 enabled:focus:bg-red-50`} onClick={() => run(() => { void ctx.remove(node); })}>삭제</button>
      {!canDelete && <p id={`${id}-delete-limit`} className="px-3 pb-2 text-xs text-ink-muted">하위 분류와 기능이 없는 분류만 삭제할 수 있습니다.</p>}
    </div>,
    menu.trigger.closest('dialog') ?? document.body,
  );
}

function FeatureRow({ feature, indent }: { feature: FeatureSummary; indent: number }) {
  return (
    <NavLink
      to={`/features/${feature.key}`}
      style={{ paddingLeft: 8 + indent + 14 }}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-2 rounded-lg py-2 pr-2 ${isActive ? 'bg-accent-tint text-accent-deep' : 'text-ink-soft hover:bg-slate-50'}`
      }
    >
      <StatusDot status={feature.status} />
      <span className="truncate">{feature.title}</span>
      {feature.openQuestions > 0 && <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{feature.openQuestions}</span>}
    </NavLink>
  );
}

function NameInput({ depth, initial = '', onSubmit, onCancel }: { depth: number; initial?: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form onSubmit={submit} className="px-2 py-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onBlur={() => !name.trim() && onCancel()}
        placeholder={`${DEPTH_LABELS[depth]} 이름`}
        aria-label={`${DEPTH_LABELS[depth]} 이름`}
        className="form-control"
      />
      <div className="mt-1 flex justify-end gap-2 text-xs"><button type="button" onClick={onCancel} className="min-h-8 rounded px-2 text-ink-muted">취소</button><button type="submit" disabled={!name.trim()} className="min-h-8 rounded px-2 text-accent disabled:opacity-40">저장</button></div>
    </form>
  );
}
