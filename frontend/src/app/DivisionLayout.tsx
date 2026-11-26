import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../shared/brand';
import { SessionContext, sessionQuery } from '../shared/session';
import { LoadProblem } from '../shared/ui';
import { Navigation } from './Navigation';

export function DivisionLayout() {
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
  if (!session.data) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <SessionContext.Provider value={session.data}>
      <div className="division-shell">
        <a className="skip-link" href="#main-content">Ke konten utama</a>
        <aside className="division-sidebar">
          <Brand />
          <Navigation />
        </aside>
        <header className="division-mobile-header">
          <Brand />
        </header>
        <main className="division-main" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <Navigation mobile />
      </div>
    </SessionContext.Provider>
  );
}
