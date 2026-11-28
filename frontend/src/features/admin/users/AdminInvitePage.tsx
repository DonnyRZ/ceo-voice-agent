import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../../shared/api';
import { adminDivisionsQuery } from '../divisions/division-data';
import { AccessFields, accessPayload, FieldError, type AccessDraft } from './AccessFields';
import { InvitationFailure, InvitationSuccess, RecentInvitations } from './InvitationPanels';
import { ManagementAlert, ManagementHeading, ManagementTaskStats } from './management-ui';
import { adminUsersQuery, type AdminUser } from './user-data';
import { useManagementTaskCounts } from './management-stats';
import './admin-invitation.css';

export function AdminInvitePage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const emailField = useRef<HTMLInputElement>(null);
  const [access, setAccess] = useState<AccessDraft>({ role: 'member', divisionId: params.get('divisionId') ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invitation, setInvitation] = useState<AdminUser>();
  const cache = useQueryClient();
  const divisions = useQuery(adminDivisionsQuery({ status: 'active' }));
  const users = useQuery(adminUsersQuery());
  const taskCounts = useManagementTaskCounts();
  const invite = useMutation({
    mutationFn: () => invitation
      ? api<AdminUser>(`/api/admin/invitations/${encodeURIComponent(invitation.id)}/retry`, {
        method: 'POST', body: JSON.stringify({ version: invitation.version }),
      })
      : api<AdminUser>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email: email.trim(), ...accessPayload(access) }) }),
    onSuccess: (record) => {
      setInvitation(record);
      cache.setQueryData(['admin', 'users', 'detail', record.id], record);
      void cache.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => { if (error instanceof ApiError) setErrors(error.fields); },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invite.isPending || divisions.isPending || divisions.isError) return;
    const invalid: Record<string, string> = {};
    if (!email.trim() || !emailField.current?.validity.valid) invalid.email = 'Masukkan email perusahaan yang valid.';
    if (access.role === 'member' && !access.divisionId) invalid.divisionId = 'Pilih divisi pengguna.';
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      if (invalid.email) emailField.current?.focus();
    } else {
      invite.mutate();
    }
  }

  if (invitation?.status === 'failed') {
    return <InvitationFailure invitation={invitation} counts={taskCounts} busy={invite.isPending} error={invite.error?.message}
      onRetry={() => invite.mutate()} />;
  }
  if (invitation) return <InvitationSuccess email={invitation.email} counts={taskCounts} />;

  return (
    <div className="mgmt-page mgmt-invite-page">
      <ManagementHeading title="Undang Pengguna" section="Pengguna" back="/admin/users" context="Undang Pengguna" />
      <div className="mgmt-invite-grid">
        <ManagementTaskStats counts={taskCounts} variant="mgmt-invite-stats" />
        <form className="mgmt-panel mgmt-invite-form" onSubmit={submit} noValidate>
          <div className="mgmt-form-fields">
            <div className="mgmt-field">
              <label htmlFor="invite-email">Email perusahaan<span className="mgmt-field-required" aria-hidden="true">*</span></label>
              <div className="mgmt-invite-email-control">
                <Mail aria-hidden="true" />
                <input id="invite-email" ref={emailField} type="email" placeholder="nama@perusahaan.co.id" maxLength={254} required value={email}
                  aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'invite-email-error' : undefined}
                  onChange={(event) => { setEmail(event.target.value); setErrors((old) => ({ ...old, email: '' })); if (invite.isError) invite.reset(); }} />
              </div>
              <FieldError id="invite-email-error" message={errors.email} />
            </div>
            <AccessFields value={access} onChange={(value) => { setAccess(value); setErrors((old) => ({ ...old, divisionId: '', role: '' })); }}
              divisions={divisions.data ?? []} errors={errors} required disabled={invite.isPending || divisions.isPending || divisions.isError} />
            {divisions.isPending && <p className="loading-inline" role="status"><span className="ui-spinner" aria-hidden="true" />Memuat divisi</p>}
            {divisions.isError && <ManagementAlert>Divisi belum dapat dimuat. <button type="button" className="mgmt-text-action" onClick={() => void divisions.refetch()}>Coba lagi</button></ManagementAlert>}
          </div>
          {invite.isError && !Object.values(errors).some(Boolean) && <ManagementAlert>{invite.error.message}</ManagementAlert>}
          <div className="mgmt-actions">
            <button className="mgmt-button mgmt-primary" type="submit" disabled={invite.isPending || divisions.isPending || divisions.isError}>
              {!invite.isPending && <Send aria-hidden="true" />}{invite.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Mengirim</span> : 'Kirim undangan'}
            </button>
            <Link className="mgmt-button mgmt-outline" to="/admin/users">Batal</Link>
          </div>
        </form>
      </div>
      <RecentInvitations users={users.data ?? []} pending={users.isPending} error={users.isError} onRetry={() => void users.refetch()} />
    </div>
  );
}
