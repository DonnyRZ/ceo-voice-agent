# Usulan onboarding Android — menunggu review

Enam gambar terpisah dibuat menggunakan OpenAI ImageGen pada 28 November 2026. Satu gambar berisi satu mockup, bukan gabungan layar. Belum ada implementasi aplikasi. Desktop tetap memakai [rancangan sebelumnya](../../desktop/15-registrasi.png).

| Urutan | Layar | Gambar |
| --- | --- | --- |
| 0 | Login dengan pintu masuk registrasi | [Login](00-login.png) |
| 1 | Data akun, Simpan dan lanjut | [Data akun](01-data-akun.png) |
| 2 | Pilihan Android/iPhone, Android dipilih | [Perangkat](02-pilih-perangkat.png) |
| 3 | Panduan dan tombol pemasangan Android | [Pasang aplikasi](03-pasang-aplikasi.png) |
| 4 | Menunggu hasil pemasangan | [Menunggu pemasangan](04-menunggu-pemasangan.png) |
| 5 | Terpasang, buka aplikasi dan petunjuk alternatif | [Aplikasi terpasang](05-aplikasi-terpasang.png) |

Alur usulan: Login → Daftar Anggota Divisi → Simpan dan lanjut → pilih Android → Lanjutkan → Pasang aplikasi → konfirmasi browser → menunggu hasil → buka aplikasi. Tombol Sebelumnya mengembalikan pengguna ke langkah sebelumnya dengan data tetap dipertahankan. Perubahan fungsi tersebut belum dibuat; gambar merupakan proposal interaksi.

Pada login, pengguna yang belum punya akun mendapatkan tombol Daftar Anggota Divisi. Pada data akun, pengguna yang sudah punya akun tetap bisa memilih Masuk. Indikator onboarding memakai tiga langkah: Data akun, Perangkat, Pasang; pemasangan memiliki kondisi siap, menunggu, dan selesai.

## Batas perilaku yang harus dipertahankan

- Pemasangan PWA memerlukan dukungan browser dan konfirmasi pengguna. Tombol Android atau Pasang aplikasi tidak boleh mengklaim dapat memasang secara diam-diam.
- Indikator menunggu adalah representasi statis animasi loading. Tidak ada persentase, durasi pasti, atau kemajuan unduhan yang dikarang.
- Revisi visual: kartu menunggu hanya memakai spinner sebagai visual utama, tanpa tile logo aplikasi atau tulisan Ruang Kerja di atas spinner. Logo pada header halaman tetap dipertahankan.
- Status selesai hanya boleh ditampilkan berdasarkan bukti pemasangan yang tersedia. Perilaku dan event aktual browser perlu diuji saat implementasi; gambar tidak membuktikan dukungan browser tersebut.
- Tombol Buka Ruang Kerja merupakan usulan tindakan yang perlu diverifikasi per browser Android. Halaman web tidak dapat menjamin navigasi selalu beralih ke jendela PWA terpasang. Jika dukungan pembukaan langsung tidak tersedia atau pengguna masih berada di browser, tampilkan petunjuk membuka ikon Ruang Kerja dari layar utama, seperti pada mockup selesai.
- Pembatalan pemasangan, browser tidak mendukung, dan kegagalan memerlukan penanganan saat alur implementasi ditentukan. Jangan menahan pengguna pada loading tanpa jalan kembali.
- Rangkaian khusus iPhone kini tersedia dalam [dokumentasi onboarding iPhone](../onboarding-iphone/README.md). Jalur Android pada folder ini tetap dipertahankan.
- Verifikasi email dan penetapan akses divisi belum diputuskan lengkap; penyimpanan data akun tidak sama dengan pemberian akses divisi.

Warna, ikon, dan tipografi mengikuti bahasa desain Ruang Kerja. Ukuran implementasi nantinya mengikuti [standar UI](../../../../docs/ui-consistency.md); ukuran raster ImageGen bukan hasil pengukuran CSS. Tidak ada perubahan pada frontend, backend, database, login produksi, atau fitur PWA dalam revisi dokumentasi ini.
