# Ruang Kerja

Anggota Divisi dapat masuk dengan akun perusahaan, melihat ringkasan pekerjaan, mengelola proyek, dan mencatat tugas di timesheet divisinya. Data proyek, tugas, dan riwayat perubahan tersimpan di PostgreSQL.

## Jalankan lokal

Gunakan Node.js 24 LTS, npm, dan Docker Compose.

```sh
npm ci
npm run env:init
docker compose up -d --wait db
npm run db:migrate
npm run db:seed
npm run dev
```

Buka `http://localhost:5173`. Data uji mencakup `doni@ruangkerja.test` dan `hakim@ruangkerja.test` dari IT, serta `laura@ruangkerja.test` dan `vanah@ruangkerja.test` dari Finance. Kata sandi akun uji ada di `SEED_PASSWORD` dalam `.env` lokal. Untuk menguji periode contoh, pilih November 2026.

`npm run env:init` membuat kredensial lokal dan kunci sesi secara acak. Isi `OPENAI_API_KEY`, `OPENAI_VOICE_MODEL`, dan `OPENAI_EMBEDDING_MODEL` lewat `.env` saat fitur AI diintegrasikan. [Contoh konfigurasi](.env.example)

## Pengujian

```sh
npm run test:backend
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright menjalankan aplikasi lokal secara otomatis dan memakai data uji dari seed. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` jika memakai instalasi Chromium lokal.

Suite pgTAP memeriksa isolasi divisi, batasan relasi, dan audit di PostgreSQL. Pasang paket `postgresql-17-pgtap` pada database pengujian untuk menjalankannya.

```sh
docker compose exec -T db psql -X -U ruang_kerja_admin -d ruang_kerja \
  -v ON_ERROR_STOP=1 -v app_role=ruang_kerja_app < backend/db/pgtap.sql
```

## Produksi

Atur `APP_ORIGIN` ke URL HTTPS aplikasi. Siapkan database dan role runtime terpisah, jalankan migrasi, lalu jalankan `npm run build` dan `NODE_ENV=production npm start`. Fastify menyajikan UI dan API dari satu proses.

Rujukan pengembangan tersedia di [aturan codebase](agents/codebase.md) dan [mockup Anggota Divisi](mockup/Anggota-Divisi/).
