# Deployment stage dan prod

| Branch | Lingkungan | Database di PostgreSQL bersama | Gateway lokal | Slot blue / green |
| --- | --- | --- | --- | --- |
| `develop` | stage | `ceo_voice_agent_stage` | `127.0.0.1:4311` | `4321` / `4331` |
| `main` | prod | `ceo_voice_agent_prod` | `127.0.0.1:4312` | `4322` / `4332` |

## Alur branch dan auto-deploy

1. Buat topic branch: `feat/nama-fitur`, `fix/nama-perbaikan`, `refactor/nama-perubahan`, `perf/...`, `test/...`, `docs/...`, `chore/...`, `build/...`, `ci/...`, atau `security/...`.
2. Buat PR topic branch → `develop`. Sesudah merge, CI membangun dan menguji image stage lalu auto-deploy jika stage sudah diaktifkan.
3. Promosi produksi melalui PR `develop` → `main` dari repository yang sama. Gunakan merge commit, bukan squash/rebase untuk promosi ini. Sesudah merge dan CI lulus, prod auto-deploy jika sudah diaktifkan.

Dilarang push langsung ke `develop`/`main` atau PR topic branch langsung ke `main`. Workflow Branch policy memeriksa metadata PR tanpa menjalankan kode PR dengan hak istimewa. Job package memeriksa lewat GitHub API bahwa SHA release berasal dari PR yang sudah di-merge dengan asal/tujuan yang sah; commit direct push ditolak.

**Branch protection tetap diperlukan untuk mencegah push di server GitHub.** Pemilik/admin menerapkan `.github/branch-protection.example.json` ke kedua branch dan menjadikan `checks` serta `branch-policy` wajib. Konfigurasi tersebut mewajibkan PR, berlaku pada admin, menolak force push/penghapusan, dan tidak mewajibkan approval orang lain untuk workflow developer tunggal. Workflow tidak dapat menggantikan kontrol server ini. Integrasi saat ini mendapat HTTP 403 ketika memasang protection; pengaturan tersebut belum terpasang.

Semua aturan kerja tersimpan dalam [agents/deployments/](../agents/deployments/README.md).

## Pipeline ringan

`.github/workflows/checks.yml` menjalankan validasi branch, unit/backend/frontend, kebijakan PostgreSQL, typecheck/build, dan tes script. Tidak menginstal atau menjalankan Chromium. Setelah merge ke develop/main, job package membangun image di runner, menjalankan smoke test UI/API/database pada container sementara, serta menguji pengalihan gateway dengan HTTP/SSE nyata. Ini tidak memakai browser atau OpenAI berbayar.

`.github/workflows/ui-regression.yml` menjalankan Playwright dan pengujian browser secara terpisah pada PR atau manual. Job ini bernama `ui-regression`, bukan `checks`, dan bukan dependensi atau required check jalur deployment. Pengujian browser tetap tersedia untuk pengembangan tanpa memperlambat setiap deployment.

VPS menerima image yang sudah diuji; tidak menjalankan npm install/build, browser, atau pengujian aplikasi. Image release memakai SHA dan run/attempt unik. Commit yang sudah digantikan head branch terbaru tidak di-deploy. Concurrency workflow dan `flock` VPS mencegah dua release lingkungan yang sama berjalan bersamaan. Image PostgreSQL client dan gateway dipakai ulang jika sudah tersedia.

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
- SSH dengan host key terverifikasi, akun deployment, dan kunci khusus.
- PostgreSQL bersama versi 15+ dengan `vector` dan `pg_trgm`. Jangan mengganti cluster atau merestart PostgreSQL untuk rilis aplikasi.
- Port loopback gateway dan slot di tabel tersedia. Tidak perlu membuka port tersebut ke internet.
- Domain HTTPS stage/prod; proxy publik yang sudah ada ditinjau sebelum menambah konfigurasi. Contoh integrasi di `infra/deploy/Caddyfile.example`. HTTPS dibutuhkan untuk mikrofon dan cookie sesi suara.

Buat `/opt/ceo-voice-agent/stage` dan `/opt/ceo-voice-agent/prod` mode 0700. Masing-masing mempunyai:

- `runtime.env` mode 0600: URL database role app, origin HTTPS, SMTP perusahaan, session secret, token deployment acak, konfigurasi AI/model/budget. Ikuti `infra/deploy/runtime.env.example`. Token deployment berupa hex 64 karakter tanpa tanda kutip.
- `migrate.env` mode 0600: `DATABASE_ADMIN_URL` milik owner database lingkungan. Kredensial ini tidak masuk container aplikasi.
- `active-image`, `rollback-image`, `active-slot`, `active-commit`, `rollback-commit`, folder `gateway/`, dan `backups/` dikelola script deployment.

Compose app hanya menjalankan aplikasi. Compose gateway menjalankan proxy lokal. Budget suara disimpan pada volume `ceo-stage-voice-budget` / `ceo-prod-voice-budget`, dipakai bersama kedua slot pada lingkungan yang sama; pergantian slot tidak mereset ledger biaya. Jangan menyalin akun seed ke produksi.

Instalasi lama yang sudah memakai topologi satu port memerlukan migrasi gateway terencana; script menolak menerka slot jika marker `active-slot` belum ada. Pada VPS ini belum ada deployment aplikasi, sehingga instalasi pertama langsung memakai topologi baru.

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

Pemilik/admin membuat Environment `stage` dan `prod`, membatasi branch masing-masing ke `develop` / `main`. Pada setiap Environment isi:

- Secret `VPS_SSH_KEY`.
- Variables `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_KNOWN_HOSTS`, dan `APP_URL` HTTPS.

Sesudah server, database, proxy/domain, backup, dan smoke test siap, aktifkan repository variable `STAGE_DEPLOY_ENABLED=true`, uji stage, lalu `PROD_DEPLOY_ENABLED=true`. Tanpa flag tersebut, package tetap tersedia dan deploy VPS dilewati. Runner mentransfer image lewat SSH, tanpa menyimpan token registry di VPS.

SSH, domain, dan Environment secrets sedang ditunda sesuai arahan pemilik. Pemeriksaan sebelumnya menemukan SSH port 22 ditolak sebelum autentikasi dan akses administrasi Environments/branch protection HTTP 403. Belum ada database, layanan, akun, firewall, atau proxy VPS yang diubah.

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
