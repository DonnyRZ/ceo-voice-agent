# Registrasi yang dapat dilanjutkan

- Pendaftaran sementara, email terverifikasi, dan registrasi selesai adalah status terpisah. Data sementara bukan akun aktif.
- Desktop selesai setelah konfirmasi email. Mobile selesai pada langkah akhir pemasangan/panduan yang sudah disetujui; verifikasi email saja tidak boleh membuat akun baru aktif.
- Simpan tahap onboarding di server. Reload, hard refresh, tutup tab, dan buka kembali harus melanjutkan tahap tersimpan. Cookie progres adalah capability privat, bukan sesi login.
- Jika browser asal hilang, pemulihan memerlukan email dan kata sandi pendaftaran yang cocok. Alamat email saja tidak boleh memberikan data atau kepemilikan progres.
- Pendaftaran tertunda dari browser lain tidak boleh mengunci email sebagai akun aktif. Draft lain tetap terisolasi; penyelesaian hanya boleh membuat satu akun dan menonaktifkan draft saingan.
- Kata sandi mentah, token, dan klaim progres dilarang masuk localStorage/sessionStorage atau log. Cache formulir hanya boleh menyimpan nama, email, dan divisi yang secara eksplisit diizinkan; server tetap sumber progres.
- Akun versi lama tidak boleh dihapus, direset, dipindah divisi, atau dinaikkan perannya untuk memperbaiki onboarding. Pulihkan hanya progres milik pengguna setelah pembuktian yang sesuai.
- Status pemasangan berasal dari bukti browser atau konfirmasi manual pada panduan iPhone; jangan mengaku memiliki attestation pemasangan dari server atau menampilkan sukses berdasarkan timer.
- Uji pemulihan browser asal dan browser baru, progres gagal disimpan, tautan sekali pakai, aktivasi bersamaan, akun belum aktif, batas pengiriman lintas draft, serta regresi ketiga peran.
