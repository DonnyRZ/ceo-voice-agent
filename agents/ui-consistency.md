# Konsistensi ukuran frontend

- Bandingkan hasil render nyata seluruh halaman dan kondisi interaksi pada desktop dan mobile. Memakai ulang komponen bukan bukti bahwa tampilannya konsisten; jangan membuat komponen React bersama sebagai solusi audit ini.
- Gunakan standar ukuran CSS yang sama untuk komponen sejenis: logo, judul halaman, judul bagian, teks, ikon navigasi/inline, badge, tombol, dan kontrol formulir. Bedakan kategori semantik secara eksplisit; angka ringkasan dan ilustrasi utama bukan teks atau ikon inline.
- Ukuran boleh berubah pada breakpoint yang terdokumentasi, tetapi tidak boleh berbeda hanya karena peran, halaman, kondisi kosong, error, atau dialog.
- Login umum dan Superadmin harus muat satu layar pada viewport pengujian normal tanpa scroll atau konten terpotong. Jangan menyembunyikan overflow untuk menutupi masalah; akses saat zoom/keyboard juga harus tetap tersedia.
- Login Superadmin tidak menampilkan panah maupun teks kembali ke login pengguna.
- Sebelum membuka PR ke `develop`, selesaikan matriks seluruh rute/kondisi desktop dan mobile, periksa screenshot secara visual serta ukuran hasil render, perbaiki semua temuan, dan jalankan regresi interaksi. Cantumkan cakupan dan batas pengujian; jangan menyebut halaman diperiksa hanya karena memakai CSS/komponen yang sama.
- Bersihkan aturan ukuran lama yang sudah digantikan; jangan menumpuk override untuk menyamarkan konflik. Pengujian visual tetap terpisah dari jalur deploy.
