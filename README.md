# Ruang Kerja

Anggota Divisi masuk dengan akun perusahaan untuk mengelola proyek dan tugas divisinya. Superadmin mengelola divisi, akun, dan hak akses, serta melihat timesheet dan audit lintas divisi. Data dan riwayat perubahan tersimpan di PostgreSQL.

## Jalankan lokal

Gunakan Node.js 24 LTS, npm, dan Docker Compose.

```sh
npm ci
npm run env:init
docker compose up -d --wait db mailpit
npm run db:migrate
npm run db:seed
npm run dev
```

Buka `http://localhost:5173`. Seed menyediakan `superadmin@ruangkerja.test`, anggota IT `doni@ruangkerja.test` dan `hakim@ruangkerja.test`, serta anggota Finance `laura@ruangkerja.test` dan `vanah@ruangkerja.test`. Kata sandi akun uji ada di `SEED_PASSWORD` dalam `.env` lokal. Untuk melihat data contoh, pilih November 2026.

Gunakan konfigurasi `SMTP_*` dari `.env.example` untuk mengirim undangan ke Mailpit. Buka kotak masuk lokal di `http://127.0.0.1:8025` dan ikuti tautan aktivasi pada email uji.

`npm run env:init` membuat kredensial lokal dan kunci sesi secara acak. Konfigurasi model dan kunci OpenAI ada di `.env` backend. Voice Agent CEO mati secara default. [Contoh konfigurasi](.env.example)

## Pengujian

```sh
npm run test:backend
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright menjalankan aplikasi lokal secara otomatis dan memakai seed serta Mailpit. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` jika memakai instalasi Chromium lokal.

Jalankan `E2E_CAPTURE_ADMIN_SCREENSHOTS=1 npm run test:e2e` untuk menyimpan pembanding mockup Superadmin desktop dan mobile di folder hasil tes lokal.

Suite pgTAP memeriksa isolasi divisi, hak baca CEO, riwayat, dan audit di PostgreSQL. Pasang paket `postgresql-17-pgtap` pada database pengujian dan restart layanan database sebelum menjalankannya.

```sh
docker compose exec -T db psql -X -U ruang_kerja_admin -d ruang_kerja \
  -v ON_ERROR_STOP=1 -v app_role=ruang_kerja_app < backend/db/pgtap.sql
```

## Produksi

Atur `APP_ORIGIN` ke URL HTTPS aplikasi dan `SMTP_*` ke server SMTP perusahaan. Siapkan database dan role runtime terpisah, lalu jalankan migrasi. Isi `SUPERADMIN_EMAIL` dan `SUPERADMIN_PASSWORD` untuk akun pertama dan jalankan `npm run db:admin` dari lingkungan administrasi database. Jalankan `npm run build` dan `NODE_ENV=production npm start`. Fastify menyajikan UI dan API dari satu proses.

Rujukan pengembangan tersedia di [aturan codebase](agents/codebase.md), [mockup Anggota Divisi](mockup/Anggota-Divisi/), dan [mockup Superadmin](mockup/Superadmin/).

## Pilot Voice Agent CEO

Aktifkan `AI_VOICE_ENABLED=true` di proses pilot setelah migrasi, seed, dan build. Akun seed `ceo@ruangkerja.test` membuka layar internal `/ceo/voice`. Aktifkan `AI_EMBEDDINGS_ENABLED=true` untuk menguji indeks semantik pada data contoh. Simpan konfigurasi OpenAI di `.env` backend.

Gunakan WAV ucapan berbahasa Indonesia yang berisi pertanyaan tentang fixture. Contoh pertanyaan awal adalah “Apa status proyek Upgrade Infrastruktur di divisi IT?” Status sumbernya Pending. `npm run test:voice:pilot -- /path/pertanyaan.wav` memakai audio itu sebagai mikrofon Chromium. Script menguji giliran awal, aktif, dan bangun dari standby. Hasil dan audio uji tersimpan di `.voice-pilot/`. Bandingkan audio hasil dengan status di sumber. Waktu audio pertama dalam laporan menunjukkan awal sinyal audio.

`npm run test:voice:protocol -- /path/pertanyaan.wav` menguji event delegasi dan keluaran PCM GPT Live dengan satu fakta contoh lewat WebSocket langsung. Pemeriksaan ini memakai FFmpeg dan anggaran yang sama dengan pilot WebRTC.

`npm run test:voice:browser-ws -- /path/pertanyaan.wav "Judul catatan seed" done` memakai browser loopback untuk mengirim WAV dan merekam audio GPT Live yang diputar. Berikan judul dan status yang diharapkan dari data seed. Jalur audit ini memakai login CEO, delegasi, penarikan fakta PostgreSQL, dan anggaran pilot yang sama. Audio berjalan lewat WebSocket, sehingga hasilnya menguji percakapan dan pemutaran browser pada transport tersebut. Pilot WebRTC tetap digunakan untuk memeriksa koneksi media aplikasi.

Anggaran lokal dibatasi US$5 dan penggunaan dicatat di direktori yang sama. Simpan ledger itu selama rangkaian uji. Jika pemakaian sesi berakhir tanpa konfirmasi dari OpenAI, cadangan biaya tetap ditahan. Endpoint Prometheus `/api/ceo/voice/metrics` memerlukan sesi Superadmin.

### Riwayat tes manual

Jalankan migrasi dan atur `AI_VOICE_TEST_HISTORY_ENABLED=true` pada backend pilot sebelum memulai tes. Sesi baru tersimpan di PostgreSQL. Pencatatan ini perlu diaktifkan secara eksplisit karena transkrip dan fakta timesheet dapat memuat data perusahaan.

```shell
npm run voice:history -- --limit 10
npm run voice:history -- <id-sesi>
```

Perintah server ini memakai `DATABASE_ADMIN_URL`. Laporan sesi memuat transkrip CEO dan GPT Live dengan offset audio, pertanyaan yang dipakai untuk kueri, fakta sumber dan teks yang dikirim ke GPT Live, durasi setiap tahap, kegagalan, dan pemakaian yang dilaporkan OpenAI. Waktu pemutaran browser adalah proksi dari event giliran hingga event `playing` dan dicatat per sesi. Cocokkan isi transkrip agen dengan fakta sumber dan hasil yang didengar pada tes manual.
