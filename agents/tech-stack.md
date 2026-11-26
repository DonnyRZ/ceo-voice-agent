# Tech Stack Ruang Kerja

- **Frontend web** — React, Vite, TypeScript, dan React Router. Mobile-first untuk CEO dan responsif untuk Anggota Divisi dan Superadmin.
- **UI dan aset** — Tailwind CSS, Lucide React untuk ikon standar, TanStack Table untuk timesheet, TanStack Query untuk data API, dan ImageGen untuk aset visual kustom.
- **Backend** — Node.js LTS, Fastify, REST API, Zod untuk validasi, dan SDK resmi OpenAI. Pakai arsitektur modular monolith.
- **Voice Agent CEO** — OpenAI GPT Live 1.1 (`gpt-live-1.1`) via WebRTC menangani seluruh percakapan, dari mendengarkan hingga klarifikasi dan jawaban. [Dokumentasi GPT Live](https://developers.openai.com/api/docs/guides/live)
- **Jalur jawaban CEO** — GPT Live memakai *client delegation* via WebSocket sideband. Fastify menjalankan kueri SQL terindeks dan mengembalikan fakta langsung ke GPT Live. [Dokumentasi client delegation](https://developers.openai.com/api/docs/guides/live-delegation?delegation-mode=client)
- **Database** — PostgreSQL self-hosted, `pg` untuk koneksi, dan `node-pg-migrate` untuk migrasi. Baca status, PIC, dan rekap langsung dari timesheet.
- **Pencarian proyek dan tugas** — PostgreSQL full-text search dan `pg_trgm` untuk judul dan deskripsi. Pakai `text-embedding-3-large` dan `pgvector` untuk mencari kandidat saat istilah CEO berbeda. [Dokumentasi embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- **Login dan hak akses** — Better Auth, cookie sesi `HttpOnly`, RBAC, dan PostgreSQL Row-Level Security. Nodemailer memakai SMTP perusahaan untuk undangan dan pemulihan akun.
- **Audit dan backup** — Tabel audit PostgreSQL dengan trigger, serta `pgBackRest` untuk backup dan pemulihan.
- **Monitoring prioritas 1** — Pino dan Prometheus untuk error, penggunaan API, serta latensi p95 dari CEO selesai bicara sampai fakta pertama terdengar.
- **Pengujian** — Vitest untuk logika, pgTAP untuk kueri dan hak akses, serta Playwright untuk alur mobile dan desktop. Periksa ketepatan jawaban suara terhadap timesheet dalam pengujian end-to-end.
- **Deployment dan CI** — Docker Compose dan Caddy untuk aplikasi self-hosted via HTTPS, serta GitHub Actions untuk build dan pengujian. OpenAI adalah satu-satunya penyedia AI dan layanan aplikasi berlangganan.
