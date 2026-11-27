# Aturan Codebase

- Gunakan arsitektur modular monolith dengan satu backend untuk seluruh modul aplikasi.
- Kelompokkan kode berdasarkan fitur. Susun modul seperti `auth/`, `divisions/`, `timesheets/`, `audit/`, dan `ai/` di `backend/modules/`.
- Beri setiap file satu tanggung jawab. Pisahkan rute, validasi, logika bisnis, dan akses data di dalam modul yang memilikinya.
- Targetkan sekitar 100–200 baris per file kode. Saat fitur bertambah, pecah file berdasarkan tanggung jawabnya.
- Saat mengganti pendekatan yang sudah ditinggalkan, ikuti [Aturan Penggantian Implementasi](implementation-replacement.md).
- Untuk kode AI, ikuti [Aturan Codebase AI](ai-codebase.md).
- Untuk implementasi UI, ikuti [Aturan Frontend](frontend.md).
- Gunakan teknologi yang tercatat di [Tech Stack Ruang Kerja](tech-stack.md).
