import { Laptop, Mail, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AccountBadge, ManagementAlert, ManagementHeading, ManagementTaskStats, ManagementTile, type TaskCounts } from './management-ui';
import { roleNames, type AdminUser } from './user-data';

export function InvitationSuccess({ email, counts }: { email: string; counts?: TaskCounts }) {
  return (
    <div className="mgmt-page mgmt-invite-page">
      <ManagementHeading title="Undang Pengguna" section="Pengguna" back="/admin/users" context="Undang Pengguna" />
      <div className="mgmt-panel mgmt-invite-success" role="status">
        <span className="mgmt-invite-success-icon"><img src="/images/admin-invite-success.png" alt="" /></span>
        <h2>Undangan berhasil dikirim</h2>
        <span className="mgmt-invite-email"><Mail aria-hidden="true" />{email}</span>
        <ManagementTaskStats counts={counts} variant="mgmt-invite-result-stats" />
        <Link className="mgmt-button mgmt-primary" to="/admin/users">Kembali ke daftar pengguna</Link>
      </div>
    </div>
  );
}

export function InvitationFailure({ invitation, counts, busy, error, onRetry }: {
  invitation: AdminUser;
  counts?: TaskCounts;
  busy: boolean;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="mgmt-page mgmt-invite-page mgmt-invite-failure">
      <ManagementHeading title="Undang Pengguna" section="Pengguna" back="/admin/users" context="Undang Pengguna" />
      <ManagementAlert><strong>Undangan gagal dikirim</strong>{error && <p>{error}</p>}</ManagementAlert>
      <dl className="mgmt-panel mgmt-invite-summary">
        <div>
          <ManagementTile icon={Mail} />
          <dt>Email perusahaan</dt><dd>{invitation.email}</dd>
        </div>
        <div>
          <ManagementTile icon={UserRound} />
          <dt>Peran</dt><dd>{roleNames[invitation.role]}</dd>
        </div>
        <div>
          <ManagementTile icon={Laptop} />
          <dt>Divisi</dt><dd>{invitation.divisionName ?? 'Tanpa divisi'}</dd>
        </div>
      </dl>
      <ManagementTaskStats counts={counts} variant="mgmt-invite-result-stats" />
      <div className="mgmt-actions">
        <button className="mgmt-button mgmt-primary" type="button" disabled={busy} onClick={onRetry}>
          {busy ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Mengirim</span> : 'Coba kirim lagi'}
        </button>
        <Link className="mgmt-button mgmt-outline" to="/admin/users">Batal</Link>
      </div>
    </div>
  );
}

export function RecentInvitations({ users, pending, error, onRetry }: { users: AdminUser[]; pending: boolean; error: boolean; onRetry: () => void }) {
  const invited = users.filter((user) => user.kind === 'invitation')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6);
  return (
    <div className="mgmt-panel mgmt-invite-history">
      <table aria-label="Undangan terbaru">
        <thead><tr><th>Email perusahaan</th><th>Peran</th><th>Divisi</th><th>Status</th></tr></thead>
        <tbody>
          {pending ? <tr><td colSpan={4}><p className="loading-inline" role="status"><span className="ui-spinner" aria-hidden="true" />Memuat undangan</p></td></tr>
            : error ? <tr><td colSpan={4}><p role="alert">Undangan belum dapat dimuat. <button className="mgmt-text-action" type="button" onClick={onRetry}>Coba lagi</button></p></td></tr>
              : invited.map((user) => (
            <tr key={user.id}>
              <td><Link to={`/admin/users/${user.id}`}>{user.email}</Link></td>
              <td>{roleNames[user.role]}</td><td>{user.divisionName ?? '—'}</td><td><AccountBadge status={user.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!pending && !error && invited.length === 0 && <p>Belum ada undangan.</p>}
    </div>
  );
}
