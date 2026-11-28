# Dokumentasi mockup Ruang Kerja

Satu file gambar memuat satu mockup layar. Versi desktop dan mobile disimpan terpisah. Logo aplikasi berada di [folder logo](../logo/).

## Registrasi Anggota Divisi — disetujui

Dibuat dengan OpenAI ImageGen pada 28 November 2026. Seluruh rangkaian desktop, Android, dan iPhone telah disetujui pemilik pada 28 November 2026. Implementasi dan batas platform dicatat pada [dokumentasi registrasi](../docs/member-registration.md).

| Versi | Gambar |
| --- | --- |
| Desktop | [Registrasi Anggota Divisi](Anggota-Divisi/desktop/15-registrasi.png) |
| Mobile Android | [Alur login, registrasi, dan pemasangan](Anggota-Divisi/mobile/onboarding-android/README.md) |
| Mobile iPhone | [Pilihan perangkat, panduan Safari, dan membuka aplikasi](Anggota-Divisi/mobile/onboarding-iphone/README.md) |

Isi data akun: nama lengkap, email perusahaan, pilihan divisi, kata sandi, dan konfirmasi kata sandi. Desktop mempertahankan tombol Daftar. Mobile direvisi menjadi flow dengan tombol Simpan dan lanjut, pilihan Android/iPhone, serta jalur pemasangan Android. Pilihan divisi direncanakan mengikuti divisi yang dikelola Superadmin. Registrasi mandiri hanya untuk Anggota Divisi; CEO dan Superadmin tetap melalui undangan.

Gaya mengikuti login terbaru: teal/mint, latar terang, ikon sederhana, dan tipografi yang tenang. Ukuran implementasi nantinya tetap mengikuti [standar konsistensi UI](../docs/ui-consistency.md), bukan mengambil ukuran piksel mentah dari gambar ImageGen.

Mockup mobile formulir tunggal terdahulu digantikan oleh alur onboarding Android/iPhone; riwayatnya tetap tersedia melalui Git. Desktop tidak diubah pada revisi ini. Akun langsung aktif setelah verifikasi email perusahaan pada divisi yang dipilih; domain awal adalah egiresources.com. Ketentuan pemasangan browser dijelaskan pada dokumentasi tiap platform. Mockup menjadi referensi implementasi yang sudah disetujui.

## Login Superadmin — dokumentasi yang sudah tersedia

Kedua mockup berikut sudah tersimpan di repository sebelum penambahan mockup registrasi:

| Versi | Gambar |
| --- | --- |
| Desktop | [Login Superadmin](Superadmin/desktop/24-login-superadmin.png) |
| Mobile | [Login Superadmin](Superadmin/mobile/24-login-superadmin.png) |

Catatan: gambar login Superadmin merupakan referensi desain terdahulu. Aturan terbaru tentang keseragaman ukuran, login tanpa scroll, serta penghapusan panah dan teks kembali ke login pengguna **menggantikan bagian gambar lama yang bertentangan**, sesuai [aturan frontend](../agents/frontend.md) dan [konsistensi UI](../agents/ui-consistency.md). Jangan mengembalikan elemen lama tersebut saat implementasi.
