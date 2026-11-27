# Menjaga layanan ketika rilis

- Gunakan blue-green: jalankan kandidat pada slot kosong dan periksa kesehatan/UI sebelum trafik baru dialihkan. Jangan stop/recreate slot aktif untuk mengganti versi.
- Gateway lokal tetap hidup dengan konfigurasi tetap. Alihkan satu symlink rute secara atomik; dilarang reload/restart proxy pada rilis aplikasi rutin. Jika kandidat atau switch gagal, pertahankan/pulihkan pointer versi lama. Perubahan konfigurasi gateway memerlukan upgrade terencana tersendiri.
- Sesi suara yang sudah ada tetap menuju slot asal melalui cookie sesi suara. Sesi baru menuju slot baru. Jangan putus sesi suara lama untuk mempercepat deploy.
- Setelah trafik dialihkan, drain slot lama sampai sesi selesai, kemudian hapus container lamanya. Jika drain tertahan, pertahankan kedua slot dan gagalkan upaya memakai slot sibuk pada deploy berikutnya.
- Database stage/prod tetap terpisah dalam PostgreSQL bersama. Buat backup sebelum migrasi. Batasi waktu tunggu lock migrasi; jangan menurunkan/memulihkan database otomatis saat rollback aplikasi.
- Migrasi wajib kompatibel dengan kedua versi yang hidup bersamaan. Perubahan destructive memakai expand/contract terpisah.
- Ketersediaan tetap bergantung pada kapasitas VPS, kesehatan database/proxy, dan kompatibilitas migrasi. Jangan menjanjikan nol error tanpa bukti pengujian.
