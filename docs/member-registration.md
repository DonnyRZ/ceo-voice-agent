# Registrasi Anggota Divisi dan pemasangan aplikasi

## Kebijakan akun

Keputusan pemilik pada 28 November 2026: registrasi mandiri hanya untuk Anggota Divisi; email perusahaan yang diizinkan saat ini adalah `egiresources.com`. Setelah verifikasi email, akun langsung aktif pada divisi yang dipilih, tanpa antrean persetujuan Superadmin. CEO dan Superadmin tetap melalui undangan.

Backend membaca daftar domain dari `REGISTRATION_EMAIL_DOMAINS` (dipisahkan koma). Pencocokan domain harus sama persis; subdomain dan domain yang menyerupai perusahaan tidak otomatis diizinkan. Dropdown hanya memuat ID/nama divisi aktif. Divisi diperiksa lagi ketika verifikasi dijalankan.

Data pendaftaran disimpan di tabel privat dengan RLS, terpisah dari akun aktif. Kata sandi di-hash memakai Better Auth; token email dan klaim progres browser disimpan sebagai hash. Akun, kredensial Better Auth, akses member, dan anggota divisi dibuat dalam satu transaksi setelah verifikasi. Peran member merupakan konstanta backend. Input tambahan seperti peran ditolak. Penyimpanan sementara token/kredensial dibersihkan setelah aktivasi; permintaan kedaluwarsa dibersihkan pada pendaftaran berikutnya.

Tautan verifikasi berlaku 24 jam, sekali pakai, dan memakai fragment agar token tidak masuk log URL HTTP. Halaman menghapus fragment sebelum interaksi; tombol konfirmasi mengirim token lewat POST. Status pendaftaran hanya bisa dibaca memakai cookie progres HttpOnly, host-only, SameSite Strict, Secure dengan awalan __Host- dan Path=/ pada HTTPS agar cookie domain induk tidak dapat menggantikannya. Klaim ini bukan sesi login dan tidak memberi akses data divisi.

SMTP memakai konfigurasi server yang sama dengan undangan. Kegagalan pengiriman ditampilkan sebagai gagal, bukan sukses. Pengiriman ulang milik pemegang klaim dibatasi satu menit dan maksimal lima pengiriman dalam masa pendaftaran, serta mengganti token lama. Pembatasan tambahan berada di PostgreSQL dan berlaku lintas proses/slot aplikasi. Endpoint tidak mencatat isi kata sandi, token, alamat email, atau balasan SMTP.

## Halaman dan alur

- `/login`: pintu masuk Daftar Anggota Divisi; login Superadmin tetap terpisah.
- `/register`: nama, email, divisi, kata sandi, dan konfirmasi. Kedua viewport memakai Simpan dan lanjut; penyimpanan tidak mengirim email dan langsung membuka langkah verifikasi.
- `/register/check-email`: tombol Kirim email verifikasi, instruksi inbox/spam, menunggu, kegagalan, hitung mundur kirim ulang, dan kelanjutan setelah verifikasi.
- `/register/verify`: konfirmasi tautan email, termasuk tautan hilang/tidak berlaku.
- `/onboarding`: pilihan perangkat, Android, atau panduan Safari. Hanya tersedia setelah verifikasi untuk pendaftaran yang dimulai di HP. URL langsung tidak melewati gerbang ini.
- `/launch`: jika benar-benar standalone, arahkan ke login/dashboard sesuai sesi. Jika masih tab browser, tampilkan petunjuk membuka ikon; jangan mengaku sudah membuka aplikasi.

Jenis alur (`originDevice`: mobile/desktop) ditangkap pada Simpan dan lanjut, divalidasi, serta disimpan pada browser pendaftaran melalui klaim privat. Nilai yang sudah tercatat tidak berubah saat viewport diubah atau email dibuka pada perangkat lain. Verifikasi pada browser yang sama kembali ke status privat; pada browser lain tidak memberikan klaim pendaftaran. Asal mobile menampilkan arahan kembali ke HP/browser asal, dan halaman asal mendeteksi verifikasi melalui polling sehingga Lanjutkan aktif. Asal desktop menampilkan Registrasi selesai dan Masuk. Email terverifikasi mengaktifkan akun; onboarding HP masih memiliki langkah pemasangan.

Pengiriman pertama dan ulang memakai POST `/api/registration/send-email`, dengan maksimal lima pengiriman dan jeda satu menit setelah percobaan. Endpoint `/api/registration/resend` telah dihapus. Respons status menyertakan sisa jeda berdasarkan waktu server agar hitung mundur tidak bergantung pada kesamaan jam perangkat. Email multipart memiliki tombol HTML bertautan HTTPS, logo CID yang tersedia offline dalam image runtime, dan teks alternatif aksesibel.

Pendaftaran yang sudah ada sebelum revisi tidak memiliki metadata perangkat; hasil verifikasinya memberikan arahan umum kembali ke browser asal, tanpa menebak HP/desktop. Akun dan data lama tidak dihapus. Bila formulir pending diedit ulang dari browser pemilik, konteks baru diinisialisasi dan email verifikasi perlu dikirim ulang. Migrasi dan primitif penyimpanan/aktivasi yang masih dipakai dipertahankan; tidak ada jalur runtime ke UI otomatis kirim atau pemasangan sebelum verifikasi.

Mengganti email draft dari browser asal dilakukan dalam transaksi yang sama: draft pending dan tautan lama dinonaktifkan hanya jika pengganti berhasil disimpan. Konflik email membatalkan transaksi sehingga draft lama tetap dapat digunakan. Asal perangkat draft dipertahankan; akun yang sudah aktif tidak dihapus.

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
- PostgreSQL: `backend/db/pgtap.sql`, 95 pemeriksaan.
- Unit frontend: `npm run test:frontend`; termasuk siklus prompt, timeout, pembatalan, respons lama, dan bukti aplikasi yang tepat.
- End-to-end: `npm run test:e2e`; registrasi mengirim email sungguhan ke Mailpit lokal, mengaktifkan akun, lalu login dan memeriksa akses.
- Visual: `npm run test:ui-audit`, matriks desktop/mobile termasuk setiap rute baru, validasi, email gagal, loading, kosong, panduan iPhone, serta kondisi pemasangan yang disimulasikan secara eksplisit.
- Pemasangan desktop nyata: `DISPLAY=:nomor PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/chromium node scripts/pwa-install-smoke.mjs`. Memerlukan display lokal dan server pengujian. Memasang pada profil sementara, memilih preferensi membuka sebagai jendela, mengecek deteksi aplikasi sendiri, meluncurkan jendela standalone, dan menghapus instalasi pengujian. Bukan bagian jalur deployment.
- Bukti lokal berada di `test-results/` dan diabaikan Git. Pemeriksaan desktop/viewport mobile tidak menggantikan uji WebAPK Android dan Add to Home Screen Safari pada perangkat nyata.

### Hasil versi sebelum revisi verifikasi, 28 November 2026

- Backend 267/267, pgTAP 85/85, unit frontend 15/15, serta tes alat deployment 68/68 lulus. Typecheck, build frontend dan build server lulus.
- Regresi browser lengkap lulus 98/98; setelah penambahan pemulihan offline dan kegagalan sesi, seluruh 12 kasus registrasi diperiksa ulang dan lulus. Gabungannya mencakup 102 kasus fungsional unik desktop/mobile. Enam kasus laporan Superadmin diperiksa ulang setelah perbaikan jarak filter dan lulus.
- Seluruh 512 kasus visual unik lulus. Sebanyak 793 capture final dan 718 gambar unik ditinjau, dengan hasil ukuran dan hash tersimpan dalam bukti lokal. Lihat [cakupan audit UI](ui-consistency.md).
- Pemasangan PWA nyata pada Chromium desktop terhadap build produksi lokal berhasil: manifest diterima, aplikasi sendiri terdeteksi, dan peluncuran native membuka jendela standalone ke login. Tautan dari onboarding pada platform ini membuka panduan manual; hasil tersebut tidak diklaim sebagai keberhasilan membuka aplikasi terpasang. Bukti: `test-results/pwa-native/evidence.json`.
- Pemasangan dan pembukaan pada Android WebAPK dan Safari iPhone asli belum diverifikasi. Preview HTTPS yang dapat dibuka dari HP diperlukan untuk pemeriksaan itu. Preview menggunakan database pengujian tersendiri, AI dinonaktifkan, dan email ditangkap Mailpit lokal; hasil ini tidak membuktikan pengiriman SMTP perusahaan.

Setelah HTTP Preview ternyata tidak tersedia pada environment chat, pemilik memilih staging untuk pengujian perangkat asli. Perubahan yang sudah lolos pemeriksaan lokal masuk melalui PR ke `develop`, lalu deployment stage yang sudah ada. Pemasangan Android/iPhone asli tetap berstatus belum diverifikasi sampai diuji di `https://ceo-stage.egiresources.com`; hasil desktop tidak menggantikannya. Tidak ada promosi ke `main` dalam tahap ini.

## Revisi langkah verifikasi email, 28 November 2026

- Sebanyak 28 mockup dibuat dengan ImageGen, satu layar per gambar, mencakup formulir/progres, email HTML, langkah verifikasi, hasil lintas perangkat, kondisi gagal, dan penyesuaian progres panduan pemasangan. Pemilik secara eksplisit mengizinkan pembuatan mockup dilanjutkan implementasi dalam tugas ini.
- Halaman verifikasi gabungan lama dan endpoint kirim ulang lama dihapus. Frontend hanya memakai alur kirim email eksplisit, konfirmasi, lalu kelanjutan sesuai asal pendaftaran. Aturan penggantian implementasi dan persetujuan UI baru diperluas di `agents/`.
- Backend 276/276 dan pgTAP 95/95 lulus. Regresi seluruh aplikasi 104/104 lulus; setelah perbaikan penggantian draft, 14/14 kasus registrasi dijalankan lagi pada build produksi lokal dan lulus. Ini mencakup pengiriman SMTP nyata ke Mailpit, tombol HTML, verifikasi dari browser lain, polling browser asal, konfirmasi pada browser asal, reload, larangan bypass pemasangan, login, dan isolasi peran.
- Audit UI mencakup 43 rute dengan 522/522 kasus unik desktop/mobile lulus. Sebanyak 833 capture final (410 desktop, 423 mobile), 742 gambar unik, dan seluruh bagian halaman panjang telah ditinjau. Tidak ada capture final yang belum direview; bukti hash/pengukuran tersimpan di `test-results/registration-verification-complete/visual-review.json`, diabaikan Git. Audit sempat terhenti karena disk lokal penuh saat build container; 406 kasus lulus dipertahankan, sisa kasus dan status verifikasi terbaru dijalankan kembali hingga seluruh matriks lulus.
- Uji native PWA desktop pada build revisi berhasil: manifest diterima, instalasi dan deteksi aplikasi sendiri berhasil, peluncuran native membuka jendela standalone ke login. Tombol tautan onboarding pada platform Linux ini membuka panduan manual dengan jujur; tidak diklaim selalu berhasil beralih otomatis ke aplikasi terpasang.
- Android/iPhone asli dan tampilan email di klien perusahaan tetap perlu diperiksa di staging. Pengiriman SMTP perusahaan sudah dilaporkan berhasil oleh engineer pada versi sebelumnya; pengujian revisi lokal memakai Mailpit, bukan inbox produksi.

## Rujukan platform

- [Chrome — mendeteksi aplikasi sendiri yang terpasang](https://developer.chrome.com/docs/capabilities/get-installed-related-apps)
- [web.dev — perbedaan persetujuan dan pemasangan WebAPK](https://web.dev/learn/pwa/detection)
- [Chrome — navigasi dan penangkapan tautan aplikasi](https://developer.chrome.com/docs/capabilities/pwa-navigation-management)
- [Apple — menggunakan situs sebagai aplikasi di iPhone](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)
