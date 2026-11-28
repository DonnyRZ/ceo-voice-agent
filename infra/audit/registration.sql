BEGIN READ ONLY;
SELECT json_build_object(
  'read_only',current_setting('transaction_read_only'),
  'database',current_database(),
  'users',(SELECT coalesce(json_agg(row_to_json(u)),'[]') FROM (
    SELECT id,"emailVerified","createdAt","updatedAt" FROM public."user" WHERE lower(email)=:'subject'
  ) u),
  'accounts',(SELECT coalesce(json_agg(row_to_json(a)),'[]') FROM (
    SELECT a.id,a."userId",a."providerId",a.password,a."createdAt",a."updatedAt"
    FROM public.account a JOIN public."user" u ON u.id=a."userId" WHERE lower(u.email)=:'subject'
  ) a),
  'access',(SELECT coalesce(json_agg(row_to_json(a)),'[]') FROM (
    SELECT a.user_id,a.role,a.state,a.division_id,d.status AS division_status
    FROM public.account_access a JOIN public."user" u ON u.id=a.user_id
    LEFT JOIN public.divisions d ON d.id=a.division_id WHERE lower(u.email)=:'subject'
  ) a),
  'registrations',(SELECT coalesce(json_agg(row_to_json(r)),'[]') FROM (
    SELECT id,division_id,credential_hash,verified_at,completed_at,legacy_user_id,onboarding_step,
      expires_at,sent_at,origin_device,delivery
    FROM app_private.member_registrations WHERE email=:'subject'
  ) r),
  'candidates',(SELECT coalesce(json_agg(row_to_json(c)),'[]') FROM public.registration_resume_candidates(:'subject') c),
  'functions',(SELECT json_agg(json_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),
    'security_definer',p.prosecdef,'config',p.proconfig)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('registration_resume_candidates','resume_member_registration'))
);
ROLLBACK;
