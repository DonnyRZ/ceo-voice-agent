# Standar ukuran dan audit seluruh frontend

Ukuran tampilan ditentukan oleh kategori pada `frontend/src/styles/sizes.css`. Komponen sejenis memakai kategori yang sama pada halaman Anggota Divisi, Superadmin, CEO, login, dan aktivasi. Struktur halaman yang sudah ada dipertahankan; perbaikan ini tidak membuat komponen React bersama baru sebagai pengganti pemeriksaan visual.

| Kategori | Desktop | Mobile |
| --- | --- | --- |
| Logo | 220 px | 180 px |
| Judul halaman | 32 px / bobot 750 | 28 px / bobot 750 |
| Judul bagian | 22 px / bobot 720 | 20 px / bobot 720 |
| Teks formulir, tombol, dan data | 16 px | 16 px |
| Judul catatan/kartu | 18 px | 18 px |
| Metadata dan badge | 14 px | 14 px |
| Angka ringkasan | 32 px | 28 px |
| Tombol aksi/formulir dan input/select | minimal 48 px | minimal 48 px |
| Tombol ikon akun/password | 44 px | 44 px |
| Ikon inline / badge / navigasi | 20 / 18 / 24 px | 20 / 18 / 24 px |
| Ikon tile / ringkasan | 28 / 36 px | 28 / 36 px |
| Latar tile ikon | 56 px | 48 px |
| Avatar akun | 72 px | 64 px |
| Label navigasi utama | 16 px | 12 px |

Nilai sumber memakai `rem` sehingga mengikuti pengaturan ukuran teks browser. Perbandingan pixel di atas menggunakan ukuran font browser standar. Judul pemasaran pada panel login desktop memakai kategori display; visual mikrofon utama memakai kategori ilustrasi. Breadcrumb adalah metadata, bukan navigasi utama. Lebar kolom dan tinggi kartu yang berisi data menyesuaikan isi; teks panjang dibungkus tanpa memperkecil ukuran kategori.

Login umum dan Superadmin diperiksa tanpa scroll pada viewport pengujian, termasuk kondisi error dan proses masuk. Tautan/panah kembali ke login pengguna dihapus dari Superadmin. Ruang header, form, dan tombol dirapikan pada layar pendek tanpa menyembunyikan konten atau mengunci overflow.

## Cakupan yang dapat diulang

- `ui-audit/catalog.ts` memetakan seluruh 43 rute yang saat ini terdaftar di React Router, termasuk wildcard per peran. Aktivasi dengan/tanpa token dicatat sebagai kondisi berbeda dari rute yang sama; halaman offline statis diperiksa terpisah.
- `ui-audit/route-coverage.test.mjs` membandingkan rute sumber dengan katalog. Perubahan jumlah atau rute yang belum terpetakan menggagalkan pemeriksaan.
- `ui-audit/screens.spec.ts` merekam hasil nyata React untuk kondisi tersedia, memuat, gagal, kosong, dan tidak ditemukan sesuai cabang yang diterapkan pada halaman.
- Berkas skenario lain mencakup validasi, submit berjalan, error penyimpanan, konflik, undangan/aktivasi, hak akses, konfirmasi dan pembatalan, arsip/arsip terhalang, riwayat, filter, logout, pengaturan, dan seluruh kondisi tampilan Voice Agent.
- Data panjang diuji pada dashboard, daftar, akun, dan detail yang rawan melebar. Nama memakai batas 120 karakter; deskripsi memakai batas 2.000 karakter.
- Setiap capture menyimpan PNG halaman lengkap dari posisi scroll paling atas dan JSON ukuran hasil render. Ini mencegah elemen fixed yang seharusnya di luar viewport ikut terlihat saat browser memperluas area screenshot sesudah form otomatis menggulir halaman. Pemeriksaan mencakup lebar viewport yang dikonfigurasi, overflow halaman, logo, judul, kontrol, badge, navigasi, ikon, dan latar tile. Ukuran viewport tidak diambil dari `innerWidth` yang dapat ikut membesar ketika konten meluber pada browser mobile.

Viewport utama: desktop 1440×900 dan mobile 390×844. Login juga diperiksa pada 1280×720, 1920×1080, 320×568, 360×640, dan 430×932, termasuk error 401/429/503 dan proses masuk. Antarmuka picker/izin bawaan browser mengikuti browser/perangkat; tampilan respons aplikasi terhadap hasilnya termasuk dalam skenario audit.

## Menjalankan pemeriksaan

```sh
npm ci
npx playwright install chromium
node --import tsx --test ui-audit/route-coverage.test.mjs
npm run test:ui-audit
```

Audit ini menjalankan Vite pada loopback port 5174 dengan `vite.ui-audit.config.ts` dan cache dependency tersendiri. Dua server tidak boleh berbagi cache optimasi karena dapat menghasilkan `504 Outdated Optimize Dep` saat pengujian bersamaan. Respons API dikendalikan oleh fixture untuk membuka cabang UI secara deterministik; tampilan yang direkam tetap komponen aplikasi sebenarnya. Kondisi suara dipicu melalui transport uji browser, tanpa API OpenAI berbayar. Regresi interaksi terhadap backend dan PostgreSQL tetap dijalankan melalui `npm run test:e2e` pada port pengembangan normal.

Workflow `Regresi mendalam terpisah` menjalankan audit dalam job `ui-consistency` tersendiri, paralel dengan regresi fungsional. Artifact `ui-consistency-<SHA>` berisi screenshot, pengukuran, dan hasil pengujian selama tiga hari. Job deployment tidak bergantung pada job browser ini.

Output regresi fungsional berada di `test-results/e2e/`; audit memakai direktori tersendiri agar memulai regresi tidak menghapus bukti audit.

Hasil lokal disimpan di `test-results/ui-audit-after/` dan diabaikan Git. Untuk membuat lembar perbandingan visual, gunakan Python dengan Pillow:

```sh
python3 scripts/ui-audit-sheets.py test-results/ui-audit-after test-results/ui-review
```

Lembar review memuat seluruh bagian halaman panjang. Gambar yang identik secara byte dideduplikasi berdasarkan SHA-256, dengan semua identitas kasus tetap dicatat pada manifest. Review tidak menganggap dua halaman sama hanya karena memakai komponen atau CSS yang sama. Bukti pemeriksaan visual dicatat per gambar dan bagian; perubahan hash harus diperiksa kembali.

## Hasil pemeriksaan 28 November 2026

- Seluruh 38 rute aplikasi tercakup pada desktop dan mobile. Matriks berisi 448 kasus unik, yaitu 224 per viewport, mencakup kondisi baca dan interaksi yang tercatat pada katalog serta berkas skenario.
- Audit lengkap awal lulus 446/446. Setelah penambahan kondisi filter timesheet, kasus desktop tambahan lulus dan seluruh 224 kasus mobile dijalankan ulang serta lulus. Pemeriksaan spesifik nama divisi panjang dan filter Audit Log dijalankan kembali setelah perbaikan terakhir; semuanya lulus.
- Bukti final di workspace: `test-results/ui-audit-final/`, berisi 691 capture (340 desktop, 351 mobile) dan JSON ukuran. Seluruh 626 gambar unik beserta bagian halaman panjang sudah ditinjau secara visual; tidak ada capture final yang belum direview. `visual-review.json` menyimpan SHA-256 dan hasil pemeriksaan tiap capture; hasil runner disimpan sebagai `playwright-*.json` di direktori yang sama.
- Regresi terhadap backend/PostgreSQL lulus 90/90. Setelah perbaikan terakhir, enam kasus timesheet/responsif dan dua kasus Audit Log desktop/mobile diperiksa kembali dan lulus. Delapan tes unit frontend, pemeriksaan cakupan rute, TypeScript, build frontend/server, dan validasi workflow juga lulus.

Temuan yang diperbaiki meliputi ukuran logo/login yang berbeda, font dan ikon antarperan, kontrol formulir yang terlalu pendek, latar ikon yang membesar di mobile, grid form yang bertumpuk saat validasi sekaligus gagal simpan, kolom deskripsi proyek yang terlalu sempit, judul dialog undangan yang tersembunyi, nama divisi/pengguna panjang yang mendesak elemen lain, dan pilihan filter Audit Log yang terpotong. Aturan CSS dan class keadaan lama yang menyebabkan konflik dihapus.

Cakupan ini memverifikasi ukuran dan interaksi aplikasi pada viewport yang disebutkan, menggunakan Chromium. Respons transport suara pada audit UI disimulasikan; pemeriksaan ini tidak mengklaim menguji ulang akurasi model atau audio OpenAI nyata. Screenshot lokal dan data fixture tidak dikirim ke VPS. PR hanya ditujukan ke `develop`; proses audit ini tidak melakukan merge atau deployment.

## Perluasan registrasi dan pemasangan, 28 November 2026

- Matriks terbaru mencakup 43 rute React, halaman offline, serta kondisi registrasi dan pemasangan. Sebanyak 512 kasus visual unik lulus pada desktop/mobile, termasuk pemeriksaan ulang setelah perbaikan.
- Bukti gabungan berada di `test-results/registration-complete/`: 793 capture (391 desktop, 402 mobile), dengan 718 gambar unik. Seluruh gambar dan bagian halaman panjang ditinjau secara visual; `visual-review.json` mencatat hash tiap capture, tanpa gambar final yang belum ditinjau.
- Login tetap muat pada viewport pendek yang disebutkan di atas. Logo, judul, formulir, tombol, ikon, pilihan perangkat, kartu loading tanpa logo tambahan, dan langkah Safari diperiksa melalui render nyata. Ikon aplikasi pada panduan dan halaman pembuka dibatasi 112 px.
- Pemeriksaan menemukan dan memperbaiki ikon yang membesar saat halaman pembuka dimuat langsung, judul menunggu yang masih tampil setelah pembatalan, serta teks filter Audit Log yang bertumpuk dengan ikon pada mobile. Pemeriksaan jarak filter meliputi kondisi tersedia, kosong, memuat, dan gagal; regresi Audit Log dijalankan ulang.
- Bukti fungsional dan batas pemasangan perangkat asli dicatat pada [registrasi Anggota Divisi](member-registration.md). Simulasi event pemasangan dalam audit UI tidak dianggap sebagai bukti pemasangan Android/iPhone asli.

## Revisi verifikasi email, 28 November 2026

- Sebanyak 28 mockup ImageGen menjadi referensi revisi formulir/progres, verifikasi, hasil lintas perangkat, email HTML, dan panduan pemasangan. Ukuran logo 220/180 px, judul 32/28 px, kontrol 48 px, serta kategori ikon tetap mengikuti token seluruh aplikasi.
- Seluruh 43 rute tercakup dalam 522 kasus UI unik desktop/mobile yang lulus. Setelah disk workspace penuh saat build container lokal, 406 kasus yang sudah lulus dipertahankan; 119 kasus mobile dan lima skenario verifikasi desktop dijalankan kembali, termasuk pemeriksaan ulang status yang berubah. Status Mengirim tidak mengaku email sudah terkirim.
- Bukti final `test-results/registration-verification-complete/`: 833 capture (410 desktop, 423 mobile), 742 gambar unik. Seluruh capture dan bagian halaman panjang sudah ditinjau; tidak ada hash final yang belum direview. `visual-review.json` menyimpan cakupan kasus, viewport, SHA-256, dan status review.
- Regresi fungsional aplikasi lulus 104/104. Registrasi pada build produksi lokal lulus 14/14; dua alur email/aktivasi/login desktop/mobile diulang setelah perbaikan status pengiriman dan lulus. Backend 276/276, pgTAP 95/95, frontend 15/15, typecheck dan build lulus.
- Pemasangan native desktop diverifikasi kembali; Android WebAPK/Safari iPhone asli tetap memerlukan pemeriksaan di staging. Bukti viewport mobile tidak dipakai untuk mengklaim pemasangan pada perangkat asli.


## Pemulihan progres registrasi, 28 November 2026

- Seluruh 530 kasus unik pada 43 rute desktop/mobile lulus setelah pemeriksaan ulang. Putaran lengkap menghasilkan 529 lulus; satu fixture pemasangan yang masih memakai tahap lama diperbaiki agar mengikuti progres server. Sebanyak 62 kasus registrasi/pemasangan dan 18 kasus verifikasi/pemulihan kemudian dijalankan kembali dan semuanya lulus.
- Bukti akhir: `test-results/registration-resume-complete/`, 851 capture (419 desktop, 432 mobile), 754 gambar unik. Seluruh gambar dan bagian halaman panjang telah dilihat; `visual-review.json` mencatat hash, viewport, hasil 530 kasus, dan nol gambar yang belum ditinjau. Bukti yang identik hanya diwarisi bila SHA-256 cocok persis.
- Halaman dan ukuran komponen yang sudah disetujui dipertahankan. Teks status mengikuti keputusan terbaru: email mobile yang terverifikasi belum berarti akun aktif. Membuka panduan lagi sesudah selesai tidak menurunkan status registrasi; URL tab lama tidak boleh mengganti progres server.
- Service worker diblokir hanya pada audit dengan respons API yang dikendalikan agar skenario gagal benar-benar mencapai interceptor. Pemeriksaan cache, navigasi offline, serta pemasangan native tetap memakai worker asli pada rangkaian terpisah. Tidak ada perubahan pipeline deployment.


## Pemulihan akun legacy melalui email

Perubahan ini memakai frontend yang sama: formulir, verifikasi email, kondisi gagal, dan panduan pemasangan tetap sesuai rancangan yang sudah tersedia. Delapan belas capture dari empat skenario browser pada build produksi (desktop/mobile, asal tidak tercatat atau mobile diketahui) diperiksa beserta ukuran komponennya. Seluruh gambar baru dan potongan halaman panjang ditinjau. Pemulihan membuka tahap server yang tersimpan; penolakan browser berbeda memakai slot pesan gagal verifikasi yang sudah ada, tanpa mengonsumsi token. Bukti privat lokal berada di `test-results/recovery-production/`; audit dan regresi lintas peran tetap terpisah dari deployment.
