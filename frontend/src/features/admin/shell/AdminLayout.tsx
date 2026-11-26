import { Calendar, ClipboardList, House, Layers, UserRound, UsersRound } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../../../shared/brand';
import './admin-frame.css';
import './admin-common.css';

export const adminLinks = [
  { to: '/admin', label: 'Dashboard', icon: House, end: true },
  { to: '/admin/timesheets', label: 'Timesheet', icon: Calendar, end: false },
  { to: '/admin/users', label: 'Pengguna', icon: UsersRound, end: false },
  { to: '/admin/divisions', label: 'Divisi', icon: Layers, end: false },
  { to: '/admin/audit', label: 'Audit Log', icon: ClipboardList, end: false },
];

function AdminNav({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation();
  return (
    <nav className={mobile ? 'mobile-navigation admin-mobile-navigation' : 'side-navigation admin-side-navigation'}
      aria-label="Navigasi Superadmin">
      {adminLinks.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => isActive || (to === '/admin/timesheets' && pathname.startsWith('/admin/tasks/'))
            ? 'nav-item nav-item--active'
            : 'nav-item'}>
          <Icon aria-hidden="true" strokeWidth={1.8} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AdminBrand() {
  return (
    <div className="admin-brand">
      <Brand to="/admin" />
      <p>Superadmin</p>
    </div>
  );
}

function AccountLink({ desktop = false }: { desktop?: boolean }) {
  return (
    <Link className={desktop ? 'admin-account admin-account-desktop' : 'admin-account'} to="/admin/account" aria-label="Akun">
      <UserRound aria-hidden="true" strokeWidth={1.7} />
    </Link>
  );
}

export function AdminLayout() {
  return (
    <div className="division-shell admin-shell">
      <a className="skip-link" href="#admin-main">Ke konten utama</a>
      <aside className="division-sidebar admin-sidebar">
        <AdminBrand />
        <AdminNav />
        <div className="admin-sidebar-footer"><AccountLink desktop /></div>
      </aside>
      <header className="division-mobile-header admin-mobile-header">
        <AdminBrand />
        <AccountLink />
      </header>
      <main className="division-main admin-main" id="admin-main" tabIndex={-1}><Outlet /></main>
      <AdminNav mobile />
    </div>
  );
}
