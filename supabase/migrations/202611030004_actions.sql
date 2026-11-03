create or replace function app_private.dispatch(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=app_private.require_user(); v_school uuid; v_id uuid; v_student uuid; v_group uuid; v_location uuid;
 v_teacher uuid; v_name text; v_status text; v_token text; v_hash text; v_key text; v_reason text; v_timezone text;
 v_roles text[]; v_group_ids uuid[]; v_student_ids uuid[]; v_expires timestamptz; v_start timestamptz; v_end timestamptz;
 v_count integer:=0; v_old_status text; v_version integer; v_changed boolean; v_adult boolean;
 org public.schools%rowtype; pupil public.students%rowtype; lesson public.lessons%rowtype;
 attendance_row public.attendance%rowtype; incident public.incidents%rowtype;
 invite app_private.invitations%rowtype; challenge app_private.qr_challenges%rowtype;
 absence public.absence_requests%rowtype; guardian public.guardian_links%rowtype;
begin
 if p_payload is null then p_payload:='{}'::jsonb; end if;
 if jsonb_typeof(p_payload)<>'object' or length(p_action)>80 then raise exception 'INVALID_INPUT'; end if;
 if p_action='create_school' then
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':create_school',0));
  if exists(select 1 from public.memberships where user_id=v_user and active) then raise exception 'У вас уже есть организация. Откройте рабочую панель.'; end if;
  if not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
   raise exception using errcode='42501',message='Сначала подтвердите адрес электронной почты';
  end if;
  v_name:=btrim(coalesce(p_payload->>'name',''));
  v_timezone:=coalesce(nullif(p_payload->>'timezone',''),'Asia/Almaty');
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then raise exception 'Некорректный часовой пояс'; end if;
  insert into public.schools(name,timezone,created_by) values(v_name,v_timezone,v_user) returning id into v_school;
  insert into public.memberships(school_id,user_id,role) values(v_school,v_user,'admin');
  perform app_private.audit(v_school,v_user,'create_school','school',v_school);
  if coalesce((p_payload->>'seed_demo')::boolean,false) then perform app_private.seed_demo(v_school,v_user); end if;
  return jsonb_build_object('id',v_school,'school_id',v_school);
 end if;
 if p_action='accept_invitation' then
  v_token:=coalesce(p_payload->>'token','');
  if length(v_token)<32 or length(v_token)>200 then raise exception 'INVALID_INVITATION'; end if;
  select * into invite from app_private.invitations where token_hash=encode(extensions.digest(v_token,'sha256'),'hex') for update;
  if not found or invite.expires_at<now() then raise exception 'INVALID_INVITATION'; end if;
  if invite.consumed_by=v_user then return jsonb_build_object('school_id',invite.school_id,'role',invite.role,'already_accepted',true); end if;
  if invite.consumed_at is not null then raise exception 'Приглашение уже использовано'; end if;
  if invite.email is not null and not exists(select 1 from auth.users where id=v_user and lower(email)=lower(invite.email) and email_confirmed_at is not null) then
   raise exception using errcode='42501',message='Приглашение выдано для другого подтверждённого адреса';
  end if;
  if invite.role in ('student','guardian') then
   select * into pupil from public.students where id=invite.student_id and school_id=invite.school_id for update;
   if not found or not pupil.active then raise exception 'Ученик недоступен'; end if;
   if invite.role='student' and pupil.user_id is not null and pupil.user_id<>v_user then raise exception 'Ученик уже связан с другой учётной записью'; end if;
   if invite.role='student' then
    update public.students set user_id=v_user where id=pupil.id;
   else
    insert into public.guardian_links(school_id,student_id,guardian_id,status) values(invite.school_id,pupil.id,v_user,'pending')
     on conflict(school_id,student_id,guardian_id) do update set status=case when guardian_links.status='active' then 'active' else 'pending' end;
   end if;
  end if;
  insert into public.memberships(school_id,user_id,role,group_ids) values(invite.school_id,v_user,invite.role,invite.group_ids)
   on conflict(school_id,user_id,role) do update set active=true,group_ids=excluded.group_ids;
  update app_private.invitations set consumed_by=v_user,consumed_at=now() where id=invite.id;
  perform app_private.audit(invite.school_id,v_user,'accept_invitation','membership',null,jsonb_build_object('role',invite.role));
  return jsonb_build_object('school_id',invite.school_id,'role',invite.role,'guardian_pending',invite.role='guardian');
 end if;
 v_school:=app_private.current_school(nullif(p_payload->>'school_id','')::uuid);
 if v_school is null then raise exception 'NO_MEMBERSHIP'; end if;
 select * into org from public.schools where id=v_school;
 if p_action in ('seed_demo','create_group','create_location','create_student','update_student','create_lesson','update_lesson',
  'create_invitation','approve_guardian','revoke_guardian','update_settings','set_member_active','run_attendance_check')
  and not app_private.has_role(v_school,array['admin']) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
 case p_action
 when 'seed_demo' then return app_private.seed_demo(v_school,v_user);
 when 'create_group' then
  insert into public.school_groups(school_id,name) values(v_school,btrim(p_payload->>'name')) returning id into v_id;
  perform app_private.audit(v_school,v_user,p_action,'group',v_id);
 when 'create_location' then
  insert into public.locations(school_id,name,building,floor) values(v_school,btrim(p_payload->>'name'),
   coalesce(nullif(btrim(p_payload->>'building'),''),'Главный корпус'),coalesce((p_payload->>'floor')::integer,1)) returning id into v_id;
  perform app_private.audit(v_school,v_user,p_action,'location',v_id);
 when 'create_student' then
  v_group:=(p_payload->>'group_id')::uuid;
  if not exists(select 1 from public.school_groups where id=v_group and school_id=v_school) then raise exception 'NOT_FOUND'; end if;
  insert into public.students(school_id,group_id,full_name,is_adult) values(v_school,v_group,btrim(p_payload->>'full_name'),coalesce((p_payload->>'is_adult')::boolean,false)) returning id into v_id;
  insert into public.enrollments(school_id,student_id,group_id) values(v_school,v_id,v_group);
  perform app_private.audit(v_school,v_user,p_action,'student',v_id);
 when 'update_student' then
  v_id:=(p_payload->>'id')::uuid;
  select * into pupil from public.students where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_group:=coalesce(nullif(p_payload->>'group_id','')::uuid,pupil.group_id);
  if not exists(select 1 from public.school_groups where id=v_group and school_id=v_school) then raise exception 'NOT_FOUND'; end if;
  if v_group<>pupil.group_id then
   update public.enrollments set ends_at=now() where school_id=v_school and student_id=v_id and ends_at is null;
   insert into public.enrollments(school_id,student_id,group_id) values(v_school,v_id,v_group);
  end if;
  update public.students set full_name=coalesce(nullif(btrim(p_payload->>'full_name'),''),full_name),group_id=v_group,
   active=coalesce((p_payload->>'active')::boolean,active),is_adult=coalesce((p_payload->>'is_adult')::boolean,is_adult) where id=v_id;
  if p_payload ? 'active' and pupil.user_id is not null then update public.memberships set active=(p_payload->>'active')::boolean
   where school_id=v_school and user_id=pupil.user_id and role='student'; end if;
  perform app_private.audit(v_school,v_user,p_action,'student',v_id,jsonb_build_object('previous_group_id',pupil.group_id,'group_id',v_group));
 when 'create_lesson' then
  v_group:=(p_payload->>'group_id')::uuid; v_location:=nullif(p_payload->>'location_id','')::uuid;
  v_teacher:=coalesce(nullif(p_payload->>'teacher_id','')::uuid,v_user);
  if not exists(select 1 from public.school_groups where id=v_group and school_id=v_school) then raise exception 'NOT_FOUND'; end if;
  if v_location is not null and not exists(select 1 from public.locations where id=v_location and school_id=v_school and active) then raise exception 'NOT_FOUND'; end if;
  if not exists(select 1 from public.memberships where school_id=v_school and user_id=v_teacher and active
   and (role='admin' or (role='teacher' and v_group=any(group_ids)))) then raise exception 'Преподаватель не назначен в эту группу'; end if;
  v_start:=(p_payload->>'starts_at')::timestamptz; v_end:=(p_payload->>'ends_at')::timestamptz;
  insert into public.lessons(school_id,group_id,location_id,teacher_id,title,starts_at,ends_at)
   values(v_school,v_group,v_location,v_teacher,btrim(p_payload->>'title'),v_start,v_end) returning id into v_id;
  insert into public.attendance(school_id,lesson_id,student_id) select v_school,v_id,s.id from public.students s
   join public.enrollments e on e.student_id=s.id and e.school_id=s.school_id and e.group_id=v_group
    and e.starts_at<=v_start and (e.ends_at is null or e.ends_at>v_start)
   where s.school_id=v_school and s.active on conflict(school_id,lesson_id,student_id) do nothing;
  perform app_private.audit(v_school,v_user,p_action,'lesson',v_id);
 when 'update_lesson' then
  v_id:=(p_payload->>'id')::uuid;
  select * into lesson from public.lessons where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_location:=case when p_payload ? 'location_id' then nullif(p_payload->>'location_id','')::uuid else lesson.location_id end;
  if v_location is not null and not exists(select 1 from public.locations where id=v_location and school_id=v_school and active) then raise exception 'NOT_FOUND'; end if;
  update public.lessons set status=coalesce(p_payload->>'status',status),location_id=v_location,
   starts_at=coalesce((p_payload->>'starts_at')::timestamptz,starts_at),ends_at=coalesce((p_payload->>'ends_at')::timestamptz,ends_at) where id=v_id;
  if p_payload->>'status'='cancelled' then
   update public.notifications set status='suppressed',error='Занятие отменено',completed_at=now(),lease_token=null,leased_until=null
    where school_id=v_school and lesson_id=v_id and status in ('queued','processing');
  end if;
  perform app_private.audit(v_school,v_user,p_action,'lesson',v_id,jsonb_build_object('previous_status',lesson.status,'status',coalesce(p_payload->>'status',lesson.status)));
 when 'record_attendance' then
  v_id:=(p_payload->>'lesson_id')::uuid;
  if not app_private.can_manage_lesson(v_school,v_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into lesson from public.lessons where id=v_id and school_id=v_school for update;
  if lesson.status='cancelled' then raise exception 'Занятие отменено'; end if;
  v_status:=p_payload->>'status'; v_reason:=nullif(btrim(p_payload->>'reason'),'');
  if v_status is null or v_status not in ('unconfirmed','present','late','absent','excused') then raise exception 'INVALID_INPUT'; end if;
  select array_agg(distinct items.value::uuid) into v_student_ids from jsonb_array_elements_text(p_payload->'student_ids') as items(value);
  if cardinality(v_student_ids) is null or cardinality(v_student_ids) not between 1 and 2000 then raise exception 'Выберите учеников'; end if;
  if exists(select 1 from unnest(v_student_ids) selected(id) where not exists(select 1 from public.students s
   join public.enrollments e on e.student_id=s.id and e.school_id=s.school_id and e.group_id=lesson.group_id
    and e.starts_at<=lesson.starts_at and (e.ends_at is null or e.ends_at>lesson.starts_at)
   where s.id=selected.id and s.school_id=v_school and s.active)) then raise exception 'Ученик не зачислен на это занятие'; end if;
  for v_student in select unnest(v_student_ids) order by 1 loop
   insert into public.attendance(school_id,lesson_id,student_id) values(v_school,v_id,v_student) on conflict(school_id,lesson_id,student_id) do nothing;
   select * into attendance_row from public.attendance where school_id=v_school and lesson_id=v_id and student_id=v_student for update;
   if (p_payload->'expected_versions') ? v_student::text then
    if (p_payload->'expected_versions'->>v_student::text)::integer<>attendance_row.version then raise exception using errcode='40001',message='Журнал уже изменён другим сотрудником. Обновите страницу.'; end if;
   end if;
   if attendance_row.status is not distinct from v_status and attendance_row.reason is not distinct from v_reason then continue; end if;
   update public.attendance set status=v_status,reason=v_reason,version=version+1,updated_at=now(),
    confirmed_by=case when v_status='unconfirmed' then null else v_user end,
    confirmed_at=case when v_status='unconfirmed' then null else now() end where id=attendance_row.id returning version into v_version;
   insert into public.attendance_changes(school_id,attendance_id,actor_id,old_status,new_status,reason,version)
    values(v_school,attendance_row.id,v_user,attendance_row.status,v_status,v_reason,v_version);
   perform app_private.notify_attendance(attendance_row.id);
   perform app_private.audit(v_school,v_user,'record_attendance','attendance',attendance_row.id,
    jsonb_build_object('old_status',attendance_row.status,'new_status',v_status,'version',v_version));
   v_count:=v_count+1;
  end loop;
  return jsonb_build_object('id',v_id,'updated',v_count);
 when 'create_qr' then
  v_id:=(p_payload->>'lesson_id')::uuid;
  if not app_private.can_manage_lesson(v_school,v_id) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into lesson from public.lessons where id=v_id and school_id=v_school;
  if lesson.status in ('cancelled','completed') or now()<lesson.starts_at-interval '15 minutes' or now()>lesson.ends_at then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
  update public.lessons set status='active' where id=v_id and status='scheduled';
  v_token:=encode(extensions.gen_random_bytes(24),'hex'); v_expires:=least(now()+interval '60 seconds',lesson.ends_at);
  insert into app_private.qr_challenges(school_id,lesson_id,created_by,token_hash,expires_at)
   values(v_school,v_id,v_user,encode(extensions.digest(v_token,'sha256'),'hex'),v_expires);
  return jsonb_build_object('token',v_token,'expires_at',v_expires,'lesson_id',v_id);
 when 'check_in' then
  if not app_private.has_role(v_school,array['student']) then raise exception using errcode='42501',message='Отметка доступна только учётной записи ученика'; end if;
  v_token:=coalesce(p_payload->>'token','');
  if length(v_token)<>48 then raise exception 'QR_INVALID'; end if;
  select * into challenge from app_private.qr_challenges where token_hash=encode(extensions.digest(v_token,'sha256'),'hex') and school_id=v_school;
  if not found then raise exception 'QR_INVALID'; end if;
  if challenge.expires_at<=now() then raise exception 'QR_EXPIRED'; end if;
  select * into lesson from public.lessons where id=challenge.lesson_id and school_id=v_school;
  if lesson.status in ('cancelled','completed') or now()<lesson.starts_at-interval '15 minutes' or now()>lesson.ends_at then raise exception 'CHECKIN_WINDOW_CLOSED'; end if;
  select s.* into pupil from public.students s join public.enrollments e on e.school_id=s.school_id and e.student_id=s.id
   and e.group_id=lesson.group_id and e.starts_at<=lesson.starts_at and (e.ends_at is null or e.ends_at>lesson.starts_at)
   where s.school_id=v_school and s.user_id=v_user and s.active;
  if not found then raise exception using errcode='42501',message='Ученик не зачислен в группу занятия'; end if;
  insert into public.check_ins(school_id,lesson_id,student_id) values(v_school,lesson.id,pupil.id)
   on conflict(school_id,lesson_id,student_id) do nothing returning id into v_id;
  v_changed:=v_id is not null;
  if not v_changed then select id into v_id from public.check_ins where school_id=v_school and lesson_id=lesson.id and student_id=pupil.id; end if;
  insert into public.attendance(school_id,lesson_id,student_id) values(v_school,lesson.id,pupil.id) on conflict(school_id,lesson_id,student_id) do nothing;
  select status into v_status from public.attendance where school_id=v_school and lesson_id=lesson.id and student_id=pupil.id;
  if v_changed then perform app_private.audit(v_school,v_user,'self_check_in','check_in',v_id,jsonb_build_object('lesson_id',lesson.id)); end if;
  return jsonb_build_object('id',v_id,'lesson_id',lesson.id,'status',v_status,'already_recorded',not v_changed,'source','self_qr');
 when 'create_incident' then
  if not app_private.has_role(v_school,array['admin','teacher','security']) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  v_location:=nullif(p_payload->>'location_id','')::uuid;
  if v_location is not null and not exists(select 1 from public.locations where id=v_location and school_id=v_school and active) then raise exception 'NOT_FOUND'; end if;
  v_key:=coalesce(p_payload->>'idempotency_key','');
  if char_length(v_key) not between 8 and 128 then raise exception 'INVALID_INPUT'; end if;
  v_hash:=encode(extensions.digest(jsonb_build_object('location_id',v_location,'kind',coalesce(p_payload->>'kind','help'),
   'details',coalesce(p_payload->>'details',''),'is_drill',coalesce((p_payload->>'is_drill')::boolean,true))::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_school::text||v_user::text||v_key,0));
  select * into incident from public.incidents where school_id=v_school and created_by=v_user and idempotency_key=v_key;
  if found then
   if incident.request_hash<>v_hash then raise exception 'Этот ключ уже использован для другого сигнала'; end if;
   return jsonb_build_object('id',incident.id,'number',incident.number,'status',incident.status,'already_recorded',true);
  end if;
  insert into public.incidents(school_id,location_id,created_by,kind,details,is_drill,idempotency_key,request_hash)
   values(v_school,v_location,v_user,coalesce(p_payload->>'kind','help'),coalesce(p_payload->>'details',''),
    coalesce((p_payload->>'is_drill')::boolean,true),v_key,v_hash) returning * into incident;
  v_id:=incident.id;
  insert into public.incident_events(school_id,incident_id,actor_id,kind,message) values(v_school,v_id,v_user,'created','Сигнал зарегистрирован сервером');
  perform app_private.notify_incident(v_id,'created');
  perform app_private.audit(v_school,v_user,p_action,'incident',v_id,jsonb_build_object('is_drill',incident.is_drill));
  return jsonb_build_object('id',v_id,'number',incident.number,'status','new','already_recorded',false);
 when 'acknowledge_incident' then
  if not app_private.has_role(v_school,array['admin','security']) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  v_id:=(p_payload->>'id')::uuid;
  select * into incident from public.incidents where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if incident.status='acknowledged' then return jsonb_build_object('id',v_id,'status',incident.status); end if;
  if incident.status<>'new' then raise exception 'Сигнал уже закрыт'; end if;
  update public.incidents set status='acknowledged',acknowledged_by=v_user,acknowledged_at=now() where id=v_id;
  insert into public.incident_events(school_id,incident_id,actor_id,kind,message) values(v_school,v_id,v_user,'acknowledged','Сотрудник подтвердил принятие');
  perform app_private.notify_incident(v_id,'acknowledged'); perform app_private.audit(v_school,v_user,p_action,'incident',v_id);
 when 'resolve_incident' then
  if not app_private.has_role(v_school,array['admin','security']) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  v_id:=(p_payload->>'id')::uuid; v_reason:=btrim(coalesce(p_payload->>'resolution',''));
  if length(v_reason)<3 then raise exception 'Укажите результат обработки'; end if;
  select * into incident from public.incidents where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if incident.status='resolved' then return jsonb_build_object('id',v_id,'status','resolved'); end if;
  if incident.status<>'acknowledged' then raise exception 'Сначала подтвердите принятие сигнала'; end if;
  update public.incidents set status='resolved',resolution=v_reason,resolved_at=now() where id=v_id;
  insert into public.incident_events(school_id,incident_id,actor_id,kind,message) values(v_school,v_id,v_user,'resolved',v_reason);
  perform app_private.notify_incident(v_id,'resolved'); perform app_private.audit(v_school,v_user,p_action,'incident',v_id);
 when 'cancel_incident' then
  v_id:=(p_payload->>'id')::uuid; v_reason:=btrim(coalesce(p_payload->>'reason',''));
  if length(v_reason)<3 then raise exception 'Укажите причину отмены'; end if;
  select * into incident from public.incidents where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not app_private.has_role(v_school,array['admin']) and not(incident.created_by=v_user and app_private.has_role(v_school,array['teacher','security'])) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if incident.status='cancelled' then return jsonb_build_object('id',v_id,'status','cancelled'); end if;
  if incident.status='resolved' then raise exception 'Инцидент уже закрыт'; end if;
  update public.incidents set status='cancelled',resolution=v_reason,resolved_at=now() where id=v_id;
  insert into public.incident_events(school_id,incident_id,actor_id,kind,message) values(v_school,v_id,v_user,'cancelled',v_reason);
  perform app_private.notify_incident(v_id,'cancelled'); perform app_private.audit(v_school,v_user,p_action,'incident',v_id);
 when 'incident_status' then
  -- Recovery after an uncertain HTTP result uses the original actor's key.
  v_key:=p_payload->>'idempotency_key';
  select * into incident from public.incidents where school_id=v_school and created_by=v_user and idempotency_key=v_key;
  if not found then return jsonb_build_object('registered',false); end if;
  return jsonb_build_object('registered',true,'id',incident.id,'number',incident.number,'status',incident.status);
 when 'submit_absence' then
  v_student:=(p_payload->>'student_id')::uuid; v_id:=nullif(p_payload->>'lesson_id','')::uuid;
  if not (app_private.has_role(v_school,array['admin']) or exists(select 1 from public.students s where s.id=v_student and s.school_id=v_school and (
   (s.user_id=v_user and app_private.has_role(v_school,array['student'])) or (app_private.has_role(v_school,array['guardian']) and exists(
    select 1 from public.guardian_links g where g.school_id=v_school and g.student_id=s.id and g.guardian_id=v_user and g.status='active' and (not s.is_adult or g.adult_authorized))))))
   then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into pupil from public.students where id=v_student and school_id=v_school;
  if not pupil.active then raise exception 'Ученик неактивен'; end if;
  if v_id is not null then
   select * into lesson from public.lessons where id=v_id and school_id=v_school;
   if not found or not exists(select 1 from public.enrollments where school_id=v_school and student_id=v_student and group_id=lesson.group_id
    and starts_at<=lesson.starts_at and (ends_at is null or ends_at>lesson.starts_at)) then raise exception 'NOT_FOUND'; end if;
  end if;
  insert into public.absence_requests(school_id,student_id,lesson_id,reason,created_by) values(v_school,v_student,v_id,btrim(p_payload->>'reason'),v_user) returning id into v_id;
  perform app_private.audit(v_school,v_user,p_action,'absence_request',v_id);
 when 'review_absence' then
  v_id:=(p_payload->>'id')::uuid;
  select * into absence from public.absence_requests where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into pupil from public.students where id=absence.student_id and school_id=v_school;
  if not app_private.can_teach_group(v_school,pupil.group_id) or (absence.lesson_id is not null and not app_private.can_manage_lesson(v_school,absence.lesson_id)) then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  v_status:=p_payload->>'status'; if v_status not in ('approved','rejected') then raise exception 'INVALID_INPUT'; end if;
  if absence.status<>'pending' then return jsonb_build_object('id',v_id,'status',absence.status); end if;
  update public.absence_requests set status=v_status,reviewed_by=v_user,reviewed_at=now(),comment=nullif(btrim(p_payload->>'comment'),'') where id=v_id;
  if v_status='approved' and absence.lesson_id is not null then
   perform app_private.dispatch('record_attendance',jsonb_build_object('school_id',v_school,'lesson_id',absence.lesson_id,'student_ids',jsonb_build_array(absence.student_id),
    'status','excused','reason','Причина согласована сотрудником'));
  end if;
  perform app_private.audit(v_school,v_user,p_action,'absence_request',v_id,jsonb_build_object('status',v_status));
 when 'create_invitation' then
  v_status:=p_payload->>'role'; v_student:=nullif(p_payload->>'student_id','')::uuid;
  if v_status is null or v_status not in ('teacher','security','student','guardian') then raise exception 'INVALID_INPUT'; end if;
  if v_status in ('student','guardian') and not exists(select 1 from public.students where id=v_student and school_id=v_school and active) then raise exception 'Выберите ученика своей организации'; end if;
  select coalesce(array_agg(distinct items.value::uuid),'{}'::uuid[]) into v_group_ids from jsonb_array_elements_text(coalesce(p_payload->'group_ids','[]'::jsonb)) as items(value);
  if exists(select 1 from unnest(v_group_ids) g(id) where not exists(select 1 from public.school_groups where school_id=v_school and id=g.id)) then raise exception 'NOT_FOUND'; end if;
  if v_status='teacher' and cardinality(v_group_ids)=0 then raise exception 'Назначьте преподавателю хотя бы одну группу'; end if;
  v_token:=encode(extensions.gen_random_bytes(24),'hex'); v_expires:=now()+interval '48 hours';
  insert into app_private.invitations(school_id,token_hash,role,student_id,group_ids,email,created_by,expires_at)
   values(v_school,encode(extensions.digest(v_token,'sha256'),'hex'),v_status,v_student,v_group_ids,nullif(lower(btrim(p_payload->>'email')),''),v_user,v_expires) returning id into v_id;
  perform app_private.audit(v_school,v_user,p_action,'invitation',v_id,jsonb_build_object('role',v_status));
  return jsonb_build_object('id',v_id,'token',v_token,'expires_at',v_expires);
 when 'approve_guardian' then
  v_id:=(p_payload->>'id')::uuid;
  select * into guardian from public.guardian_links where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select is_adult into v_adult from public.students where id=guardian.student_id and school_id=v_school;
  if v_adult and not coalesce((p_payload->>'adult_authorized')::boolean,false) then raise exception 'Для совершеннолетнего студента необходимо отдельно подтвердить разрешённый доступ представителя'; end if;
  update public.guardian_links set status='active',approved_by=v_user,approved_at=now(),adult_authorized=coalesce((p_payload->>'adult_authorized')::boolean,false) where id=v_id;
  perform app_private.audit(v_school,v_user,p_action,'guardian_link',v_id,jsonb_build_object('adult_authorized',coalesce((p_payload->>'adult_authorized')::boolean,false)));
 when 'revoke_guardian' then
  v_id:=(p_payload->>'id')::uuid;
  select * into guardian from public.guardian_links where id=v_id and school_id=v_school for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.guardian_links set status='revoked',adult_authorized=false where id=v_id;
  update public.notifications set status='suppressed',error='Доступ представителя отозван',completed_at=now(),lease_token=null,leased_until=null
   where school_id=v_school and recipient_user_id=guardian.guardian_id and student_id=guardian.student_id and status in ('queued','processing');
  perform app_private.audit(v_school,v_user,p_action,'guardian_link',v_id);
 when 'set_member_active' then
  v_id:=(p_payload->>'user_id')::uuid; v_status:=p_payload->>'role';
  if v_id=v_user and v_status='admin' then raise exception 'Нельзя отключить собственную роль администратора'; end if;
  update public.memberships set active=coalesce((p_payload->>'active')::boolean,false) where school_id=v_school and user_id=v_id and role=v_status;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform app_private.audit(v_school,v_user,p_action,'membership',null,jsonb_build_object('user_id',v_id,'role',v_status));
 when 'update_settings' then
  v_timezone:=coalesce(p_payload->>'timezone',org.timezone);
  if not exists(select 1 from pg_timezone_names where name=v_timezone) then raise exception 'Некорректный часовой пояс'; end if;
  update public.schools set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),timezone=v_timezone,
   grace_minutes=coalesce((p_payload->>'grace_minutes')::integer,grace_minutes),notifications_enabled=coalesce((p_payload->>'notifications_enabled')::boolean,notifications_enabled),
   notification_mode=coalesce(p_payload->>'notification_mode',notification_mode),
   emergency_phone=case when p_payload ? 'emergency_phone' then nullif(btrim(p_payload->>'emergency_phone'),'') else emergency_phone end,
   locale=coalesce(p_payload->>'locale',locale) where id=v_school;
  v_id:=v_school; perform app_private.audit(v_school,v_user,p_action,'school',v_id);
 when 'create_telegram_link' then
  v_token:=encode(extensions.gen_random_bytes(24),'hex'); v_expires:=now()+interval '15 minutes';
  update app_private.telegram_link_tokens set expires_at=now() where user_id=v_user and consumed_at is null;
  insert into app_private.telegram_link_tokens(user_id,token_hash,expires_at) values(v_user,encode(extensions.digest(v_token,'sha256'),'hex'),v_expires);
  return jsonb_build_object('token',v_token,'expires_at',v_expires);
 when 'disconnect_telegram' then
  update app_private.telegram_links set active=false where user_id=v_user;
  perform app_private.audit(v_school,v_user,p_action,'profile',v_user);
  return jsonb_build_object('disconnected',true);
 when 'run_attendance_check' then return app_private.process_due(v_school);
 else raise exception 'UNKNOWN_ACTION';
 end case;
 return jsonb_build_object('id',v_id,'ok',true);
end $$;

create or replace function public.edusafe_action(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select app_private.dispatch(p_action,p_payload) $$;
revoke all on function app_private.dispatch(text,jsonb) from public,anon;
grant execute on function app_private.dispatch(text,jsonb) to authenticated;
revoke all on function public.edusafe_action(text,jsonb) from public,anon;
grant execute on function public.edusafe_action(text,jsonb) to authenticated;
