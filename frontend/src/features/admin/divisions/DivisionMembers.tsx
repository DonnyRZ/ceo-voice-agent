import { CalendarDays, ChevronRight, UserRound, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ManagementTile } from '../users/management-ui';
import type { AdminDivision } from './division-data';

export function DivisionMembers({ division, blocked }: { division: AdminDivision; blocked: boolean }) {
  const timesheets = `/admin/timesheets/${division.id}`;
  return (
    <div className="mgmt-division-members">
      <section className="mgmt-panel" aria-labelledby="mgmt-division-members-heading">
        <h2 id="mgmt-division-members-heading">{blocked ? 'Anggota Aktif' : 'Anggota'}</h2>
        <div className="mgmt-members-label" aria-hidden="true">Nama</div>
        {division.members?.length ? (
          <ul>
            {division.members.map((member) => (
              <li key={member.id} className="mgmt-member-row">
                <Link className="mgmt-member-name" to={`/admin/users/${member.id}`}>
                  <ManagementTile icon={UserRound} /><strong>{member.name}</strong><ChevronRight aria-hidden="true" />
                </Link>
                <Link className="mgmt-button mgmt-outline mgmt-member-timesheet" to={`${timesheets}?picId=${encodeURIComponent(member.id)}`} aria-label={`Buka timesheet ${member.name}`}>
                  Buka timesheet
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="mgmt-members-none">Belum ada anggota aktif.</p>}
        {blocked && (
          <Link className="mgmt-button mgmt-outline mgmt-view-members" to={`/admin/users?divisionId=${division.id}&status=active`}>
            <UsersRound aria-hidden="true" />Lihat anggota
          </Link>
        )}
      </section>
      {!blocked && <Link className="mgmt-panel mgmt-mobile-division-timesheet" to={timesheets}>
        <ManagementTile icon={CalendarDays} /><strong>Buka timesheet</strong><ChevronRight aria-hidden="true" />
      </Link>}
    </div>
  );
}
