import { Check, UserRoundPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Brand } from '../../shared/brand';
import './registration.css';

export function RegistrationShell({ step = 1, title, subtitle, children, compact = false, showSteps = true }: {
  step?: number; title: string; subtitle: string; children: ReactNode; compact?: boolean; showSteps?: boolean;
}) {
  return <main className={'registration-shell' + (compact ? ' registration-shell--form' : '')}>
    <Brand to="/login" />
    <div className="registration-content">
      {showSteps && <ol className="registration-steps" aria-label="Tahapan pendaftaran">
        {['Data akun', 'Perangkat', 'Pasang'].map((label, index) => <li key={label}
          aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'active' : ''}>
          <span>{step > index + 1 ? <Check aria-hidden="true" /> : index + 1}</span>{label}
        </li>)}
      </ol>}
      <header className="registration-intro">
        {compact && <span className="registration-intro-icon"><UserRoundPlus aria-hidden="true" /></span>}
        <div><h1>{title}</h1><p>{compact ? <><span className="registration-desktop-label">Gunakan email perusahaan untuk terdaftar.</span>
          <span className="registration-mobile-label">{subtitle}</span></> : subtitle}</p></div>
      </header>
      {children}
    </div>
  </main>;
}
