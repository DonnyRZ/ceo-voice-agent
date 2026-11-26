import type { WorkStatus } from '../modules/work-status.js';

export const it = 'ea0e00b0-201c-4000-8000-000000000001';
export const finance = 'ea0e00b0-201c-4000-8000-000000000002';
const mobile = 'ea0e00b0-301c-4000-8000-000000000001';
const sso = 'ea0e00b0-301c-4000-8000-000000000002';
const infrastructure = 'ea0e00b0-301c-4000-8000-000000000003';
const monthlyClose = 'ea0e00b0-301c-4000-8000-000000000004';

export const divisions = [[it, 'IT'], [finance, 'Finance']];
export const users = [
  { name: 'Doni', email: 'doni@ruangkerja.test', divisionId: it },
  { name: 'Hakim', email: 'hakim@ruangkerja.test', divisionId: it },
  { name: 'Laura', email: 'laura@ruangkerja.test', divisionId: finance },
  { name: 'Vanah', email: 'vanah@ruangkerja.test', divisionId: finance },
];

export const projects: Array<[string, string, string, string, WorkStatus]> = [
  [mobile, it, 'Aplikasi A Mobile', 'Aplikasi internal untuk akses layanan di HP.', 'on_progress'],
  [sso, it, 'Integrasi Sistem SSO', 'Penyatuan login untuk sistem internal perusahaan.', 'on_progress'],
  [infrastructure, it, 'Upgrade Infrastruktur', 'Peningkatan kapasitas dan pemantauan server.', 'pending'],
  [monthlyClose, finance, 'Penutupan Buku November', 'Rekonsiliasi laporan keuangan bulanan.', 'on_progress'],
];

export const firstTaskId = seededTaskId(1);
export const tasks: Array<[number, string, string, string, string, string, WorkStatus]> = [
  [1, it, '2026-11-26', 'Validasi alur login', 'Uji akses dan pesan gagal.', mobile, 'pending'],
  [2, it, '2026-11-25', 'Uji notifikasi', 'Periksa notifikasi di HP.', mobile, 'done'],
  [3, it, '2026-11-24', 'Integrasi autentikasi', 'Hubungkan aplikasi dengan sistem SSO.', sso, 'on_progress'],
  [4, it, '2026-11-23', 'Jadwalkan perawatan server', 'Koordinasikan waktu pemeliharaan.', infrastructure, 'pending'],
  [5, it, '2026-11-21', 'Cek ketersediaan server', 'Periksa kapasitas lingkungan produksi.', infrastructure, 'done'],
  [6, it, '2026-11-20', 'Dokumentasi alur SSO', 'Tulis langkah integrasi untuk tim.', sso, 'done'],
  [7, it, '2026-11-18', 'Validasi akses SSO', 'Uji akses aplikasi internal.', sso, 'on_progress'],
  [8, it, '2026-11-16', 'Uji pemulihan backup', 'Periksa hasil pemulihan di lingkungan uji.', infrastructure, 'done'],
  [9, it, '2026-11-13', 'Perbarui alat pemantauan', 'Tinjau konfigurasi peringatan server.', infrastructure, 'pending'],
  [10, it, '2026-11-12', 'Inventaris aplikasi internal', 'Catat aplikasi yang siap diintegrasikan.', sso, 'done'],
  [11, finance, '2026-11-26', 'Rekonsiliasi transaksi', 'Cocokkan transaksi dengan buku besar.', monthlyClose, 'on_progress'],
];

export function seededTaskId(index: number) {
  return `ea0e00b0-401c-4000-8000-${String(index).padStart(12, '0')}`;
}
