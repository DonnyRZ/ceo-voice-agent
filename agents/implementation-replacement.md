# Aturan Penggantian Implementasi

- Aturan ini berlaku untuk revisi metodologi, sistem, backend, frontend, dan flow pengguna. Versi yang sudah digantikan tidak boleh tetap menjadi fallback, jalur alternatif tersembunyi, atau pilihan melalui konfigurasi; tidak ada pengecualian untuk menghidupkan kembali versi yang ditinggalkan ketika versi baru gagal.
- Saat mengganti pendekatan yang sudah diputuskan untuk ditinggalkan, hapus implementasi lama dalam perubahan yang sama. Telusuri impor, konfigurasi, sakelar fitur, skrip audit, tes, dan dokumentasi yang hanya melayani pendekatan lama.
- Hapus halaman, komponen, stylesheet, aset/mockup aktif, serta rute atau tautan yang hanya melayani flow yang digantikan. Perbarui referensi dan skenario uji menjadi alur baru; jangan menumpuk versi baru di atas implementasi lama. Bagian yang tetap dipakai dalam desain baru dipertahankan berdasarkan tanggung jawabnya.
- Dilarang memakai pendekatan yang sudah ditinggalkan sebagai fallback saat implementasi aktif gagal, melewati batas waktu, atau menerima respons yang tidak valid. Laporkan kegagalan sesuai kontrak fitur dan catat penyebabnya untuk evaluasi.
- Untuk intent detection CEO, pakai interpretasi terstruktur dari model OpenAI yang dikonfigurasi pada backend. Jika interpretasi gagal, sampaikan bahwa timesheet belum bisa diperiksa pada giliran itu. Klarifikasi tetap berlaku jika interpretasi berhasil tetapi proyek, tugas, atau cakupan belum dapat dipastikan.
- Pertahankan riwayat migrasi yang sudah diterapkan dan hasil pengujian terdahulu. Simpan rujukan ke versi lama melalui riwayat Git jika diperlukan.
- Setelah pembersihan, periksa referensi yang tersisa dan jalankan pengujian untuk jalur aktif dan penanganan kegagalannya.
