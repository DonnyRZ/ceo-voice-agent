import { ChevronDown, Laptop, UsersRound } from 'lucide-react';
import { useId } from 'react';
import type { AdminDivision } from '../divisions/division-data';
import { roleNames, type AdminRole } from './user-data';

export interface AccessDraft {
  role: AdminRole;
  divisionId: string;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span className="mgmt-field-error" id={id} role="alert">{message}</span> : null;
}

export function AccessFields({ value, onChange, divisions, errors = {}, required = false, disabled = false }: {
  value: AccessDraft;
  onChange: (value: AccessDraft) => void;
  divisions: AdminDivision[];
  errors?: Record<string, string>;
  required?: boolean;
  disabled?: boolean;
}) {
  const roleId = useId();
  const divisionId = useId();
  const member = value.role === 'member';
  return (
    <>
      <div className="mgmt-field">
        <label htmlFor={roleId}>Peran{required && <span className="mgmt-field-required" aria-hidden="true">*</span>}</label>
        <div>
          <span className="mgmt-select-control">
            {required && <UsersRound className="mgmt-select-icon" aria-hidden="true" />}
            <select id={roleId} value={value.role} disabled={disabled} aria-invalid={Boolean(errors.role)} aria-describedby={errors.role ? `${roleId}-error` : undefined}
              onChange={(event) => onChange({ ...value, role: event.target.value as AdminRole })}>
              {Object.entries(roleNames).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
            <ChevronDown className="mgmt-select-chevron" aria-hidden="true" />
          </span>
          <FieldError id={`${roleId}-error`} message={errors.role} />
        </div>
      </div>
      <div className="mgmt-field">
        <label htmlFor={divisionId}>Divisi{required && member && <span className="mgmt-field-required" aria-hidden="true">*</span>}</label>
        <div>
          <span className="mgmt-select-control">
            {required && <Laptop className="mgmt-select-icon" aria-hidden="true" />}
            <select id={divisionId} value={member ? value.divisionId : ''} disabled={disabled || !member} required={member}
              aria-invalid={Boolean(errors.divisionId)} aria-describedby={errors.divisionId ? `${divisionId}-error` : undefined}
              onChange={(event) => onChange({ ...value, divisionId: event.target.value })}>
              <option value="">{member ? 'Pilih divisi' : 'Tanpa divisi'}</option>
              {divisions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
            <ChevronDown className="mgmt-select-chevron" aria-hidden="true" />
          </span>
          <FieldError id={`${divisionId}-error`} message={errors.divisionId} />
        </div>
      </div>
    </>
  );
}

export function accessPayload(value: AccessDraft) {
  return { role: value.role, divisionId: value.role === 'member' ? value.divisionId : null };
}
