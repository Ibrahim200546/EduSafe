-- Run as the Supabase SQL administrator against the EduSafe project after all
-- migrations. Every fixture and mutation is rolled back. No external network
-- calls, authentication emails, or Telegram messages are made by this script.
begin;
create temporary table edusafe_test_results(name text primary key);
grant insert,select on edusafe_test_results to authenticated,service_role;
create function pg_temp.ok(p_ok boolean,p_name text) returns void language plpgsql as $$
begin
 if not coalesce(p_ok,false) then raise exception 'TEST FAILED: %',p_name; end if;
 insert into edusafe_test_results values(p_name);
end $$;
create function pg_temp.denied(p_sql text,p_name text,p_state text default '42501',p_message text default null)
returns void language plpgsql as $$
declare failed boolean:=false; actual_state text; actual_message text;
begin
 begin execute p_sql;
 exception when others then
  get stacked diagnostics actual_state=returned_sqlstate,actual_message=message_text;
  failed:=true;
  if p_state is not null and actual_state<>p_state then raise exception 'TEST FAILED %: SQLSTATE %, message %',p_name,actual_state,actual_message; end if;
  if p_message is not null and position(p_message in actual_message)=0 then raise exception 'TEST FAILED %: unexpected error %',p_name,actual_message; end if;
 end;
 if not failed then raise exception 'TEST FAILED %: operation unexpectedly allowed',p_name; end if;
 insert into edusafe_test_results values(p_name);
end $$;
create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','session_id',p_user)::text,true);
end $$;

-- Distinct, fictional users. No passwords are created or emails sent.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('f0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated',
 'edusafe-fixture-'||i||'@example.test',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Тестовый участник '||i),now(),now() from generate_series(1,9) i;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated',
 'edusafe-pupil-'||i||'@example.test',now(),'{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('full_name','Тестовый ученик '||i),now(),now() from generate_series(1,20) i;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after)
 select id,id,now(),now(),'aal1',now()+interval '1 hour' from auth.users
 where id::text like '10000000-0000-4000-8000-%' or id::text like 'f0000000-0000-4000-8000-%';

insert into public.schools(id,name,created_by,notifications_enabled,notification_mode) values
 ('30000000-0000-4000-8000-000000000001','Тестовая школа А','f0000000-0000-4000-8000-000000000001',true,'mock'),
 ('30000000-0000-4000-8000-000000000002','Тестовая школа Б','f0000000-0000-4000-8000-000000000002',true,'mock');
insert into public.school_groups(id,school_id,name) values
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Тестовая группа А'),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Тестовая группа Б');
insert into public.locations(id,school_id,name) values
 ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Кабинет А'),
 ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Кабинет Б');
insert into public.memberships(school_id,user_id,role,group_ids) values
 ('30000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','admin','{}'),
 ('30000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000002','admin','{}'),
 ('30000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','teacher',array['40000000-0000-4000-8000-000000000001']::uuid[]),
 ('30000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000006','guardian','{}'),
 ('30000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000007','security','{}'),
 ('30000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000008','teacher','{}');
insert into public.students(id,school_id,group_id,full_name,user_id,is_adult)
select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'30000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','Вымышленный ученик '||i,('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,i=20 from generate_series(1,20) i;
insert into public.students(id,school_id,group_id,full_name) values
 ('20000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','Чужая тестовая запись');
insert into public.enrollments(school_id,student_id,group_id,starts_at)
select school_id,id,group_id,now()-interval '1 day' from public.students where id::text like '20000000-0000-4000-8000-%';
insert into public.memberships(school_id,user_id,role)
select school_id,user_id,'student' from public.students where id::text like '20000000-0000-4000-8000-%' and user_id is not null;
insert into public.guardian_links(id,school_id,student_id,guardian_id,status) values
 ('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000006','pending'),
 ('70000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000020','f0000000-0000-4000-8000-000000000006','pending');
insert into public.lessons(id,school_id,group_id,location_id,teacher_id,title,starts_at,ends_at,status) values
 ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','Тестовый урок',now()-interval '5 minutes',now()+interval '40 minutes','active'),
 ('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000002','Чужой урок',now()-interval '5 minutes',now()+interval '40 minutes','active');
insert into public.attendance(school_id,lesson_id,student_id)
select school_id,'60000000-0000-4000-8000-000000000001',id from public.students where school_id='30000000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-000000000009');
select pg_temp.ok(public.edusafe_workspace()->'school'='null'::jsonb,'onboarding: no school yields empty snapshot');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=0,'onboarding: no unauthorized data');
do $$ declare created jsonb; begin
 created:=public.edusafe_action('create_school','{"name":"Новая тестовая организация","timezone":"Asia/Almaty"}');
 perform pg_temp.ok(created->>'id' is not null,'onboarding: verified account creates own school');
end $$;
select pg_temp.denied($q$select public.edusafe_action('create_school','{"name":"Повторная школа"}')$q$,'onboarding: duplicate school creation rejected','P0001');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) from public.schools where id='30000000-0000-4000-8000-000000000002')=0,'RLS: another school hidden');
select pg_temp.denied($q$select public.edusafe_workspace('30000000-0000-4000-8000-000000000002')$q$,'RPC: another school forbidden');
select pg_temp.denied($q$insert into public.school_groups(school_id,name) values('30000000-0000-4000-8000-000000000001','Direct write')$q$,'RLS: direct writes forbidden even to admin');
select pg_temp.denied($q$select public.edusafe_process_due()$q$,'service RPC: ordinary user forbidden');
select pg_temp.denied($q$select * from app_private.qr_challenges$q$,'private QR hashes not readable');
select pg_temp.denied($q$select public.edusafe_action('create_lesson','{"group_id":"40000000-0000-4000-8000-000000000002","title":"Bad","starts_at":"2026-11-03T08:00:00Z","ends_at":"2026-11-03T09:00:00Z"}')$q$,'tenant: cross-school group mutation rejected','P0001','NOT_FOUND');
select public.edusafe_action('approve_guardian','{"id":"70000000-0000-4000-8000-000000000001"}');
select pg_temp.denied($q$select public.edusafe_action('approve_guardian','{"id":"70000000-0000-4000-8000-000000000020"}')$q$,'adult guardian access requires explicit approval','P0001');
select public.edusafe_action('approve_guardian','{"id":"70000000-0000-4000-8000-000000000020","adult_authorized":true}');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000006');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=2,'guardian: exactly linked children visible');
select pg_temp.ok((select count(*) from public.students where id='20000000-0000-4000-8000-000000000002')=0,'guardian: unrelated child hidden by RLS');
select pg_temp.denied($q$select public.edusafe_action('record_attendance','{"lesson_id":"60000000-0000-4000-8000-000000000001","student_ids":["20000000-0000-4000-8000-000000000001"],"status":"present"}')$q$,'guardian: cannot confirm attendance');
select pg_temp.denied($q$select public.edusafe_action('create_incident','{"idempotency_key":"guardian-alert","is_drill":true}')$q$,'guardian: cannot trigger staff alarm');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000007');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=0,'security: no academic roster');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'lessons')=0,'security: no lesson history');
select pg_temp.as_user('f0000000-0000-4000-8000-000000000008');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=0,'unassigned teacher: no roster');
select pg_temp.denied($q$select public.edusafe_action('create_qr','{"lesson_id":"60000000-0000-4000-8000-000000000001"}')$q$,'unassigned teacher: cannot mint QR');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000003');
do $$ declare q jsonb; begin
 q:=public.edusafe_action('create_qr','{"lesson_id":"60000000-0000-4000-8000-000000000001"}');
 perform set_config('edusafe.test.qr',q->>'token',true);
 perform pg_temp.ok(length(q->>'token')=48,'QR: opaque high-entropy token returned');
end $$;
do $$ declare i integer; actor uuid; r jsonb; begin
 for i in 1..20 loop
  actor:=('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  perform pg_temp.as_user(actor);
  r:=public.edusafe_action('check_in',jsonb_build_object('token',current_setting('edusafe.test.qr')));
  if r->>'status'<>'unconfirmed' then raise exception 'QR must not confirm physical attendance'; end if;
 end loop;
end $$;
select pg_temp.as_user('10000000-0000-4000-8000-000000000001');
select pg_temp.ok((public.edusafe_action('check_in',jsonb_build_object('token',current_setting('edusafe.test.qr')))->>'already_recorded')::boolean,'QR: repeated request is idempotent');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=1,'student: sees only own profile');
select pg_temp.denied($q$select public.edusafe_action('check_in','{"token":"000000000000000000000000000000000000000000000000"}')$q$,'QR: forged token rejected','P0001','QR_INVALID');
select pg_temp.as_user('f0000000-0000-4000-8000-000000000003');
select pg_temp.ok((select count(*) from public.check_ins where lesson_id='60000000-0000-4000-8000-000000000001')=20,'QR: one shared token accepts twenty pupils');
select pg_temp.ok((select count(*) from public.attendance where lesson_id='60000000-0000-4000-8000-000000000001' and status='unconfirmed')=20,'QR: all remain unconfirmed until teacher checks');
select public.edusafe_action('record_attendance','{"lesson_id":"60000000-0000-4000-8000-000000000001","student_ids":["20000000-0000-4000-8000-000000000001"],"status":"present","expected_versions":{"20000000-0000-4000-8000-000000000001":0}}');
select pg_temp.denied($q$select public.edusafe_action('record_attendance','{"lesson_id":"60000000-0000-4000-8000-000000000001","student_ids":["20000000-0000-4000-8000-000000000001"],"status":"absent","expected_versions":{"20000000-0000-4000-8000-000000000001":0}}')$q$,'attendance: stale edit rejected','40001');
select pg_temp.as_user('10000000-0000-4000-8000-000000000001');
select pg_temp.ok(public.edusafe_action('check_in',jsonb_build_object('token',current_setting('edusafe.test.qr')))->>'status'='present','QR: cannot overwrite teacher confirmation');

reset role;
update app_private.qr_challenges set expires_at=now()-interval '1 second' where token_hash=encode(extensions.digest(current_setting('edusafe.test.qr'),'sha256'),'hex');
set local role authenticated;
select pg_temp.denied($q$select public.edusafe_action('check_in',jsonb_build_object('token',current_setting('edusafe.test.qr')))$q$,'QR: expired token rejected','P0001','QR_EXPIRED');
reset role;
update public.memberships set group_ids='{}' where user_id='f0000000-0000-4000-8000-000000000003' and role='teacher';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-000000000003');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=0,'revocation: old teacher_id grants no permanent class access');
select pg_temp.denied($q$select public.edusafe_action('create_qr','{"lesson_id":"60000000-0000-4000-8000-000000000001"}')$q$,'revocation: old teacher cannot mint QR');
reset role;
update public.memberships set group_ids=array['40000000-0000-4000-8000-000000000001']::uuid[] where user_id='f0000000-0000-4000-8000-000000000003' and role='teacher';
set local role authenticated;

do $$ declare first_result jsonb; second_result jsonb; begin
 first_result:=public.edusafe_action('create_incident','{"location_id":"50000000-0000-4000-8000-000000000001","kind":"help","is_drill":true,"idempotency_key":"test-alarm-idempotent"}');
 second_result:=public.edusafe_action('create_incident','{"location_id":"50000000-0000-4000-8000-000000000001","kind":"help","is_drill":true,"idempotency_key":"test-alarm-idempotent"}');
 perform set_config('edusafe.test.incident',first_result->>'id',true);
 perform pg_temp.ok(first_result->>'id'=second_result->>'id','alarm: same request returns original incident');
 perform pg_temp.ok(first_result->>'status'='new','alarm: registration does not imply acknowledgement');
end $$;
select pg_temp.denied($q$select public.edusafe_action('create_incident','{"kind":"fire","is_drill":true,"idempotency_key":"test-alarm-idempotent"}')$q$,'alarm: changed request cannot reuse idempotency key','P0001');
select pg_temp.ok((public.edusafe_action('incident_status','{"idempotency_key":"test-alarm-idempotent"}')->>'registered')::boolean,'alarm: original key supports timeout recovery');
select pg_temp.as_user('f0000000-0000-4000-8000-000000000007');
select public.edusafe_action('acknowledge_incident',jsonb_build_object('id',current_setting('edusafe.test.incident')));
select pg_temp.ok((select status from public.incidents where id=current_setting('edusafe.test.incident')::uuid)='acknowledged','alarm: staff acknowledgement persisted');
select public.edusafe_action('resolve_incident',jsonb_build_object('id',current_setting('edusafe.test.incident'),'resolution','Учебная проверка завершена'));
select pg_temp.ok((select count(*) from public.incident_events where incident_id=current_setting('edusafe.test.incident')::uuid)=3,'alarm: complete immutable event history');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000001');
select public.edusafe_action('update_settings','{"grace_minutes":1,"notification_mode":"telegram","notifications_enabled":true}');
select public.edusafe_action('run_attendance_check','{}');
select pg_temp.ok((select count(*) from public.notifications where kind='attendance_unconfirmed' and student_id='20000000-0000-4000-8000-000000000020')=1,'jobs: unconfirmed warning created for authorized guardian');
select public.edusafe_action('run_attendance_check','{}');
select pg_temp.ok((select count(*) from public.notifications where kind='attendance_unconfirmed' and student_id='20000000-0000-4000-8000-000000000020')=1,'jobs: repeated scheduling creates no duplicate warning');
select pg_temp.ok((select status from public.attendance where student_id='20000000-0000-4000-8000-000000000020' and lesson_id='60000000-0000-4000-8000-000000000001')='unconfirmed','jobs: no automatic absence verdict');

reset role;
set local role service_role;
do $$ declare claimed record; begin
 for claimed in select * from public.edusafe_claim_notifications(50) loop
  if claimed.kind='attendance_unconfirmed' and claimed.school_id='30000000-0000-4000-8000-000000000001' then
   perform set_config('edusafe.test.notification',claimed.id::text,true);
   perform set_config('edusafe.test.lease',claimed.lease_token::text,true);
  end if;
 end loop;
end $$;
select pg_temp.ok((public.edusafe_revalidate_notification(current_setting('edusafe.test.notification')::uuid,current_setting('edusafe.test.lease')::uuid)->>'valid')::boolean,'worker: valid active lease can be checked');
select pg_temp.ok(public.edusafe_acquire_worker('a0000000-0000-4000-8000-000000000001',120),'worker: first dispatcher acquires lease');
select pg_temp.ok(not public.edusafe_acquire_worker('a0000000-0000-4000-8000-000000000002',120),'worker: parallel dispatcher cannot acquire same lease');
select public.edusafe_release_worker('a0000000-0000-4000-8000-000000000001');
select pg_temp.ok(public.edusafe_acquire_worker('a0000000-0000-4000-8000-000000000002',120),'worker: lease can be acquired after release');
select public.edusafe_release_worker('a0000000-0000-4000-8000-000000000002');
select pg_temp.ok((public.edusafe_claim_telegram_update(990001,'a0000000-0000-4000-8000-000000000001')->>'claimed')::boolean,'webhook: first update claimed');
select pg_temp.ok(public.edusafe_claim_telegram_update(990001,'a0000000-0000-4000-8000-000000000002')->>'status'='processing','webhook: duplicate during processing remains retryable');
select public.edusafe_finish_telegram_update(990001,'a0000000-0000-4000-8000-000000000001',true);
select pg_temp.ok(public.edusafe_claim_telegram_update(990001,'a0000000-0000-4000-8000-000000000002')->>'status'='completed','webhook: completed duplicate is recognized');
reset role;
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-000000000001');
select public.edusafe_action('revoke_guardian','{"id":"70000000-0000-4000-8000-000000000020"}');
reset role;
set local role service_role;
select pg_temp.ok(not (public.edusafe_revalidate_notification(current_setting('edusafe.test.notification')::uuid,current_setting('edusafe.test.lease')::uuid)->>'valid')::boolean,'worker: revocation blocks leased message before send');
select pg_temp.ok(not public.edusafe_authorize_worker(repeat('x',48)),'worker: unknown secret rejected');
reset role;
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-000000000006');
select pg_temp.ok(jsonb_array_length(public.edusafe_workspace()->'students')=1,'guardian revocation: history access immediately removed');
reset role;
delete from auth.sessions where id='f0000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.denied($q$select public.edusafe_workspace()$q$,'revoked web session cannot use a still-unexpired access JWT');
select pg_temp.ok((select count(*) from public.students)=0,'revoked web session cannot bypass RPC with direct reads');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
 ('f0000000-0000-4000-8000-000000000006','f0000000-0000-4000-8000-000000000006',now(),now(),'aal1',now()+interval '1 hour');
update auth.users set banned_until=now()+interval '1 day' where id='f0000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.denied($q$select public.edusafe_workspace()$q$,'banned account cannot access RPC');
select pg_temp.ok((select count(*) from public.students)=0,'banned account cannot bypass RPC with direct reads');
reset role;

select count(*) as passed_assertions,jsonb_agg(name order by name) as assertions from edusafe_test_results;
rollback;
