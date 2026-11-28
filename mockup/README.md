# Dokumentasi mockup Ruang Kerja

Satu file gambar memuat satu mockup layar. Versi desktop dan mobile disimpan terpisah. Logo aplikasi berada di [folder logo](../logo/).

## Registrasi Anggota Divisi — menunggu review

Dibuat dengan OpenAI ImageGen pada 28 November 2026. Kedua gambar merupakan usulan desain untuk ditinjau pemilik, **belum persetujuan implementasi**. Perubahan ini hanya menambah gambar dan dokumentasi; tidak menambah halaman, endpoint, database, atau alur registrasi aplikasi.

| Versi | Gambar |
| --- | --- |
| Desktop | [Registrasi Anggota Divisi](Anggota-Divisi/desktop/15-registrasi.png) |
| Mobile | [Registrasi Anggota Divisi](Anggota-Divisi/mobile/15-registrasi.png) |

Isi rancangan: nama lengkap, email perusahaan, pilihan divisi, kata sandi, konfirmasi kata sandi, tombol Daftar, dan tautan Masuk. Pilihan divisi direncanakan mengikuti divisi yang dikelola Superadmin. Registrasi mandiri hanya untuk Anggota Divisi; CEO dan Superadmin tetap melalui undangan.

Gaya mengikuti login terbaru: teal/mint, latar terang, ikon sederhana, dan tipografi yang tenang. Ukuran implementasi nantinya tetap mengikuti [standar konsistensi UI](../docs/ui-consistency.md), bukan mengambil ukuran piksel mentah dari gambar ImageGen.

Tahap verifikasi email, konfirmasi keanggotaan divisi, dan panduan pemasangan aplikasi masih perlu diputuskan lebih lanjut. Gambar ini hanya menampilkan halaman awal registrasi, bukan keseluruhan onboarding.

## Login Superadmin — dokumentasi yang sudah tersedia

Kedua mockup berikut sudah tersimpan di repository sebelum penambahan mockup registrasi:

| Versi | Gambar |
| --- | --- |
| Desktop | [Login Superadmin](Superadmin/desktop/24-login-superadmin.png) |
| Mobile | [Login Superadmin](Superadmin/mobile/24-login-superadmin.png) |

Catatan: gambar login Superadmin merupakan referensi desain terdahulu. Aturan terbaru tentang keseragaman ukuran, login tanpa scroll, serta penghapusan panah dan teks kembali ke login pengguna **menggantikan bagian gambar lama yang bertentangan**, sesuai [aturan frontend](../agents/frontend.md) dan [konsistensi UI](../agents/ui-consistency.md). Jangan mengembalikan elemen lama tersebut saat implementasi.
