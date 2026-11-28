import { Brand } from '../shared/brand';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SessionContext, sessionHome, sessionQuery } from '../shared/session';
import type { SessionUser } from '../shared/types';
import { LoadProblem } from '../shared/ui';

export function RequireSession({ role }: { role: SessionUser['role'] }) {
  const session = useQuery(sessionQuery);
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  if (session.isPending) {
    return <main className="session-status session-status--loading"><Brand to="/login" /><span className="loading-inline loading-inline--page" role="status"><span className="ui-spinner" aria-hidden="true" />Memeriksa sesi</span></main>;
  }
  if (session.isError) {
    return (
      <main className="session-status">
        <LoadProblem title="Sesi tidak dapat diperiksa." retry={() => void session.refetch()} />
      </main>
    );
  }
  if (!session.data) return <Navigate to={role === 'superadmin' ? '/superadmin' : '/login'} state={{ from: location }} replace />;
  if (session.data.role !== role) return <Navigate to={sessionHome(session.data.role)} replace />;

  return (
    <SessionContext.Provider value={session.data}>
      <Outlet />
    </SessionContext.Provider>
  );
}
