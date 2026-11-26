\set ON_ERROR_STOP on
\if :{?app_role}
\else
\set app_role ruang_kerja_app
\endif

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(19);

INSERT INTO public."user" (id, name, email) VALUES
    ('pgtap-member-it', 'Anggota IT pgTAP', 'pgtap-it@example.test'),
    ('pgtap-member-finance', 'Anggota Finance pgTAP', 'pgtap-finance@example.test');

INSERT INTO public.divisions (id, name) VALUES
    ('10000000-0000-4000-8000-000000000001', 'IT pgTAP'),
    ('10000000-0000-4000-8000-000000000002', 'Finance pgTAP');

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
SELECT throws_ok('SELECT id FROM public.audit_log', '42501', NULL, 'Akses langsung ke audit log dibatasi');
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

RESET ROLE;
SELECT is(
    (SELECT actor_id FROM public.audit_log
     WHERE record_table = 'tasks' AND record_id = '30000000-0000-4000-8000-000000000001' AND action = 'UPDATE'),
    'pgtap-member-it',
    'Audit perubahan menyimpan identitas anggota'
);

SELECT * FROM finish(true);
ROLLBACK;
