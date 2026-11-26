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
    return <main className="session-status" role="status">Memeriksa sesi…</main>;
  }
  if (session.isError) {
    return (
      <main className="session-status">
        <LoadProblem title="Sesi tidak dapat diperiksa." retry={() => void session.refetch()} />
      </main>
    );
  }
  if (!session.data) return <Navigate to="/login" state={{ from: location }} replace />;
  if (session.data.role !== role) return <Navigate to={sessionHome(session.data.role)} replace />;

  return (
    <SessionContext.Provider value={session.data}>
      <Outlet />
    </SessionContext.Provider>
  );
}
