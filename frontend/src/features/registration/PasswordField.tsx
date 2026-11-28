import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useState } from 'react';

export function PasswordField({ confirm = false, disabled = false }: { confirm?: boolean; disabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  const id = confirm ? 'registration-confirm' : 'registration-password';
  return <div className="registration-field">
    <label htmlFor={id}>{confirm ? 'Konfirmasi kata sandi' : 'Kata sandi'}</label>
    <div className="registration-input">
      <LockKeyhole aria-hidden="true" />
      <input id={id} name={confirm ? 'confirm' : 'password'} type={visible ? 'text' : 'password'}
        autoComplete="new-password" minLength={8} maxLength={128} required disabled={disabled}
        placeholder={confirm ? 'Ulangi kata sandi' : 'Buat kata sandi'} />
      <button type="button" aria-label={(visible ? 'Sembunyikan' : 'Tampilkan') + (confirm ? ' konfirmasi kata sandi' : ' kata sandi')}
        onClick={() => setVisible(!visible)}><>{visible ? <EyeOff /> : <Eye />}</></button>
    </div>
    {!confirm && <small>Minimal 8 karakter</small>}
  </div>;
}
