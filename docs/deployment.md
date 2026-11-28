# Deployment stage dan prod

Domain yang ditetapkan: stage `https://ceo-stage.egiresources.com`, prod `https://ceo.egiresources.com`; keduanya mengarah ke VPS `212.85.24.238`. Sesudah verifikasi DNS, tinjau proxy yang sudah melayani port 80/443 sebelum menambahkan host CEO. Jangan mengganti default site atau konfigurasi aplikasi lain.

Inspeksi server menemukan Nginx native dan Certbot. Untuk pemasangan domain oleh engineer root, ikuti [langkah Nginx dan origin CEO](ceo-domains.md); contoh Caddy hanya berlaku jika proxy publik yang digunakan memang Caddy.

| Branch | Lingkungan | Database di PostgreSQL bersama | Gateway lokal | Slot blue / green |
| --- | --- | --- | --- | --- |
| `develop` | stage | `ceo_voice_agent_stage` | `127.0.0.1:4311` | `4321` / `4331` |
| `main` | prod | `ceo_voice_agent_prod` | `127.0.0.1:4312` | `4322` / `4332` |

## Alur branch dan auto-deploy

1. Buat topic branch: `feat/nama-fitur`, `fix/nama-perbaikan`, `refactor/nama-perubahan`, `perf/...`, `test/...`, `docs/...`, `chore/...`, `build/...`, `ci/...`, atau `security/...`.
2. Buat PR topic branch → `develop`. Setelah siap ditinjau, aktifkan auto-merge native GitHub per PR dengan metode merge commit. GitHub menunggu required checks dan seluruh persyaratan branch terpenuhi. Sesudah merge otomatis, CI membangun dan menguji image stage lalu auto-deploy ke stage sesudah CI lulus.
3. Hanya atas permintaan eksplisit pemilik, buat PR promosi produksi `develop` → `main` dari repository yang sama dan aktifkan auto-merge pada PR production tersebut. Jangan otomatis membuat PR ke `main`. Gunakan merge commit, bukan squash/rebase untuk promosi ini. Sesudah merge dan CI lulus, prod auto-deploy.

### Auto-merge native GitHub

Pemilik/admin mengaktifkan **Settings → General → Pull Requests → Allow auto-merge** dan mempertahankan **Allow merge commits**. Pengaturan repository ini tidak otomatis mengaktifkan auto-merge pada setiap PR; engineer atau integrasi GitHub yang sesuai tetap harus mengaktifkannya per PR yang sudah siap ditinjau:

```sh
gh pr merge NOMOR_PR --repo DonnyRZ/ceo-voice-agent --auto --merge
```

Aktifkan ketika checks masih berjalan agar GitHub menunggu `checks`, `branch-policy`, dan seluruh persyaratan proteksi branch. Jika checks gagal, perbaiki melalui topic branch yang sama dan biarkan pemeriksaan berjalan lagi. Jangan memakai `--admin`, melemahkan aturan review, atau melewati larangan direct push, force push, dan penghapusan branch. Pengujian browser tetap terpisah dan bukan required check tambahan untuk deployment.

Tidak diperlukan workflow merge, PAT, secret, cron, atau layanan baru. Hindari workflow yang melakukan merge memakai `GITHUB_TOKEN`, karena event hasil tindakannya dapat tidak memicu workflow deployment berikutnya. Auto-merge native menjalankan merge setelah persyaratan terpenuhi; workflow `push` yang sudah ada kemudian menjalankan jalur stage atau prod sesuai branch tujuan.

Dilarang push langsung ke `develop`/`main` atau PR topic branch langsung ke `main`. Workflow Branch policy memeriksa metadata PR tanpa menjalankan kode PR dengan hak istimewa. Job package memeriksa lewat GitHub API bahwa SHA release berasal dari PR yang sudah di-merge dengan asal/tujuan yang sah; commit direct push ditolak.

**Branch protection tetap diperlukan untuk mencegah push di server GitHub.** Pemilik/admin menerapkan `.github/branch-protection.example.json` ke kedua branch dan menjadikan `checks` serta `branch-policy` wajib. Konfigurasi tersebut mewajibkan PR, berlaku pada admin, menolak force push/penghapusan, dan tidak mewajibkan approval orang lain untuk workflow developer tunggal. Workflow tidak dapat menggantikan kontrol server ini. API integrasi tetap mendapat HTTP 403 untuk administrasi protection; engineer melaporkan perlindungan kedua branch sudah dipasang melalui akses admin pada 27 November 2026.

Semua aturan kerja tersimpan dalam [agents/deployments/](../agents/deployments/README.md).

## Pipeline ringan

`.github/workflows/checks.yml` menjalankan validasi branch, unit/backend/frontend, kebijakan PostgreSQL, typecheck/build, dan tes script deployment. Tidak menginstal atau menjalankan Chromium. Frontend dan backend dikompilasi sekali di runner. Hasil build diteruskan sebagai artifact commit yang sama ke job package; Docker hanya memasang dependency produksi dan mengemas hasil yang sudah diperiksa. Setelah merge ke develop/main, image menjalankan smoke test UI/API/database pada container sementara. Ini tidak memakai browser atau OpenAI berbayar.

`.github/workflows/ui-regression.yml` menjalankan Playwright, pengujian alat evaluasi AI, stress test gateway, dan audit dependency secara terpisah pada PR atau manual. pgTAP hanya dijalankan pada checks utama; setup database pada regresi terpisah cukup migrasi dan seed. Job ini bernama `ui-regression`, bukan `checks`, dan bukan dependensi atau required check jalur deployment. Pengujian browser tetap tersedia untuk pengembangan tanpa memperlambat setiap deployment.

Versi PostgreSQL dan konfigurasi backup diambil dalam satu koneksi preflight. Audit npm dilakukan terpisah dari install dependency. Artifact build otomatis kedaluwarsa dalam satu hari.

Runner deployment khusus di VPS menarik image GHCR yang sudah diuji menggunakan token otomatis GitHub; tidak menjalankan npm install/build, browser, atau pengujian aplikasi. Image release memakai SHA dan run/attempt unik. Commit yang sudah digantikan head branch terbaru tidak di-deploy. Checks dan packaging commit yang sudah digantikan dibatalkan otomatis; job deployment yang sudah menyentuh server tidak dibatalkan. Concurrency deployment dan `flock` VPS mencegah dua release lingkungan yang sama berjalan bersamaan. Image PostgreSQL client dan gateway dipakai ulang jika sudah tersedia.

## Pergantian versi tanpa menghentikan slot aktif

- Gateway lokal Caddy tetap hidup di port 4311/4312; proxy HTTPS publik meneruskan trafik ke port tersebut. API admin Caddy dinonaktifkan. Image gateway dipin versi dan digest.
- Kandidat dijalankan pada slot kosong, dengan port loopback berbeda dari versi aktif. Backup dan migrasi dilakukan sementara aplikasi lama tetap melayani. Migrasi diberi batas tunggu lock 3 detik dan statement 60 detik.
- Image, label commit, database, kesehatan kandidat, dan sumber HTML diperiksa sebelum pengalihan. Bundle JS/CSS hash disalin ke penyimpanan gateway; aset versi aktif dan satu versi sebelumnya dipertahankan agar tab lama masih dapat memuatnya.
- Konfigurasi gateway tetap. Matcher file membaca satu pointer symlink `gateway/current` per permintaan untuk memilih blue/green. Switch mengganti symlink secara atomik, tanpa reload/restart listener HTTP. Kandidat gagal tidak menggantikan slot aktif; switch gagal dipulihkan ke pointer lama. Jika konfigurasi gateway berubah, rilis aplikasi ditolak dan diperlukan upgrade gateway terencana.
- POST pembukaan sesi suara mendapat cookie `ceo_voice_slot`, `HttpOnly`, `Secure`, `SameSite=Strict`. Cookie hanya digunakan untuk merutekan endpoint sesi suara yang sudah ada ke proses asal. Otorisasi akun/pemilik sesi tetap diperiksa aplikasi. Sesi baru memakai slot baru.
- Setelah switch, slot lama menolak sesi suara baru dan menyelesaikan sesi yang sudah ada. Listener dan koneksi yang sudah ada tetap berjalan. Setelah sesi habis, rute lama dihapus dan container lama dihentikan secara graceful lalu dihapus.
- Menunggu sesi lama terjadi setelah versi baru sudah melayani; bukan downtime aplikasi. Jika sesi/control lama tertahan, kedua slot dipertahankan. Deployment berikutnya tidak boleh menimpa slot yang masih mempunyai sesi.

Tidak ada pemulihan database otomatis ketika rollback aplikasi: tindakan itu dapat menghapus perubahan pengguna. Semua migrasi wajib kompatibel dengan dua versi bersamaan. Perubahan destructive memakai expand/contract pada release terpisah. Kapasitas VPS harus cukup untuk dua proses aplikasi saat pergantian; pola ini tidak menghilangkan kegagalan host, database, atau migrasi yang tidak kompatibel.

## Cleanup aman

Setiap akhir percobaan deploy, `cleanup.sh` hanya menghapus tag release milik repository dan lingkungan terkait, dengan label sumber GitHub yang cocok. Image aktif, satu image rollback, dan image yang dipakai container mana pun dipertahankan. Dengan kondisi normal, masing-masing lingkungan menyimpan dua image release. Kegagalan deployment awal juga dibersihkan ketika tidak ada container yang memakainya.

Tidak ada `docker system prune`, volume prune, atau penghapusan image paksa/global. Container slot lama dihapus setelah drain. Database, volume budget, backup, dan image layanan lain tidak disentuh. Bundle frontend hanya dipertahankan untuk commit aktif dan rollback; cleanup aset batal jika manifest proteksi tidak lengkap. Docker log dibatasi 10 MB per file, 5 file aplikasi dan 3 file gateway.

Backup berada pada kebijakan terpisah; tetapkan retensi dan penyalinan off-host sebelum aktivasi. Cleanup image tidak menghapus backup.

## Prasyarat dan konfigurasi VPS

- Linux amd64, Docker Engine/Compose v2, Bash, Python 3, curl, flock, dan OpenSSL.
- Runner GitHub Actions Linux amd64 khusus repository ini, label `ceo-agent-deploy`, dijalankan sebagai layanan dengan akun khusus yang mempunyai akses Docker dan direktori deployment. Build, pengujian, dan package tetap memakai runner GitHub.
- `gh` CLI dan akses HTTPS keluar ke GitHub/GHCR. Tidak diperlukan koneksi SSH dari workspace untuk rilis rutin.
- PostgreSQL bersama versi 15+ dengan `vector` dan `pg_trgm`. Jangan mengganti cluster atau merestart PostgreSQL untuk rilis aplikasi.
- Port loopback gateway dan slot di tabel tersedia. Tidak perlu membuka port tersebut ke internet.
- Domain HTTPS stage/prod; proxy publik yang sudah ada ditinjau sebelum menambah konfigurasi. Contoh integrasi di `infra/deploy/Caddyfile.example`. HTTPS dibutuhkan untuk mikrofon dan cookie sesi suara.

Buat `/var/www/ceo-agent/stage` dan `/var/www/ceo-agent/prod` mode 0700, dimiliki akun runner deployment. Masing-masing mempunyai:

- `shared/api.env` mode 0600: URL database role app, origin HTTPS, SMTP perusahaan, session secret, token deployment acak, konfigurasi AI/model/budget. Ikuti `infra/deploy/api.env.example`. Token deployment berupa hex 64 karakter tanpa tanda kutip.
- `shared/compose.env` mode 0600: tiga port `GATEWAY_PORT`, `BLUE_PORT`, dan `GREEN_PORT`. Salin contoh `compose.stage.env.example` atau `compose.prod.env.example` sesuai lingkungan. Parser menolak variabel lain, ekspresi shell, port duplikat, dan port tidak valid. Jangan mengubah port gateway yang sudah aktif tanpa upgrade terencana.
- `shared/migrate.env` mode 0600: `DATABASE_ADMIN_URL` milik owner database lingkungan. Kredensial ini tidak masuk container aplikasi.
- `releases/<SHA>/` berisi script dan Compose dari commit terverifikasi; konfigurasi privat tetap di `shared`, di luar checkout runner dan tidak ditimpa release.
- `active-image`, `rollback-image`, `active-slot`, `active-commit`, `rollback-commit`, folder `gateway/`, dan `backups/` dikelola script deployment.

`GH_TOKEN` memakai `${{ github.token }}` dengan `contents: read` dan `packages: read`. Token hanya dipakai untuk mengecek head branch dan menarik image; konfigurasi login Docker dibuat sementara lalu dihapus, tanpa mengganti kredensial Docker pengguna lain. `RELEASE_ID` adalah SHA commit; `RELEASE_IMAGE_ID` memverifikasi ID image yang dihasilkan job package. Tidak dibutuhkan PAT atau secret SSH untuk jalur ini.

Compose app hanya menjalankan aplikasi. Compose gateway menjalankan proxy lokal. Budget suara disimpan pada volume `ceo-stage-voice-budget` / `ceo-prod-voice-budget`, dipakai bersama kedua slot pada lingkungan yang sama; pergantian slot tidak mereset ledger biaya. Jangan menyalin akun seed ke produksi.

Instalasi lama yang sudah memakai topologi satu port memerlukan migrasi gateway terencana; script menolak menerka slot jika marker `active-slot` belum ada. Instalasi pertama langsung memakai topologi baru; keadaan VPS harus diperiksa sebelum pemasangan.

## Database pada PostgreSQL bersama

Jalankan `infra/deploy/bootstrap-database.sql` sekali melalui administrator cluster yang sudah ada. Script membuat database dan owner/app role terpisah, menolak nama yang sudah ada, mencabut koneksi PUBLIC, serta memasang ekstensi. Role runtime bukan superuser dan tidak bypass RLS.

```sh
export CEO_OWNER_PASSWORD="$(openssl rand -hex 32)"
export CEO_APP_PASSWORD="$(openssl rand -hex 32)"
psql -X -v environment=stage -f infra/deploy/bootstrap-database.sql
# Simpan nilai pada konfigurasi privat stage.
unset CEO_OWNER_PASSWORD CEO_APP_PASSWORD
# Ulangi untuk prod dengan password baru dan environment=prod.
```

Gunakan URL password yang di-URL-encode. Runtime/migrasi harus menunjuk host, port, dan database yang sama dengan user berbeda. Tidak ada bootstrap atau seed otomatis pada setiap release.

## Aktivasi GitHub

Pemilik/admin membuat Environment `stage` dan `prod`, membatasi branch masing-masing ke `develop` / `main`. Pada setiap Environment isi variable `APP_URL` HTTPS. Kedua Environment, domain, HTTPS, APP_ORIGIN server, dan APP_URL sudah disiapkan engineer. Respons persiapan kedua domain sudah diverifikasi; deployment aplikasi dijalankan melalui merge PR.

Pasang runner sekali pada VPS melalui **Settings → Actions → Runners → New self-hosted runner**, pilih Linux x64, dan jalankan instruksi GitHub di VPS dengan akun khusus. Gunakan label tambahan `ceo-agent-deploy` pada `config.sh --labels ceo-agent-deploy`, lalu instal/jalankan service runner. Token registrasi runner dari halaman tersebut hanya untuk instalasi, berbeda dengan `GH_TOKEN` otomatis tiap job; jangan simpan token registrasi dalam Git atau log/chat. Runner harus terdaftar khusus untuk repository ini; jangan mengganti atau merestart runner aplikasi lain.

Repository ini publik. Batasi izin penulisan workflow, wajibkan approval untuk semua workflow dari kontributor luar, dan jangan menyetujui job PR/fork yang meminta runner VPS. Perlindungan branch dan pembatasan Environment harus terpasang sebelum aktivasi. Runner dengan akses Docker mempunyai akses istimewa ke host; kode PR/fork tidak boleh berjalan di sana. Pipeline ini menempatkan seluruh job PR, checks, package, dan regresi pada runner GitHub; runner VPS hanya dipilih untuk deploy hasil merge yang sudah diverifikasi.

Sesudah runner, konfigurasi shared, database, proxy/domain, dan backup siap, merge PR ke `develop` menjalankan CI, mengemas image terverifikasi, lalu langsung deploy stage. Promosi prod hanya melalui merge PR `develop` → `main`. Tidak ada variable pengaktifan deployment tambahan. PR yang belum di-merge tidak menjalankan deployment; commit direct push dan commit lama tetap ditolak. Untuk menahan rilis prod, jangan membuat/merge PR ke `main`.

Workspace tidak memerlukan login Cloud Browser atau akses TCP ke VPS. Akses administrasi GitHub untuk variable/runner/protection masih terbatas, tetapi rilis rutin hanya memakai token otomatis workflow. Runner, database, file shared, serta HTTPS kedua domain telah diverifikasi. SMTP masih menunggu konfigurasi untuk undangan/pemulihan akun. Jangan menganggap kesiapan infrastruktur sebagai bukti deployment aplikasi sudah berhasil; periksa run CI dan endpoint aplikasi sesudah merge.

## Pemeriksaan runner sebelum domain tersedia

Sesudah perubahan workflow mencapai default branch, jalankan `checks.yml` secara manual pada `develop` atau `main` dengan input `vps_readiness=true`. Job hanya memakai runner VPS untuk memeriksa konfigurasi stage/prod sesuai branch. Tidak ada build, install paket, pull image, migrasi, perubahan data, restart, ataupun deployment. Pemeriksaan port kosong ini khusus tahap sebelum instalasi pertama dan tidak bergantung pada variable pengaktifan deployment.

Input tambahan `inspect_ingress=true` menampilkan metadata listener, service proxy, container, routing domain, dan lokasi sertifikat yang dapat dibaca akun runner. Tidak mencetak isi file konfigurasi, private key, atau environment container. Pemeriksaan ini tidak memberi akun runner hak root atau mengubah layanan.

### Perbaikan terencana gateway awal stage

Gateway awal pernah mengembalikan HTTP 200 kosong untuk Host domain publik karena alamat situs Caddy juga membatasi Host ke loopback. Konfigurasi baru memakai alamat tanpa matcher Host dengan `bind 127.0.0.1` tetap berlaku. Uji gateway kini meneruskan Host publik, termasuk HTTP/SSE dan pin sesi; smoke publik memvalidasi isi JSON, HTML, dan aset, bukan status saja.

Untuk konfigurasi stage lama yang sudah terpasang, jalankan `checks.yml` pada `develop` dengan input `repair_stage_gateway=true`. Ini merupakan maintenance bootstrap terpisah, bukan langkah rilis rutin. Job mengunci stage, menolak jika ada sesi suara aktif atau perubahan konfigurasi yang tidak dikenal, memvalidasi penghapusan batas Host yang spesifik, lalu merestart container gateway stage saja. Backend, database, Nginx, dan prod tidak diganti. Jika verifikasi gagal, konfigurasi lama dipulihkan; penerimaan sesi dilanjutkan kembali. Setelah perbaikan, rilis rutin kembali hanya mengganti pointer blue/green tanpa restart gateway.

Pemeriksaan mencakup akun runner, ownership/permission file privat, akses Docker/Compose, port, koneksi PostgreSQL owner/runtime, ekstensi, dan hak koneksi lintas database. Query memakai transaksi default baca-saja dengan batas waktu. Output hanya metadata aman; URL, password, dan pesan error mentah tidak dicetak. SMTP dan pengujian aplikasi setelah rilis tetap diperiksa terpisah. Ini bukan pengganti smoke test release sesudah domain tersedia.

Laporan engineer 27 November 2026 menyatakan setup runner/database selesai. Engineer juga melaporkan instalasi pgvector menarik PostgreSQL 16.15 → 16.16 dan restart otomatis sekitar 8 detik. Hal ini melanggar batas tanpa restart; cluster dilaporkan kembali active. Bukti asli berada pada komputer engineer dan belum dibaca dari workspace ini. Pemeriksaan runner berikutnya tidak memasang paket atau merestart layanan. Jangan mengklaim tidak ada dampak pada aplikasi lain hanya dari status cluster active.

## Verifikasi

```sh
npm run test:tools
npm run build
npm run build:server
docker build -t ceo-ci:local .
bash infra/deploy/smoke.sh ceo-ci:local
node --test infra/deploy/gateway-smoke.mjs
# Opsional, hanya lokal: dua slot app nyata dengan DB disposable.
# Menolak slot/port/volume ceo-stage yang sudah ada; bukan jalur CI deployment.
bash infra/deploy/rollout-smoke.sh ceo-ci:local
# Terpisah dari deployment:
npx playwright install chromium
npm run test:browser-tools
npm run test:e2e
```

Smoke database menggunakan dua database pada PostgreSQL sementara, bukan VPS. Uji gateway memakai dua HTTP fixture, cookie sesi, stream SSE, trafik saat switch atomik, aset lama, target tidak valid, dan pembalikan rute. Unit script menguji kegagalan migrasi/kandidat/switch, slot sibuk, drain tertahan, branch policy, serta isolasi cleanup. Uji ini membuktikan perilaku dalam lingkup skenario tersebut; bukan jaminan mutlak terhadap seluruh kondisi VPS.

### Hasil verifikasi 27 November 2026

- 244 tes backend dan 8 tes frontend lulus; typecheck/build frontend dan compiled backend lulus.
- Tes unit/script mencakup cabang gagal migrasi, kandidat gagal, config/switch gagal, slot sibuk, drain gagal, retensi image/aset, serta pembatalan transfer karena commit baru.
- Gateway nyata lulus 100 request bersamaan dengan 20 switch blue/green, pin sesi lama, pembukaan sesi baru, stream SSE yang tidak terputus, aset hash sebelumnya, penolakan endpoint internal, penolakan target tidak valid, dan pembalikan rute.
- Instalasi pertama dan blue → green berhasil memakai container aplikasi nyata dengan AI dinonaktifkan serta PostgreSQL disposable. Migrasi, sumber UI, marker slot/image, dan penghapusan container lama diverifikasi.
- Uji lokal memakai ulang image aplikasi yang sudah dibangun karena perubahan ini hanya menyentuh deployment/test/rules. Tidak ada panggilan OpenAI berbayar atau perubahan VPS. Bukti ini tidak menyatakan stage/prod sudah aktif.

Gateway tidak di-reload pada rilis rutin karena reload HTTP/1 dapat menutup koneksi pada celah penerimaan permintaan; lihat [laporan upstream Caddy](https://github.com/caddyserver/caddy/issues/8233). Rute berbasis file menggunakan [matcher file resmi Caddy](https://caddyserver.com/docs/caddyfile/matchers#file), tanpa modul tambahan atau layanan berlangganan.

### Audit efisiensi pipeline

- Hapus build frontend/backend dan instalasi dependency development di Docker; image memakai artifact dari build runner yang sama.
- Hapus instalasi/restart pgTAP dan uji SQL ganda pada workflow regresi UI. Pengujian kebijakan database tetap di checks utama.
- Pindahkan tes alat bantu pilot AI dan stress test gateway dari jalur rilis ke regresi mendalam. Unit deployment tetap wajib.
- Pisahkan audit npm dari install dependency; audit tetap tersedia pada regresi mendalam.
- Gabungkan pembacaan versi PostgreSQL dan metadata backup menjadi satu koneksi, dengan validasi database/ekstensi tetap berjalan.
- Pertahankan pengujian kode hasil merge karena hasil penggabungan dapat berbeda dari branch PR yang diuji. Backup, migrasi, isolasi data, verifikasi image, health check, dan perlindungan sesi aktif tetap diperlukan.

### Metode runner VPS

Mengikuti pola [workflow cari-kerja](https://github.com/EGI-HOLDING/cari-kerja/blob/main/.github/workflows/ci.yml): job deploy memakai self-hosted runner, token otomatis, SHA release, serta file shared di server. Build/test tetap dipisah ke runner GitHub agar VPS cukup menjalankan image. Blue-green, backup sebelum migrasi, sesi suara aktif, dan cleanup image terisolasi tetap dipertahankan.

Validasi perubahan runner VPS: 42 tes script/unit deployment lulus, termasuk stage/prod, image salah, head branch berubah sebelum/sesudah pull, kegagalan pull, lock bersamaan, pewarisan lock ke deploy, konfigurasi privat, dan penolakan ekspresi shell pada compose.env. Lint workflow dan sintaks Bash lulus. Instalasi awal serta blue → green dengan aplikasi nyata, shared env, dan PostgreSQL disposable juga lulus; container slot lama dihapus sesudah drain. Pengujian lokal ini tidak memasang runner maupun mengaktifkan server VPS.
