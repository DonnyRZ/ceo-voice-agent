const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function registrationEmail(verificationUrl: string) {
  const url = new URL(verificationUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Tautan verifikasi harus menggunakan HTTPS.');
  }
  const link = escapeHtml(url.href);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@media(max-width:600px){h1{font-size:28px!important}.rk-email-brand{width:180px!important}}</style></head>
<body style="margin:0;background:#edf5f3;color:#102629;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:18px"><tr>
<td style="padding:32px 24px;text-align:center">
<img class="rk-email-brand" src="cid:ruang-kerja-brand" alt="Ruang Kerja" width="220" style="display:block;width:220px;max-width:100%;height:auto;margin:0 auto 24px">
<hr style="border:0;border-top:1px solid #cbe8e1;margin:0 0 24px">
<h1 style="font-size:32px;line-height:1.3;margin:0 0 20px;color:#102629">Verifikasi email Anda</h1>
<p>Terima kasih sudah mendaftar sebagai Anggota Divisi.</p>
<p>Tekan tombol berikut untuk memverifikasi email perusahaan dan mengaktifkan akun Anda.</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto"><tr>
<td bgcolor="#00675c" style="border-radius:10px;text-align:center"><a href="${link}" style="display:inline-block;padding:14px 28px;min-height:20px;color:#fff;text-decoration:none;font-size:16px;font-weight:bold">Verifikasi email</a></td>
</tr></table>
<p style="font-size:14px;color:#52656b">Tautan berlaku 24 jam dan hanya dapat digunakan sekali.</p>
<p>Setelah verifikasi, kembali ke browser tempat Anda memulai pendaftaran untuk melanjutkan.</p>
<hr style="border:0;border-top:1px solid #cbe8e1;margin:24px 0">
<p style="font-size:14px;color:#52656b">Jika Anda tidak membuat pendaftaran ini, abaikan email ini.</p>
</td></tr></table></td></tr></table></body></html>`;
}
