# Stage dan produksi

- `develop` → stage; `main` → prod. Konfigurasi, origin HTTPS, database, role database, budget, dan secrets dipisah.
- Pakai PostgreSQL bersama yang sudah ada pada VPS. Jangan mengganti cluster, membuat ulang layanan, atau merestart PostgreSQL untuk rilis aplikasi.
- Semua kredensial hanya pada GitHub Environment/secrets atau file privat VPS. ID model dan kunci OpenAI tetap melalui environment backend.
- Rilis memakai runner self-hosted khusus repository ini di VPS, label `ceo-agent-deploy`. Tidak memerlukan SSH dari workspace atau token GitHub pribadi.
- `GH_TOKEN` berasal dari `${{ github.token }}`, hanya untuk GitHub API/GHCR. `RELEASE_ID` adalah SHA commit; ID image diverifikasi terpisah.
- Stage/prod berada di `/var/www/ceo-agent/stage` dan `/var/www/ceo-agent/prod`. Konfigurasi privat masing-masing: `shared/api.env`, `shared/compose.env`, dan `shared/migrate.env`, mode 0600. Jangan commit isi file server.
- Aktivasi deployment menunggu runner VPS, konfigurasi server, GitHub Environments, dan domain siap. Jangan menganggap file contoh sebagai konfigurasi server yang telah terpasang.
- Runner VPS tidak boleh menjalankan kode PR/fork atau pekerjaan pengujian. Build/pengujian berada di runner GitHub; VPS hanya menerima commit merge yang sudah diverifikasi. Batasi branch Environment dan perlindungan branch sebelum aktivasi.
- Jangan mengubah situs, firewall, akun, database, atau container aplikasi lain tanpa kebutuhan yang terverifikasi.
- Sebelum memasang dependency pada VPS bersama, periksa rencana perubahan paket. Jangan menjalankan instalasi yang akan memperbarui PostgreSQL atau merestart layanan bersama sebagai bagian setup/deploy aplikasi; pisahkan ke pekerjaan maintenance yang dijadwalkan.

- Akses HTTP/HTTPS unrestricted tidak membuktikan TCP/SSH tersedia. Periksa metadata kebijakan TCP environment sebelum menyimpulkan layanan SSH VPS bermasalah. Jangan mengubah firewall atau service VPS untuk mengatasi pembatasan executor.
