# Usulan onboarding iPhone — menunggu review

Empat mockup khusus iPhone dibuat dengan OpenAI ImageGen pada 28 November 2026, satu gambar untuk satu layar. Semua merupakan usulan desain untuk ditinjau pemilik. Belum ada implementasi registrasi, onboarding, atau pemasangan aplikasi.

Login dan data akun mengikuti rancangan bersama yang sudah tersedia; gambar yang sama tidak diduplikasi:

| Urutan | Layar | Gambar |
| --- | --- | --- |
| 0 | Login dengan tombol Daftar Anggota Divisi | [Login bersama](../onboarding-android/00-login.png) |
| 1 | Data akun dan Simpan dan lanjut | [Data akun bersama](../onboarding-android/01-data-akun.png) |
| 2 | Pilihan perangkat, iPhone terpilih | [Pilih iPhone](02-pilih-perangkat.png) |
| 3 | Panduan Safari: Bagikan dan Tambah ke Layar Utama | [Panduan Safari](03-panduan-safari.png) |
| 4 | Petunjuk konfirmasi penambahan di Safari | [Tambah ke Layar Utama](04-tambah-ke-layar-utama.png) |
| 5 | Petunjuk membuka ikon aplikasi secara manual | [Buka dari Layar Utama](05-buka-aplikasi.png) |

Alur usulan: Login → Daftar → simpan data akun → pilih iPhone → ikuti panduan Safari → tambahkan ke Layar Utama → buka manual melalui ikon Ruang Kerja. Tombol Sebelumnya dan Lanjutkan berpindah antarhalaman panduan; tombol tersebut tidak menekan menu Safari atau menginstal aplikasi secara otomatis.

## Perilaku pemasangan

- Panduan mengacu pada [petunjuk resmi Apple untuk menggunakan situs sebagai aplikasi di Safari](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26). Menu Bagikan dapat tersedia langsung atau melalui Lainnya, bergantung tata letak Safari. Pengguna memilih Add to Home Screen, mengaktifkan Open as Web App bila tersedia, lalu mengonfirmasi Add di Safari.
- Nama menu pada gambar merupakan panduan berbahasa Indonesia. Versi iOS, bahasa, dan tata letak Safari dapat berbeda; cocokkan petunjuk pada perangkat saat implementasi.
- Gambar adalah halaman panduan Ruang Kerja, bukan tangkapan layar menu sistem Safari yang sudah diuji. Ikon instruksi tidak mengubah pengaturan browser.
- Sudah ditambahkan adalah konfirmasi pengguna untuk melanjutkan panduan, bukan bukti teknis pemasangan. Jangan mengklaim otomatis mendeteksi sukses berdasarkan klik tersebut.
- iPhone tidak memakai layar loading unduhan atau janji redirect otomatis. Pengguna kembali ke Layar Utama dan membuka ikon aplikasi secara manual. Jika sesi tidak terbawa, pengguna masuk kembali; rincian pemulihan sesi perlu diuji saat implementasi.
- Tombol Selesai menutup panduan. Status aplikasi terpasang hanya boleh dipastikan melalui bukti yang tersedia, misalnya saat aplikasi benar-benar dibuka dalam mode standalone; jangan menyamakan penyelesaian panduan dengan keberhasilan pemasangan.
- Verifikasi email dan penetapan akses divisi tetap harus ditentukan terpisah. Menyelesaikan panduan pemasangan tidak memberikan akses ke data divisi.

Gaya visual mengikuti teal/mint, logo, navigasi langkah, dan kategori ukuran pada rancangan Android. Ukuran implementasi mengikuti [standar UI](../../../../docs/ui-consistency.md), bukan ukuran piksel raster ImageGen. Mockup desktop dan gambar Android tidak diubah oleh penambahan ini.
