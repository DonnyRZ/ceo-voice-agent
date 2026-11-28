# Menghubungkan domain CEO pada VPS

DNS kedua hostname sudah terverifikasi ke `212.85.24.238`, tanpa AAAA. Inspeksi runner menemukan Nginx native aktif, Certbot tersedia, dan belum ada server block CEO. HTTPS saat inspeksi masih menampilkan situs default 7Oz Espresso Cafe. Runner tidak mempunyai sudo umum tanpa password; pemasangan Nginx/sertifikat dilakukan engineer melalui akses root yang sudah dimiliki. Tidak perlu mengubah DNS lagi.

Jalankan dari checkout commit yang sudah direview. Langkah ini hanya menambah konfigurasi untuk dua hostname CEO. Jangan memasang paket, merestart PostgreSQL, mengganti nginx.conf/default site, atau mengubah konfigurasi situs lain. Selesaikan bootstrap sebelum merge PR rilis ke branch lingkungan tersebut. Deploy dikendalikan alur PR, tanpa sakelar pengaktifan tambahan.

## 1. Pasang host HTTP untuk validasi sertifikat

Sebagai root di VPS, pastikan nama file berikut belum dipakai. Jika sudah ada, tinjau dan backup file tersebut dahulu; jangan menimpanya tanpa pemeriksaan.

```sh
set -euo pipefail
test ! -e /etc/nginx/sites-available/ceo-agent.conf
test ! -L /etc/nginx/sites-available/ceo-agent.conf
test ! -e /etc/nginx/sites-enabled/ceo-agent.conf
test ! -L /etc/nginx/sites-enabled/ceo-agent.conf
install -d -m 0755 /var/lib/ceo-agent/acme
install -m 0644 infra/deploy/nginx-http.conf /etc/nginx/sites-available/ceo-agent.conf
ln -s /etc/nginx/sites-available/ceo-agent.conf /etc/nginx/sites-enabled/ceo-agent.conf
nginx -t && systemctl reload nginx
```

Jika `nginx -t` gagal, jangan reload. Hapus symlink/file yang baru dibuat untuk CEO saja dan periksa penyebabnya. Reload bersifat graceful; jangan restart layanan.

## 2. Terbitkan sertifikat kedua hostname

Gunakan akun Let's Encrypt yang sudah dipakai server. Jika Certbot meminta pemilihan akun/email, engineer menyelesaikannya melalui konfigurasi ACME yang ada; jangan mengarang email pemilik.

```sh
certbot certonly --webroot -w /var/lib/ceo-agent/acme \
  --cert-name ceo-agent-egiresources \
  -d ceo.egiresources.com -d ceo-stage.egiresources.com \
  --non-interactive --agree-tos \
  --deploy-hook 'nginx -t && systemctl reload nginx'
openssl x509 -in /etc/letsencrypt/live/ceo-agent-egiresources/fullchain.pem -noout -checkhost ceo.egiresources.com
openssl x509 -in /etc/letsencrypt/live/ceo-agent-egiresources/fullchain.pem -noout -checkhost ceo-stage.egiresources.com
```

Lanjutkan hanya jika penerbitan dan verifikasi kedua hostname berhasil. Certbot menyimpan webroot dan deploy hook untuk pembaruan; periksa timer renewal yang sudah ada tetap aktif. Jangan mencetak private key atau menjalankan simulasi renewal seluruh sertifikat aplikasi lain.

## 3. Pasang HTTPS dan routing aplikasi

```sh
cp -a /etc/nginx/sites-available/ceo-agent.conf /etc/nginx/sites-available/ceo-agent.conf.before-https
install -m 0644 infra/deploy/nginx-https.conf /etc/nginx/sites-available/ceo-agent.conf
nginx -t && systemctl reload nginx
```

Jika validasi/reload gagal, pulihkan `ceo-agent.conf.before-https` ke `ceo-agent.conf`, validasi kembali, dan jangan restart Nginx. Sertifikat baru tidak perlu dihapus saat rollback konfigurasi.

Routing akhir: stage → `127.0.0.1:4311`, prod → `127.0.0.1:4312`. Konfigurasi mendukung WebSocket/SSE dan izin mikrofon pada domain sendiri. Sebelum aplikasi pertama di-deploy, respons **503 Ruang Kerja sedang disiapkan** memang diharapkan; jangan menggantinya dengan situs default lain untuk membuat pemeriksaan terlihat berhasil.

## 4. Isi origin aplikasi dan variable GitHub

Pada `/var/www/ceo-agent/stage/shared/api.env`, tetapkan `APP_ORIGIN=https://ceo-stage.egiresources.com`. Pada file prod yang setara, tetapkan `APP_ORIGIN=https://ceo.egiresources.com`. Pertahankan seluruh secret/model/koneksi database, owner `ceo-deploy`, dan mode 0600. Jangan mengirim isi file ke chat atau GitHub.

Pada GitHub Settings → Environments, tambahkan variable `APP_URL`:

| Environment | APP_URL |
| --- | --- |
| stage | https://ceo-stage.egiresources.com |
| prod | https://ceo.egiresources.com |

Setelah konfigurasi HTTPS/origin siap, merge PR ke `develop` untuk deployment pertama stage. Sesudah stage lolos pengujian, promosikan lewat PR `develop` → `main` untuk prod. Tidak perlu menambah atau mengubah variable pengaktifan deployment. SMTP tetap konfigurasi terpisah untuk undangan/pemulihan akun.
