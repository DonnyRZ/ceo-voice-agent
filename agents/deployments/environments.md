# Stage dan produksi

- `develop` → stage; `main` → prod. Konfigurasi, origin HTTPS, database, role database, budget, dan secrets dipisah.
- Pakai PostgreSQL bersama yang sudah ada pada VPS. Jangan mengganti cluster, membuat ulang layanan, atau merestart PostgreSQL untuk rilis aplikasi.
- Semua kredensial hanya pada GitHub Environment/secrets atau file privat VPS. ID model dan kunci OpenAI tetap melalui environment backend.
- Verifikasi SSH host key. Dilarang melemahkan TLS atau StrictHostKeyChecking untuk meloloskan deploy.
- Aktivasi deployment menunggu koneksi SSH, konfigurasi server, GitHub Environments, dan domain siap. Jangan menganggap file contoh sebagai konfigurasi server yang telah terpasang.
- Jangan mengubah situs, firewall, akun, database, atau container aplikasi lain tanpa kebutuhan yang terverifikasi.

- Akses HTTP/HTTPS unrestricted tidak membuktikan TCP/SSH tersedia. Periksa metadata kebijakan TCP environment sebelum menyimpulkan layanan SSH VPS bermasalah. Jangan mengubah firewall atau service VPS untuk mengatasi pembatasan executor.
