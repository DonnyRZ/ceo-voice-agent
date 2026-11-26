import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Laptop, LockKeyhole, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../shared/api';
import { ManagementAlert, ManagementConfirm, ManagementTile } from './management-ui';
import { roleNames, userDisplayName, type AdminUser } from './user-data';

export function InvitationAccess({ user }: { user: AdminUser }) {
  const [confirm, setConfirm] = useState(false);
  const cache = useQueryClient();
  const endpoint = encodeURIComponent(user.id);
  const mutation = useMutation({
    mutationFn: (action: 'retry' | 'revoke') => api<AdminUser>(action === 'retry' ? `/api/admin/invitations/${endpoint}/retry` : `/api/admin/users/${endpoint}`, {
      method: action === 'retry' ? 'POST' : 'DELETE', body: JSON.stringify({ version: user.version }),
    }),
    onSuccess: (record) => {
      cache.setQueryData(['admin', 'users', 'detail', record.id], record);
      void cache.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirm(false);
    },
    onError: () => setConfirm(false),
  });

  return (
    <div className="mgmt-invited-access">
      <section className="mgmt-panel">
        <h2>Hak Akses</h2>
        <div className="mgmt-invited-assignment">
          <strong>{roleNames[user.role]}</strong>
          {user.divisionName && <span><ManagementTile icon={Laptop} />{user.divisionName}</span>}
        </div>
      </section>
      {user.status === 'failed' && <ManagementAlert>Undangan gagal dikirim.</ManagementAlert>}
      {mutation.isError && <ManagementAlert>{mutation.error.message}</ManagementAlert>}
      {mutation.isSuccess && mutation.data.status === 'pending' && <p role="status">Undangan berhasil dikirim ulang.</p>}
      <div className="mgmt-actions">
        {user.status !== 'revoked' && (
          <button className="mgmt-button mgmt-primary" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate('retry')}>
            <Send aria-hidden="true" />{mutation.isPending && !confirm ? 'Mengirim…' : 'Kirim ulang undangan'}
          </button>
        )}
        <Link className="mgmt-button mgmt-outline" to="/admin/users"><ArrowLeft aria-hidden="true" />Kembali ke daftar pengguna</Link>
        {user.status !== 'revoked' && <button className="mgmt-button mgmt-outline" type="button" disabled={mutation.isPending} onClick={() => setConfirm(true)}>Cabut akses</button>}
      </div>
      {confirm && <ManagementConfirm title={`Cabut akses ${userDisplayName(user)}?`} description="Undangan akan dicabut."
        icon={LockKeyhole} confirm="Cabut akses" warning busy={mutation.isPending} onClose={() => setConfirm(false)}
        onConfirm={() => mutation.mutate('revoke')} />}
    </div>
  );
}
