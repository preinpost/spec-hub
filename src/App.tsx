import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router';

import type { Me, WorkspaceSummary } from '../shared/api';
import { RequestError, api } from './api';
import { Layout } from './components/Layout';
import { EditFeaturePage } from './pages/EditFeaturePage';
import { FeaturePage } from './pages/FeaturePage';
import { LoginPage } from './pages/LoginPage';
import { MePage } from './pages/MePage';
import { NewFeaturePage } from './pages/NewFeaturePage';
import { SearchPage } from './pages/SearchPage';
import { WorkspaceHomePage } from './pages/WorkspaceHomePage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { SessionContext } from './session';

export function App() {
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);

  const reloadWorkspaces = useCallback(async () => {
    setWorkspaces(await api.get<WorkspaceSummary[]>('/workspaces'));
  }, []);

  useEffect(() => {
    api
      .get<Me>('/me')
      .then(async (m) => {
        setMe(m);
        await reloadWorkspaces();
      })
      .catch((e) => {
        if (!(e instanceof RequestError && e.status === 401)) console.error(e);
      })
      .finally(() => setChecked(true));
  }, [reloadWorkspaces]);

  if (!checked) return null;
  if (!me || location.pathname === '/login') return <LoginPage />;

  return (
    <SessionContext.Provider value={{ me, workspaces, reloadWorkspaces }}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<WorkspacesPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="me" element={<MePage />} />
          <Route path="w/:wk" element={<WorkspaceHomePage />} />
          <Route path="w/:wk/settings" element={<WorkspaceSettingsPage />} />
          <Route path="w/:wk/new" element={<NewFeaturePage />} />
          <Route path="features/:key" element={<FeaturePage />} />
          <Route path="features/:key/edit" element={<EditFeaturePage />} />
          <Route path="*" element={<p className="p-8 text-ink-muted">없는 화면입니다.</p>} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}
