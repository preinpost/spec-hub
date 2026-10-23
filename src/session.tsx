import { createContext, useContext } from 'react';

import type { Me, WorkspaceDetail, WorkspaceSummary } from '../shared/api';

export interface SessionValue {
  me: Me;
  workspaces: WorkspaceSummary[];
  reloadWorkspaces: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionContext 밖에서 useSession 을 불렀습니다.');
  return value;
}

/** 지금 보고 있는 워크스페이스. 사이드바 트리와 화면이 같은 데이터를 보고, 바꾼 뒤에는 reload 로 함께 갱신한다. */
export interface WorkspaceValue {
  workspace: WorkspaceDetail;
  reload: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('WorkspaceContext 밖에서 useWorkspace 를 불렀습니다.');
  return value;
}
