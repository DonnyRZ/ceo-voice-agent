# Aturan Codebase AI

- Tempatkan logika AI di `backend/modules/ai/` dan buat subfolder tersendiri untuk setiap fitur AI.
- Gunakan `voice/` untuk sesi dan prompt voice agent. Gunakan `retrieval/` untuk pencarian data timesheet.
- Pisahkan pengelolaan sesi, prompt, integrasi API, dan pencarian data ke file sesuai tanggung jawabnya. Targetkan sekitar 100–200 baris per file kode.
- Kelola sesi, prompt, kredensial, dan pemanggilan API OpenAI di backend. Frontend menangani tampilan, izin mikrofon, koneksi WebRTC, dan pemutaran suara.
- Gunakan OpenAI sebagai satu-satunya penyedia AI. GPT Live 1.1 menangani seluruh percakapan CEO, termasuk mendengarkan, meminta klarifikasi, dan menyampaikan jawaban.
- Tafsirkan maksud CEO dari transkrip dan konteks melalui keluaran terstruktur. Validasi operasi baca, identitas, divisi, dan tanggal sebelum menjalankan kueri timesheet. Hindari aturan kata kunci sebagai penentu maksud.
- Baca ID model dan kunci OpenAI dari variabel lingkungan di backend. Simpan nilai lokal di `.env` yang diabaikan Git dan sediakan contoh konfigurasi di `.env.example`.
