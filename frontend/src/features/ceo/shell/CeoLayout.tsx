import { House, Layers, Mic, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../../../shared/brand';
import './ceo-shell.css';
import '../shared/ceo-common.css';

const links = [
  { to: '/ceo', label: 'Dashboard', icon: House, end: true },
  { to: '/ceo/divisions', label: 'Divisi', icon: Layers, end: false },
  { to: '/ceo/voice', label: 'Agent', icon: Mic, end: false },
  { to: '/ceo/account', label: 'Akun', icon: UserRound, end: false },
];

function CeoNavigation({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation();
  return <nav className={mobile ? 'ceo-bottom-nav' : 'ceo-side-nav'} aria-label="Navigasi CEO">
    {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}
      className={({ isActive }) => {
        const nested = to === '/ceo/divisions' && /^\/ceo\/(projects|tasks)\//.test(pathname);
        const account = to === '/ceo/account' && pathname === '/ceo/settings';
        return `ceo-nav-item${isActive || nested || account ? ' ceo-nav-item--active' : ''}`;
      }}>
      <Icon aria-hidden="true" strokeWidth={1.7} /><span>{label}</span>
    </NavLink>)}
  </nav>;
}

export function CeoLayout() {
  return <div className="ceo-shell">
    <a className="skip-link" href="#ceo-main">Ke konten utama</a>
    <aside className="ceo-sidebar"><Brand to="/ceo" /><CeoNavigation /></aside>
    <header className="ceo-mobile-header"><Brand to="/ceo" /></header>
    <main className="ceo-main" id="ceo-main" tabIndex={-1}>
      <Link className="ceo-desktop-account" to="/ceo/account" aria-label="Buka akun"><UserRound aria-hidden="true" /></Link>
      <Outlet />
    </main>
    <CeoNavigation mobile />
  </div>;
}
