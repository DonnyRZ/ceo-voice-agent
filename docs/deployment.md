# Deployment stage dan prod

| Branch | GitHub Environment | Database pada PostgreSQL bersama | Port lokal VPS |
| --- | --- | --- | --- |
| `develop` | `stage` | `ceo_voice_agent_stage` | `127.0.0.1:4311` |
| `main` | `prod` | `ceo_voice_agent_prod` | `127.0.0.1:4312` |

Kedua lingkungan memakai cluster PostgreSQL yang sudah ada. Compose deployment hanya menjalankan aplikasi, tanpa membuat, mengganti, memulai ulang, atau menghapus layanan PostgreSQL bersama. Setiap database mempunyai owner migrasi dan role aplikasi sendiri. Role aplikasi tidak mempunyai hak superuser atau bypass RLS. Data stage tidak disalin dari prod.

## Alur otomatis

Workflow `.github/workflows/checks.yml` menjalankan seluruh pengujian. Push pada `develop` atau `main` yang lulus membangun image Node.js 24, menjalankan uji container dengan database sementara stage/prod, lalu menerbitkan image `ghcr.io/donnyrz/ceo-voice-agent:stage-sha-COMMIT-RUN-ATTEMPT` atau `prod-sha-COMMIT-RUN-ATTEMPT`.

Job deploy baru berjalan setelah variabel repository `STAGE_DEPLOY_ENABLED=true` atau `PROD_DEPLOY_ENABLED=true` diaktifkan. Selama belum dikonfigurasi, pengujian dan publikasi image tetap berjalan, sedangkan deployment VPS dilewati. Tidak ada password VPS/PostgreSQL di workflow.

Runner mengunduh image dan mengirimkannya melalui SSH. VPS tidak menyimpan token registry. Tag unik setiap run menghindari benturan stage/prod dan rerun. ID image dan label commit diperiksa sebelum deployment. Commit yang sudah digantikan branch terbaru tidak di-deploy. Job dan lock VPS mencegah deployment lingkungan yang sama berjalan serentak.

Deployment melakukan pemeriksaan database dan ekstensi, membuat backup `pg_dump` dengan versi client sesuai server, menolak sesi suara baru sementara sesi aktif diselesaikan, menjalankan migrasi forward, lalu mengganti container. Kegagalan migrasi mengaktifkan kembali penerimaan sesi pada versi lama. Kegagalan kesehatan container mengembalikan image sebelumnya. Ledger biaya suara berada dalam volume permanen yang berbeda untuk setiap lingkungan.

Rollback otomatis hanya mengganti aplikasi. Database tidak diturunkan atau dipulihkan secara otomatis karena dapat menghapus perubahan pengguna. Migrasi berikutnya harus kompatibel dengan image sebelumnya. Untuk perubahan skema yang tidak kompatibel, gunakan tahap expand/contract dan rencana pemulihan tersendiri.

## Prasyarat VPS

- Linux dengan Docker Engine, Compose v2, Bash, Python 3, curl, flock, dan OpenSSL.
- SSH yang dapat dijangkau runner GitHub, kunci deployment tersendiri, dan fingerprint host yang diverifikasi.
- PostgreSQL bersama versi 15 atau lebih baru dengan ekstensi `vector` dan `pg_trgm` tersedia. Periksa versi, port, konfigurasi jaringan, dan backup yang ada sebelum mengubah server.
- Port loopback 4311/4312 tersedia. Aplikasi memakai host networking agar dapat membaca PostgreSQL yang hanya tersedia di loopback VPS.
- Proxy HTTPS yang sudah ada ditinjau sebelum konfigurasi baru ditambahkan. Contoh Caddy di `infra/deploy/Caddyfile.example` mengalirkan SSE tanpa buffering dan menolak `/internal/*` dari internet. HTTPS diperlukan untuk izin mikrofon di browser.
- Arsitektur image saat ini `linux/amd64`, mengikuti runner `ubuntu-latest`. Verifikasi arsitektur VPS sebelum aktivasi.

## Persiapan database sekali saja

Script `infra/deploy/bootstrap-database.sql` dijalankan menggunakan administrator PostgreSQL yang sudah ada. Script menolak lingkungan selain stage/prod dan menolak menimpa nama database/role yang sudah ada. Password owner dan app harus acak, berbeda, dan minimal 32 karakter.

Set koneksi administrator melalui konfigurasi PostgreSQL privat pada VPS. Jangan menyimpan kredensial administrator bersama aplikasi atau di Git.

```sh
# Jalankan dari shell administrator yang mempunyai koneksi ke cluster bersama.
export CEO_OWNER_PASSWORD="$(openssl rand -hex 32)"
export CEO_APP_PASSWORD="$(openssl rand -hex 32)"
psql -X -v environment=stage -f infra/deploy/bootstrap-database.sql
# Simpan dua nilai di file privat stage sebelum membersihkan variabel.
unset CEO_OWNER_PASSWORD CEO_APP_PASSWORD
# Ulangi untuk prod dengan dua password acak baru, -v environment=prod.
```

Script membuat database baru dan role `ceo_stage_owner`/`ceo_stage_app` atau `ceo_prod_owner`/`ceo_prod_app`. Instalasi ekstensi yang belum tersedia harus disesuaikan dengan versi PostgreSQL yang ditemukan; jangan mengganti cluster bersama.

## File privat pada VPS

Siapkan `/opt/ceo-voice-agent/stage` dan `/opt/ceo-voice-agent/prod` dengan permission direktori 0700. Masing-masing berisi:

- `runtime.env`, mode 0600, mengikuti `infra/deploy/runtime.env.example`. Isi URL database role app, origin HTTPS, SMTP perusahaan, kunci sesi acak, token deployment acak, konfigurasi model dan kunci OpenAI. Token deployment berupa hex 64 karakter tanpa tanda kutip.
- `migrate.env`, mode 0600, hanya berisi `DATABASE_ADMIN_URL` milik owner database lingkungan itu. File ini dipakai container migrasi/backup, bukan proses aplikasi.
- `active-image` dan `active-commit` ditulis otomatis setelah deployment berhasil.
- `backups/` menyimpan snapshot sebelum migrasi. Salin backup ke penyimpanan backup yang sudah tersedia dan tetapkan retensi setelah memeriksa kapasitas VPS. Script tidak menghapus backup lama otomatis.

Gunakan URL PostgreSQL dengan password yang di-URL-encode. Host, port, dan nama database runtime/migrasi harus sama; user harus berbeda. Origin, session secret, token deployment, SMTP, konfigurasi AI, dan budget setiap lingkungan dikelola terpisah. Jangan menyalin akun seed atau password uji ke produksi. Bootstrap akun Superadmin dilakukan sekali dengan kredensial perusahaan melalui CLI administrasi yang tersedia.

## GitHub Environments

Pemilik repo menyiapkan Environment `stage` dan `prod` di Settings → Environments. Batasi branch deployment stage ke `develop`, prod ke `main`. Pipeline memakai branch asli untuk deployment.

Pada **masing-masing Environment**:

- Secret `VPS_SSH_KEY`: private key khusus deployment yang public key-nya dipasang pada akun SSH VPS.
- Variable `VPS_HOST`: alamat VPS.
- Variable `VPS_PORT`: port SSH yang diverifikasi.
- Variable `VPS_USER`: akun SSH deployment.
- Variable `VPS_KNOWN_HOSTS`: baris known_hosts dari host key yang sudah diverifikasi. Jangan mengambil fingerprint baru tanpa pemeriksaan pada setiap deployment.
- Variable `APP_URL`: origin HTTPS lingkungan itu. Pipeline memeriksa akses HTTPS melalui domain setelah pemeriksaan lokal VPS. Kegagalan proxy/DNS/TLS membuat job gagal untuk diperiksa; snapshot database tidak dipulihkan otomatis.

Setelah konfigurasi server, domain, backup, dan smoke test selesai, aktifkan variable **repository** `STAGE_DEPLOY_ENABLED=true`. Uji stage, lalu aktifkan `PROD_DEPLOY_ENABLED=true`. Aktivasi terpisah memungkinkan stage diuji sebelum prod berjalan.

Token integrasi GitHub yang tersedia saat persiapan mendapat HTTP 403 pada API pembuatan Environment. Pembuatan Environment dan pengisian secrets memerlukan akses pemilik/admin repo. Ini berbeda dari akses push kode yang sudah tersedia.

## Verifikasi

```sh
npm run build
npm run build:server
docker build -t ceo-ci:local .
bash infra/deploy/smoke.sh ceo-ci:local
node --test scripts/deployment-script.test.mjs
```

Uji container memakai dua database baru pada container PostgreSQL sementara, bukan VPS. Uji memeriksa migrasi compiled JavaScript, UI dan API produksi, token kontrol deployment, backup yang dapat dibaca, serta isolasi koneksi database. Tes backend memeriksa drain/resume tanpa menghentikan giliran suara aktif. Tes script memeriksa kegagalan migrasi, rollback image, dan penolakan parameter yang tidak valid.

Pada executor dengan proxy CA khusus, build lokal memakai Dockerfile sementara dengan CA sebagai BuildKit secret. CA tidak disalin ke image maupun konfigurasi repo dan verifikasi TLS tetap aktif.

Hasil verifikasi 27 November 2026: 244 tes backend, 8 tes frontend, 40 tes tool/script, typecheck, build server, build image produksi non-root, actionlint, dan smoke container kedua lingkungan lulus. Setiap database sementara berhasil menjalankan 19 migrasi dengan owner non-superuser, melayani UI/API, membatasi kontrol sesi dengan token, menolak koneksi role aplikasi ke database lingkungan lain, serta menghasilkan arsip backup yang dapat dibaca. Uji ini tidak memakai API OpenAI berbayar dan tidak menyentuh VPS.

CI awal main menemukan timeout pada uji intersepsi browser yang lulus di develop. Harness sekarang membatasi launch/navigasi/fetch, memberi waktu untuk cleanup, dan menutup koneksi server uji. Pemeriksaan kesamaan byte WAV tidak diubah. Kasus Chromium tersebut lulus dalam 12 pengulangan lokal setelah perbaikan.

Log CI kemudian memperlihatkan timeout terjadi saat launch Chromium sistem. Pemilihan otomatis browser sistem dihapus agar CI menggunakan browser yang dipasang oleh Playwright. Instalasi lokal khusus tetap didukung melalui `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, mengikuti konfigurasi Playwright aplikasi.

## Status koneksi awal

Pada 27 November 2026 koneksi SSH ke VPS yang diberikan pada port 22 ditolak sebelum autentikasi, termasuk percobaan dari sandbox, dengan akses jaringan tambahan, dan di luar sandbox. HTTP VPS memberi respons, tetapi itu tidak membuktikan SSH tersedia. Domain stage/prod ditunda oleh pemilik. Belum ada perubahan layanan, database, akun, firewall, atau proxy pada VPS.

Untuk melanjutkan konfigurasi langsung, akses SSH perlu tersedia. Dari console provider, operator dapat memeriksa `systemctl status ssh`, `ss -ltnp`, dan aturan firewall/allowlist. Gunakan hasil pemeriksaan tersebut untuk menentukan tindakan, tanpa menonaktifkan firewall secara menyeluruh.
