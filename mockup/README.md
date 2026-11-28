# Dokumentasi mockup Ruang Kerja

Satu file gambar memuat satu mockup layar. Versi desktop dan mobile disimpan terpisah. Logo aplikasi berada di [folder logo](../logo/).

## Registrasi Anggota Divisi — disetujui

Dibuat dengan OpenAI ImageGen pada 28 November 2026. Seluruh rangkaian desktop, Android, dan iPhone telah disetujui pemilik pada 28 November 2026. Implementasi dan batas platform dicatat pada [dokumentasi registrasi](../docs/member-registration.md).

| Versi | Gambar |
| --- | --- |
| Desktop | [Registrasi Anggota Divisi](Anggota-Divisi/desktop/15-registrasi.png) |
| Mobile Android | [Alur login, registrasi, dan pemasangan](Anggota-Divisi/mobile/onboarding-android/README.md) |
| Mobile iPhone | [Pilihan perangkat, panduan Safari, dan membuka aplikasi](Anggota-Divisi/mobile/onboarding-iphone/README.md) |

Isi data akun tetap: nama lengkap, email perusahaan, divisi, kata sandi, dan konfirmasi. Kedua ukuran layar memakai Simpan dan lanjut → verifikasi email. Pengiriman dipicu tombol Kirim email verifikasi; email berisi tombol hyperlink menuju konfirmasi. Desktop selesai setelah verifikasi. HP menunggu verifikasi di browser asal sebelum memilih Android/iPhone dan memasang aplikasi.

Rancangan revisi menggunakan ImageGen, satu mockup per gambar. Pemilik secara eksplisit mengizinkan implementasi setelah mockup dibuat pada tugas ini. Versi gambar yang digantikan ditimpa pada lokasi kanonis; riwayat tersedia melalui Git.

- [Verifikasi desktop](Anggota-Divisi/desktop/registration-verification/README.md)
- [Verifikasi mobile dan perpindahan perangkat](Anggota-Divisi/mobile/registration-verification/README.md)
- [Email verifikasi bertombol](Anggota-Divisi/email/README.md)

Ukuran implementasi mengikuti [standar konsistensi UI](../docs/ui-consistency.md). Desktop aktif setelah konfirmasi email. Mobile aktif setelah verifikasi email dan penyelesaian tahap pemasangan/panduan; email terverifikasi saja belum menyelesaikan registrasi.

## Login Superadmin — dokumentasi yang sudah tersedia

Kedua mockup berikut sudah tersimpan di repository sebelum penambahan mockup registrasi:

| Versi | Gambar |
| --- | --- |
| Desktop | [Login Superadmin](Superadmin/desktop/24-login-superadmin.png) |
| Mobile | [Login Superadmin](Superadmin/mobile/24-login-superadmin.png) |

Catatan: gambar login Superadmin merupakan referensi desain terdahulu. Aturan terbaru tentang keseragaman ukuran, login tanpa scroll, serta penghapusan panah dan teks kembali ke login pengguna **menggantikan bagian gambar lama yang bertentangan**, sesuai [aturan frontend](../agents/frontend.md) dan [konsistensi UI](../agents/ui-consistency.md). Jangan mengembalikan elemen lama tersebut saat implementasi.

## Konfirmasi lintas browser dan animasi loading

Rancangan ImageGen dibuat sebelum implementasi dalam tugas sembilan langkah yang diotorisasi pemilik.

- [Konfirmasi kata sandi — desktop](Anggota-Divisi/desktop/registration-verification/confirm-password.png)
- [Konfirmasi kata sandi — mobile](Anggota-Divisi/mobile/registration-verification/confirm-password.png)
- [Loading tombol — desktop](Anggota-Divisi/desktop/registration-verification/verifying.png)
- [Loading tombol — mobile](Anggota-Divisi/mobile/registration-verification/verifying.png)
- [Loading sesi — desktop](Anggota-Divisi/desktop/loading/session.png)
- [Loading sesi — mobile](Anggota-Divisi/mobile/loading/session.png)

Pola spinner kecil dengan teks tanpa ellipsis diterapkan pada loading data, tombol, dialog, dan dropdown di seluruh peran. Spinner sesi berukuran 32 px CSS, spinner inline 20 px; kontrol mengikuti standar ukuran aplikasi. Gambar memperlihatkan keadaan animasi secara statis, bukan pengukur progres atau bukti proses selesai.

### Loading undangan Superadmin
- [Desktop](Superadmin/desktop/kondisi/25-memuat-undangan.png) dan [mobile](Superadmin/mobile/kondisi/25-memuat-undangan.png): dibuat dengan ImageGen sebelum implementasi. Daftar divisi menampilkan animasi selama permintaan berjalan; riwayat undangan desktop juga membedakan memuat dari data kosong.
