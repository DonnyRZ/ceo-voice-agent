\set ON_ERROR_STOP on
\if :{?app_role}
\else
\set app_role ruang_kerja_app
\endif

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(35);

INSERT INTO public."user" (id, name, email) VALUES
    ('pgtap-member-it', 'Anggota IT pgTAP', 'pgtap-it@example.test'),
    ('pgtap-member-finance', 'Anggota Finance pgTAP', 'pgtap-finance@example.test'),
    ('pgtap-admin', 'Superadmin pgTAP', 'pgtap-admin@example.test');

INSERT INTO public.divisions (id, name) VALUES
    ('10000000-0000-4000-8000-000000000001', 'IT pgTAP'),
    ('10000000-0000-4000-8000-000000000002', 'Finance pgTAP'),
    ('10000000-0000-4000-8000-000000000003', 'Divisi kosong pgTAP');

INSERT INTO public.account_access (user_id, role, division_id) VALUES
    ('pgtap-member-it', 'member', '10000000-0000-4000-8000-000000000001'),
    ('pgtap-member-finance', 'member', '10000000-0000-4000-8000-000000000002'),
    ('pgtap-admin', 'superadmin', NULL);

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
SELECT is(
    (SELECT actor_id FROM public.audit_log
     WHERE record_table = 'tasks' AND record_id = '30000000-0000-4000-8000-000000000001' AND action = 'UPDATE'),
    'pgtap-member-it',
    'Audit perubahan menyimpan identitas anggota'
);

SELECT * FROM finish(true);
ROLLBACK;
