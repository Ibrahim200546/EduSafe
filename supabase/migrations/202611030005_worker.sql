-- Durable schedules are recomputed from authoritative lesson/enrollment data.
-- Creating a warning never changes the pupil's attendance status to absent.
create or replace function app_private.process_due(p_school uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org public.schools%rowtype; expected record; recipient record; incident public.incidents%rowtype;
 v_checked integer:=0; v_escalated integer:=0; v_before bigint; v_after bigint; v_ready boolean; v_title text; v_body text;
begin
 select count(*) into v_before from public.notifications where p_school is null or school_id=p_school;
 for org in select * from public.schools where p_school is null or id=p_school loop
  if not pg_try_advisory_xact_lock(hashtextextended(org.id::text||':due_jobs',0)) then continue; end if;
  if org.notifications_enabled then
   for expected in
    select s.id student_id,s.full_name,s.is_adult,l.id lesson_id,l.title,l.starts_at,l.status lesson_status,
     coalesce(a.status,'unconfirmed') attendance_status
    from public.students s
    cross join lateral (
     select q.* from public.lessons q join public.enrollments e on e.school_id=q.school_id and e.group_id=q.group_id
      and e.student_id=s.id and e.starts_at<=q.starts_at and (e.ends_at is null or e.ends_at>q.starts_at)
     where q.school_id=org.id and q.status<>'cancelled'
      and (q.starts_at at time zone org.timezone)::date=(now() at time zone org.timezone)::date
     order by q.starts_at,q.id limit 1
    ) l left join public.attendance a on a.school_id=org.id and a.lesson_id=l.id and a.student_id=s.id
    where s.school_id=org.id and s.active and now()>=l.starts_at+make_interval(mins=>org.grace_minutes)
   loop
    v_checked:=v_checked+1;
    if expected.attendance_status<>'unconfirmed' then continue; end if;
    if exists(select 1 from public.absence_requests r where r.school_id=org.id and r.student_id=expected.student_id and r.status='approved'
     and (r.lesson_id=expected.lesson_id or (r.lesson_id is null and (r.created_at at time zone org.timezone)::date=(expected.starts_at at time zone org.timezone)::date))) then continue; end if;
    v_ready:=expected.lesson_status='active' or exists(select 1 from public.attendance a where a.school_id=org.id and a.lesson_id=expected.lesson_id and a.confirmed_by is not null)
      or exists(select 1 from public.check_ins c where c.school_id=org.id and c.lesson_id=expected.lesson_id);
    if not v_ready then
     for recipient in select distinct m.user_id from public.memberships m where m.school_id=org.id and m.active
      and (m.role='admin' or (m.role='teacher' and exists(select 1 from public.lessons q where q.id=expected.lesson_id and q.group_id=any(m.group_ids)))) loop
      perform app_private.queue_notification(org.id,recipient.user_id,'lesson-not-ready:'||expected.lesson_id::text||':'||extract(epoch from expected.starts_at)::text,'attendance_readiness',
       'Проверьте готовность журнала','Занятие началось, но электронный журнал ещё не активирован. Уведомления об отсутствии родителям не отправлены.',40,null,expected.lesson_id);
     end loop;
     continue;
    end if;
    if org.locale='kk' then
     v_title:='Қатысу әлі расталмады';
     v_body:=expected.full_name||': '||expected.title||'. Мұғалімнің растауы күтілуде. Бұл сабақтан қалғанын дәлелдемейді.';
    else
     v_title:='Присутствие пока не подтверждено';
     v_body:=expected.full_name||': '||expected.title||', '||to_char(expected.starts_at at time zone org.timezone,'DD.MM.YYYY HH24:MI')||'. Информация уточняется. Отсутствие отметки не доказывает отсутствие на занятии.';
    end if;
    for recipient in select g.guardian_id from public.guardian_links g where g.school_id=org.id and g.student_id=expected.student_id
     and g.status='active' and (not expected.is_adult or g.adult_authorized) loop
     perform app_private.queue_notification(org.id,recipient.guardian_id,'unconfirmed:'||expected.lesson_id::text||':'||expected.student_id::text||':'||extract(epoch from expected.starts_at)::text,
      'attendance_unconfirmed',v_title,v_body,40,expected.student_id,expected.lesson_id,null,'unconfirmed',null);
    end loop;
   end loop;
  end if;
  for incident in select * from public.incidents i where i.school_id=org.id and i.status='new' and i.escalation_step<3 and i.next_escalation_at<=now()
   order by i.next_escalation_at for update skip locked loop
   update public.incidents set escalation_step=escalation_step+1,next_escalation_at=now()+interval '60 seconds' where id=incident.id;
   insert into public.incident_events(school_id,incident_id,kind,message) values(org.id,incident.id,'escalation','Нет подтверждения сотрудника. Повторное внутреннее оповещение.');
   perform app_private.notify_incident(incident.id,'escalation');
   v_escalated:=v_escalated+1;
  end loop;
 end loop;
 -- Expired QR hashes are operational state, not attendance evidence.
 delete from app_private.qr_challenges where expires_at<now()-interval '1 day' and (p_school is null or school_id=p_school);
 select count(*) into v_after from public.notifications where p_school is null or school_id=p_school;
 return jsonb_build_object('checked_students',v_checked,'notifications_created',greatest(0,v_after-v_before),'escalations',v_escalated);
end $$;

create or replace function app_private.notification_state(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; s public.students%rowtype; l public.lessons%rowtype; a public.attendance%rowtype;
 i public.incidents%rowtype; org public.schools%rowtype; v_chat bigint; v_drill boolean:=false;
begin
 select * into n from public.notifications where id=p_id;
 if not found then return jsonb_build_object('valid',false,'reason','notification_missing'); end if;
 select * into org from public.schools where id=n.school_id;
 if not exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.school_id=n.school_id
  and m.user_id=n.recipient_user_id and m.active and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
  return jsonb_build_object('valid',false,'reason','recipient_access_revoked'); end if;
 if n.student_id is not null then
  select * into s from public.students where id=n.student_id and school_id=n.school_id;
  if not found or not s.active then return jsonb_build_object('valid',false,'reason','student_inactive'); end if;
  if not exists(select 1 from public.guardian_links g join public.memberships m on m.school_id=g.school_id and m.user_id=g.guardian_id and m.role='guardian' and m.active
   where g.school_id=n.school_id and g.student_id=s.id and g.guardian_id=n.recipient_user_id and g.status='active' and (not s.is_adult or g.adult_authorized)) then
   return jsonb_build_object('valid',false,'reason','guardian_access_revoked'); end if;
 end if;
 if n.lesson_id is not null then
  select * into l from public.lessons where id=n.lesson_id and school_id=n.school_id;
  if not found or l.status='cancelled' then return jsonb_build_object('valid',false,'reason','lesson_cancelled'); end if;
  if n.lesson_starts_at is distinct from l.starts_at then return jsonb_build_object('valid',false,'reason','lesson_rescheduled'); end if;
  if n.kind like 'attendance_%' and not org.notifications_enabled then return jsonb_build_object('valid',false,'reason','notifications_disabled'); end if;
  if n.student_id is not null and not exists(select 1 from public.enrollments e where e.school_id=n.school_id and e.student_id=n.student_id
   and e.group_id=l.group_id and e.starts_at<=l.starts_at and (e.ends_at is null or e.ends_at>l.starts_at)) then
   return jsonb_build_object('valid',false,'reason','enrollment_changed'); end if;
  if n.kind='attendance_unconfirmed' then
   if now()<l.starts_at+make_interval(mins=>org.grace_minutes) then return jsonb_build_object('valid',false,'reason','grace_period_not_elapsed'); end if;
   if (l.starts_at at time zone org.timezone)::date<>(now() at time zone org.timezone)::date then return jsonb_build_object('valid',false,'reason','warning_stale'); end if;
   if exists(select 1 from public.absence_requests r where r.school_id=n.school_id and r.student_id=n.student_id and r.status='approved'
    and (r.lesson_id=n.lesson_id or (r.lesson_id is null and (r.created_at at time zone org.timezone)::date=(l.starts_at at time zone org.timezone)::date))) then
    return jsonb_build_object('valid',false,'reason','absence_excused'); end if;
  end if;
  if n.student_id is not null and n.expected_status is not null then
   select * into a from public.attendance where school_id=n.school_id and lesson_id=n.lesson_id and student_id=n.student_id;
   if coalesce(a.status,'unconfirmed')<>n.expected_status or (n.expected_version is not null and coalesce(a.version,0)<>n.expected_version) then
    return jsonb_build_object('valid',false,'reason','attendance_updated'); end if;
  end if;
  if n.kind='attendance_readiness' and (l.status='active' or exists(select 1 from public.attendance q where q.lesson_id=l.id and q.confirmed_by is not null)) then
   return jsonb_build_object('valid',false,'reason','lesson_already_active'); end if;
 end if;
 if n.incident_id is not null then
  select * into i from public.incidents where id=n.incident_id and school_id=n.school_id;
  if not found then return jsonb_build_object('valid',false,'reason','incident_missing'); end if;
  v_drill:=i.is_drill;
  if not exists(select 1 from public.memberships m where m.school_id=n.school_id and m.user_id=n.recipient_user_id and m.active
   and (m.role in ('admin','security') or (m.role='teacher' and i.created_by=m.user_id))) then
   return jsonb_build_object('valid',false,'reason','staff_assignment_revoked'); end if;
  if n.kind in ('incident_created','incident_escalation') and i.status<>'new' then return jsonb_build_object('valid',false,'reason','incident_already_handled'); end if;
  if n.kind='incident_acknowledged' and i.status<>'acknowledged' then return jsonb_build_object('valid',false,'reason','incident_status_updated'); end if;
 end if;
 select chat_id into v_chat from app_private.telegram_links where user_id=n.recipient_user_id and active;
 return jsonb_build_object('valid',true,'chat_id',v_chat,'notification_mode',case when v_drill then 'mock' else org.notification_mode end,'is_drill',v_drill);
end $$;

create or replace function app_private.claim_notifications(p_limit integer default 8)
returns table(id uuid,school_id uuid,recipient_user_id uuid,title text,body text,kind text,chat_id bigint,
 notification_mode text,is_drill boolean,incident_id uuid,lease_token uuid,attempts integer)
language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; state jsonb; v_lease uuid;
begin
 for n in select q.* from public.notifications q where
   ((q.status='queued' and q.next_attempt_at<=now()) or (q.status='processing' and q.leased_until<now()))
   order by q.priority desc,q.next_attempt_at,q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,8),50))
 loop
  if n.attempts>=8 then
   update public.notifications q set status='failed',error='Превышено число попыток отправки',completed_at=now(),lease_token=null,leased_until=null where q.id=n.id;
   continue;
  end if;
  state:=app_private.notification_state(n.id);
  if not coalesce((state->>'valid')::boolean,false) then
   update public.notifications q set status='suppressed',error=state->>'reason',completed_at=now(),lease_token=null,leased_until=null where q.id=n.id;
   continue;
  end if;
  v_lease:=gen_random_uuid();
  update public.notifications q set status='processing',attempts=q.attempts+1,lease_token=v_lease,leased_until=now()+interval '2 minutes' where q.id=n.id;
  return query select n.id,n.school_id,n.recipient_user_id,n.title,n.body,n.kind,(state->>'chat_id')::bigint,
   state->>'notification_mode',coalesce((state->>'is_drill')::boolean,false),n.incident_id,v_lease,n.attempts+1;
 end loop;
end $$;
create or replace function app_private.revalidate_notification(p_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null or not exists(select 1 from public.notifications where id=p_id and lease_token=p_lease_token and status='processing' and leased_until>now()) then
  return jsonb_build_object('valid',false,'reason','lease_lost'); end if;
 return app_private.notification_state(p_id);
end $$;
create or replace function app_private.finish_notification(p_id uuid,p_status text,p_error text default null,p_message_id text default null,
 p_retry_after integer default null,p_lease_token uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; v_status text; v_delay integer;
begin
 if p_status not in ('queued','sent','mock','failed','suppressed') then raise exception 'INVALID_STATUS'; end if;
 select * into n from public.notifications where id=p_id and lease_token=p_lease_token and status='processing' and leased_until>now() for update;
 if not found or p_lease_token is null then raise exception 'LEASE_LOST'; end if;
 v_status:=case when p_status='queued' and n.attempts>=8 then 'failed' else p_status end;
 v_delay:=greatest(1,least(coalesce(p_retry_after,power(2,least(n.attempts,10))::integer),86400));
 update public.notifications set status=v_status,error=left(p_error,1000),telegram_message_id=left(p_message_id,100),
  lease_token=null,leased_until=null,next_attempt_at=case when v_status='queued' then now()+make_interval(secs=>v_delay) else next_attempt_at end,
  completed_at=case when v_status='queued' then null else now() end where id=p_id;
 if v_status='sent' then update app_private.telegram_links set last_sent_at=now() where user_id=n.recipient_user_id and active; end if;
end $$;
create or replace function app_private.acquire_worker(p_run_id uuid,p_seconds integer default 120)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_claim uuid;
begin
 if p_run_id is null then return false; end if;
 insert into app_private.worker_lease(name,run_id,leased_until) values('telegram_dispatch',p_run_id,now()+make_interval(secs=>greatest(30,least(p_seconds,180))))
 on conflict(name) do update set run_id=excluded.run_id,leased_until=excluded.leased_until
 where worker_lease.leased_until<now() or worker_lease.run_id=p_run_id returning run_id into v_claim;
 return coalesce(v_claim=p_run_id,false);
end $$;
create or replace function app_private.release_worker(p_run_id uuid)
returns void language sql security definer set search_path='' as $$
 delete from app_private.worker_lease where name='telegram_dispatch' and run_id=p_run_id
$$;

create or replace function app_private.set_integration_secret(p_name text,p_secret text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_name not in ('worker','telegram_webhook') or p_secret is null or length(p_secret) not between 32 and 256 then raise exception 'INVALID_SECRET'; end if;
 insert into app_private.integration_secrets(name,secret_hash) values(p_name,encode(extensions.digest(p_secret,'sha256'),'hex'))
 on conflict(name) do update set secret_hash=excluded.secret_hash,updated_at=now();
end $$;
create or replace function app_private.authorize_integration(p_name text,p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_secret is not null and length(p_secret) between 32 and 256 and exists(select 1 from app_private.integration_secrets
  where name=p_name and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex'))
$$;
create or replace function app_private.telegram_link(p_token text,p_chat_id bigint,p_telegram_user_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link_token app_private.telegram_link_tokens%rowtype;
begin
 if p_chat_id<=0 or p_chat_id<>p_telegram_user_id or length(p_token)<>48 then raise exception 'INVALID_LINK'; end if;
 select * into link_token from app_private.telegram_link_tokens where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found then raise exception 'INVALID_LINK'; end if;
 if link_token.consumed_at is not null then
  if exists(select 1 from app_private.telegram_links where user_id=link_token.user_id and chat_id=p_chat_id and telegram_user_id=p_telegram_user_id and active) then return jsonb_build_object('ok',true,'already_linked',true); end if;
  raise exception 'LINK_ALREADY_USED';
 end if;
 if link_token.expires_at<=now() then raise exception 'LINK_EXPIRED'; end if;
 if not exists(select 1 from auth.users where id=link_token.user_id and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'USER_DISABLED'; end if;
 if exists(select 1 from app_private.telegram_links where active and user_id<>link_token.user_id and (chat_id=p_chat_id or telegram_user_id=p_telegram_user_id)) then raise exception 'TELEGRAM_ALREADY_LINKED'; end if;
 insert into app_private.telegram_links(user_id,chat_id,telegram_user_id,active) values(link_token.user_id,p_chat_id,p_telegram_user_id,true)
 on conflict(user_id) do update set chat_id=excluded.chat_id,telegram_user_id=excluded.telegram_user_id,active=true,linked_at=now();
 update app_private.telegram_link_tokens set consumed_at=now() where id=link_token.id;
 return jsonb_build_object('ok',true);
end $$;
create or replace function app_private.telegram_ack(p_incident_id uuid,p_telegram_user_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; i public.incidents%rowtype;
begin
 select t.user_id into v_user from app_private.telegram_links t join auth.users u on u.id=t.user_id
  where t.telegram_user_id=p_telegram_user_id and t.active and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
 if v_user is null then raise exception using errcode='42501',message='TELEGRAM_NOT_LINKED'; end if;
 select * into i from public.incidents where id=p_incident_id for update;
 if not found or not exists(select 1 from public.memberships where school_id=i.school_id and user_id=v_user and active and role in ('admin','security')) then
  raise exception using errcode='42501',message='FORBIDDEN'; end if;
 if i.status<>'new' then return jsonb_build_object('ok',true,'status',i.status); end if;
 update public.incidents set status='acknowledged',acknowledged_by=v_user,acknowledged_at=now() where id=i.id;
 insert into public.incident_events(school_id,incident_id,actor_id,kind,message) values(i.school_id,i.id,v_user,'acknowledged','Сотрудник принял сигнал через Telegram');
 perform app_private.notify_incident(i.id,'acknowledged'); perform app_private.audit(i.school_id,v_user,'telegram_acknowledge','incident',i.id);
 return jsonb_build_object('ok',true,'status','acknowledged');
end $$;
create or replace function app_private.claim_telegram_update(p_update_id bigint,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u app_private.telegram_updates%rowtype;
begin
 if p_update_id<0 or p_run_id is null then raise exception 'INVALID_UPDATE'; end if;
 insert into app_private.telegram_updates(update_id,run_id,status,leased_until) values(p_update_id,p_run_id,'processing',now()+interval '60 seconds') on conflict(update_id) do nothing;
 select * into u from app_private.telegram_updates where update_id=p_update_id for update;
 if u.status='done' then return jsonb_build_object('claimed',false,'status','completed'); end if;
 if u.status='processing' and u.leased_until>now() and u.run_id<>p_run_id then return jsonb_build_object('claimed',false,'status','processing'); end if;
 update app_private.telegram_updates set run_id=p_run_id,status='processing',leased_until=now()+interval '60 seconds' where update_id=p_update_id;
 return jsonb_build_object('claimed',true,'status','claimed');
end $$;
create or replace function app_private.finish_telegram_update(p_update_id bigint,p_run_id uuid,p_success boolean)
returns void language sql security definer set search_path='' as $$
 update app_private.telegram_updates set status=case when p_success then 'done' else 'retry' end,
  completed_at=case when p_success then now() else null end,leased_until=now()
 where update_id=p_update_id and run_id=p_run_id and status='processing'
$$;

-- Service-only public invoker wrappers. Their private implementations are not
-- exposed in the Data API, and PUBLIC/anon/authenticated EXECUTE is revoked.
create or replace function public.edusafe_process_due()
returns jsonb language sql security invoker set search_path='' as $$ select app_private.process_due(null) $$;
create or replace function public.edusafe_claim_notifications(p_limit integer default 8)
returns table(id uuid,school_id uuid,recipient_user_id uuid,title text,body text,kind text,chat_id bigint,
 notification_mode text,is_drill boolean,incident_id uuid,lease_token uuid,attempts integer)
language sql security invoker set search_path='' as $$ select * from app_private.claim_notifications(p_limit) $$;
create or replace function public.edusafe_revalidate_notification(p_id uuid,p_lease_token uuid)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.revalidate_notification(p_id,p_lease_token) $$;
create or replace function public.edusafe_finish_notification(p_id uuid,p_status text,p_error text default null,p_message_id text default null,
 p_retry_after integer default null,p_lease_token uuid default null)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_notification(p_id,p_status,p_error,p_message_id,p_retry_after,p_lease_token) $$;
create or replace function public.edusafe_acquire_worker(p_run_id uuid,p_seconds integer default 120)
returns boolean language sql security invoker set search_path='' as $$ select app_private.acquire_worker(p_run_id,p_seconds) $$;
create or replace function public.edusafe_release_worker(p_run_id uuid)
returns void language sql security invoker set search_path='' as $$ select app_private.release_worker(p_run_id) $$;
create or replace function public.edusafe_set_integration_secret(p_name text,p_secret text)
returns void language sql security invoker set search_path='' as $$ select app_private.set_integration_secret(p_name,p_secret) $$;
create or replace function public.edusafe_authorize_worker(p_secret text)
returns boolean language sql security invoker set search_path='' as $$ select app_private.authorize_integration('worker',p_secret) $$;
create or replace function public.edusafe_authorize_telegram(p_secret text)
returns boolean language sql security invoker set search_path='' as $$ select app_private.authorize_integration('telegram_webhook',p_secret) $$;
create or replace function public.edusafe_telegram_link(p_token text,p_chat_id bigint,p_telegram_user_id bigint)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.telegram_link(p_token,p_chat_id,p_telegram_user_id) $$;
create or replace function public.edusafe_telegram_ack(p_incident_id uuid,p_telegram_user_id bigint)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.telegram_ack(p_incident_id,p_telegram_user_id) $$;
create or replace function public.edusafe_claim_telegram_update(p_update_id bigint,p_run_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.claim_telegram_update(p_update_id,p_run_id) $$;
create or replace function public.edusafe_finish_telegram_update(p_update_id bigint,p_run_id uuid,p_success boolean)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_telegram_update(p_update_id,p_run_id,p_success) $$;

revoke all on function app_private.process_due(uuid),app_private.notification_state(uuid),app_private.claim_notifications(integer),
 app_private.revalidate_notification(uuid,uuid),app_private.finish_notification(uuid,text,text,text,integer,uuid),
 app_private.acquire_worker(uuid,integer),app_private.release_worker(uuid),app_private.set_integration_secret(text,text),
 app_private.authorize_integration(text,text),app_private.telegram_link(text,bigint,bigint),app_private.telegram_ack(uuid,bigint),
 app_private.claim_telegram_update(bigint,uuid),app_private.finish_telegram_update(bigint,uuid,boolean)
 from public,anon,authenticated;
grant execute on function app_private.process_due(uuid),app_private.claim_notifications(integer),
 app_private.revalidate_notification(uuid,uuid),app_private.finish_notification(uuid,text,text,text,integer,uuid),
 app_private.acquire_worker(uuid,integer),app_private.release_worker(uuid),app_private.set_integration_secret(text,text),
 app_private.authorize_integration(text,text),app_private.telegram_link(text,bigint,bigint),app_private.telegram_ack(uuid,bigint),
 app_private.claim_telegram_update(bigint,uuid),app_private.finish_telegram_update(bigint,uuid,boolean) to service_role;
revoke all on function public.edusafe_process_due(),public.edusafe_claim_notifications(integer),public.edusafe_revalidate_notification(uuid,uuid),
 public.edusafe_finish_notification(uuid,text,text,text,integer,uuid),public.edusafe_acquire_worker(uuid,integer),public.edusafe_release_worker(uuid),
 public.edusafe_set_integration_secret(text,text),public.edusafe_authorize_worker(text),public.edusafe_authorize_telegram(text),
 public.edusafe_telegram_link(text,bigint,bigint),public.edusafe_telegram_ack(uuid,bigint),public.edusafe_claim_telegram_update(bigint,uuid),
 public.edusafe_finish_telegram_update(bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.edusafe_process_due(),public.edusafe_claim_notifications(integer),public.edusafe_revalidate_notification(uuid,uuid),
 public.edusafe_finish_notification(uuid,text,text,text,integer,uuid),public.edusafe_acquire_worker(uuid,integer),public.edusafe_release_worker(uuid),
 public.edusafe_set_integration_secret(text,text),public.edusafe_authorize_worker(text),public.edusafe_authorize_telegram(text),
 public.edusafe_telegram_link(text,bigint,bigint),public.edusafe_telegram_ack(uuid,bigint),public.edusafe_claim_telegram_update(bigint,uuid),
 public.edusafe_finish_telegram_update(bigint,uuid,boolean) to service_role;

-- SQL scheduling runs without external HTTP or Telegram credentials. It is safe
-- in mock mode and survives process/browser restarts. Edge delivery is separate.
do $$
begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('edusafe-attendance-and-escalation','* * * * *','select app_private.process_due(null);');
 else
  raise notice 'pg_cron is not available: configure a scheduler for edusafe_process_due before production use.';
 end if;
exception when insufficient_privilege then
 raise notice 'pg_cron requires administrator activation: configure scheduler before production use.';
end $$;
