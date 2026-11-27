# Pembersihan yang aman

- Jalankan cleanup image aplikasi pada akhir setiap percobaan deployment.
- Pertahankan image aktif, satu image rollback, dan image yang masih dipakai container mana pun.
- Batasi penghapusan ke tag release milik repository dan lingkungan yang sedang di-deploy serta label sumber yang cocok. Stage tidak boleh menghapus prod, demikian pula sebaliknya.
- Hapus container slot lama hanya setelah sesi suaranya habis. Gunakan paling banyak dua slot per lingkungan.
- Dilarang memakai `docker system prune`, `docker volume prune`, atau image rm paksa/global pada VPS bersama.
- Jangan menghapus PostgreSQL, volume budget, data aplikasi, backup, atau image layanan lain sebagai bagian cleanup image.
- Kegagalan cleanup dicatat dan dicoba lagi pada rilis berikutnya. Jangan mematikan aplikasi sehat karena cleanup gagal.
- Docker log memakai rotasi ukuran/jumlah. Retensi backup mengikuti kebijakan tersendiri yang disepakati; jangan menghapus backup tanpa kebijakan itu.
