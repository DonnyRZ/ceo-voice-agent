# Branch dan pull request

- Dilarang push langsung ke `develop` dan `main`, termasuk oleh agen. Kerjakan perubahan dalam branch baru.
- Format branch: `feat/nama-fitur`, `fix/nama-perbaikan`, `refactor/nama-perubahan`, `perf/...`, `test/...`, `docs/...`, `chore/...`, `build/...`, `ci/...`, atau `security/...`. Gunakan huruf kecil, angka, dan tanda hubung.
- Semua topic branch membuat PR ke `develop`. Dilarang topic branch langsung ke `main`.
- Promosi produksi hanya melalui PR `develop` → `main` dari repository yang sama.
- Deploy terjadi sesudah PR di-merge, bukan ketika PR baru dibuka. `develop` memicu stage; `main` memicu prod.
- Gunakan branch protection/ruleset tanpa bypass untuk menolak direct push, force push, dan penghapusan branch. Jadikan pemeriksaan `checks` dan `branch-policy` wajib.
- Pemeriksaan CI/release bukan pengganti branch protection server GitHub. Jika integrasi tidak memiliki izin admin, laporkan batas ini; jangan mengklaim larangan push sudah ditegakkan di server.
- Jangan squash/rebase promosi develop → main; gunakan merge commit agar riwayat kedua branch tetap menyambung.
