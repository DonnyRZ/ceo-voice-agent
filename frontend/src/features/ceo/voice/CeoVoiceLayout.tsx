import { UserRound } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Brand } from '../../../shared/brand';
import './ceo-voice.css';

export function CeoVoiceLayout() {
  const { pathname } = useLocation();
  return (
    <div className="ceo-voice-layout">
      <a className="skip-link" href="#ceo-main">Ke konten utama</a>
      <header className="ceo-voice-header">
        <Brand to="/ceo/voice" />
        {pathname === '/ceo/account'
          ? <Link className="ceo-voice-account" to="/ceo/voice">Sesi suara</Link>
          : <Link className="ceo-voice-account" to="/ceo/account"><UserRound aria-hidden="true" />Akun</Link>}
      </header>
      <main className="ceo-voice-main" id="ceo-main" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
