import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Login } from './pages/Login';
import { Jobs } from './pages/Jobs';
import { Workspace } from './pages/Workspace';
import { Admin } from './pages/Admin';
import { Upscaler } from './pages/Upscaler';
import { Spinner } from './components/ui';

export interface Me {
  user: { name: string } | null;
  passwordRequired: boolean;
  mock: boolean;
}

export function navigate(to: string) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePath();
  const refresh = useCallback(() => api.get<Me>('/me').then(setMe).catch(() => setMe({ user: null, passwordRequired: true, mock: false })), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!me)
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner />
      </div>
    );
  if (!me.user) return <Login onDone={refresh} />;

  const job = path.match(/^\/jobs\/([a-z]+_[a-f0-9]+)/);
  if (job) return <Workspace key={job[1]} projectId={job[1]} me={me} />;
  if (path.startsWith('/admin')) return <Admin me={me} />;
  if (path.startsWith('/upscaler')) return <Upscaler me={me} />;
  return <Jobs me={me} />;
}
