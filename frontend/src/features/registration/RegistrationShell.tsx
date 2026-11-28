import { Check, UserRoundPlus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Brand } from '../../shared/brand';
import './registration.css';

export function RegistrationShell({ step = 1, title, subtitle, children, compact = false, showSteps = true,
  flow = 'responsive', joined = compact, icon: Icon = UserRoundPlus }: {
  step?: number; title: string; subtitle: string; children: ReactNode; compact?: boolean; showSteps?: boolean;
  flow?: 'responsive' | 'mobile' | 'desktop'; joined?: boolean; icon?: LucideIcon;
}) {
  return <main className={'registration-shell' + (compact ? ' registration-shell--form' : '')}>
    <Brand to="/login" />
    <div className="registration-content">
      {showSteps && <ol className={'registration-steps registration-steps--' + flow} aria-label="Tahapan pendaftaran">
        {(flow === 'desktop' ? ['Data akun', 'Verifikasi'] : ['Data akun', 'Verifikasi', 'Perangkat', 'Pasang']).map((label, index) => <li key={label}
          aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'active' : ''}>
          <span>{step > index + 1 ? <Check aria-hidden="true" /> : index + 1}</span>{label}
        </li>)}
      </ol>}
      <div className={joined ? 'registration-panel' : undefined}>
      <header className="registration-intro">
        {joined && <span className="registration-intro-icon"><Icon aria-hidden="true" /></span>}
        <div><h1>{title}</h1><p>{compact ? <><span className="registration-desktop-label">Gunakan email perusahaan untuk terdaftar.</span>
          <span className="registration-mobile-label">{subtitle}</span></> : subtitle}</p></div>
      </header>
      {children}
      </div>
    </div>
  </main>;
}
