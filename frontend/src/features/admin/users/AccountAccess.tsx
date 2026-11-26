import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../../shared/api';
import { adminDivisionsQuery } from '../divisions/division-data';
import { AccessFields, accessPayload, type AccessDraft } from './AccessFields';
import { ManagementAlert, ManagementConfirm } from './management-ui';
import { roleNames, userDisplayName, type AdminUser } from './user-data';

type AccountAction = 'update' | 'revoke';

export function AccountAccess({ user }: { user: AdminUser }) {
  const [base, setBase] = useState(user);
  const [draft, setDraft] = useState<AccessDraft>({ role: user.role, divisionId: user.divisionId ?? '' });
  const [action, setAction] = useState<AccountAction>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const cache = useQueryClient();
  const divisions = useQuery(adminDivisionsQuery({ status: 'active' }));
  const access = accessPayload(draft);
  const changed = access.role !== base.role || access.divisionId !== base.divisionId;
  const endpoint = `/api/admin/users/${encodeURIComponent(user.id)}`;
  const write = useMutation({
    mutationFn: (requested: AccountAction) => api<AdminUser>(endpoint, {
      method: requested === 'revoke' ? 'DELETE' : 'PATCH',
      body: JSON.stringify(requested === 'revoke' ? { version: base.version } : { ...access, version: base.version }),
    }),
    onSuccess: (record) => {
      setBase(record);
      setDraft({ role: record.role, divisionId: record.divisionId ?? '' });
      cache.setQueryData(['admin', 'users', 'detail', record.id], record);
      void cache.invalidateQueries({ queryKey: ['admin'] });
      setAction(undefined);
    },
    onError: (error) => {
      if (error instanceof ApiError) setFields(error.fields);
      setAction(undefined);
    },
  });

  function confirmUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || write.isPending) return;
    if (access.role === 'member' && !access.divisionId) {
      setFields({ divisionId: 'Pilih divisi pengguna.' });
      return;
    }
    write.reset();
    setAction('update');
  }

  const chosenDivision = divisions.data?.find(({ id }) => id === access.divisionId)?.name;
  const revoked = base.status === 'revoked';
  return (
    <form className="mgmt-panel mgmt-access-form" onSubmit={confirmUpdate} noValidate>
      <h2>Hak Akses</h2>
      <div className="mgmt-form-fields">
        <AccessFields value={draft} divisions={divisions.data ?? []} errors={fields} disabled={revoked || write.isPending}
          onChange={(value) => { setDraft(value); setFields({}); }} />
      </div>
      {write.isError && <ManagementAlert>{write.error.message}</ManagementAlert>}
      {revoked ? <p className="mgmt-access-note" role="status">Akses pengguna telah dicabut.</p> : (
        <div className="mgmt-actions">
          <button className="mgmt-button mgmt-primary" type="submit" disabled={!changed || write.isPending}>Simpan perubahan</button>
          <button className="mgmt-button mgmt-outline" type="button" disabled={write.isPending} onClick={() => { write.reset(); setAction('revoke'); }}>Cabut akses</button>
        </div>
      )}
      {action && (
        <ManagementConfirm
          title={action === 'revoke' ? `Cabut akses ${userDisplayName(user)}?` : 'Simpan perubahan akses?'}
          description={action === 'revoke' ? 'Sesi aktif akan ditutup.' : `${userDisplayName(user)}, ${roleNames[base.role]}${base.divisionName ? ` · ${base.divisionName}` : ''} → ${roleNames[draft.role]}${chosenDivision ? ` · ${chosenDivision}` : ''}.`}
          icon={action === 'revoke' ? LockKeyhole : UsersRound}
          confirm={action === 'revoke' ? 'Cabut akses' : 'Konfirmasi perubahan'} warning={action === 'revoke'}
          busy={write.isPending} onClose={() => setAction(undefined)} onConfirm={() => write.mutate(action)} />
      )}
    </form>
  );
}
