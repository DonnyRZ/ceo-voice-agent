# Verifikasi registrasi — mobile

Dibuat dengan OpenAI ImageGen pada 28 November 2026, satu layar per gambar. Pemilik mengizinkan pembuatan mockup dan implementasi langsung dalam tugas revisi ini. Rangkaian ini menggantikan alur yang melewati langkah verifikasi.

| Kondisi | Mockup |
| --- | --- |
| Kirim email verifikasi | [Kirim email verifikasi](email-ready.png) |
| Email terkirim / menunggu | [Email terkirim / menunggu](email-sent.png) |
| Konfirmasi dari tombol email | [Konfirmasi dari tombol email](confirm-email.png) |
| Email terverifikasi di browser asal HP | [Email terverifikasi di browser asal HP](email-verified.png) |
| Kembali ke HP/browser asal | [Kembali ke HP/browser asal](return-mobile.png) |
| Desktop asal, verifikasi dibuka di HP | [Desktop asal, verifikasi dibuka di HP](desktop-complete.png) |
| Pengiriman email gagal | [Pengiriman email gagal](email-failed.png) |
| Tautan tidak berlaku | [Tautan tidak berlaku](link-invalid.png) |
| Konteks perangkat awal tidak tersedia | [Konteks perangkat awal tidak tersedia](return-browser.png) |

Form awal tetap berisi nama, email, divisi, kata sandi, dan konfirmasi. Simpan dan lanjut membuka verifikasi; pengiriman email dipicu tombol tersendiri. Jenis alur disimpan saat pendaftaran: desktop selesai setelah verifikasi; HP melanjutkan pilihan perangkat sesudah verifikasi. Membuka email di perangkat lain tidak mengubah alur asal.

Ukuran kode mengikuti standar CSS aplikasi, bukan ukuran piksel raster. Nomor dan tanda centang menandai tahap aktif/selesai; verifikasi email berbeda dari penyelesaian pemasangan.

Revisi navigasi disetujui pemilik pada 28 November 2026: Sebelumnya di kiri dan Lanjutkan/Pasang aplikasi di kanan dalam satu baris horizontal, lebar serta tinggi setara. Gambar terkait telah diganti; versi bertumpuk tidak lagi menjadi referensi aktif. Kirim ulang email dan status tetap berada di luar pasangan navigasi.
