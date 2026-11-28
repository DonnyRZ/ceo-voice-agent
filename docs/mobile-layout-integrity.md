# Integritas layout mobile

## Penyebab dan perbaikan

Screenshot pemilik direproduksi pada viewport 360 px dengan ukuran teks normal. Tombol memiliki dua kolom setara, tetapi `overflow-wrap: anywhere`, padding, gap, dan ikon menyisakan ruang terlalu kecil bagi kata “Sebelumnya”. Pemeriksaan tinggi tombol dan overflow dokumen terdahulu tidak menangkap kata yang terbelah. Margin paragraf juga membuat catatan verifikasi menempel pada kartu iPhone.

Navigasi sekarang membungkus di antara kata, memiliki ukuran setara dan jarak 12 px. Pada ruang aktual yang sempit, ikon dekoratif dihilangkan; pembesaran teks yang lebih besar menggunakan label ringkas Kembali/Lanjut dengan nama aksesibel lengkap. Empat penanda tahap tersusun dua kolom jika satu baris tidak cukup. Kartu perangkat memakai kolom teks fleksibel dan catatan memiliki jarak tersendiri.

Audit lintas peran juga memperbaiki:

- Ringkasan status memakai kolom adaptif agar badge tidak bertabrakan ketika teks diperbesar.
- Daftar proyek, pengguna, dan akses cepat menyusun ulang ikon serta teks saat ruang menyempit.
- Kolom judul/deskripsi tabel tidak memaksa kata menjadi potongan huruf. Tabel yang lebih lebar dapat digulir dalam panelnya.
- Header Superadmin memberi ruang tersendiri bagi tombol akun bila logo dan tombol tidak cukup dalam satu baris.
- Filter laporan dan rincian label/nilai bertumpuk pada ruang sempit; label tidak tertutup kontrol.
- Kolom tile, padding ikon dalam formulir, tanggal, serta chevron mengikuti token ukuran aktual. Formulir tugas memiliki ruang input penuh pada teks besar.
- Dialog konfirmasi menata tindakan menurut ruang yang tersedia. Pasangan navigasi tahap tetap horizontal.
- Tata letak desktop sempit di sekitar breakpoint 768 px mempertahankan lebar kolom yang terbaca.
- Periode dashboard tidak lagi dipotong ketika nama divisi panjang; anggota divisi dan detail tugas mendapat baris penuh saat teks besar.
- Tile pengguna tidak ikut melebar bersama kolom teks. Panel fakta Voice Agent menjadi satu kolom berdasarkan ruang konten aktual, termasuk landscape.

Aturan yang digantikan diubah langsung. Tidak ada rute, sakelar, atau fallback menuju versi layout lama. Pola responsif merupakan satu implementasi aktif. Tidak ditambahkan komponen React bersama. Referensi rancangan tetap dalam `mockup/`; token logo, tipografi, kontrol dan ikon mengikuti [standar UI](ui-consistency.md).

## Cakupan dan cara menjalankan

Katalog `ui-audit/catalog.ts` mencakup seluruh 43 pola rute, 52 layar dan 141 kondisi dasar: publik, registrasi/verifikasi/pemasangan, Anggota Divisi, Superadmin, CEO, akun, dan halaman tidak ditemukan. Rangkaian interaksi juga mencakup filter, validasi, simpan, konflik, retry, dialog, loading, error, isi panjang, serta kondisi Voice Agent.

```sh
node --import tsx --test ui-audit/*.test.mjs
UI_LAYOUT_SWEEP=1 npm run test:ui-audit -- --workers=2
npm run test:e2e -- --workers=1 --timeout=60000
```

Setiap capture mobile diperiksa pada 31 kombinasi viewport/teks: lebar 300, 320, 350, 359, 360, 374, 375, 390, 412, 430, 480, 600, 767, 768, 800, 844, 932 dan 1024 px; teks 125%/150% pada 320/360/390/767 px; tinggi 568/667/932 px; landscape 844×390 dan 932×430. Capture desktop tetap diperiksa pada viewport desktop aslinya. Pengujian visual berjalan pada build produksi dan terpisah dari pipeline deploy.

`layout-integrity.ts` memeriksa range kata aktual, clipping, teks terhadap teks/ikon/tile/kontrol, ruang isi input terhadap ikon, status badge, ukuran tile terhadap token, pasangan navigasi dan jarak kartu. Overlay teks noninteraktif yang memang menggantikan isi native input diperiksa terhadap ikon/clipping, tanpa dianggap sebagai label luar yang menimpa input. Navigasi fixed diperiksa dalam konteks navigasinya sendiri; panel tabel/navigasi yang dapat digulir bukan overflow dokumen.

Setelah sweep, alat uji memulihkan viewport serta zoom visual emulator Chromium. Pergantian viewport berulang sebelumnya meninggalkan skala visual 1,12–1,40 walaupun layout sudah kembali 390 px, sehingga koordinat klik berikutnya keliru. Pemulihan ini hanya berada di alat uji; aplikasi tidak membatasi zoom pengguna.

Pemeriksaan otomatis dilengkapi review screenshot, termasuk seluruh potongan halaman panjang. Bukti lama hanya dapat diwarisi melalui hash gambar yang identik. Pengujian browser memakai respons API terkendali; E2E terpisah memakai backend/database pengujian. Emulasi viewport dan ukuran teks tidak menyatakan bahwa seluruh versi browser/perangkat fisik di dunia telah diuji.

## Hasil

Putaran akhir pada 28 November 2026 menggunakan build produksi dan lulus seluruh 536 skenario dalam 13,9 menit, tanpa kegagalan, skip, atau flaky test.

| Pemeriksaan | Hasil |
| --- | --- |
| Seluruh rute dan kondisi UI desktop/mobile | 536/536 lulus; 43 pola rute, 52 layar, 141 kondisi dasar ditambah interaksi |
| Sweep kondisi mobile | 438 capture × 31 kombinasi = 13.578 pemeriksaan; 0 temuan |
| Sweep tambahan seluruh layar siap | 52 × 31 = 1.612 pemeriksaan; 0 temuan |
| Onboarding Android/iPhone | 5 langkah × setiap lebar 300–767 px × teks 100%/125%/150% = 7.020 pemeriksaan; 0 temuan |
| Review visual | 1.029 capture, 917 gambar unik, seluruh bagian halaman panjang ditinjau; 0 gambar final belum direview |
| Navigasi sentuh pada 300×568, teks 150% | Tautan terakhir dapat dijangkau dan dibuka pada ketiga peran |
| Regresi E2E dengan backend pengujian | 116/116 lulus; setelah penyempurnaan CSS terakhir, 10/10 navigasi, timesheet dan pemulihan simpan diulang dan lulus |
| Unit frontend dan kontrak katalog/loading | 15/15 dan 2/2 lulus |
| Kontrak branch/deployment | 70/70 lulus |
| Build produksi akhir | Typecheck/build lulus; SHA-256 seluruh 94 file output identik dengan artefak yang diuji |

Uji sensitivitas menyisipkan aturan lama hanya di browser pengujian: pemeriksa menangkap kata “Sebelumnya” terbelah, jarak kartu nol, dan tile yang melebar menjadi 240,8 px saat tokennya 72 px. Layout baru tidak menghasilkan temuan pada pemeriksaan yang sama. Aturan yang disisipkan tersebut tidak menjadi bagian aplikasi.

Bukti lokal yang diabaikan Git:

- `test-results/ui-audit-mobile-integrity-final-proof/results.json`: seluruh 536 hasil pada satu putaran akhir.
- `test-results/mobile-integrity-visual-review/visual-review.json`: daftar capture, SHA-256, asal review dan hasil sweep; review sebelumnya hanya diwarisi untuk gambar identik.
- `test-results/mobile-layout-ready-final-proof/results.json` dan `test-results/mobile-onboarding-verified/results.json`: sweep tambahan.
- `test-results/mobile-integrity-guard-regression/`: uji sensitivitas pemeriksa.
- `test-results/mobile-navigation-verified/results.json`: bukti scroll dan tap navigasi.

CI mengulangi katalog dan sweep pada workflow regresi terpisah serta menyimpan screenshot/ukuran sebagai artefak. Jalur deployment tidak ditambah browser atau dependensi regresi visual.
