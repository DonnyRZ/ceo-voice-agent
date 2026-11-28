import { ArrowLeft, ArrowRight, Compass, Home, Info, PlusSquare, Share, Check } from 'lucide-react';

export function IphoneGuide({ step, go }: { step: string; go: (step: string) => void }) {
  const first = step === 'iphone-share';
  const last = step === 'iphone-open';
  return <section className="registration-card install-guide">
    {first ? <>
      <ol className="install-instructions">
        <li><Compass /><div><h2>1. Buka di Safari</h2><p>Buka halaman Ruang Kerja menggunakan Safari.</p></div></li>
        <li><Share /><div><h2>2. Ketuk Bagikan</h2><p>Pada sebagian tampilan, buka menu Lainnya terlebih dahulu.</p></div></li>
        <li><PlusSquare /><div><h2>3. Tambah ke Layar Utama</h2><p>Gulir menu Bagikan untuk menemukan pilihan ini.</p></div></li>
      </ol>
      <p className="registration-note"><Info /> Pemasangan dilakukan melalui menu Safari.</p>
    </> : last ? <>
      <Home className="registration-feature-icon" aria-hidden="true" />
      <h2>Buka dari layar utama</h2><p>Kembali ke layar utama iPhone, cari ikon Ruang Kerja, lalu ketuk untuk membuka aplikasi.</p>
      <img className="install-app-icon" src="/pwa/icon-512.png" alt="Ikon Ruang Kerja" />
      <p>Anda mungkin perlu masuk kembali saat pertama membuka aplikasi.</p>
      <p className="registration-note">Tombol Selesai menutup panduan. Aplikasi dibuka secara manual dari ikonnya.</p>
    </> : <>
      <ol className="install-instructions">
        <li><PlusSquare /><div><h2>4. Periksa nama aplikasi</h2><p>Pastikan namanya Ruang Kerja.</p></div></li>
        <li><Check /><div><h2>5. Buka sebagai aplikasi web</h2><p>Aktifkan opsi ini jika tersedia di Safari.</p></div></li>
        <li><PlusSquare /><div><h2>6. Ketuk Tambah</h2><p>Konfirmasikan di Safari agar ikon ditambahkan ke layar utama.</p></div></li>
      </ol>
      <p className="registration-note"><Info /> Tombol di bawah hanya melanjutkan panduan setelah Anda menambahkan ikon.</p>
    </>}
    <div className="registration-actions">
      <button className="ui-button ui-button--outline" onClick={() => go(first ? 'device' : last ? 'iphone-add' : 'iphone-share')}>
        <ArrowLeft /> Sebelumnya</button>
      <button className="ui-button" onClick={() => go(first ? 'iphone-add' : last ? 'done' : 'iphone-open')}>
        {first ? 'Lanjutkan' : last ? 'Selesai' : 'Sudah ditambahkan'}{!last && <ArrowRight />}</button>
    </div>
    {!last && <p className="install-guide-number">Panduan {first ? '1' : '2'} dari 2</p>}
  </section>;
}
