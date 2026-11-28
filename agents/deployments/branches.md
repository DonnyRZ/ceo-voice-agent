# Branch dan pull request

- Dilarang push langsung ke `develop` dan `main`, termasuk oleh agen. Kerjakan perubahan dalam branch baru.
- Format branch: `feat/nama-fitur`, `fix/nama-perbaikan`, `refactor/nama-perubahan`, `perf/...`, `test/...`, `docs/...`, `chore/...`, `build/...`, `ci/...`, atau `security/...`. Gunakan huruf kecil, angka, dan tanda hubung.
- Semua topic branch membuat PR ke `develop`. Dilarang topic branch langsung ke `main`.
- Setelah PR topic branch → `develop` siap ditinjau, aktifkan auto-merge native GitHub per PR dengan metode merge commit: `gh pr merge NOMOR_PR --repo DonnyRZ/ceo-voice-agent --auto --merge`.
- GitHub menunggu seluruh required checks (`checks` dan `branch-policy`) serta persyaratan proteksi branch terpenuhi sebelum merge otomatis. Jika checks gagal, perbaiki melalui topic branch yang sama; jangan gunakan `--admin` atau melewati proteksi.
- Promosi produksi hanya melalui PR `develop` → `main` dari repository yang sama dan hanya dibuat atas permintaan eksplisit pemilik. Jangan otomatis membuat PR ke `main`; aktifkan auto-merge production hanya pada PR yang memang diminta pemilik.
- Pengaturan repository **Allow auto-merge** harus aktif, tetapi tidak otomatis mengaktifkan auto-merge pada setiap PR. Aktivasi per PR tetap diperlukan oleh akun engineer atau integrasi GitHub yang sesuai.
- Gunakan auto-merge native GitHub; jangan menambah workflow merge, PAT, secret, cron, atau layanan baru. Hindari merge melalui workflow memakai `GITHUB_TOKEN`, karena event hasil tindakannya dapat tidak memicu workflow deployment berikutnya.
- Deploy terjadi sesudah PR di-merge, bukan ketika PR baru dibuka. `develop` memicu stage; `main` memicu prod.
- Jangan menambahkan sakelar pengaktifan stage/prod terpisah dari alur PR. CI dan verifikasi asal commit tetap wajib. Menahan promosi prod dilakukan dengan tidak membuat/merge PR `develop` → `main`.
- Gunakan branch protection/ruleset tanpa bypass untuk menolak direct push, force push, dan penghapusan branch. Jadikan pemeriksaan `checks` dan `branch-policy` wajib.
- Pemeriksaan CI/release bukan pengganti branch protection server GitHub. Jika integrasi tidak memiliki izin admin, laporkan batas ini; jangan mengklaim larangan push sudah ditegakkan di server.
- Jangan squash/rebase promosi develop → main; gunakan merge commit agar riwayat kedua branch tetap menyambung.
