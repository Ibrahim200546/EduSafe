-- ONE SPECIFIC disposable HTTP integration fixture, not a general reset script.
-- Owner: b8e1c2f8-1920-47ae-a8ba-57b34e0da3c1
-- School: 6b3ea745-b366-4b06-94c0-12fd15be1eb7 / HTTP Integration 8fe7ac73
-- Drill: 7e164e7b-31cb-4b3c-af14-e0c45cd58499
-- Run only as SQL administrator after the HTTP test has signed out.
-- All assertions run before any DELETE. An error rolls back the transaction.
begin;

do $$
declare
 v_user constant uuid:='b8e1c2f8-1920-47ae-a8ba-57b34e0da3c1';
 v_school constant uuid:='6b3ea745-b366-4b06-94c0-12fd15be1eb7';
 v_incident constant uuid:='7e164e7b-31cb-4b3c-af14-e0c45cd58499';
 v_name constant text:='HTTP Integration 8fe7ac73';
 v_meta jsonb;
 org public.schools%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_school::text||':http-fixture-cleanup',0));
 -- Coordinate with the same per-school lease used by process_due().
 perform pg_advisory_xact_lock(hashtextextended(v_school::text||':due_jobs',0));

 -- Re-running an already completed exact cleanup is a verified no-op.
 if not exists(select 1 from auth.users where id=v_user)
  and not exists(select 1 from public.schools where id=v_school) then
  raise notice 'Exact HTTP fixture is already absent; no changes made.';
  return;
 end if;

 select raw_user_meta_data into v_meta from auth.users where id=v_user for update;
 if not found or v_meta->'http_integration_fixture' is distinct from 'true'::jsonb then
  raise exception 'Cleanup refused: exact user is missing or is not explicitly marked http_integration_fixture=true';
 end if;

 -- Locking the parent prevents concurrent FK-based inserts into this school.
 select * into org from public.schools where id=v_school for update;
 if not found or org.name is distinct from v_name or org.created_by is distinct from v_user
  or not org.is_demo or org.notification_mode is distinct from 'mock' then
  raise exception 'Cleanup refused: school UUID, exact name, owner, demo flag or mock mode does not match';
 end if;

 if (select count(*) from public.memberships where school_id=v_school)<>1
  or not exists(select 1 from public.memberships where school_id=v_school and user_id=v_user and role='admin') then
  raise exception 'Cleanup refused: the fixture owner must be the only school member';
 end if;
 if exists(select 1 from public.memberships where user_id=v_user and school_id<>v_school)
  or exists(select 1 from public.schools where created_by=v_user and id<>v_school) then
  raise exception 'Cleanup refused: this account also belongs to another organization';
 end if;

 if (select count(*) from public.students where school_id=v_school)<>60
  or (select count(*) from public.school_groups where school_id=v_school)<>3
  or (select count(*) from public.locations where school_id=v_school)<>3 then
  raise exception 'Cleanup refused: the expected 60-student / 3-group / 3-room synthetic dataset has changed';
 end if;
 if exists(select 1 from public.students where school_id=v_school and user_id is not null)
  or exists(select 1 from public.students where user_id=v_user)
  or exists(select 1 from public.guardian_links where school_id=v_school or guardian_id=v_user) then
  raise exception 'Cleanup refused: a pupil account or representative relationship has been connected';
 end if;

 if not exists(select 1 from public.incidents where id=v_incident and school_id=v_school
  and created_by=v_user and is_drill and status='acknowledged' and acknowledged_by=v_user) then
  raise exception 'Cleanup refused: the exact acknowledged HTTP test drill is missing or has changed';
 end if;
 if exists(select 1 from public.incidents where school_id=v_school
   and (not is_drill or created_by<>v_user or (acknowledged_by is not null and acknowledged_by<>v_user)))
  or exists(select 1 from public.incident_events where school_id=v_school and actor_id is not null and actor_id<>v_user)
  or exists(select 1 from public.audit_log where school_id=v_school and actor_id is not null and actor_id<>v_user)
  or exists(select 1 from public.lessons where school_id=v_school and teacher_id is not null and teacher_id<>v_user)
  or exists(select 1 from public.attendance where school_id=v_school and confirmed_by is not null and confirmed_by<>v_user)
  or exists(select 1 from public.attendance_changes where school_id=v_school and actor_id<>v_user) then
  raise exception 'Cleanup refused: the school contains a non-fixture actor or a non-drill incident';
 end if;
 if exists(select 1 from public.notifications where school_id=v_school and recipient_user_id<>v_user)
  or exists(select 1 from public.absence_requests where school_id=v_school
   and (created_by<>v_user or (reviewed_by is not null and reviewed_by<>v_user)))
  or exists(select 1 from app_private.invitations where school_id=v_school
   and (created_by<>v_user or (consumed_by is not null and consumed_by<>v_user)))
  or exists(select 1 from app_private.telegram_links where user_id=v_user) then
  raise exception 'Cleanup refused: another recipient, actor or Telegram identity is attached';
 end if;

 -- No global worker lease, integration secret, scheduler or unrelated row is
 -- touched. Child rows are deleted before their tenant-scoped parents.
 delete from public.notifications where school_id=v_school;
 delete from public.audit_log where school_id=v_school;
 delete from public.incident_events where school_id=v_school;
 delete from public.attendance_changes where school_id=v_school;
 delete from public.check_ins where school_id=v_school;
 delete from public.absence_requests where school_id=v_school;
 delete from app_private.qr_challenges where school_id=v_school;
 delete from app_private.invitations where school_id=v_school;
 delete from public.attendance where school_id=v_school;
 delete from public.enrollments where school_id=v_school;
 delete from public.guardian_links where school_id=v_school;
 delete from public.lessons where school_id=v_school;
 delete from public.incidents where school_id=v_school;
 delete from public.students where school_id=v_school;
 delete from public.school_groups where school_id=v_school;
 delete from public.locations where school_id=v_school;
 delete from public.memberships where school_id=v_school and user_id=v_user;
 delete from public.schools where id=v_school and created_by=v_user and name=v_name;

 -- Only authentication state owned by this explicitly marked fixture account.
 delete from app_private.telegram_link_tokens where user_id=v_user;
 delete from auth.refresh_tokens where user_id::text=v_user::text;
 delete from auth.sessions where user_id=v_user;
 delete from auth.users where id=v_user and raw_user_meta_data->'http_integration_fixture'='true'::jsonb;
 -- auth.users ON DELETE CASCADE removes the corresponding own profile and
 -- Auth-owned child rows. Other school memberships and student links were
 -- explicitly ruled out above, before any deletion.

 if exists(select 1 from public.schools where id=v_school)
  or exists(select 1 from auth.users where id=v_user)
  or exists(select 1 from public.profiles where id=v_user) then
  raise exception 'Cleanup verification failed; rolling back every deletion';
 end if;
end $$;

commit;

select
 (select count(*) from public.schools where id='6b3ea745-b366-4b06-94c0-12fd15be1eb7') as remaining_fixture_schools,
 (select count(*) from auth.users where id='b8e1c2f8-1920-47ae-a8ba-57b34e0da3c1') as remaining_fixture_users,
 (select count(*) from auth.sessions where user_id='b8e1c2f8-1920-47ae-a8ba-57b34e0da3c1') as remaining_fixture_sessions,
 (select count(*) from public.students where school_id='6b3ea745-b366-4b06-94c0-12fd15be1eb7') as remaining_fixture_students,
 (select count(*) from public.notifications where school_id='6b3ea745-b366-4b06-94c0-12fd15be1eb7') as remaining_fixture_notifications,
 (select count(*) from public.incidents where id='7e164e7b-31cb-4b3c-af14-e0c45cd58499') as remaining_fixture_drills;
