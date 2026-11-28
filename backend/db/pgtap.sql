\set ON_ERROR_STOP on
\if :{?app_role}
\else
\set app_role ruang_kerja_app
\endif

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(102);

INSERT INTO public."user" (id, name, email) VALUES
    ('pgtap-member-it', 'Anggota IT pgTAP', 'pgtap-it@example.test'),
    ('pgtap-member-finance', 'Anggota Finance pgTAP', 'pgtap-finance@example.test'),
    ('pgtap-admin', 'Superadmin pgTAP', 'pgtap-admin@example.test'),
    ('pgtap-ceo', 'CEO pgTAP', 'pgtap-ceo@example.test');

INSERT INTO public.divisions (id, name) VALUES
    ('10000000-0000-4000-8000-000000000001', 'IT pgTAP'),
    ('10000000-0000-4000-8000-000000000002', 'Finance pgTAP'),
    ('10000000-0000-4000-8000-000000000003', 'Divisi kosong pgTAP');

INSERT INTO public.account_access (user_id, role, division_id) VALUES
    ('pgtap-member-it', 'member', '10000000-0000-4000-8000-000000000001'),
    ('pgtap-member-finance', 'member', '10000000-0000-4000-8000-000000000002'),
    ('pgtap-admin', 'superadmin', NULL),
    ('pgtap-ceo', 'ceo', NULL);

INSERT INTO public.members (id, division_id, name) VALUES
    ('pgtap-member-it', '10000000-0000-4000-8000-000000000001', 'Anggota IT pgTAP'),
    ('pgtap-member-finance', '10000000-0000-4000-8000-000000000002', 'Anggota Finance pgTAP');

INSERT INTO public.projects (id, division_id, name) VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Proyek IT pgTAP'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Proyek Finance pgTAP');

INSERT INTO public.tasks (id, division_id, date, title, project_id, pic_id) VALUES
    ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', CURRENT_DATE,
        'Tugas IT pgTAP', '20000000-0000-4000-8000-000000000001', 'pgtap-member-it'),
    ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', CURRENT_DATE,
        'Tugas Finance pgTAP', '20000000-0000-4000-8000-000000000002', 'pgtap-member-finance');

UPDATE public.tasks SET status = 'done' WHERE id = '30000000-0000-4000-8000-000000000002';
UPDATE public.projects SET status = 'on_progress' WHERE id = '20000000-0000-4000-8000-000000000002';
UPDATE public.projects SET name = 'Proyek Finance terbaru pgTAP' WHERE id = '20000000-0000-4000-8000-000000000002';
UPDATE public.members SET name = 'PIC Finance baru pgTAP' WHERE id = 'pgtap-member-finance';

SELECT changed_at AS finance_task_created_at FROM public.audit_log
WHERE record_table = 'tasks' AND record_id = '30000000-0000-4000-8000-000000000002' AND action = 'INSERT' \gset

INSERT INTO public.invitations (email, role, division_id, token_hash, expires_at)
VALUES ('pgtap-invite@example.test', 'member', '10000000-0000-4000-8000-000000000002',
    repeat('a', 64), now() + interval '1 hour');

SET ROLE :"app_role";
SELECT is((SELECT count(*) FROM public.divisions), 0::bigint, 'Divisi memerlukan konteks anggota');
SELECT is((SELECT count(*) FROM public.tasks), 0::bigint, 'Tugas memerlukan konteks anggota');

SELECT set_config('app.user_id', 'pgtap-member-it', true) AS app_user \gset
SELECT is(
    (SELECT division_id FROM public.members WHERE id = 'pgtap-member-it'),
    '10000000-0000-4000-8000-000000000001'::uuid,
    'Sesi dapat menemukan keanggotaan dari identitas pengguna'
);
SELECT is((SELECT count(*) FROM public.members), 1::bigint, 'Daftar anggota terbatas pada divisi sendiri');
SELECT is((SELECT name FROM public.divisions), 'IT pgTAP', 'Daftar divisi terbatas pada divisi sendiri');
SELECT is((SELECT count(*) FROM public.tasks), 0::bigint, 'Tugas memerlukan konteks divisi aktif');

SELECT set_config('app.division_id', '10000000-0000-4000-8000-000000000001', true) AS app_division \gset
SELECT is((SELECT name FROM public.projects), 'Proyek IT pgTAP', 'Proyek divisi lain tersembunyi');
SELECT is((SELECT title FROM public.tasks), 'Tugas IT pgTAP', 'Tugas divisi lain tersembunyi');
SELECT ok(
    app_private.is_active_member('10000000-0000-4000-8000-000000000001', 'pgtap-member-it'),
    'Roster mengenali anggota aktif divisi sendiri'
);
SELECT ok(
    NOT app_private.is_active_member('10000000-0000-4000-8000-000000000002', 'pgtap-member-finance'),
    'Roster tidak mengungkap keanggotaan divisi lain'
);
SELECT is((SELECT count(*) FROM public.invitations), 0::bigint, 'Undangan hanya terlihat oleh Superadmin');
SELECT throws_ok(
    $$INSERT INTO public.divisions (name) VALUES ('Divisi terlarang pgTAP')$$,
    '42501', NULL, 'Anggota tidak dapat membuat divisi'
);

SELECT lives_ok($$
    UPDATE public.tasks SET status = 'on_progress', version = version + 1
    WHERE id = '30000000-0000-4000-8000-000000000001' AND version = 1
$$, 'Runtime dapat memperbarui tugas divisi sendiri');
SELECT is(
    (SELECT version FROM public.tasks WHERE id = '30000000-0000-4000-8000-000000000001'),
    2,
    'Perubahan menyimpan versi berikutnya'
);
SELECT results_eq(
    $$ SELECT previous_status, status, actor_name
       FROM public.task_status_history('30000000-0000-4000-8000-000000000001') $$,
    $$ VALUES ('pending'::text, 'on_progress'::text, 'Anggota IT pgTAP'::text) $$,
    'Riwayat status mencatat nilai lama, nilai baru, dan nama anggota'
);
SELECT is(
    (SELECT count(*) FROM public.task_status_history('30000000-0000-4000-8000-000000000002')),
    0::bigint,
    'Riwayat status divisi lain tersembunyi'
);
SELECT is((SELECT count(*) FROM public.ceo_work_status_as_of(
    'task', '30000000-0000-4000-8000-000000000002', 'infinity')),
    0::bigint, 'Anggota tidak dapat menggunakan snapshot lintas divisi CEO');
SELECT is((SELECT count(*) FROM public.ceo_search_work(
    'task', 'tugas finance pgtap', NULL, NULL, true)),
    0::bigint, 'Anggota tidak dapat menggunakan pencarian lintas divisi CEO');
SELECT is((SELECT count(*) FROM public.ceo_exact_work_labels(ARRAY['Tugas IT pgTAP'], 'task', NULL, NULL)),
    0::bigint, 'Anggota tidak dapat memakai pencarian nama resmi CEO');
SELECT is((SELECT count(*) FROM public.audit_log), 0::bigint, 'RLS menyembunyikan audit log dari Anggota Divisi');
SELECT throws_ok('UPDATE public.audit_log SET action = ''DELETE''', '42501', NULL, 'Runtime tidak dapat mengubah audit log');
SELECT throws_ok($$
    INSERT INTO public.projects (division_id, name)
    VALUES ('10000000-0000-4000-8000-000000000002', 'Proyek lintas divisi pgTAP')
$$, '42501', NULL, 'RLS menolak pembuatan proyek di divisi lain');
SELECT throws_ok($$
    INSERT INTO public.tasks (division_id, date, title, project_id, pic_id)
    VALUES ('10000000-0000-4000-8000-000000000001', CURRENT_DATE, 'Tugas lintas divisi pgTAP',
        '20000000-0000-4000-8000-000000000002', 'pgtap-member-it')
$$, '23503', NULL, 'Foreign key komposit menjaga proyek tetap satu divisi');

SELECT set_config('app.division_id', '10000000-0000-4000-8000-000000000002', true) AS app_division \gset
SELECT is((SELECT count(*) FROM public.tasks), 0::bigint, 'Konteks divisi harus sesuai keanggotaan');
SELECT set_config('app.user_id', 'pgtap-unknown-user', true) AS app_user \gset
SELECT is((SELECT count(*) FROM public.projects), 0::bigint, 'Identitas tanpa keanggotaan tidak memiliki akses proyek');

SELECT set_config('app.user_id', 'pgtap-admin', true) AS app_user \gset
SELECT ok(app_private.is_superadmin(), 'Identitas Superadmin dikenali oleh PostgreSQL');
SELECT is(
    (SELECT count(*) FROM public.tasks WHERE id IN (
        '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'
    )), 2::bigint, 'Superadmin dapat membaca tugas lintas divisi'
);
SELECT is(
    (SELECT count(*) FROM public.task_status_history('30000000-0000-4000-8000-000000000002')),
    1::bigint, 'Superadmin dapat membaca riwayat tugas lintas divisi'
);
SELECT is(
    (SELECT actor_name FROM public.audit_log WHERE record_table = 'tasks'
        AND record_id = '30000000-0000-4000-8000-000000000001' AND action = 'UPDATE'),
    'Anggota IT pgTAP', 'Superadmin dapat membaca identitas pelaku yang tercatat pada audit'
);
SELECT throws_ok('UPDATE public.audit_log SET action = ''DELETE''',
    '42501', NULL, 'Superadmin tidak dapat mengubah audit log');
SELECT throws_ok('SELECT token_hash FROM public.invitations',
    '42501', NULL, 'Runtime tidak dapat membaca hash token undangan');
SELECT ok(
    NOT EXISTS (SELECT 1 FROM public.audit_log WHERE record_table = 'invitations'
        AND (old_row ? 'token_hash' OR new_row ? 'token_hash')),
    'Audit undangan menghilangkan hash token'
);
UPDATE public."user" SET name = 'Anggota dengan nama baru pgTAP' WHERE id = 'pgtap-member-finance';
SELECT results_eq(
    $$SELECT old_row ->> 'name', new_row ->> 'name', actor_name
      FROM public.audit_log WHERE record_table = 'account_access'
        AND record_id = 'pgtap-member-finance' AND new_row ? 'name'$$,
    $$VALUES ('Anggota Finance pgTAP'::text, 'Anggota dengan nama baru pgTAP'::text, 'Superadmin pgTAP'::text)$$,
    'Audit menyimpan nama lama, nama baru, dan pelaku perubahan profil'
);
SELECT throws_ok(
    $$UPDATE public.divisions SET status = 'archived' WHERE id = '10000000-0000-4000-8000-000000000001'$$,
    '23514', NULL, 'Database menolak arsip divisi dengan anggota aktif'
);
SELECT lives_ok(
    $$UPDATE public.divisions SET status = 'archived' WHERE id = '10000000-0000-4000-8000-000000000003'$$,
    'Superadmin dapat mengarsipkan divisi kosong'
);
SELECT is(
    (SELECT status FROM public.divisions WHERE id = '10000000-0000-4000-8000-000000000003'),
    'archived', 'Divisi yang diarsipkan tetap tercatat'
);

UPDATE public.account_access SET state = 'revoked' WHERE user_id = 'pgtap-member-it';
SELECT set_config('app.user_id', 'pgtap-member-it', true) AS app_user \gset
SELECT set_config('app.division_id', '10000000-0000-4000-8000-000000000001', true) AS app_division \gset
SELECT is((SELECT count(*) FROM public.tasks), 0::bigint, 'Akun dicabut kehilangan akses di PostgreSQL');

RESET ROLE;
INSERT INTO public.projects (division_id, name) VALUES
    ('10000000-0000-4000-8000-000000000001', 'Kalibrasi—Aset pgTAP'),
    ('10000000-0000-4000-8000-000000000002', 'Kalibrasi Aset pgTAP'),
    ('10000000-0000-4000-8000-000000000001', 'Kalibrasi Aset C# pgTAP'),
    ('10000000-0000-4000-8000-000000000001', 'Kalibrasi Aset C pgTAP');
SET ROLE :"app_role";
SELECT set_config('app.user_id', 'pgtap-ceo', true) AS app_user \gset
SELECT ok(app_private.is_ceo() AND NOT app_private.is_superadmin(), 'CEO memiliki peran baca tersendiri');
SELECT is((SELECT count(*) FROM public.tasks WHERE id IN (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'
)), 2::bigint, 'CEO dapat membaca tugas lintas divisi');
SELECT is((SELECT count(*) FROM public.projects WHERE id IN (
    '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'
)), 2::bigint, 'CEO dapat membaca proyek lintas divisi');
SELECT is((SELECT status FROM public.divisions WHERE id = '10000000-0000-4000-8000-000000000003'),
    'archived', 'CEO dapat membaca divisi yang diarsipkan');
SELECT is((SELECT id FROM public.ceo_search_work('task', 'tugas finance pgtap', NULL, NULL, true)),
    '30000000-0000-4000-8000-000000000002', 'Pencarian CEO menemukan judul tugas lintas divisi');
SELECT is((SELECT id FROM public.ceo_search_work('task', 'tugas finance pgtp',
    '10000000-0000-4000-8000-000000000002', NULL, false) LIMIT 1),
    '30000000-0000-4000-8000-000000000002', 'Pencarian CEO menemukan judul dengan salah ketik dalam divisi');
SELECT is((SELECT id FROM public.ceo_search_work('project', 'proyek finance pgtap', NULL,
    :'finance_task_created_at', true)),
    '20000000-0000-4000-8000-000000000002', 'Pencarian historis CEO memakai nama proyek sebelum penggantian');
SELECT is((SELECT id FROM public.ceo_search_work('project', 'proyek finance pgtp', NULL,
    :'finance_task_created_at', false) LIMIT 1),
    '20000000-0000-4000-8000-000000000002', 'Pencarian historis CEO menemukan nama proyek dengan salah ketik');
SELECT is((SELECT count(*) FROM public.ceo_search_work('project', 'proyek finance pgtap', NULL,
    'infinity', true)), 0::bigint, 'Pencarian historis tidak menampilkan nama yang sudah diganti pada waktu itu');
SELECT is((SELECT count(*) FROM public.ceo_exact_work_labels(ARRAY['Ｋalibrasi   Aset pgTAP'], 'project', NULL, NULL)),
    2::bigint, 'Nama resmi yang terdengar sama tetap mencakup semua pilihan');
SELECT is((SELECT name FROM public.ceo_exact_work_labels(ARRAY['Ｋalibrasi   Aset pgTAP'], 'project',
    '10000000-0000-4000-8000-000000000001', NULL)), 'Kalibrasi—Aset pgTAP', 'Lingkup divisi memilih nama resmi yang sesuai');
SELECT is((SELECT name FROM public.ceo_exact_work_labels(ARRAY['Kalibrasi Aset C＃ pgTAP'], 'project', NULL, NULL)),
    'Kalibrasi Aset C# pgTAP', 'Pencarian nama resmi mempertahankan simbol bermakna');
SELECT is((SELECT id FROM public.ceo_exact_work_labels(ARRAY['Proyek Finance pgTAP'], 'project', NULL,
    :'finance_task_created_at')), '20000000-0000-4000-8000-000000000002'::uuid, 'Nama resmi historis mengikuti catatan pada tanggal acuan');
SELECT is((SELECT count(*) FROM public.ceo_exact_work_labels(ARRAY['Proyek Finance pgTAP'], 'project', NULL,
    'infinity')), 0::bigint, 'Nama historis lama tidak muncul sesudah diubah');
SELECT results_eq(
    $$SELECT status::text, title, project_id, pic_name FROM public.ceo_work_status_as_of(
        'task', '30000000-0000-4000-8000-000000000002', 'infinity')$$,
    $$VALUES ('done'::text, 'Tugas Finance pgTAP'::text, '20000000-0000-4000-8000-000000000002'::uuid,
        'PIC Finance baru pgTAP'::text)$$,
    'Snapshot CEO mengembalikan status, proyek dan PIC dari audit'
);
SELECT is((SELECT pic_name FROM public.ceo_work_status_as_of(
    'task', '30000000-0000-4000-8000-000000000002', :'finance_task_created_at')),
    'Anggota Finance pgTAP', 'Snapshot CEO memakai nama PIC pada saat diminta');
SELECT is((SELECT status FROM public.ceo_work_status_as_of(
    'task', '30000000-0000-4000-8000-000000000002', :'finance_task_created_at')),
    'pending'::public.work_status, 'Snapshot CEO menyertakan status awal tugas');
SELECT is((SELECT count(*) FROM public.ceo_work_status_as_of(
    'task', '30000000-0000-4000-8000-000000000002', '-infinity')),
    0::bigint, 'Snapshot CEO kosong sebelum rekaman pertama');
SELECT results_eq(
    $$SELECT previous_status::text, status::text FROM public.ceo_work_status_history(
        'task', '30000000-0000-4000-8000-000000000002', NULL, NULL, 20)$$,
    $$VALUES ('pending'::text, 'done'::text)$$,
    'CEO membaca perubahan status tugas dengan nilai sebelumnya'
);
SELECT results_eq(
    $$SELECT previous_status::text, status::text FROM public.ceo_work_status_history(
        'project', '20000000-0000-4000-8000-000000000002', NULL, NULL, 20)$$,
    $$VALUES ('pending'::text, 'on_progress'::text)$$,
    'CEO membaca riwayat perubahan status proyek'
);
SELECT is((SELECT count(*) FROM public.audit_log), 0::bigint, 'CEO tidak dapat membaca audit mentah');
SELECT is((SELECT count(*) FROM public.invitations), 0::bigint, 'CEO tidak dapat membaca undangan');
SELECT is((SELECT count(*) FROM public.account_access), 1::bigint, 'CEO hanya dapat membaca akses akun sendiri');
WITH changed AS (
    UPDATE public.tasks SET status = 'done'
    WHERE id = '30000000-0000-4000-8000-000000000001' RETURNING id
)
SELECT is((SELECT count(*) FROM changed), 0::bigint, 'CEO tidak dapat mengubah tugas');
SELECT throws_ok($$
    INSERT INTO public.projects (division_id, name)
    VALUES ('10000000-0000-4000-8000-000000000001', 'Proyek CEO pgTAP')
$$, '42501', NULL, 'CEO tidak dapat membuat proyek');
SELECT is((SELECT count(*) FROM public.claim_work_search_embeddings('pgtap-model', 10)),
    0::bigint, 'Sesi CEO tidak dapat mengambil pekerjaan indeks');
SELECT is((SELECT count(resource_id) FROM public.work_search_embeddings WHERE resource_id IN (
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'
)), 2::bigint, 'CEO membaca indeks tugas lintas divisi');
SELECT throws_ok('SELECT content_hash FROM public.work_search_embeddings', '42501', NULL,
    'Metadata internal pekerjaan indeks hanya untuk worker');

SELECT set_config('app.user_id', 'pgtap-admin', true) AS app_user \gset
UPDATE public.account_access SET state = 'revoked' WHERE user_id = 'pgtap-ceo';
SELECT set_config('app.user_id', 'pgtap-ceo', true) AS app_user \gset
SELECT is((SELECT count(*) FROM public.tasks), 0::bigint, 'CEO yang dicabut kehilangan akses kerja');
SELECT is((SELECT count(*) FROM public.ceo_work_status_history(
    'task', '30000000-0000-4000-8000-000000000002', NULL, NULL, 20)),
    0::bigint, 'CEO yang dicabut kehilangan akses riwayat');

RESET ROLE;
SELECT is(
    (SELECT actor_id FROM public.audit_log
     WHERE record_table = 'tasks' AND record_id = '30000000-0000-4000-8000-000000000001' AND action = 'UPDATE'),
    'pgtap-member-it',
    'Audit perubahan menyimpan identitas anggota'
);

UPDATE public.work_search_embeddings SET next_attempt_at = 'infinity'
WHERE resource_id <> '20000000-0000-4000-8000-000000000001';
SET ROLE :"app_role";
SELECT set_config('app.user_id', '', true) AS app_user \gset
SELECT lease_id AS project_lease, content_hash AS first_hash
FROM public.claim_work_search_embeddings('pgtap-model', 1)
WHERE resource_id = '20000000-0000-4000-8000-000000000001' \gset
SELECT is((SELECT count(*) FROM public.claim_work_search_embeddings('pgtap-model', 1)),
    0::bigint, 'Worker kedua tidak mengambil dokumen yang sedang dikerjakan');
RESET ROLE;
UPDATE public.projects SET name = 'Proyek IT terbaru pgTAP' WHERE id = '20000000-0000-4000-8000-000000000001';
SET ROLE :"app_role";
SELECT ok(NOT public.complete_work_search_embedding('project', '20000000-0000-4000-8000-000000000001',
    :'project_lease', 'pgtap-model', ('[1' || repeat(',0', 1535) || ']')::public.vector),
    'Worker tidak dapat menyimpan embedding dari versi lama');
SELECT lease_id AS current_lease, content_hash AS current_hash
FROM public.claim_work_search_embeddings('pgtap-model', 1)
WHERE resource_id = '20000000-0000-4000-8000-000000000001' \gset
SELECT isnt(:'first_hash'::text, :'current_hash'::text, 'Perubahan teks menghasilkan hash dokumen baru');
SELECT ok(public.complete_work_search_embedding('project', '20000000-0000-4000-8000-000000000001',
    :'current_lease', 'pgtap-model', ('[1' || repeat(',0', 1535) || ']')::public.vector),
    'Worker menyimpan embedding dengan lease dokumen aktif');
SELECT is((SELECT count(*) FROM public.claim_work_search_embeddings('pgtap-model', 1)),
    0::bigint, 'Worker tidak mengulang model dan teks yang sudah diindeks');
SELECT is((SELECT count(*) FROM public.claim_work_search_embeddings('pgtap-model-next', 1)),
    1::bigint, 'Perubahan model menjadwalkan ulang dokumen');


-- Public registration exposes only capability-bound operations, never pending credentials.
RESET ROLE;
SET ROLE :"app_role";
SELECT throws_ok('SELECT * FROM app_private.member_registrations', '42501', NULL,
    'Runtime tidak dapat membaca kata sandi atau token registrasi');
SELECT throws_ok('SELECT * FROM app_private.registration_limits', '42501', NULL,
    'Runtime tidak dapat memodifikasi bucket pembatasan secara langsung');
SELECT ok(NOT has_function_privilege('public', 'public.verify_member_registration(text,text,text)', 'EXECUTE'),
    'Fungsi aktivasi bukan hak PUBLIC');
SELECT ok(public.save_member_registration('pgtap-register@egiresources.com', 'Registrasi pgTAP',
    '10000000-0000-4000-8000-000000000001', 'test-only-credential-hash', repeat('a',64), repeat('b',64)) IS NOT NULL,
    'Pendaftaran hanya menyimpan permintaan sampai email diverifikasi');
SELECT public.capture_registration_origin(repeat('b',64),'desktop');
SELECT ok(public.registration_rate_allowed(repeat('c',64), 1, 600), 'Percobaan pertama diizinkan');
SELECT ok(NOT public.registration_rate_allowed(repeat('c',64), 1, 600), 'Bucket bersama membatasi percobaan berikutnya');
SELECT is(public.verify_member_registration(repeat('a',64), 'pgtap-self-register', 'pgtap-self-credential'),
    'pgtap-register@egiresources.com', 'Verifikasi mengaktifkan akun');
SELECT is(public.verify_member_registration(repeat('a',64), 'pgtap-replay', 'pgtap-replay-credential'),
    NULL::text, 'Tautan yang dikonsumsi tidak dapat diputar ulang');
RESET ROLE;
SELECT is((SELECT role::text FROM account_access WHERE user_id='pgtap-self-register'),
    'member', 'Registrasi publik selalu menghasilkan Anggota Divisi');
SELECT is((SELECT "emailVerified" FROM "user" WHERE id='pgtap-self-register'),
    true, 'Akun aktif memiliki email yang terverifikasi');
SELECT ok(NOT EXISTS(SELECT FROM app_private.member_registrations
    WHERE email='pgtap-register@egiresources.com' AND (credential_hash IS NOT NULL OR token_hash IS NOT NULL)),
    'Kredensial sementara dan token dibersihkan setelah aktivasi');

SET ROLE :"app_role";
SELECT ok(public.save_member_registration('pgtap-context@egiresources.com', 'Konteks pgTAP',
    '10000000-0000-4000-8000-000000000001', 'test-only-hash', repeat('d',64), repeat('e',64)) IS NOT NULL,
    'Pendaftaran baru dapat menyimpan konteks sebelum email dikirim');
SELECT public.capture_registration_origin(repeat('e',64), 'mobile');
SELECT is((SELECT origin_device FROM public.registration_context(repeat('e',64))), 'mobile',
    'Perangkat awal tersimpan pada klaim browser asal');
SELECT public.capture_registration_origin(repeat('e',64), 'desktop');
SELECT is((SELECT origin_device FROM public.registration_context(repeat('e',64))), 'mobile',
    'Perangkat awal tidak berubah saat form diedit');
SELECT is((SELECT count(*) FROM public.registration_context(repeat('f',64))), 0::bigint,
    'Browser lain tidak dapat membaca konteks pendaftaran');
SELECT ok(NOT has_function_privilege('public', 'public.confirm_member_registration(text,text,text,text)', 'EXECUTE'),
    'Konfirmasi dengan konteks bukan hak PUBLIC');
SELECT is((SELECT same_browser FROM public.confirm_member_registration(repeat('d',64),
    'pgtap-context-user', 'pgtap-context-account', repeat('e',64))), true,
    'Konfirmasi hanya mengembalikan status browser asal untuk klaim yang benar');
SELECT is((SELECT origin_device FROM public.registration_context(repeat('e',64))), 'mobile',
    'Konteks perangkat tetap tersedia sesudah verifikasi');
SELECT ok(NOT has_function_privilege('public','public.complete_member_registration(text,text,text)','EXECUTE'),
    'Penyelesaian registrasi bukan hak PUBLIC');
RESET ROLE;
SELECT is((SELECT count(*) FROM public."user" WHERE email='pgtap-context@egiresources.com'),0::bigint,
    'Verifikasi mobile tidak membuat akun sebelum onboarding selesai');
SET ROLE :"app_role";
SELECT is(public.complete_member_registration(repeat('e',64),'pgtap-context-user','pgtap-context-account'),NULL::text,
    'Aktivasi mobile ditolak sebelum tahap akhir pemasangan');
SELECT ok(NOT public.save_registration_step(repeat('f',64),'iphone-open'),
    'Browser lain tidak dapat mengubah progres');
SELECT ok(public.save_registration_step(repeat('e',64),'iphone-open'),'Tahap tersimpan pada server');
SELECT is(public.complete_member_registration(repeat('e',64),'pgtap-context-user','pgtap-context-account'),
    'pgtap-context@egiresources.com','Akun dibuat setelah tahap akhir selesai');
SELECT is((SELECT completed FROM public.registration_onboarding(repeat('e',64))),true,
    'Progres membedakan selesai dari email terverifikasi');
SELECT ok(NOT has_function_privilege('public', 'public.retire_registration_draft(text)', 'EXECUTE'),
    'Penggantian draft bukan hak PUBLIC');
SELECT public.retire_registration_draft(repeat('e',64));
SELECT is((SELECT count(*) FROM public.registration_status(repeat('e',64))), 1::bigint,
    'Penggantian draft tidak membatalkan akun yang sudah aktif');
SELECT public.save_member_registration('pgtap-edit@egiresources.com', 'Draft pgTAP',
    '10000000-0000-4000-8000-000000000001', 'test-only-hash', repeat('7',64), repeat('8',64));
SELECT public.retire_registration_draft(repeat('8',64));
SELECT is((SELECT count(*) FROM public.registration_status(repeat('8',64))), 0::bigint,
    'Draft lama tidak dapat dilanjutkan setelah digantikan');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
