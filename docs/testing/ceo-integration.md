# Verifikasi integrasi CEO

Tanggal pemeriksaan 27 November 2026. Target tahap ini adalah UI CEO desktop/mobile dan integrasi dengan sumber timesheet Anggota Divisi serta pengelolaan Superadmin.

## Implementasi

- CEO masuk ke Dashboard dan memakai navigasi Divisi, Agent, serta Akun. Detail divisi, proyek, tugas, deskripsi, dan riwayat terhubung ke API dengan sesi CEO.
- Semua API CEO bersifat baca. RBAC dan RLS mempertahankan isolasi Anggota Divisi serta pembatasan data akun/audit. Sesi yang dicabut ditolak pada permintaan berikutnya dan sesi suara ditutup.
- Filter periode laporan memakai tanggal tugas. Status historis tetap menggunakan riwayat perubahan pada waktu yang diminta. Timestamp tampilan memakai Asia/Jakarta untuk tanggal dan jam.
- Dashboard dan detail CEO/Superadmin membaca ulang saat kembali ke halaman dan setiap 30 detik. Kueri backend mengembalikan data terbaru tanpa cache HTTP.
- Voice Agent mengikuti tujuh kondisi mockup. Kartu fakta muncul setelah hasil tersedia, menghubungkan sumber, dan menampilkan waktu catatan. Mikrofon serta audio dihentikan saat berpindah halaman, sesi berakhir, interupsi, atau akses dicabut.
- Preferensi suara tersimpan per akun/browser. Pemutaran yang dimatikan tetap menerima fakta dan tidak memutar kembali jawaban lama saat diaktifkan.
- Rekap terfilter menampilkan status yang dihitung dan jumlah yang sesuai filter. Tautan sumber historis mempertahankan cutoff/periode dan menjelaskan bahwa halaman sumber menampilkan catatan terkini. Tautan semua divisi dari Dashboard mencakup arsip yang ikut dihitung.
- Pemeriksaan penerimaan sesi memakai pool baca terpisah yang dibatasi. Penggantian kata sandi tidak menahan koneksi aplikasi saat memanggil Better Auth. Login/perubahan kata sandi serentak dan pencabutan akses di tengah transaksi diuji dengan setiap pool dibatasi satu koneksi.
- Indeks semantik diperbarui saat judul/deskripsi berubah. Penyelesaian pekerjaan worker memeriksa lease, versi konten, model, dan status divisi. Dokumen terhapus atau kedaluwarsa tidak menjadi sumber jawaban.
- Logo ImageGen yang sudah tersedia dipakai bersama ikon standar Lucide. Tidak diperlukan aset kustom tambahan. Modul AI tetap berada di backend; ID model dan kunci dibaca dari environment.

## Cakupan pengujian

- PostgreSQL nyata dan API: Anggota Divisi membuat/mengubah tugas, PIC, status, deskripsi, tanggal, serta proyek. API Superadmin, API CEO, dan retrieval produksi membaca fakta yang sama. Perpindahan divisi, arsip, perubahan peran, pencabutan sesi, validasi, dan penolakan akses diuji.
- Penghapusan tugas diuji pada lapisan integritas SQL dan indeks. Ini bukan penambahan fitur hapus tugas pada UI/API Anggota Divisi. Arsip divisi diuji melalui alur produk yang tersedia.
- Browser desktop 1440×900 dan mobile 390×844: login/pengalihan, CRUD yang tersedia, undangan melalui SMTP lokal, filter, keadaan kosong/gagal, sumber, akun, pengaturan, dan keamanan akun.
- Layar CEO diperiksa visual terhadap `mockup/CEO/desktop` dan `mockup/CEO/mobile`, termasuk seluruh keadaan dalam `voice-agent`. Screenshot terpisah dihasilkan oleh tes halaman, akun, dan keadaan suara. Scroll digunakan untuk konten panjang.
- Tes voice browser memakai adapter provider yang terkontrol untuk menguji lifecycle, state, generasi giliran, fakta, pembatalan, dan izin media tanpa biaya API. Tes audio native memutar WAV sebenarnya dan memeriksa urutan sinyal, penyelesaian, serta interupsi.
- Tes retrieval lintas peran memakai interpreter terstruktur deterministik untuk mengisolasi kueri dan RLS. Hasil ini tidak dihitung sebagai evaluasi kemampuan model OpenAI atau akurasi ASR.

## Menjalankan ulang

Hasil akhir pada workspace:

- Backend: 241 tes lulus dalam 36 suite, memakai PostgreSQL nyata untuk integrasi dan RLS.
- Frontend: 8 tes lulus untuk lifecycle, pemutaran, dan cakupan sumber fakta.
- Tool audit suara: 36 tes lulus.
- pgTAP: 74 pemeriksaan lulus, transaksi pengujian di-rollback.
- Browser: seluruh 88 kasus desktop/mobile lulus. Regresi penuh menghasilkan 87 lulus dan satu kasus WAV panjang mobile yang sebelumnya dikecualikan. Pengecualian tersebut dihapus dan kasus mobile sembilan detik dijalankan terpisah, lulus sampai audio berakhir. Suite berikutnya menjalankan seluruh kasus tanpa pengecualian itu.
- Typecheck, build produksi, pemeriksaan whitespace Git, serta pemindaian literal kunci privat/API lulus. `.env`, rekaman/transkrip pilot, build, log, dan hasil browser tidak masuk commit.

Gunakan database pengembangan dengan seed dan SMTP lokal. Jangan arahkan suite browser ke data produksi.

```sh
AI_VOICE_ENABLED=false AI_EMBEDDINGS_ENABLED=false npm run test:backend
npm run test:frontend
npm run test:tools
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  AI_VOICE_ENABLED=false AI_EMBEDDINGS_ENABLED=false \
  npm run test:e2e -- --workers=1 --output=/tmp/ceo-regression
```

Chromium bawaan Playwright dapat digunakan dengan menghapus variabel executable. Setiap proses Playwright paralel harus memakai direktori `--output` berbeda agar tidak saling menghapus artefak. Build tetap dan backend tanpa watch dipakai untuk regresi akhir agar restart development tidak memutus permintaan yang sedang diuji.

Suite SQL dijalankan dengan perintah pgTAP di README. GitHub Actions menjalankan pgTAP, backend, frontend, tool audit, build, serta browser desktop/mobile.

## Evaluasi manual dan batas bukti

Aktifkan `AI_VOICE_TEST_HISTORY_ENABLED=true` untuk menyimpan transkrip historis, tahapan respons, fakta sumber, keluaran provider, pemakaian, dan error di server. `npm run voice:history -- --limit 10` menampilkan sesi; gunakan ID sesi untuk detail. Event `playing` browser mengukur awal pemutaran, bukan bukti bahwa seluruh fakta sudah terdengar.

Kesalahan transkripsi nama yang tidak dikenal masih merupakan masalah terbuka dari pilot sebelumnya. Contoh acuan sintetis `Rangkaian Komet Ungu` dan `Pemetaan Bintang Pualam` pernah ditranskripsi menjadi nama berbeda. Aturan runtime tidak menambahkan ejaan khusus untuk nama uji tersebut. Simpan konteks, transkrip, sumber, dan hasil manual untuk evaluasi berikutnya.

Tahap ini tidak membuktikan akurasi end-to-end 99,99% ataupun sasaran dua detik. Pengujian browser deterministik dan audio WAV tidak menggantikan uji percakapan GPT Live dengan suara pengguna nyata. Anggaran OpenAI pilot tetap mengikuti ledger yang sudah ada dan batas total US$6; pengujian UI/integrasi tahap ini tidak menambah panggilan berbayar.
