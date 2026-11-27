# Ruang Kerja

Anggota Divisi masuk dengan akun perusahaan untuk mengelola proyek dan tugas divisinya. Superadmin mengelola divisi, akun, dan hak akses, serta melihat timesheet dan audit lintas divisi. CEO melihat ringkasan, menelusuri sumber pekerjaan, dan bertanya melalui Voice Agent. Data dan riwayat perubahan tersimpan di PostgreSQL.

## Jalankan lokal

Gunakan Node.js 24 LTS, npm, dan Docker Compose.

```sh
npm ci
npm run env:init
docker compose up -d --wait db mailpit
npm run db:migrate
npm run db:seed
npm run dev
```

Buka `http://localhost:5173`. Seed menyediakan `ceo@ruangkerja.test`, `superadmin@ruangkerja.test`, anggota IT `doni@ruangkerja.test` dan `hakim@ruangkerja.test`, serta anggota Finance `laura@ruangkerja.test` dan `vanah@ruangkerja.test`. Kata sandi akun uji ada di `SEED_PASSWORD` dalam `.env` lokal. Untuk melihat data contoh, pilih November 2026.

Gunakan konfigurasi `SMTP_*` dari `.env.example` untuk mengirim undangan ke Mailpit. Buka kotak masuk lokal di `http://127.0.0.1:8025` dan ikuti tautan aktivasi pada email uji.

`npm run env:init` membuat kredensial lokal dan kunci sesi secara acak. Konfigurasi model dan kunci OpenAI ada di `.env` backend. Voice Agent CEO mati secara default. [Contoh konfigurasi](.env.example)

## Pengujian

```sh
npm run test:backend
npm run test:frontend
npx playwright install chromium
npm run test:tools
npm run test:e2e
npm run build
```

Playwright menjalankan aplikasi lokal secara otomatis dan memakai seed serta Mailpit. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` jika memakai instalasi Chromium lokal.

Jalankan `E2E_CAPTURE_ADMIN_SCREENSHOTS=1 npm run test:e2e` untuk menyimpan pembanding mockup Superadmin desktop dan mobile di folder hasil tes lokal.

Suite pgTAP memeriksa isolasi divisi, hak baca CEO, riwayat, dan audit di PostgreSQL. Pasang paket `postgresql-17-pgtap` pada database pengujian dan restart layanan database sebelum menjalankannya.

```sh
docker compose exec -T db psql -X -U ruang_kerja_admin -d ruang_kerja \
  -v ON_ERROR_STOP=1 -v app_role=ruang_kerja_app < backend/db/pgtap.sql
```

## Produksi

Atur `APP_ORIGIN` ke URL HTTPS aplikasi dan `SMTP_*` ke server SMTP perusahaan. Siapkan database dan role runtime terpisah, lalu jalankan migrasi. Isi `SUPERADMIN_EMAIL` dan `SUPERADMIN_PASSWORD` untuk akun pertama dan jalankan `npm run db:admin` dari lingkungan administrasi database. Jalankan `npm run build` dan `NODE_ENV=production npm start`. Fastify menyajikan UI dan API dari satu proses.

Rujukan pengembangan tersedia di [aturan codebase](agents/codebase.md), [mockup Anggota Divisi](mockup/Anggota-Divisi/), [mockup Superadmin](mockup/Superadmin/), dan [mockup CEO](mockup/CEO/).

## Halaman CEO

Setelah login, CEO masuk ke `/ceo`. Navigasi menyediakan Dashboard, Divisi, Agent, dan Akun. Halaman divisi menghubungkan detail proyek dan tugas beserta deskripsi, PIC, status, pembaruan terakhir, dan riwayat. Filter periode memakai tanggal tugas dan mempertahankan konteks saat membuka detail. Persentase progres dihitung dari tugas berstatus Done dalam cakupan yang ditampilkan.

Semua halaman CEO bersifat baca. API memeriksa sesi dan hak CEO di setiap permintaan. Data dibaca ulang saat jendela aktif dan berkala setiap 30 detik. Perubahan kata sandi melalui Akun → Keamanan akun mencabut seluruh sesi lama. Preferensi keluaran suara tersimpan terpisah per akun pada browser yang digunakan.

## Pilot Voice Agent CEO

Aktifkan `AI_VOICE_ENABLED=true` di proses pilot setelah migrasi, seed, dan build. Akun seed `ceo@ruangkerja.test` membuka halaman `/ceo/voice`. Aktifkan `AI_EMBEDDINGS_ENABLED=true` untuk menguji indeks semantik pada data contoh. Simpan konfigurasi OpenAI di `.env` backend. Tampilan mengikuti kondisi belum mulai, mendengarkan, mencari, menjawab, standby, selesai, dan koneksi terputus. Mikrofon diaktifkan melalui tombol; perpindahan halaman atau penutupan sesi menghentikan media. Kartu fakta hanya ditampilkan setelah backend mengirim hasil dan menyediakan tautan ke sumber.

GPT Live menangani percakapan. Setelah delegasi, backend memakai `OPENAI_INTENT_MODEL=gpt-6-luna` untuk menafsirkan transkrip dan konteks menjadi operasi baca terstruktur. Permintaan Responses memakai `reasoning.effort: "none"` dan tier Standard. Anggaran memakai tarif input konservatif termasuk penulisan cache. Interpretasi dan embedding memakai bagian anggaran yang sama. Backend memvalidasi operasi, cakupan, tanggal, dan pilihan sebelum mengambil fakta dari PostgreSQL. `AI_VOICE_RETRIEVAL_TIMEOUT_MS` membatasi waktu interpretasi dan pengambilan fakta.

Pemutaran memakai potongan PCM GPT Live yang sudah diperiksa terhadap teks hasil backend. Browser mengirim audio mikrofon lewat WebRTC dan memutar WAV yang disetujui melalui endpoint milik sesi. Audio yang belum dapat dipastikan tetap tertahan. Jurnal pilot mencatat hasil `output_verify` dan latensi per giliran. Hitung fakta yang sudah benar di PostgreSQL tetapi audionya tertahan sebagai kegagalan jawaban lisan pada pilot.

Jika hasil interpretasi memasukkan kata terkait cakupan ke dalam judul, backend dapat meminta satu pemeriksaan tambahan kepada Luna setelah menemukan satu judul katalog yang cocok secara literal. Perubahan hanya berlaku jika kutipan cakupan dapat diverifikasi dan fakta permintaan tetap sama. Jurnal mencatat tahap `scope_recheck` secara terpisah.

Gunakan WAV ucapan berbahasa Indonesia yang berisi pertanyaan tentang fixture. Contoh pertanyaan awal adalah “Apa status proyek Upgrade Infrastruktur di divisi IT?” Status sumbernya Pending. `npm run test:voice:pilot -- /path/pertanyaan.wav` memakai audio itu sebagai mikrofon Chromium. Script menguji giliran awal, aktif, dan bangun dari standby. Hasil dan audio uji tersimpan di `.voice-pilot/`. Bandingkan audio hasil dengan status di sumber. Waktu audio pertama dalam laporan menunjukkan awal sinyal audio.

`npm run test:voice:protocol -- /path/pertanyaan.wav` menguji event delegasi dan keluaran PCM GPT Live dengan satu fakta contoh lewat WebSocket langsung. Pemeriksaan ini memakai FFmpeg dan anggaran yang sama dengan pilot WebRTC.

`npm run test:voice:browser-ws -- /path/pertanyaan.wav "Judul catatan seed" done` memakai browser loopback untuk mengirim WAV dan merekam audio GPT Live yang diputar. Berikan judul dan status yang diharapkan dari data seed. Jalur audit ini memakai login CEO, delegasi, penarikan fakta PostgreSQL, dan anggaran pilot yang sama. Audio berjalan lewat WebSocket, sehingga hasilnya menguji percakapan dan pemutaran browser pada transport tersebut. Pilot WebRTC tetap digunakan untuk memeriksa koneksi media aplikasi.

Anggaran pilot mengikuti `AI_OPENAI_BUDGET_USD`; batas rangkaian uji yang disetujui saat ini US$6. Penggunaan dicatat di direktori yang sama. Simpan ledger itu selama rangkaian uji. Jika pemakaian sesi berakhir tanpa konfirmasi dari OpenAI, cadangan biaya tetap ditahan. Endpoint Prometheus `/api/ceo/voice/metrics` memerlukan sesi Superadmin.

### Matriks latensi Luna dan WebRTC

Siapkan Chromium, eSpeak NG dengan suara Indonesia, lalu gunakan database PostgreSQL pengembangan. Runner membuat dan membersihkan database seed terpisah. Jalankan smoke sebelum 30 skenario terlabel.

```sh
npm run build
npm run test:voice:fixtures
AI_VOICE_ENABLED=true npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest.json smoke
AI_VOICE_ENABLED=true npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest.json probe
AI_VOICE_ENABLED=true npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest.json matrix
AI_VOICE_ENABLED=true npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest.json holdout
```

Setel `PLAYWRIGHT_CHROMIUM_EXECUTABLE` untuk memakai Chromium lokal. Di lingkungan yang memerlukan TURN/TCP, runner menerima `PILOT_TURN_HELPER` dan `PILOT_TURN_ASSETS` untuk relay lokal terautentikasi yang memverifikasi kandidat SDP dan izin peer sebelum memulai media. Catat kegagalan ICE terpisah dari giliran suara.

Jika tab Chromium melewatkan audio WebRTC, jalankan pilot bertanda `PILOT_PULSE_SYNC=true` dan `PILOT_RUN_TAG` dengan Chromium diarahkan ke sink PulseAudio khusus. Rekam monitor sink dalam WAV PCM mono 16-bit. Penanda audio lokal menyelaraskan rekaman monitor ke frame ucapan tanpa masuk ke mikrofon. Jalankan `node scripts/ceo-voice-pilot-pulse.mjs LAPORAN.json MONITOR.wav` untuk membuat laporan monitor terpisah.

Untuk mengaudit batas pemutaran, jalankan pilot sintetis dengan `PILOT_REFLECTION_TRACE=true`. Runner menyimpan urutan event GPT Live, PCM yang diterima server, dan WAV yang dikirim untuk tiap giliran di direktori lokal yang diabaikan Git. ACK mengonfirmasi perintah baca. Awal dan akhir audio diambil dari PCM yang tertangkap untuk giliran yang sama, dengan bukti hening dan transkrip lengkap.

```sh
node --import tsx scripts/ceo-voice-reflection-replay.mjs TRACE.json --controls
node scripts/ceo-voice-pilot-waveform-review.mjs LAPORAN-MONITOR.json
```

Hasil di `.voice-pilot/luna-results/` menyimpan rekaman tab browser dan penanda frame untuk awal dan akhir ucapan, awal audio, serta interupsi. Simpan hasil peninjauan audio dalam objek JSON berindeks ID skenario. Untuk jawaban benar, gunakan `{"outcome":"correct","firstFactEndSeconds":8.4,"answerEndSeconds":12.1}` dengan waktu relatif terhadap awal WAV. Untuk kegagalan, gunakan `outcome` bernilai `incorrect` atau `incomplete` serta catatan. Perintah `npm run test:voice:review -- .voice-pilot/luna-results/matrix.json reviews.json` menghitung distribusi dan skor dua detik. Ganti `reviews.json` dengan `--transcribe` untuk membuat transkrip bertimestamp dari audio sintetis dalam anggaran pilot. Waktu yang dihitung dari transkrip provider atau event `playing` adalah diagnostik tahap, dengan ketepatan fakta terakhir diperiksa dari rekaman pemutaran.

### Pengujian isi dari transkrip

Pakai fase `transcript` untuk mengirim ucapan sintetis melalui WebRTC tanpa menangkap pemutaran browser. Jurnal menyimpan fragmen transkrip menurut urutan terima, waktu delegasi dan ACK, teks yang dikirim backend, serta fakta sumber. Bandingkan isi keluaran GPT Live dengan hasil dari PostgreSQL lewat perintah berikut.

```sh
AI_VOICE_ENABLED=true PILOT_RUN_TAG=content-a npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest.json transcript
node scripts/ceo-voice-transcript-review.mjs .voice-pilot/luna-results/transcript-content-a.json
node --import tsx scripts/ceo-voice-input-replay.mjs .voice-pilot/luna-results/transcript-content-a.json transcript-correct-inline
AI_VOICE_ENABLED=true node --use-env-proxy --env-file=.env --import tsx scripts/ceo-voice-intent-replay.mjs content-a
```

Perintah terakhir memakai input teks fixture dan event sesi sintetis untuk menguji interpretasi Luna, konteks, dan kueri PostgreSQL tanpa sesi GPT Live. Gunakan laporan fase `transcript` untuk memeriksa teks yang benar-benar dihasilkan GPT Live. Riwayat yang hanya punya transkrip terkelompok dapat memerlukan peninjauan manual saat batas giliran tidak jelas.

### Pengujian nama proyek dan tugas

Pada awal sesi CEO, GPT Live menerima daftar nama dari katalog yang dibaca dengan hak akses CEO sebagai bantuan ejaan. Nama dan tanggal yang akan dijawab tetap diperiksa terhadap catatan timesheet. Pertanyaan yang hanya mengubah tanggal dapat memakai proyek yang sudah dikonfirmasi. Jika proyek belum dikonfirmasi, backend menyimpan perubahan tanggal untuk digunakan setelah konfirmasi.

Gunakan WAV asli yang sudah diarsipkan untuk mengulang kegagalan ASR. Pembuat manifest memeriksa SHA-256 WAV utama dan pemanasan. Aktifkan profil nama mirip untuk menguji dua catatan yang benar-benar berbeda tetapi mudah tertukar.

```sh
node --import tsx scripts/ceo-voice-pilot-asr.mjs .voice-pilot/luna-fixtures/manifest.json
AI_VOICE_ENABLED=true PILOT_RUN_TAG=names-a PILOT_ASR_COLLISIONS=true PILOT_REFLECTION_TRACE=true \
  npm run test:voice:luna -- .voice-pilot/luna-fixtures/manifest-asr.json asr
```

Pakai `PILOT_INPUT_EXACT=true` saat menilai ucapan tunggal yang transkripnya harus sama dengan teks acuan. Runner memeriksa hash WAV, transkrip mentah GPT Live, dan teks yang dipakai backend. Gunakan `node scripts/ceo-voice-input-gate.mjs LAPORAN.json MANIFEST.json ID_UJI...` untuk memeriksa laporan lama. Kesalahan pada ucapan tetap membuat uji gagal meskipun respons aplikasi sesuai dengan hasil pencarian.

### Riwayat tes manual

Jalankan migrasi dan atur `AI_VOICE_TEST_HISTORY_ENABLED=true` pada backend pilot sebelum memulai tes. Sesi baru tersimpan di PostgreSQL. Pencatatan ini perlu diaktifkan secara eksplisit karena transkrip dan fakta timesheet dapat memuat data perusahaan.

```shell
npm run voice:history -- --limit 10
npm run voice:history -- <id-sesi>
```

Perintah server ini memakai `DATABASE_ADMIN_URL`. Laporan sesi memuat transkrip CEO dan GPT Live dengan offset audio, pertanyaan yang dipakai untuk kueri, fakta sumber dan teks yang dikirim ke GPT Live, durasi setiap tahap, kegagalan, dan pemakaian yang dilaporkan OpenAI. Waktu pemutaran browser adalah proksi dari event giliran hingga event `playing` dan dicatat per sesi. Cocokkan isi transkrip agen dengan fakta sumber dan hasil yang didengar pada tes manual.
