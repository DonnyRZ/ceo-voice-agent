import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Layers, LockKeyhole, Shield, ShieldCheck, UsersRound } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Brand } from '../../shared/brand';
import { sessionQuery } from '../../shared/session';
import { LoginForm } from './LoginForm';
import { loginDestination } from './login-destination';
import './auth.css';
import './auth-mobile.css';
import './superadmin-login.css';

export function SuperadminLoginPage() {
  const session = useQuery(sessionQuery);
  const location = useLocation();
  if (session.data) return <Navigate to={loginDestination(session.data, location.state?.from?.pathname)} replace />;
  return (
    <main className="superadmin-login">
      <header className="superadmin-login-header">
        <Brand to="/superadmin" />
        <span className="superadmin-portal"><Shield aria-hidden="true" />Portal Superadmin</span>
      </header>
      <section className="superadmin-login-panel" aria-labelledby="superadmin-login-title">
        <aside className="superadmin-login-intro">
          <p className="superadmin-login-eyebrow"><ShieldCheck aria-hidden="true" />Administrasi Ruang Kerja</p>
          <h2>Kelola ruang kerja<br />dengan tenang.</h2>
          <p>Satu portal untuk mengelola pengguna, divisi, dan akses aplikasi.</p>
          <ul>
            <li><UsersRound aria-hidden="true" />Kelola pengguna</li>
            <li><Layers aria-hidden="true" />Atur divisi</li>
            <li><ShieldCheck aria-hidden="true" />Pantau audit aktivitas</li>
          </ul>
        </aside>
        <div className="superadmin-login-content">
          <div className="superadmin-login-heading">
            <span className="superadmin-shield"><ShieldCheck aria-hidden="true" /></span>
            <h1 id="superadmin-login-title">Masuk Superadmin</h1>
            <p>Gunakan akun Superadmin untuk melanjutkan.</p>
          </div>
          <div className="superadmin-login-form">
            <LoginForm superadmin />
            <p className="superadmin-login-note"><LockKeyhole aria-hidden="true" />Khusus akun Superadmin.</p>
            <Link to="/login" className="superadmin-login-back"><ArrowLeft aria-hidden="true" />Kembali ke login pengguna</Link>
          </div>
        </div>
      </section>
      <footer>Ruang Kerja · Portal administrasi</footer>
    </main>
  );
}
