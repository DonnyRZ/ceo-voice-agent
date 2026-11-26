import { Outlet } from 'react-router-dom';
import { Brand } from '../shared/brand';
import { Navigation } from './Navigation';

export function DivisionLayout() {
  return (
    <div className="division-shell">
      <a className="skip-link" href="#main-content">Ke konten utama</a>
      <aside className="division-sidebar">
        <Brand />
        <Navigation />
      </aside>
      <header className="division-mobile-header"><Brand /></header>
      <main className="division-main" id="main-content" tabIndex={-1}><Outlet /></main>
      <Navigation mobile />
    </div>
  );
}
