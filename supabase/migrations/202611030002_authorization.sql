-- Private authorization helpers intentionally use fresh membership rows rather
-- than user-editable JWT metadata. All definer functions pin their search path.
create or replace function app_private.actor_active()
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=(select auth.uid()) and s.id::text=(select auth.jwt()->>'session_id')
  and (s.not_after is null or s.not_after>now())
  and (u.banned_until is null or u.banned_until<=now()) and u.deleted_at is null)
$$;
create or replace function app_private.is_member(p_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.actor_active() and exists(select 1 from public.memberships m
  where m.school_id=p_school and m.user_id=(select auth.uid()) and m.active)
$$;
create or replace function app_private.has_role(p_school uuid,p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.actor_active() and exists(select 1 from public.memberships m
  where m.school_id=p_school and m.user_id=(select auth.uid()) and m.active and m.role=any(p_roles))
$$;
create or replace function app_private.can_teach_group(p_school uuid,p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.has_role(p_school,array['admin']) or (app_private.is_member(p_school) and exists(
  select 1 from public.memberships m where m.school_id=p_school and m.user_id=(select auth.uid())
   and m.active and m.role='teacher' and p_group=any(m.group_ids)))
$$;
create or replace function app_private.can_view_student(p_school uuid,p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.students s where s.school_id=p_school and s.id=p_student and (
  app_private.can_teach_group(p_school,s.group_id)
  or (s.user_id=(select auth.uid()) and app_private.has_role(p_school,array['student']))
  or (app_private.has_role(p_school,array['guardian']) and exists(select 1 from public.guardian_links g
    where g.school_id=p_school and g.student_id=s.id and g.guardian_id=(select auth.uid()) and g.status='active'
     and (not s.is_adult or g.adult_authorized)))))
$$;
create or replace function app_private.can_view_group(p_school uuid,p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.can_teach_group(p_school,p_group) or exists(select 1 from public.students s
  where s.school_id=p_school and s.group_id=p_group and app_private.can_view_student(p_school,s.id))
$$;
create or replace function app_private.can_manage_lesson(p_school uuid,p_lesson uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.has_role(p_school,array['admin']) or (app_private.is_member(p_school) and exists(select 1 from public.lessons l join public.memberships m
  on m.school_id=l.school_id and m.user_id=(select auth.uid()) and m.role='teacher' and m.active
  where l.school_id=p_school and l.id=p_lesson and
   l.group_id=any(m.group_ids) and (l.teacher_id=m.user_id or l.teacher_id is null)))
$$;
create or replace function app_private.can_view_lesson(p_school uuid,p_lesson uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.can_manage_lesson(p_school,p_lesson) or exists(select 1 from public.lessons l
  join public.enrollments e on e.school_id=l.school_id and e.group_id=l.group_id
    and e.starts_at<=l.starts_at and (e.ends_at is null or e.ends_at>l.starts_at)
  where l.school_id=p_school and l.id=p_lesson and app_private.can_view_student(p_school,e.student_id))
$$;
create or replace function app_private.can_view_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select app_private.actor_active() and (p_user=(select auth.uid()) or exists(select 1 from public.memberships a join public.memberships b on b.school_id=a.school_id
  where a.user_id=(select auth.uid()) and a.active and b.user_id=p_user and b.active
   and (a.role='admin' or (a.role in ('teacher','security') and b.role in ('admin','teacher','security')))))
$$;
create or replace function app_private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
 if not app_private.actor_active() then
  raise exception using errcode='42501',message='Требуется вход в систему';
 end if;
 return v_user;
end $$;
create or replace function app_private.current_school(p_requested uuid default null)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_school uuid; v_user uuid:=app_private.require_user();
begin
 if p_requested is not null then
  if not app_private.is_member(p_requested) then raise exception using errcode='42501',message='Нет доступа к организации'; end if;
  return p_requested;
 end if;
 select m.school_id into v_school from public.memberships m where m.user_id=v_user and m.active order by m.created_at,m.id limit 1;
 return v_school;
end $$;
create or replace function app_private.on_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,full_name) values(new.id,
  left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),nullif(split_part(new.email,'@',1),''),'Участник'),120))
 on conflict(id) do nothing;
 return new;
end $$;
create trigger edusafe_profile_after_signup after insert on auth.users for each row execute function app_private.on_new_user();

create policy schools_read on public.schools for select to authenticated using(app_private.is_member(id));
create policy profiles_read on public.profiles for select to authenticated using(app_private.can_view_profile(id));
create policy memberships_read on public.memberships for select to authenticated using(
 (user_id=(select auth.uid()) and active and app_private.actor_active()) or app_private.has_role(school_id,array['admin']));
create policy groups_read on public.school_groups for select to authenticated using(app_private.can_view_group(school_id,id));
create policy locations_read on public.locations for select to authenticated using(app_private.is_member(school_id));
create policy students_read on public.students for select to authenticated using(app_private.can_view_student(school_id,id));
create policy enrollments_read on public.enrollments for select to authenticated using(app_private.can_view_student(school_id,student_id));
create policy guardians_read on public.guardian_links for select to authenticated using(
 app_private.has_role(school_id,array['admin']) or (guardian_id=(select auth.uid()) and app_private.is_member(school_id)));
create policy lessons_read on public.lessons for select to authenticated using(app_private.can_view_lesson(school_id,id));
create policy attendance_read on public.attendance for select to authenticated using(
 app_private.can_view_student(school_id,student_id) and app_private.can_view_lesson(school_id,lesson_id));
create policy changes_read on public.attendance_changes for select to authenticated using(exists(select 1 from public.attendance a
 where a.id=attendance_id and a.school_id=attendance_changes.school_id
 and app_private.can_view_student(a.school_id,a.student_id) and app_private.can_view_lesson(a.school_id,a.lesson_id)));
create policy checkins_read on public.check_ins for select to authenticated using(
 app_private.can_view_student(school_id,student_id) and app_private.can_view_lesson(school_id,lesson_id));
create policy incidents_read on public.incidents for select to authenticated using(app_private.has_role(school_id,array['admin','security'])
 or (created_by=(select auth.uid()) and app_private.has_role(school_id,array['teacher'])));
create policy incident_events_read on public.incident_events for select to authenticated using(exists(select 1 from public.incidents i
 where i.id=incident_id and i.school_id=incident_events.school_id and
 (app_private.has_role(i.school_id,array['admin','security']) or (i.created_by=(select auth.uid()) and app_private.has_role(i.school_id,array['teacher'])))));
create policy absence_read on public.absence_requests for select to authenticated using(app_private.can_view_student(school_id,student_id)
 and (app_private.has_role(school_id,array['admin','teacher']) or created_by=(select auth.uid())));
create policy notifications_read on public.notifications for select to authenticated using(app_private.has_role(school_id,array['admin'])
 or (recipient_user_id=(select auth.uid()) and app_private.is_member(school_id)
 and (student_id is null or app_private.can_view_student(school_id,student_id))));
create policy audit_read on public.audit_log for select to authenticated using(app_private.has_role(school_id,array['admin']));

create or replace function app_private.workspace(p_school_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=app_private.require_user(); v_school uuid:=app_private.current_school(p_school_id);
 v_roles text[]; v_role text; v_result jsonb; v_profile jsonb;
begin
 insert into public.profiles(id,full_name) select id,left(coalesce(nullif(raw_user_meta_data->>'full_name',''),nullif(split_part(email,'@',1),''),'Участник'),120)
  from auth.users where id=v_user on conflict(id) do nothing;
 select jsonb_build_object('id',p.id,'full_name',p.full_name,'email',u.email) into v_profile
  from public.profiles p join auth.users u on u.id=p.id where p.id=v_user;
 select array_agg(m.role order by case m.role when 'admin' then 1 when 'teacher' then 2 when 'security' then 3 when 'student' then 4 else 5 end)
  into v_roles from public.memberships m where m.school_id=v_school and m.user_id=v_user and m.active;
 v_roles:=coalesce(v_roles,array[]::text[]); v_role:=coalesce(v_roles[1],'admin');
 v_result:=jsonb_build_object('school',null,'profile',v_profile,'role',v_role,'roles',to_jsonb(v_roles),
  'groups','[]'::jsonb,'students','[]'::jsonb,'locations','[]'::jsonb,'lessons','[]'::jsonb,
  'attendance','[]'::jsonb,'checkIns','[]'::jsonb,'incidents','[]'::jsonb,'incidentEvents','[]'::jsonb,
  'absenceRequests','[]'::jsonb,'notifications','[]'::jsonb,'audit','[]'::jsonb,'teammates','[]'::jsonb,
  'guardianLinks','[]'::jsonb,'telegramConnected',exists(select 1 from app_private.telegram_links t where t.user_id=v_user and t.active));
 if v_school is null then return v_result; end if;
 v_result:=v_result || jsonb_build_object(
  'school',(select to_jsonb(s) from public.schools s where s.id=v_school),
  'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.name) from public.school_groups g
    where g.school_id=v_school and app_private.can_view_group(v_school,g.id)),'[]'::jsonb),
  'students',coalesce((select jsonb_agg(to_jsonb(s) order by s.full_name) from public.students s
    where s.school_id=v_school and app_private.can_view_student(v_school,s.id)),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(to_jsonb(l) order by l.building,l.floor,l.name) from public.locations l where l.school_id=v_school and l.active),'[]'::jsonb),
  'lessons',coalesce((select jsonb_agg(to_jsonb(l) order by l.starts_at) from public.lessons l
    where l.school_id=v_school and l.starts_at>=now()-interval '31 days' and app_private.can_view_lesson(v_school,l.id)),'[]'::jsonb),
  'attendance',coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from public.attendance a join public.lessons l on l.id=a.lesson_id
    where a.school_id=v_school and l.starts_at>=now()-interval '31 days' and app_private.can_view_student(v_school,a.student_id)
      and app_private.can_view_lesson(v_school,a.lesson_id)),'[]'::jsonb),
  'checkIns',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.check_ins c
    where c.school_id=v_school and c.created_at>=now()-interval '31 days' and app_private.can_view_student(v_school,c.student_id)
      and app_private.can_view_lesson(v_school,c.lesson_id)),'[]'::jsonb),
  'incidents',coalesce((select jsonb_agg(to_jsonb(i) - 'request_hash' - 'idempotency_key' order by i.created_at desc) from public.incidents i
    where i.school_id=v_school and (app_private.has_role(v_school,array['admin','security'])
    or (i.created_by=v_user and app_private.has_role(v_school,array['teacher'])))),'[]'::jsonb),
  'incidentEvents',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.incident_events e join public.incidents i on i.id=e.incident_id
    where i.school_id=v_school and (app_private.has_role(v_school,array['admin','security'])
    or (i.created_by=v_user and app_private.has_role(v_school,array['teacher'])))),'[]'::jsonb),
  'absenceRequests',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.absence_requests a
    where a.school_id=v_school and app_private.can_view_student(v_school,a.student_id)
    and (app_private.has_role(v_school,array['admin','teacher']) or a.created_by=v_user)),'[]'::jsonb),
  'notifications',coalesce((select jsonb_agg(to_jsonb(n) - 'lease_token' - 'leased_until' order by n.created_at desc) from
    (select * from public.notifications where school_id=v_school and
      (app_private.has_role(v_school,array['admin']) or (recipient_user_id=v_user and (student_id is null or app_private.can_view_student(v_school,student_id))))
      order by created_at desc limit 200) n),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from
    (select * from public.audit_log where school_id=v_school and app_private.has_role(v_school,array['admin']) order by created_at desc limit 150) a),'[]'::jsonb),
  'teammates',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'full_name',p.full_name,'group_ids',m.group_ids)
    order by p.full_name) from public.memberships m join public.profiles p on p.id=m.user_id where m.school_id=v_school and m.active
    and (app_private.has_role(v_school,array['admin']) or (app_private.has_role(v_school,array['teacher','security']) and m.role in ('admin','teacher','security')))),'[]'::jsonb),
  'guardianLinks',coalesce((select jsonb_agg(to_jsonb(g) order by g.created_at desc) from public.guardian_links g where g.school_id=v_school
    and (app_private.has_role(v_school,array['admin']) or g.guardian_id=v_user)),'[]'::jsonb));
 return v_result;
end $$;
create or replace function public.edusafe_workspace(p_school_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$ select app_private.workspace(p_school_id) $$;

revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on function app_private.actor_active(),app_private.is_member(uuid),app_private.has_role(uuid,text[]),
 app_private.can_teach_group(uuid,uuid),app_private.can_view_student(uuid,uuid),app_private.can_view_group(uuid,uuid),
 app_private.can_manage_lesson(uuid,uuid),app_private.can_view_lesson(uuid,uuid),app_private.can_view_profile(uuid),
 app_private.workspace(uuid) to authenticated;
revoke all on function public.edusafe_workspace(uuid) from public,anon;
grant execute on function public.edusafe_workspace(uuid) to authenticated;
