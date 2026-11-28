# Registrasi yang dapat dilanjutkan

- Pendaftaran sementara, email terverifikasi, dan registrasi selesai adalah status terpisah. Data sementara bukan akun aktif.
- Desktop selesai setelah konfirmasi email. Mobile selesai pada langkah akhir pemasangan/panduan yang sudah disetujui; verifikasi email saja tidak boleh membuat akun baru aktif.
- Simpan tahap onboarding di server. Reload, hard refresh, tutup tab, dan buka kembali harus melanjutkan tahap tersimpan. Cookie progres adalah capability privat, bukan sesi login.
- Jika browser asal hilang, kredensial yang cocok dapat memulihkan progres. Bila kredensial lama tidak dapat dipakai untuk pendaftaran lama yang belum selesai, wajib tersedia pemulihan lewat bukti email baru pada flow verifikasi yang sudah disetujui. Email atau pengisian form saja tidak boleh memindahkan kepemilikan progres.
- Pendaftaran tertunda dari browser lain tidak boleh mengunci email sebagai akun aktif. Draft lain tetap terisolasi; penyelesaian hanya boleh membuat satu akun dan menonaktifkan draft saingan.
- Kata sandi mentah, token, dan klaim progres dilarang masuk localStorage/sessionStorage atau log. Cache formulir hanya boleh menyimpan nama, email, dan divisi yang secara eksplisit diizinkan; server tetap sumber progres.
- Akun versi lama yang belum selesai harus ditandai belum menyelesaikan registrasi, ditolak oleh login/RLS, dan sesi lamanya dicabut. Pertahankan identitas, riwayat, peran, dan divisinya. Kata sandi yang diajukan saat pemulihan hanya diterapkan setelah bukti email baru dan penyelesaian akhir; jangan mengubah kredensial berdasarkan email atau form saja. Akun yang sudah selesai atau dicabut Superadmin tidak boleh dipulihkan lewat pendaftaran.
- Status pemasangan berasal dari bukti browser atau konfirmasi manual pada panduan iPhone; jangan mengaku memiliki attestation pemasangan dari server atau menampilkan sukses berdasarkan timer.
- Uji pemulihan browser asal dan browser baru, progres gagal disimpan, tautan sekali pakai, aktivasi bersamaan, akun belum aktif, batas pengiriman lintas draft, serta regresi ketiga peran.
