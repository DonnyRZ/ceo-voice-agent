import { useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Brand } from '../../shared/brand';
import { sessionQuery } from '../../shared/session';
import { LoginForm } from './LoginForm';
import { loginDestination } from './login-destination';
import './auth.css';
import './auth-mobile.css';

export function LoginPage() {
  const session = useQuery(sessionQuery);
  const location = useLocation();
  if (session.data) return <Navigate to={loginDestination(session.data, location.state?.from?.pathname)} replace />;

  return (
    <main className="auth-shell">
      <Brand to="/login" />
      <section className="auth-card" aria-labelledby="login-title">
        <header className="auth-intro">
          <span className="auth-intro-icon"><BriefcaseBusiness aria-hidden="true" /></span>
          <div>
            <h1 id="login-title">Masuk ke Ruang Kerja</h1>
            <p>Gunakan email perusahaan untuk masuk.</p>
          </div>
        </header>
        <LoginForm />
        <div className="auth-register"><p>Belum punya akun?</p><Link className="ui-button ui-button--outline" to="/register">Daftar Anggota Divisi</Link></div>
      </section>
    </main>
  );
}
