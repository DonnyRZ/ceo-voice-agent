# Pipeline cepat dan dapat diulang

- Jalur rilis hanya memuat validasi branch, pengujian backend/database/unit, typecheck/build, smoke test container, pengiriman image, migrasi, dan health check.
- Chromium, Playwright, dan regresi visual dijalankan pada workflow terpisah untuk PR atau manual. Keduanya bukan dependensi job deployment dan tidak dipasang pada VPS.
- Bangun aplikasi di runner. VPS menjalankan image yang sudah diuji; jangan npm install/build di VPS.
- Rilis hanya commit hasil merge PR yang sah dan masih menjadi head branch tujuan. Direct push tidak boleh dipublikasikan atau di-deploy.
- Gunakan concurrency per lingkungan dan lock VPS. Jangan membatalkan deployment yang sudah mengubah server untuk memberi jalan kepada commit baru.
- Cache/pakai ulang image infrastruktur yang tersedia. Jangan menambah pemeriksaan browser atau uji berbayar OpenAI pada jalur deploy.
- Validasi konfigurasi, backup, dan health check tetap wajib. Ukur durasi tiap tahap dan benahi bottleneck berdasarkan log.
