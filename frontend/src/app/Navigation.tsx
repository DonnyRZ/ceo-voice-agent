import { Calendar, CalendarDays, House, Layers, Settings, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', name: 'Dashboard', Icon: House },
  { to: '/timesheet', name: 'Timesheet', Icon: Calendar, MobileIcon: CalendarDays },
  { to: '/projects', name: 'Proyek', Icon: Layers },
  { to: '/account', name: 'Akun', Icon: Settings, MobileIcon: UserRound },
];

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav className={mobile ? 'mobile-navigation' : 'side-navigation'} aria-label="Navigasi Anggota Divisi">
      {links.map(({ to, name, Icon, MobileIcon }) => {
        const NavigationIcon = mobile && MobileIcon ? MobileIcon : Icon;
        return (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => isActive ? 'nav-item nav-item--active' : 'nav-item'}
          >
            <NavigationIcon aria-hidden="true" strokeWidth={1.85} />
            <span>{name}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
