# Portal login Superadmin

- Login Superadmin: `/superadmin`.
- Login Anggota Divisi dan CEO tetap di `/login`.
- Sesudah masuk, Superadmin menuju dashboard `/admin`. Tautan area `/admin/*` yang dibuka tanpa sesi mengarah ke `/superadmin`, dengan tujuan semula dipertahankan setelah login.
- Keluar dari akun Superadmin mengembalikan pengguna ke `/superadmin`.
- Akun dengan sesi aktif tetap diarahkan ke area sesuai perannya; membuka halaman login lain tidak mengganti identitas sesi.

## Pembatasan backend

`POST /api/superadmin/auth/sign-in/email` hanya menerima akun Superadmin aktif. `POST /api/auth/sign-in/email` hanya menerima Anggota Divisi dan CEO aktif. Better Auth tetap memverifikasi kata sandi, membatasi percobaan, dan membuat cookie sesi. Hook admission memeriksa peran dari database sebelum sesi disimpan; peran, referrer, dan header yang dikirim klien tidak menentukan portal. Akun pada portal yang salah menerima kegagalan kredensial generik tanpa cookie atau sesi baru. Hak akses API tetap diperiksa dengan RBAC/RLS pada setiap permintaan.

## Referensi dan URL

- [Mockup desktop](../mockup/Superadmin/desktop/24-login-superadmin.png), dibuat menggunakan ImageGen.
- [Mockup mobile](../mockup/Superadmin/mobile/24-login-superadmin.png), dibuat menggunakan ImageGen.
- Stage sesudah merge ke `develop`: `https://ceo-stage.egiresources.com/superadmin`.
- Prod sesudah promosi `develop` ke `main`: `https://ceo.egiresources.com/superadmin`.

Uji integrasi `backend/tests/login-portals.test.ts` memeriksa matriks peran, ketiadaan sesi pada penolakan, pemalsuan parameter, login serentak, kredensial salah, origin, dan akun dicabut. Uji browser `e2e/admin/login.spec.ts` memeriksa halaman desktop/mobile, penolakan antarportal, redirect, login, dan logout. Semua pengujian memakai basis data lokal, tanpa kredensial produksi.
