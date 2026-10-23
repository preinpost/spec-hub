import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { UserRef } from '../../shared/api';
import { STATUS_LABELS, type Source, type Status } from '../../shared/spec';

const STATUS_STYLE: Record<Status, string> = {
  draft: 'bg-slate-100 text-slate-700',
  review: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function StatusDot({ status }: { status: Status }) {
  const color = { draft: 'bg-slate-400', review: 'bg-amber-500', confirmed: 'bg-emerald-500' }[status];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} title={STATUS_LABELS[status]} />;
}

/** 작성자 이름과 이 워크스페이스에서 고른 팀. 어느 팀이 한 말인지 바로 보이게 한다. */
export function Author({ user, source }: { user: UserRef; source?: Source }) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 text-sm">
      <span className="min-w-0 break-words font-medium text-ink-soft">{user.name}</span>
      {user.team && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{user.team}</span>}
      {source === 'mcp' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">AI</span>}
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-deep border-accent',
  secondary: 'bg-white text-ink-soft hover:bg-slate-50 border-border-strong',
  danger: 'bg-white text-danger hover:bg-red-50 border-red-200',
  ghost: 'bg-transparent text-ink-muted hover:text-ink border-transparent',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold leading-snug transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`section-card ${className}`}>{children}</section>;
}

export function MarkdownView({ text, empty = '(비어 있음)' }: { text: string; empty?: string }) {
  if (!text.trim()) return <p className="text-sm text-ink-faint">{empty}</p>;
  return (
    <div className="spec-markdown prose prose-slate max-w-none">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="my-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-danger">{message}</p>;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`form-control leading-relaxed ${props.className ?? ''}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`form-control ${props.className ?? ''}`}
    />
  );
}
