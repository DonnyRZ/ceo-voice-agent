import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../../shared/api';
import { FieldError } from '../users/AccessFields';
import { ManagementAlert } from '../users/management-ui';
import type { AdminDivision } from './division-data';

export function DivisionForm({ division, onArchive }: { division?: AdminDivision; onArchive?: () => void }) {
  const nameId = useId();
  const descriptionId = useId();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [version, setVersion] = useState(division?.version);
  const [name, setName] = useState(division?.name ?? '');
  const [description, setDescription] = useState(division?.description ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const archived = division?.status === 'archived';
  const mutation = useMutation({
    mutationFn: () => api<AdminDivision>(division ? `/api/admin/divisions/${encodeURIComponent(division.id)}` : '/api/admin/divisions', {
      method: division ? 'PATCH' : 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), version }),
    }),
    onSuccess: (updated) => {
      setSaved(true);
      setName(updated.name);
      setDescription(updated.description);
      setVersion(updated.version);
      cache.setQueryData<AdminDivision>(['admin', 'divisions', 'detail', updated.id], (previous) => ({ ...previous, ...updated }));
      void cache.invalidateQueries({ queryKey: ['admin'] });
      if (!division) navigate(`/admin/divisions/${updated.id}`, { replace: true });
    },
    onError: (error) => { if (error instanceof ApiError) setFields(error.fields); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (archived || mutation.isPending) return;
    const invalid: Record<string, string> = {};
    if (!name.trim()) invalid.name = 'Masukkan nama divisi.';
    if (!description.trim()) invalid.description = 'Masukkan deskripsi divisi.';
    setFields(invalid);
    setSaved(false);
    if (!Object.keys(invalid).length) mutation.mutate();
  }

  function reset() {
    mutation.reset();
    setFields({});
    setSaved(false);
    setName(division?.name ?? '');
    setDescription(division?.description ?? '');
    setVersion(division?.version);
  }

  const saveFailed = mutation.isError && !Object.values(fields).some(Boolean);
  return (
    <form className={`mgmt-panel mgmt-division-form${division ? ' mgmt-division-edit-form' : ' mgmt-division-create-form'}`} onSubmit={submit} noValidate>
      {saveFailed && <div className="mgmt-division-save-error"><ManagementAlert><strong>Perubahan belum tersimpan.</strong><p>{mutation.error.message}</p></ManagementAlert></div>}
      <div className="mgmt-form-fields">
        <div className="mgmt-field">
          <label htmlFor={nameId}>Nama divisi{!division && <span className="mgmt-field-required" aria-hidden="true">*</span>}</label>
          <input id={nameId} value={name} maxLength={120} placeholder="Masukkan nama divisi" readOnly={archived} required
            aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? `${nameId}-error` : undefined}
            onChange={(event) => { setName(event.target.value); setSaved(false); setFields((old) => ({ ...old, name: '' })); }} />
          <FieldError id={`${nameId}-error`} message={fields.name} />
        </div>
        <div className="mgmt-field">
          <label htmlFor={descriptionId}>Deskripsi{!division && <span className="mgmt-field-required" aria-hidden="true">*</span>}</label>
          <textarea id={descriptionId} value={description} maxLength={2000} rows={3} placeholder="Masukkan deskripsi divisi"
            readOnly={archived} required aria-invalid={Boolean(fields.description)} aria-describedby={fields.description ? `${descriptionId}-error` : undefined}
            onChange={(event) => { setDescription(event.target.value); setSaved(false); setFields((old) => ({ ...old, description: '' })); }} />
          <FieldError id={`${descriptionId}-error`} message={fields.description} />
        </div>
      </div>
      {saved && <p className="mgmt-division-saved" role="status">Perubahan tersimpan.</p>}
      {!archived && (
        <div className="mgmt-actions">
          <button className="mgmt-button mgmt-primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? <span className="loading-inline" aria-live="polite"><span className="ui-spinner" aria-hidden="true" />Menyimpan</span> : saveFailed ? 'Coba simpan lagi' : division ? 'Simpan perubahan' : 'Simpan divisi'}
          </button>
          {!division ? <Link className="mgmt-button mgmt-outline" to="/admin/divisions">Batal</Link> : saveFailed ? (
            <button className="mgmt-button mgmt-outline" type="button" onClick={reset}>Batal</button>
          ) : (
            <button className="mgmt-button mgmt-outline" type="button" onClick={onArchive} disabled={!onArchive || mutation.isPending}>
              <Archive aria-hidden="true" />Arsipkan divisi
            </button>
          )}
        </div>
      )}
    </form>
  );
}
