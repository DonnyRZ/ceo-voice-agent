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

`npm run env:init` membuat kredensial lokal dan kunci sesi secara acak. Isi `OPENAI_API_KEY`, `OPENAI_VOICE_MODEL`, dan `OPENAI_EMBEDDING_MODEL` lewat `.env` saat fitur AI diintegrasikan. [Contoh konfigurasi](.env.example)

## Pengujian

```sh
npm run test:backend
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright menjalankan aplikasi lokal secara otomatis dan memakai seed serta Mailpit. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` jika memakai instalasi Chromium lokal.

Jalankan `E2E_CAPTURE_ADMIN_SCREENSHOTS=1 npm run test:e2e` untuk menyimpan pembanding mockup Superadmin desktop dan mobile di folder hasil tes lokal.

Suite pgTAP memeriksa isolasi divisi, batasan relasi, dan audit di PostgreSQL. Pasang paket `postgresql-17-pgtap` pada database pengujian untuk menjalankannya.

```sh
docker compose exec -T db psql -X -U ruang_kerja_admin -d ruang_kerja \
  -v ON_ERROR_STOP=1 -v app_role=ruang_kerja_app < backend/db/pgtap.sql
```

## Produksi

Atur `APP_ORIGIN` ke URL HTTPS aplikasi dan `SMTP_*` ke server SMTP perusahaan. Siapkan database dan role runtime terpisah, lalu jalankan migrasi. Isi `SUPERADMIN_EMAIL` dan `SUPERADMIN_PASSWORD` untuk akun pertama dan jalankan `npm run db:admin` dari lingkungan administrasi database. Jalankan `npm run build` dan `NODE_ENV=production npm start`. Fastify menyajikan UI dan API dari satu proses.

Rujukan pengembangan tersedia di [aturan codebase](agents/codebase.md), [mockup Anggota Divisi](mockup/Anggota-Divisi/), dan [mockup Superadmin](mockup/Superadmin/).
