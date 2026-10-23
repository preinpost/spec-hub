// 웹과 워커가 함께 쓰는 명세 규칙. 상태 전이 · 역할 · 템플릿 해석은 여기에서만 정한다.

export interface TemplateSection {
  /** 기능 본문 JSON 의 키. 한 번 정하면 바꾸지 않는다(라벨만 바꾼다). */
  key: string;
  label: string;
  hint: string;
  /** 템플릿에서 뺀 섹션. 라벨을 기억해 두려고 지우지 않고 남긴다. */
  archived?: boolean;
}

export type Template = TemplateSection[];
export type Sections = Record<string, string>;

/** 새 워크스페이스가 처음 받는 템플릿. */
export const DEFAULT_TEMPLATE: Template = [
  { key: 'purpose', label: '목적과 배경', hint: '왜 이 기능이 필요한지, 지금 어떤 문제가 있는지 적습니다.' },
  { key: 'users', label: '사용자와 권한', hint: '누가 쓰는지, 역할별로 무엇을 할 수 있는지 적습니다.' },
  { key: 'flow', label: '화면 흐름', hint: '어느 화면에서 시작해서 무엇을 누르면 어떻게 되는지 순서대로 적습니다.' },
  { key: 'rules', label: '업무 규칙', hint: '계산식, 검증 조건, 상태가 바뀌는 조건처럼 반드시 지켜야 하는 규칙을 적습니다.' },
  { key: 'exceptions', label: '예외 상황', hint: '입력이 잘못됐거나 외부 연동이 실패했을 때 어떻게 되어야 하는지 적습니다.' },
];

export const SECTION_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export const activeSections = (template: Template) => template.filter((s) => !s.archived);

/** 템플릿 순서대로 섹션을 채운다. 템플릿에서 뺀 섹션의 본문도 버리지 않는다. */
export function normalizeSections(template: Template, input: Partial<Record<string, unknown>> | null | undefined): Sections {
  const out: Sections = {};
  for (const s of activeSections(template)) out[s.key] = typeof input?.[s.key] === 'string' ? (input[s.key] as string) : '';
  for (const [k, v] of Object.entries(input ?? {})) {
    if (!(k in out) && typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

export interface DisplaySection extends TemplateSection {
  /** 지금 템플릿에는 없지만 본문이 남아 있는 섹션. */
  removed: boolean;
}

/** 화면에 그릴 섹션 목록. 템플릿 섹션 뒤에 템플릿에서 빠졌지만 본문이 있는 섹션을 붙인다. */
export function displaySections(template: Template, sections: Sections): DisplaySection[] {
  const active = activeSections(template);
  const known = new Set(active.map((s) => s.key));
  return [
    ...active.map((s) => ({ ...s, removed: false })),
    ...Object.keys(sections)
      .filter((k) => !known.has(k) && sections[k].trim() !== '')
      .map((k) => ({ key: k, label: `${sectionLabel(template, k)} (템플릿에서 빠진 섹션)`, hint: '', removed: true })),
  ];
}

export function sectionLabel(template: Template, key: string | null): string {
  if (key === null) return '기능 전체';
  return template.find((s) => s.key === key)?.label ?? key;
}

export const STATUSES = ['draft', 'review', 'confirmed'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  draft: '초안',
  review: '검토 중',
  confirmed: '확정',
};

/**
 * 버튼으로 바꿀 수 있는 상태 전이. 확정본을 고치면 저장할 때 초안으로 돌아가므로
 * confirmed 에서 나가는 전이는 여기에 없다.
 */
export const TRANSITIONS: Record<Status, Status[]> = {
  draft: ['review'],
  review: ['draft', 'confirmed'],
  confirmed: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

export const ROLES = ['admin', 'approver', 'member'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { admin: '관리자', approver: '확정권한자', member: '멤버' };

export const canConfirmAs = (role: Role | null) => role === 'admin' || role === 'approver';

export type Source = 'web' | 'mcp';

/** 워크스페이스 키. 기능 키의 접두사가 되므로 영문 대문자로 짧게 쓴다. 하이픈은 기능 번호와 구분하는 데 쓰므로 받지 않는다. */
export const WORKSPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** 기능 키(WCN-12)에서 워크스페이스 키(WCN)를 꺼낸다. */
export function workspaceKeyOf(featureKey: string): string {
  return featureKey.split('-')[0].toUpperCase();
}

export const MAX_CATEGORY_DEPTH = 3;
export const DEPTH_LABELS: Record<number, string> = { 1: '대분류', 2: '중분류', 3: '소분류' };

export const SCREEN_PATH_MAX_LENGTH = 512;
const SCREEN_PATH_FORMAT_MESSAGE = '도메인을 제외하고 /로 시작하는 화면 경로를 입력해 주세요. 공백, 역슬래시, 제어문자, query와 hash는 사용할 수 없습니다.';

export function screenPathError(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value.length > SCREEN_PATH_MAX_LENGTH) return `화면 경로는 ${SCREEN_PATH_MAX_LENGTH}자를 넘을 수 없습니다.`;
  if (!value.startsWith('/') || value.startsWith('//') || /[\s\\?#\p{Cc}\p{Cf}]/u.test(value)) return SCREEN_PATH_FORMAT_MESSAGE;
  return null;
}

export const ENTRY_PATH_MAX_LENGTH = 2000;

export function entryPathError(value: string | null | undefined): string | null {
  return value && value.length > ENTRY_PATH_MAX_LENGTH ? `접근 경로는 ${ENTRY_PATH_MAX_LENGTH.toLocaleString()}자를 넘을 수 없습니다.` : null;
}
