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

- `ui-audit/catalog.ts` memetakan seluruh 38 rute yang saat ini terdaftar di React Router, termasuk wildcard per peran. Aktivasi dengan/tanpa token dicatat sebagai kondisi berbeda dari rute yang sama.
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
