# Registrasi Anggota Divisi dan pemasangan aplikasi

## Kebijakan akun

Keputusan pemilik pada 28 November 2026: registrasi mandiri hanya untuk Anggota Divisi; email perusahaan yang diizinkan saat ini adalah `egiresources.com`. Keputusan revisi: akun desktop aktif setelah konfirmasi email karena alur desktop selesai pada tahap itu. Akun mobile baru dibuat/aktif setelah langkah akhir onboarding, bukan langsung setelah verifikasi email. Tidak ada antrean persetujuan Superadmin. CEO dan Superadmin tetap melalui undangan.

Backend membaca daftar domain dari `REGISTRATION_EMAIL_DOMAINS` (dipisahkan koma). Pencocokan domain harus sama persis; subdomain dan domain yang menyerupai perusahaan tidak otomatis diizinkan. Dropdown hanya memuat ID/nama divisi aktif. Divisi diperiksa lagi ketika verifikasi dijalankan.

Data pendaftaran disimpan di tabel privat dengan RLS, terpisah dari akun aktif. Kata sandi di-hash memakai Better Auth; token email dan klaim progres browser disimpan sebagai hash. Akun, kredensial Better Auth, akses member, dan anggota divisi dibuat dalam satu transaksi saat registrasi selesai; email mobile yang sudah terverifikasi masih berada dalam penyimpanan privat sampai langkah akhir. Peran member merupakan konstanta backend. Input tambahan seperti peran ditolak. Penyimpanan sementara token/kredensial dibersihkan setelah aktivasi; permintaan kedaluwarsa dibersihkan pada pendaftaran berikutnya.

Tautan verifikasi berlaku 24 jam, sekali pakai, dan memakai fragment agar token tidak masuk log URL HTTP. Halaman menghapus fragment sebelum interaksi; tombol konfirmasi mengirim token lewat POST. Status pendaftaran hanya bisa dibaca memakai cookie progres HttpOnly, host-only, SameSite Strict, Secure dengan awalan __Host- dan Path=/ pada HTTPS agar cookie domain induk tidak dapat menggantikannya. Klaim ini bukan sesi login dan tidak memberi akses data divisi.

SMTP memakai konfigurasi server yang sama dengan undangan. Kegagalan pengiriman ditampilkan sebagai gagal, bukan sukses. Pengiriman ulang milik pemegang klaim dibatasi satu menit dan maksimal lima pengiriman dalam masa pendaftaran, serta mengganti token lama. Pembatasan tambahan berada di PostgreSQL dan berlaku lintas proses/slot aplikasi. Endpoint tidak mencatat isi kata sandi, token, alamat email, atau balasan SMTP.

## Halaman dan alur

- `/login`: pintu masuk Daftar Anggota Divisi; login Superadmin tetap terpisah.
- `/register`: nama, email, divisi, kata sandi, dan konfirmasi. Kedua viewport memakai Simpan dan lanjut; penyimpanan tidak mengirim email dan langsung membuka langkah verifikasi.
- `/register/check-email`: tombol Kirim email verifikasi, instruksi inbox/spam, menunggu, kegagalan, hitung mundur kirim ulang, dan kelanjutan setelah verifikasi.
- `/register/verify`: konfirmasi tautan email, termasuk tautan hilang/tidak berlaku.
- `/onboarding`: pilihan perangkat, Android, atau panduan Safari. Hanya tersedia setelah verifikasi untuk pendaftaran yang dimulai di HP. URL langsung tidak melewati gerbang ini.
- `/launch`: jika benar-benar standalone, lanjutkan registrasi yang masih pending terlebih dahulu; bila sudah selesai, arahkan ke login/dashboard sesuai sesi. Jika masih tab browser, tampilkan petunjuk membuka ikon; jangan mengaku sudah membuka aplikasi.

Jenis alur (`originDevice`: mobile/desktop) ditangkap pada Simpan dan lanjut, divalidasi, serta disimpan pada browser pendaftaran melalui klaim privat. Nilai yang sudah tercatat tidak berubah saat viewport diubah atau email dibuka pada perangkat lain. Verifikasi pada browser yang sama kembali ke status privat; pada browser lain tidak memberikan klaim pendaftaran. Asal mobile menampilkan arahan kembali ke HP/browser asal, dan halaman asal mendeteksi verifikasi melalui polling sehingga Lanjutkan aktif. Asal desktop menampilkan Registrasi selesai dan Masuk. Email terverifikasi tidak mengaktifkan akun baru mobile. Onboarding HP masih memiliki langkah pemasangan; akun hanya dibuat ketika penyelesaian diterima server.

Pengiriman pertama dan ulang memakai POST `/api/registration/send-email`, dengan maksimal lima pengiriman dan jeda satu menit setelah percobaan. Endpoint `/api/registration/resend` telah dihapus. Respons status menyertakan sisa jeda berdasarkan waktu server agar hitung mundur tidak bergantung pada kesamaan jam perangkat. Email multipart memiliki tombol HTML bertautan HTTPS, logo CID yang tersedia offline dalam image runtime, dan teks alternatif aksesibel.

Sebagian pendaftaran sebelum revisi tidak memiliki metadata perangkat; hasil verifikasinya memberikan arahan umum kembali ke browser asal, tanpa menebak HP/desktop. Akun dan data lama tidak dihapus. Bila formulir pending diedit ulang dari browser pemilik, konteks baru diinisialisasi dan email verifikasi perlu dikirim ulang. Migrasi dan primitif penyimpanan/aktivasi yang masih dipakai dipertahankan; tidak ada jalur runtime ke UI otomatis kirim atau pemasangan sebelum verifikasi.

Mengganti email draft dari browser asal dilakukan dalam transaksi yang sama: draft pending dan tautan lama dinonaktifkan hanya jika pengganti berhasil disimpan. Kegagalan penyimpanan membatalkan transaksi sehingga draft lama tetap dapat digunakan. Draft pending milik browser lain tidak dianggap akun aktif atau pengunci email. Asal perangkat draft dipertahankan; akun yang sudah aktif tidak dihapus.

Kembali ke data akun atau memuat ulang formulir mempertahankan nama/email/divisi melalui cache dengan allowlist eksplisit. Progres sesudah Simpan dan lanjut berada di server dan dapat dilanjutkan setelah tab ditutup atau hard refresh. Kata sandi tidak disimpan dalam localStorage, sessionStorage, atau URL. Pengguna bisa melanjutkan data yang sudah tersimpan melalui tautan progres.

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

iPhone: pilih iPhone, buka Safari, Bagikan (atau Lainnya lalu Bagikan), Tambah ke Layar Utama, Buka sebagai aplikasi web jika tersedia, lalu Tambah. Pengguna membuka ikon secara manual. Tombol Sudah ditambahkan adalah pernyataan pengguna untuk melanjutkan panduan; Selesai menyelesaikan registrasi dan aktivasi akun di server; kegagalan tetap mempertahankan langkah terakhir. Tidak ada animasi pemasangan otomatis atau redirect yang dijanjikan.

Service worker tidak menyimpan respons API, sesi, HTML akun, timesheet, atau audio. HTTP gagal tetap gagal; halaman offline hanya menggantikan navigasi yang kehilangan jaringan.

## Pengujian

- Backend: `npm run test:backend`; mencakup verifikasi, RLS, domain, pembatasan percobaan, penolakan role, pengiriman gagal, divisi diarsipkan, serta replay/concurrency.
- PostgreSQL: `backend/db/pgtap.sql`, 108 pemeriksaan.
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

## Pemulihan progres dan aktivasi akhir, 28 November 2026

Aturan terbaru menggantikan aktivasi langsung setelah verifikasi email mobile. Status privat menambahkan `completed` dan `step`; verifikasi mobile mengisi `verified`, menghapus token sekali pakai, dan memperpanjang progres hingga tujuh hari. Hash kata sandi tetap privat hingga akun dibuat, lalu dibersihkan. Desktop menyelesaikan aktivasi secara atomik bersama verifikasi email.

`POST /api/registration/progress` menyimpan tahap pemasangan. `POST /api/registration/complete` hanya menerima klaim pemilik yang terverifikasi dan tahap akhir yang sesuai. iPhone memakai konfirmasi pengguna pada tombol Selesai; Android memakai sinyal pemasangan/dibuka standalone dari browser. Ini adalah bukti klien, bukan attestation OS yang bisa dibuktikan kriptografis oleh server. Pengiriman sukses, klik verifikasi, atau timer tidak menyelesaikan onboarding mobile.

Browser asal membuka `/register` dan otomatis kembali ke tahap tersimpan. Tahap dari server mengungguli parameter URL tab lama, termasuk ketika registrasi sudah selesai. Tautan Sebelumnya menuju formulir memakai `?edit=1`. Browser baru yang kehilangan cookie dapat mengirim formulir dengan email/kata sandi yang sama; backend membandingkan hash, memindahkan klaim privat, dan mempertahankan tahap serta perangkat asal. Pemulihan dengan kredensial yang cocok tidak mengganti nama, divisi, atau kata sandi akun. Pemulihan melalui bukti email baru mengikuti aturan koreksi terbaru di bawah. Email saja atau kata sandi yang salah tidak boleh membaca/mengambil alih progres. Draft baru yang terisolasi tetap dapat dibuat untuk email yang belum memiliki akun; hanya penyelesaian yang mengunci pembuatan satu akun.

Draft lintas browser memiliki budget pengiriman email bersama, disimpan di PostgreSQL. Penolakan cooldown/budget membatalkan transaksi lease sehingga tautan sebelumnya tidak rusak. Completion bersifat idempoten dan serial per email, dengan pemeriksaan ulang divisi, undangan, serta peran member tetap konstan.

Aturan pemulihan terbaru di bawah menggantikan perilaku aktivasi akun lama. Akun dan riwayat tidak dihapus. Registrasi lama yang terverifikasi tetapi tidak memiliki penanda selesai mobile dapat dipulihkan dengan hash kata sandi akun yang cocok; Pemulihan dengan kredensial cocok mempertahankan ID akun, peran, divisi, dan kata sandinya; pemulihan melalui bukti email baru mengikuti koreksi di bawah. Akun yang sudah selesai tetap diarahkan ke login. Log terstruktur mencatat `registration.rejected` beserta alasan, `registration.resumed`, dan `registration.completed`, tanpa email, kata sandi, token, atau claim.

## Validasi pemulihan progres, 28 November 2026

- Backend 286/286, PostgreSQL/pgTAP 102/102, frontend 15/15, dan alat deployment 68/68 lulus; typecheck, build frontend/server, serta pemeriksaan cakupan 43 rute juga lulus.
- Regresi seluruh aplikasi terhadap database lokal lulus 112/112 pada desktop/mobile. Delapan skenario pemulihan juga lulus pada build server/frontend produksi dengan database terpisah dan pembatasan login asli tetap aktif. Harness pengujian menghormati respons 429 dan waktu tunggu server, tanpa menonaktifkan batas aplikasi.
- Audit visual mencakup 530 kasus unik desktop/mobile yang seluruhnya lulus setelah pemeriksaan ulang. Seluruh 851 capture akhir (754 gambar unik) ditinjau sampai nol gambar belum direview. Lihat `docs/ui-consistency.md` dan bukti privat lokal `test-results/registration-resume-complete/visual-review.json`.
- Pengujian mencakup akun mobile belum aktif setelah verifikasi, token sekali pakai, penyelesaian serentak/idempoten, draft browser lain, pemulihan memakai hash kredensial, pencabutan klaim lama, progres setelah reload/tutup tab/pindah viewport, URL lama, kegagalan penyimpanan, serta pembukaan kembali panduan tanpa membatalkan registrasi selesai.
- Akun dari versi lama dipertahankan. Bila penyelesaian pemulihan desktop ditolak karena divisi tidak aktif, transaksi dibatalkan sehingga klaim lama tetap tersedia; tidak ada respons sukses palsu.
- Pengiriman email pengujian lokal memakai Mailpit. Pemeriksaan ini tidak mengklaim telah membaca log VPS atau menguji ulang WebAPK/Safari pada HP fisik. Pemasangan Android/iPhone tetap mengikuti batas bukti platform dan pengujian manual staging yang sudah dicatat.

## Rujukan platform

- [Chrome — mendeteksi aplikasi sendiri yang terpasang](https://developer.chrome.com/docs/capabilities/get-installed-related-apps)
- [web.dev — perbedaan persetujuan dan pemasangan WebAPK](https://web.dev/learn/pwa/detection)
- [Chrome — navigasi dan penangkapan tautan aplikasi](https://developer.chrome.com/docs/capabilities/pwa-navigation-management)
- [Apple — menggunakan situs sebagai aplikasi di iPhone](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26)


## Koreksi akun lama dan pemulihan lewat email

Audit staging menemukan pendaftaran terverifikasi dengan onboarding belum selesai tetapi akun sudah dibuat oleh alur sebelumnya. Hash kredensial akun itu tidak memverifikasi kata sandi yang dilaporkan pemilik. Pemulihan yang hanya mengandalkan kredensial lama menyebabkan kebuntuan; tes lama yang mengharapkan penolakan pada kondisi tersebut telah diperbaiki.

- `account_access.registration_complete` menjadi syarat login, akses sesi, scope RLS, dan daftar/hitungan pengguna aktif. Migrasi menandai akun Anggota Divisi dengan catatan legacy yang belum selesai sebagai belum selesai, mencabut sesi serta klaim browser lamanya sekali, tanpa menghapus akun, riwayat, peran, atau divisi. Rekonsiliasi idempoten tidak membatalkan klaim pemulihan yang sudah sah.
- Jika kredensial lama tidak dapat dipakai, formulir tetap menerima permintaan sementara dan menuju layar verifikasi yang tersedia. Permintaan ini terpisah dari progres kanonis: email atau form saja tidak memindahkan progres dan tidak mengubah password akun.
- Email pemulihan harus dibuka pada browser tempat permintaan pemulihan dibuat. Browser lain menerima penjelasan pada kondisi gagal yang sudah tersedia, tanpa mengonsumsi token atau membuka akun. Ini mengikat perubahan sandi ke pemegang tautan email sekaligus peminta, sehingga klik email pada browser lain tidak menyetujui sandi yang diajukan browser asing. Alur lintas perangkat untuk registrasi baru tidak berubah.
- Setelah bukti email cocok, klaim berpindah ke peminta yang sah dan tahap kanonis dilanjutkan. Password baru masih berbentuk hash privat; baru diterapkan saat penyelesaian akhir bersama pembukaan akses. Desktop selesai pada konfirmasi email; mobile tetap menuntaskan onboarding.
- Akun yang sudah selesai, dicabut, atau berubah menjadi peran pimpinan tidak boleh diambil alih lewat pendaftaran. Role dan divisi tidak diubah oleh pemulihan. Progres kanonis lama yang kedaluwarsa tetap dapat dipulihkan melalui email, tanpa mengaktifkan akun karena berlalunya waktu.
- Tidak ada halaman, layout, aset, atau komponen baru. Pemulihan memakai formulir, pengiriman email, konfirmasi, kondisi gagal, dan panduan pemasangan yang sudah tersedia.

Audit operasional hanya melalui dispatch manual pemilik repository pada `develop`, memakai environment stage dan runner VPS yang ada. Transaksi PostgreSQL dipaksa read-only. Bukti privat dienkripsi CMS AES-256-GCM untuk sertifikat publik operator sebelum menjadi artifact; private key tetap di workspace, bukan di GitHub atau VPS. Audit tidak mengirim email, menjalankan migrasi, atau deploy.


### Validasi koreksi akun lama

Backend 291/291, pgTAP 108/108, frontend 15/15, dan alat deployment 70/70 lulus. Sesudah penajaman alasan penolakan, lima tes pemulihan dijalankan ulang dan lulus. Regresi mencakup 116 kasus unik desktop/mobile: 115 lulus pada putaran lengkap, satu kasus responsif menerima HTTP 502 selama pergantian proses server pengembangan; kedua viewport kasus itu dijalankan ulang setelah kode dibekukan dan lulus. Empat skenario insiden juga lulus pada build produksi dengan database lokal terpisah serta SMTP Mailpit. Seluruh 18 capture pemulihan produksi dan bagian halaman panjang telah ditinjau. Typecheck, build frontend/server, dan pemeriksaan file sensitif lulus. Pemeriksaan ini tidak menggantikan pengujian instalasi Android/iPhone fisik di staging.
