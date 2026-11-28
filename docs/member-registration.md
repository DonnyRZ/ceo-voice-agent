# Registrasi Anggota Divisi dan pemasangan aplikasi

## Kebijakan akun

Keputusan pemilik pada 28 November 2026: registrasi mandiri hanya untuk Anggota Divisi; email perusahaan yang diizinkan saat ini adalah `egiresources.com`. Setelah verifikasi email, akun langsung aktif pada divisi yang dipilih, tanpa antrean persetujuan Superadmin. CEO dan Superadmin tetap melalui undangan.

Backend membaca daftar domain dari `REGISTRATION_EMAIL_DOMAINS` (dipisahkan koma). Pencocokan domain harus sama persis; subdomain dan domain yang menyerupai perusahaan tidak otomatis diizinkan. Dropdown hanya memuat ID/nama divisi aktif. Divisi diperiksa lagi ketika verifikasi dijalankan.

Data pendaftaran disimpan di tabel privat dengan RLS, terpisah dari akun aktif. Kata sandi di-hash memakai Better Auth; token email dan klaim progres browser disimpan sebagai hash. Akun, kredensial Better Auth, akses member, dan anggota divisi dibuat dalam satu transaksi setelah verifikasi. Peran member merupakan konstanta backend. Input tambahan seperti peran ditolak. Penyimpanan sementara token/kredensial dibersihkan setelah aktivasi; permintaan kedaluwarsa dibersihkan pada pendaftaran berikutnya.

Tautan verifikasi berlaku 24 jam, sekali pakai, dan memakai fragment agar token tidak masuk log URL HTTP. Halaman menghapus fragment sebelum interaksi; tombol konfirmasi mengirim token lewat POST. Status pendaftaran hanya bisa dibaca memakai cookie progres HttpOnly, host-only, SameSite Strict, Secure dengan awalan __Host- dan Path=/ pada HTTPS agar cookie domain induk tidak dapat menggantikannya. Klaim ini bukan sesi login dan tidak memberi akses data divisi.

SMTP memakai konfigurasi server yang sama dengan undangan. Kegagalan pengiriman ditampilkan sebagai gagal, bukan sukses. Pengiriman ulang milik pemegang klaim dibatasi satu menit dan maksimal lima pengiriman dalam masa pendaftaran, serta mengganti token lama. Pembatasan tambahan berada di PostgreSQL dan berlaku lintas proses/slot aplikasi. Endpoint tidak mencatat isi kata sandi, token, alamat email, atau balasan SMTP.

## Halaman dan alur

- `/login`: pintu masuk Daftar Anggota Divisi; login Superadmin tetap terpisah.
- `/register`: nama, email, divisi, kata sandi, dan konfirmasi. Desktop memakai Daftar; mobile Simpan dan lanjut.
- `/register/check-email`: status verifikasi, kegagalan pengiriman, dan kirim ulang.
- `/register/verify`: konfirmasi tautan email, termasuk tautan hilang/tidak berlaku.
- `/onboarding`: pilihan perangkat, Android, atau panduan Safari. Data akun disimpan sebelum masuk alur ini; pemasangan tidak mengaktifkan akses tanpa verifikasi email.
- `/launch`: jika benar-benar standalone, arahkan ke login/dashboard sesuai sesi. Jika masih tab browser, tampilkan petunjuk membuka ikon; jangan mengaku sudah membuka aplikasi.

Kembali ke data akun mempertahankan nama/email/divisi selama tab masih hidup. Kata sandi tidak disimpan dalam localStorage, sessionStorage, atau URL. Pengguna bisa melanjutkan data yang sudah tersimpan melalui tautan progres.

Ukuran mengikuti token CSS aplikasi: logo 220/180 px, judul 32/28 px, teks dan kontrol 16 px, kontrol 48 px, serta kategori ikon yang sama dengan halaman lain. Sumber desain: [indeks mockup](../mockup/README.md). Logo di dalam kartu loading dihilangkan sesuai revisi; logo header tetap ada.

## Perilaku pemasangan yang benar-benar tersedia

Aplikasi menyediakan manifest dengan identitas per origin, ikon PNG 192/512 px dari logo ImageGen yang disetujui, mode standalone, serta service worker terbatas pada aset publik dan halaman offline. Ekspor ukuran ikon merupakan resize teknis yang diizinkan pemilik; desain logo tidak diganti.

Android:
1. Simpan event `beforeinstallprompt`; tampilkan tombol jika browser benar-benar menyediakan prompt.
2. Panggil prompt dalam klik pengguna. Pembatalan/kegagalan tidak dianggap selesai.
3. Persetujuan dan `appinstalled` memicu pemeriksaan; keduanya sendiri belum membuktikan WebAPK siap.
4. Tampilkan sukses hanya ketika aplikasi sendiri terdeteksi terpasang melalui Installed Related Apps atau sedang dibuka dalam mode standalone.
5. Pemeriksaan memiliki batas waktu dan jalan kembali. Browser yang tidak mendukung deteksi mendapatkan panduan manual, tanpa sukses palsu.
6. Buka Ruang Kerja mencoba tautan aplikasi di jendela baru. OS/browser dan preferensi pengguna menentukan penangkapan tautan. Jika tetap browser, halaman pembuka menyediakan petunjuk manual dari layar utama.

iPhone: pilih iPhone, buka Safari, Bagikan (atau Lainnya lalu Bagikan), Tambah ke Layar Utama, Buka sebagai aplikasi web jika tersedia, lalu Tambah. Pengguna membuka ikon secara manual. Tombol Sudah ditambahkan adalah pernyataan pengguna untuk melanjutkan panduan; Selesai menutup panduan. Tidak ada animasi pemasangan otomatis atau redirect yang dijanjikan.

Service worker tidak menyimpan respons API, sesi, HTML akun, timesheet, atau audio. HTTP gagal tetap gagal; halaman offline hanya menggantikan navigasi yang kehilangan jaringan.

## Pengujian

- Backend: `npm run test:backend`; mencakup verifikasi, RLS, domain, pembatasan percobaan, penolakan role, pengiriman gagal, divisi diarsipkan, serta replay/concurrency.
- PostgreSQL: `backend/db/pgtap.sql`, 85 pemeriksaan.
- Unit frontend: `npm run test:frontend`; termasuk siklus prompt, timeout, pembatalan, respons lama, dan bukti aplikasi yang tepat.
- End-to-end: `npm run test:e2e`; registrasi mengirim email sungguhan ke Mailpit lokal, mengaktifkan akun, lalu login dan memeriksa akses.
- Visual: `npm run test:ui-audit`, matriks desktop/mobile termasuk setiap rute baru, validasi, email gagal, loading, kosong, panduan iPhone, serta kondisi pemasangan yang disimulasikan secara eksplisit.
- Pemasangan desktop nyata: `DISPLAY=:nomor PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/chromium node scripts/pwa-install-smoke.mjs`. Memerlukan display lokal dan server pengujian. Memasang pada profil sementara, memilih preferensi membuka sebagai jendela, mengecek deteksi aplikasi sendiri, meluncurkan jendela standalone, dan menghapus instalasi pengujian. Bukan bagian jalur deployment.
- Bukti lokal berada di `test-results/` dan diabaikan Git. Pemeriksaan desktop/viewport mobile tidak menggantikan uji WebAPK Android dan Add to Home Screen Safari pada perangkat nyata.

### Hasil yang sudah diverifikasi, 28 November 2026

- Backend 267/267, pgTAP 85/85, unit frontend 15/15, serta tes alat deployment 68/68 lulus. Typecheck, build frontend dan build server lulus.
- Regresi browser lengkap lulus 98/98; setelah penambahan pemulihan offline dan kegagalan sesi, seluruh 12 kasus registrasi diperiksa ulang dan lulus. Gabungannya mencakup 102 kasus fungsional unik desktop/mobile. Enam kasus laporan Superadmin diperiksa ulang setelah perbaikan jarak filter dan lulus.
- Seluruh 512 kasus visual unik lulus. Sebanyak 793 capture final dan 718 gambar unik ditinjau, dengan hasil ukuran dan hash tersimpan dalam bukti lokal. Lihat [cakupan audit UI](ui-consistency.md).
- Pemasangan PWA nyata pada Chromium desktop terhadap build produksi lokal berhasil: manifest diterima, aplikasi sendiri terdeteksi, dan peluncuran native membuka jendela standalone ke login. Tautan dari onboarding pada platform ini membuka panduan manual; hasil tersebut tidak diklaim sebagai keberhasilan membuka aplikasi terpasang. Bukti: `test-results/pwa-native/evidence.json`.
- Pemasangan dan pembukaan pada Android WebAPK dan Safari iPhone asli belum diverifikasi. Preview HTTPS yang dapat dibuka dari HP diperlukan untuk pemeriksaan itu. Preview menggunakan database pengujian tersendiri, AI dinonaktifkan, dan email ditangkap Mailpit lokal; hasil ini tidak membuktikan pengiriman SMTP perusahaan.

Setelah HTTP Preview ternyata tidak tersedia pada environment chat, pemilik memilih staging untuk pengujian perangkat asli. Perubahan yang sudah lolos pemeriksaan lokal masuk melalui PR ke `develop`, lalu deployment stage yang sudah ada. Pemasangan Android/iPhone asli tetap berstatus belum diverifikasi sampai diuji di `https://ceo-stage.egiresources.com`; hasil desktop tidak menggantikannya. Tidak ada promosi ke `main` dalam tahap ini.

## Rujukan platform

- [Chrome — mendeteksi aplikasi sendiri yang terpasang](https://developer.chrome.com/docs/capabilities/get-installed-related-apps)
- [web.dev — perbedaan persetujuan dan pemasangan WebAPK](https://web.dev/learn/pwa/detection)
- [Chrome — navigasi dan penangkapan tautan aplikasi](https://developer.chrome.com/docs/capabilities/pwa-navigation-management)
- [Apple — menggunakan situs sebagai aplikasi di iPhone](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)
