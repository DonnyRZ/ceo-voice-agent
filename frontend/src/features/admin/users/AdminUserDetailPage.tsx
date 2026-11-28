import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../../../shared/api';
import { AccountAccess } from './AccountAccess';
import { InvitationAccess } from './InvitationAccess';
import { AccountBadge, ManagementAlert, ManagementHeading, ManagementTaskStats, ManagementTile } from './management-ui';
import { useManagementTaskCounts } from './management-stats';
import { adminUserQuery, userDisplayName, type AdminUser } from './user-data';
import './admin-user-detail.css';

function UserAccessDetails({ user }: { user: AdminUser }) {
  const counts = useManagementTaskCounts({ divisionId: user.divisionId ?? undefined, picId: user.id }, user.kind === 'account');
  const isAccount = user.kind === 'account';
  return (
    <>
      <div className={`mgmt-band mgmt-user-identity${isAccount ? '' : ' mgmt-user-invited'}`}>
        <ManagementTile icon={UserRound} />
        <div>
          <h2>{userDisplayName(user)}</h2>
          {user.name && <p>{user.email}</p>}
        </div>
        <AccountBadge status={user.status} />
      </div>
      {isAccount ? (
        <>
          <ManagementTaskStats counts={counts} variant="mgmt-user-detail-stats" />
          <AccountAccess key={user.id} user={user} />
        </>
      ) : <InvitationAccess key={user.id} user={user} />}
    </>
  );
}

export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const user = useQuery(adminUserQuery(id));
  const missing = user.error instanceof ApiError && user.error.status === 404;
  return (
    <div className="mgmt-page mgmt-user-detail">
      <ManagementHeading title="Detail Pengguna dan Hak Akses" section="Pengguna" context="Detail" back="/admin/users" />
      {user.isPending && <p role="status"><span className="loading-inline"><span className="ui-spinner" aria-hidden="true" />Memuat pengguna</span></p>}
      {user.isError && (
        <ManagementAlert>
          <p>{missing ? 'Pengguna tidak ditemukan.' : 'Detail pengguna belum berhasil dimuat.'}</p>
          {!missing && <button type="button" className="mgmt-button mgmt-outline" onClick={() => void user.refetch()}>Coba lagi</button>}
        </ManagementAlert>
      )}
      {user.data && <UserAccessDetails user={user.data} />}
    </div>
  );
}
