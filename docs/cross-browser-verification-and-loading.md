# Verifikasi lintas browser dan loading aplikasi

Revisi 28 November 2026 memperbaiki tautan pemulihan pendaftaran yang sebelumnya ditolak ketika inbox membukanya di browser lain. Verifikasi sekarang dapat diselesaikan dari konteks browser berbeda tanpa memindahkan URL secara manual. Untuk pemulihan akun lama, pengguna mengonfirmasi **kata sandi yang diisi pada formulir pendaftaran**, bukan membuat kata sandi lagi.

## Perilaku akhir

1. Membuka tautan hanya menampilkan halaman konfirmasi. Reload, menutup tab, dan membukanya lagi dari tombol email belum mengonsumsi token.
2. Pemulihan akun lama dari browser berbeda meminta kata sandi pendaftaran melalui HTTP 428. Respons tantangan tidak dianggap sebagai verifikasi berhasil, termasuk oleh klien lama yang masih terbuka saat rilis.
3. Kata sandi salah tidak mengonsumsi token. Percobaan dibatasi per tautan; hash bukti diperiksa kembali dalam transaksi yang sama dengan konsumsi token. Dua konfirmasi bersamaan hanya menghasilkan satu keberhasilan.
4. Verifikasi berhasil baru mengonsumsi token dan membersihkannya dari fragmen URL. Browser berbeda tidak mendapat cookie login ataupun progres privat. Browser pendaftaran dapat melanjutkan tahap server yang tersimpan; jika klaim browser hilang, jalur pemulihan kredensial tetap berlaku.
5. Registrasi desktop selesai setelah verifikasi; registrasi mobile tetap belum aktif sampai seluruh onboarding selesai. Identitas, peran, divisi, dan data akun lama tidak ditimpa oleh isian pemulihan.
6. Respons sukses yang tidak memenuhi kontrak tidak menampilkan hasil hijau atau membuang tautan. UI menampilkan kesalahan yang dapat dicoba kembali.

Semua indikator loading teks bertitik pada frontend diganti animasi cincin yang mengikuti status kueri/mutasi sebenarnya. Ukuran inline 20 px dan loading sesi 32 px; label tetap dapat dibaca teknologi bantu. Tombol proses mencegah kirim ganda, berhenti berputar saat selesai/gagal, dan mempertahankan ukuran standar. Navigasi Sebelumnya/Lanjutkan tetap horizontal, termasuk saat menyimpan pada lebar 320 px. Halaman Undang Pengguna juga membedakan daftar yang sedang dimuat, gagal, dan benar-benar kosong; pengiriman ditahan jika daftar divisi belum tersedia.

Mockup baru dibuat dengan ImageGen sebelum implementasi: konfirmasi kata sandi, verifikasi berjalan, pemeriksaan sesi desktop/mobile, penyimpanan langkah mobile, serta loading undangan Superadmin. Satu gambar memuat satu layar; referensinya ada di [indeks mockup](../mockup/README.md). Tidak ada komponen React bersama baru sebagai pengganti audit visual.

## Bukti pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| Backend, 45 berkas | 293/293 lulus |
| Kebijakan database pgTAP | 112/112 lulus |
| Unit frontend | 15/15 lulus |
| Penjaga cakupan rute dan larangan loading bertitik | 2/2 lulus |
| Integrasi seluruh aplikasi desktop/mobile | 116/116 skenario unik lulus |
| Pemulihan legacy setelah perubahan protokol 428 | 4/4 diulang dan lulus |
| UI seluruh 43 pola rute, 52 layar katalog, 141 kondisi dasar | 536/536 skenario unik lulus |
| Navigasi pending 320/390 px, empat langkah per ukuran | 8/8 lulus |
| Typecheck, build frontend produksi, build backend | Lulus |

Putaran UI lengkap awal menemukan dua kegagalan nyata pada loading Undang Pengguna. Keduanya diperbaiki, lalu loading/ready/error dan interaksi undangan diuji ulang. Pemeriksaan tambahan membuktikan respons 200 yang malformed tidak mengaku verifikasi berhasil. Hasil konsolidasi memakai hasil terbaru untuk kasus yang diulang, bukan menjumlahkan ulang kasus yang sama.

Bukti privat workspace: `test-results/crossbrowser-verification-loading-complete/visual-review.json`. Terdapat 893 capture (435 desktop, 458 mobile), 775 gambar unik, dan nol gambar belum ditinjau. Gambar yang sama dengan bukti terdahulu hanya mewarisi review bila SHA-256 identik; semua gambar baru dan potongan halaman panjang dilihat. Bukti asal dan percobaan gagal tetap dipertahankan untuk penelusuran. Capture, transkrip pengujian, log lokal, serta konfigurasi rahasia diabaikan Git.

Tes email memakai SMTP Mailpit lokal dan tombol HTML email aktual. Tes lintas browser memakai konteks browser terpisah dengan cookie terisolasi, bukan memalsukan hasil API dalam rangkaian integrasi. Audit UI memakai respons API terkendali pada build produksi; animasi, ukuran, overflow, dialog, kondisi gagal, serta akses tombol diperiksa pada render browser. Ini tidak mengklaim pemasangan WebAPK Android atau Safari iPhone asli baru diuji dalam revisi ini. Tes suara memakai transport pengujian, tanpa panggilan OpenAI berbayar.

## Migrasi dan pembersihan

Migrasi maju menambahkan dua fungsi verifikasi dengan hak runtime terbatas; akses PUBLIC dicabut. Pemeriksaan browser-asal di API dihapus. Fungsi SQL ABI lama dipertahankan sebagai fungsi inert yang selalu `false` agar slot rilis sebelumnya dapat drain dengan aman; tidak ada pemanggilan atau fallback pembatasan lama dari implementasi aktif. Riwayat migrasi yang sudah diterapkan dipertahankan.

Audit visual sekarang menggunakan build produksi lewat Vite preview. Konfigurasi server audit development sebelumnya dihapus. Penjaga loading dijalankan pada workflow regresi UI terpisah; deployment tidak ditambah Chromium, Playwright, atau panggilan model berbayar.
