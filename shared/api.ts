// /api 응답 형태. 워커가 만들고 웹이 읽는다.
import type { Role, Sections, Source, Status, Template } from './spec';

export interface Me {
  id: string;
  email: string;
  name: string;
}

export interface UserRef {
  id: string;
  name: string;
  /** 이 워크스페이스에서 고른 팀 이름. */
  team: string | null;
}

export interface WorkspaceSummary {
  key: string;
  name: string;
  description: string;
  featureCount: number;
  memberCount: number;
  myRole: Role | null;
}

export interface Team {
  id: number;
  name: string;
}

export interface Member {
  user: UserRef;
  email: string;
  role: Role;
  teamId: number | null;
  joinedAt: string;
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  depth: number;
  sortOrder: number;
}

export interface FeatureSummary {
  key: string;
  title: string;
  screenPath: string | null;
  entryPath: string | null;
  status: Status;
  categoryId: number | null;
  openQuestions: number;
  updatedAt: string;
  updatedBy: UserRef;
}

export interface WorkspaceDetail {
  key: string;
  name: string;
  description: string;
  template: Template;
  teams: Team[];
  members: Member[];
  categories: Category[];
  features: FeatureSummary[];
  myRole: Role | null;
  myTeamId: number | null;
}

export interface Comment {
  id: number;
  section: string | null;
  kind: 'comment' | 'proposal';
  body: string;
  proposedText: string | null;
  author: UserRef;
  source: Source;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
}

export interface Question {
  id: number;
  section: string | null;
  body: string;
  author: UserRef;
  source: Source;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
}

export interface Decision {
  id: number;
  questionId: number | null;
  body: string;
  author: UserRef;
  source: Source;
  createdAt: string;
}

export interface Activity {
  id: number;
  action: string;
  detail: string | null;
  actor: UserRef;
  source: Source;
  createdAt: string;
}

export interface SnapshotSummary {
  revision: number;
  note: string | null;
  confirmedBy: UserRef;
  confirmedAt: string;
}

export interface Snapshot extends SnapshotSummary {
  title: string;
  screenPath: string | null;
  entryPath: string | null;
  sections: Sections;
  /** 확정할 때의 템플릿. */
  template: Template;
}

export interface FeatureDetail {
  key: string;
  title: string;
  screenPath: string | null;
  entryPath: string | null;
  status: Status;
  version: number;
  workspace: { key: string; name: string };
  categoryId: number | null;
  /** 대분류부터 순서대로. 미분류면 빈 배열. */
  categoryPath: string[];
  /** 워크스페이스의 지금 템플릿. */
  template: Template;
  sections: Sections;
  createdBy: UserRef;
  createdAt: string;
  updatedBy: UserRef;
  updatedAt: string;
  comments: Comment[];
  questions: Question[];
  decisions: Decision[];
  activities: Activity[];
  snapshots: SnapshotSummary[];
  /** 가장 최근 확정본. 한 번도 확정하지 않았으면 null. */
  lastConfirmed: Snapshot | null;
  canConfirm: boolean;
}

export interface SearchResult extends FeatureSummary {
  workspaceKey: string;
  workspaceName: string;
}

export interface Connection {
  grantId: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}
