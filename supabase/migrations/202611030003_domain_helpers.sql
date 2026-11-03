-- Snapshot schedule time so a later reschedule invalidates a queued old message.
alter table public.notifications add column lesson_starts_at timestamptz;

create or replace function app_private.audit(p_school uuid,p_actor uuid,p_action text,p_type text,p_id uuid,p_detail jsonb default '{}')
returns void language sql security definer set search_path='' as $$
 insert into public.audit_log(school_id,actor_id,action,entity_type,entity_id,detail)
 values(p_school,p_actor,p_action,p_type,p_id,p_detail)
$$;

create or replace function app_private.queue_notification(p_school uuid,p_recipient uuid,p_key text,p_kind text,
 p_title text,p_body text,p_priority integer default 20,p_student uuid default null,p_lesson uuid default null,
 p_incident uuid default null,p_expected_status text default null,p_expected_version integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_mock boolean;
begin
 if not exists(select 1 from public.memberships m where m.school_id=p_school and m.user_id=p_recipient and m.active) then return null; end if;
 select s.notification_mode='mock' or coalesce((select i.is_drill from public.incidents i where i.id=p_incident and i.school_id=p_school),false)
  into v_mock from public.schools s where s.id=p_school;
 insert into public.notifications(school_id,recipient_user_id,event_key,kind,title,body,priority,student_id,lesson_id,incident_id,
  expected_status,expected_version,status,completed_at,lesson_starts_at)
 values(p_school,p_recipient,p_key,p_kind,p_title,p_body,p_priority,p_student,p_lesson,p_incident,
  p_expected_status,p_expected_version,case when v_mock then 'mock' else 'queued' end,case when v_mock then now() else null end,
  (select l.starts_at from public.lessons l where l.school_id=p_school and l.id=p_lesson))
 on conflict(school_id,event_key,recipient_user_id,channel) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.notifications where school_id=p_school and event_key=p_key and recipient_user_id=p_recipient and channel='telegram'; end if;
 return v_id;
end $$;

create or replace function app_private.notify_attendance(p_attendance uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.attendance%rowtype; s public.students%rowtype; l public.lessons%rowtype; org public.schools%rowtype;
 g record; v_title text; v_body text;
begin
 select * into a from public.attendance where id=p_attendance;
 if not found or (a.status='unconfirmed' and a.version=0) then return; end if;
 select * into org from public.schools where id=a.school_id;
 if not org.notifications_enabled then return; end if;
 select * into s from public.students where id=a.student_id and school_id=a.school_id;
 select * into l from public.lessons where id=a.lesson_id and school_id=a.school_id;
 if l.status='cancelled' or not s.active then return; end if;
 if org.locale='kk' then
  v_title:=case a.status when 'present' then 'Қатысу расталды' when 'late' then 'Кешігу белгіленді' when 'absent' then 'Қатыспау белгіленді' when 'unconfirmed' then 'Қатысу мәртебесі нақтылануда' else 'Себепті қатыспау' end;
  v_body:=s.full_name||': '||l.title||', '||to_char(l.starts_at at time zone org.timezone,'DD.MM.YYYY HH24:MI')||'. Мұғалім журналды жаңартты.';
 else
  v_title:=case a.status when 'present' then 'Присутствие подтверждено' when 'late' then 'Зафиксировано опоздание' when 'absent' then 'Преподаватель отметил отсутствие' when 'unconfirmed' then 'Статус посещения уточняется' else 'Отсутствие согласовано' end;
  v_body:=s.full_name||': '||l.title||', '||to_char(l.starts_at at time zone org.timezone,'DD.MM.YYYY HH24:MI')||'. Информация обновлена преподавателем.';
 end if;
 for g in select gl.guardian_id from public.guardian_links gl where gl.school_id=a.school_id and gl.student_id=a.student_id and gl.status='active'
  and (not s.is_adult or gl.adult_authorized) loop
  perform app_private.queue_notification(a.school_id,g.guardian_id,'attendance:'||a.id::text||':'||a.version::text,
   'attendance_update',v_title,v_body,30,a.student_id,a.lesson_id,null,a.status,a.version);
 end loop;
end $$;

create or replace function app_private.notify_incident(p_incident uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare i public.incidents%rowtype; recipient record; v_title text; v_body text; v_place text; v_key text;
begin
 select * into i from public.incidents where id=p_incident;
 if not found then return; end if;
 select coalesce(l.building||', '||l.name,'Помещение не уточнено') into v_place from public.locations l where l.id=i.location_id;
 v_place:=coalesce(v_place,'Помещение не уточнено');
 v_title:=(case when i.is_drill then 'УЧЕБНАЯ ТРЕВОГА · ' else 'Сигнал помощи · ' end)||'#'||i.number::text;
 v_body:=v_place||'. '||case p_event when 'created' then 'Ожидает принятия сотрудником.' when 'acknowledged' then 'Сотрудник принял сигнал.'
  when 'resolved' then 'Инцидент закрыт.' when 'cancelled' then 'Сигнал отменён как ошибочный.' else 'Сигнал пока не принят. Требуется ответственный.' end;
 v_key:='incident:'||i.id::text||':'||p_event||case when p_event='escalation' then ':'||i.escalation_step::text else '' end;
 for recipient in
  select distinct m.user_id from public.memberships m where m.school_id=i.school_id and m.active and (
   (p_event='created' and (m.role='security' or (m.role='admin' and not exists(select 1 from public.memberships q where q.school_id=i.school_id and q.active and q.role='security'))))
   or (p_event='escalation' and m.role in ('admin','security'))
   or (p_event not in ('created','escalation') and (m.role in ('admin','security') or m.user_id=i.created_by)))
 loop
  perform app_private.queue_notification(i.school_id,recipient.user_id,v_key,'incident_'||p_event,v_title,v_body,100,null,null,i.id,i.status,null);
 end loop;
end $$;

create or replace function app_private.seed_demo(p_school uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_groups uuid[]:='{}'; v_rooms uuid[]:='{}'; v_group uuid; v_room uuid; v_student uuid; v_lesson uuid; v_incident uuid;
 i integer; j integer; d integer; v_status text; v_start timestamptz; v_tz text;
 v_first text[]:=array['Айлин','Данияр','Амина','Алихан','Аружан','Ернар','Мадина','Нурислам','Айша','Мирас','София','Артём','Сабина','Аслан','Адель','Тимур','Жансая','Диас','Назерке','Роман'];
 v_last text[]:=array['Сапарова','Омаров','Нурланова','Сериков','Бекова','Исаев','Жумабаева','Касымов','Алиева','Садыков','Смирнова','Волков','Рахимова','Тлеубеков','Каримова','Ахметов','Турсынова','Жакупов','Есенова','Соколов'];
 pupil record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_school::text||':seed',0));
 if exists(select 1 from public.school_groups where school_id=p_school) or exists(select 1 from public.students where school_id=p_school) then
  raise exception using errcode='P0001',message='Демонстрационные данные можно добавить только в пустую организацию';
 end if;
 update public.schools set is_demo=true,notification_mode='mock',notifications_enabled=true where id=p_school returning timezone into v_tz;
 for j in 1..3 loop
  insert into public.school_groups(school_id,name) values(p_school,(array['8 «А»','8 «Б»','ИС-21'])[j]) returning id into v_group;
  v_groups:=array_append(v_groups,v_group);
  insert into public.locations(school_id,name,building,floor) values(p_school,'Кабинет '||(array['203','204','317'])[j],'Учебный корпус',case when j=3 then 3 else 2 end) returning id into v_room;
  v_rooms:=array_append(v_rooms,v_room);
  for i in 1..20 loop
   insert into public.students(school_id,group_id,full_name,is_adult) values(p_school,v_group,
    v_last[((i+j-2)%20)+1]||' '||v_first[i],j=3 and i<=10) returning id into v_student;
   insert into public.enrollments(school_id,student_id,group_id,starts_at) values(p_school,v_student,v_group,now()-interval '45 days');
  end loop;
  for d in 0..4 loop
   if d=0 then v_start:=date_trunc('minute',now())-interval '5 minutes';
   else v_start:=(((now() at time zone v_tz)::date-d)::text||' 08:30')::timestamp at time zone v_tz; end if;
   insert into public.lessons(school_id,group_id,location_id,teacher_id,title,starts_at,ends_at,status)
    values(p_school,v_group,v_room,p_actor,(array['Математика','Информатика','Проектирование систем'])[j],v_start,v_start+interval '45 minutes',case when d=0 then 'active' else 'completed' end)
    returning id into v_lesson;
   i:=0;
   for pupil in select * from public.students where school_id=p_school and group_id=v_group order by full_name loop
    i:=i+1;
    v_status:=case when d=0 and i%10=0 then 'unconfirmed' when (i+d)%10=1 then 'absent' when (i+d)%10=2 then 'late' when (i+d)%10=3 then 'excused' else 'present' end;
    insert into public.attendance(school_id,lesson_id,student_id,status,confirmed_by,confirmed_at,version,updated_at,reason)
     values(p_school,v_lesson,pupil.id,v_status,case when v_status='unconfirmed' then null else p_actor end,
      case when v_status='unconfirmed' then null else v_start+interval '3 minutes' end,case when v_status='unconfirmed' then 0 else 1 end,
      v_start+interval '3 minutes',case when v_status='excused' then 'Демонстрационный пример согласованного отсутствия' else null end);
    if v_status in ('present','late') or (v_status='unconfirmed' and i=10) then
     insert into public.check_ins(school_id,lesson_id,student_id,created_at) values(p_school,v_lesson,pupil.id,v_start-interval '2 minutes');
    end if;
   end loop;
  end loop;
  insert into public.lessons(school_id,group_id,location_id,teacher_id,title,starts_at,ends_at)
   values(p_school,v_group,v_room,p_actor,(array['Русский язык','Физика','Разработка приложений'])[j],date_trunc('minute',now())+interval '55 minutes',date_trunc('minute',now())+interval '100 minutes');
 end loop;
 insert into public.incidents(school_id,location_id,created_by,kind,details,status,is_drill,idempotency_key,request_hash,created_at,
  acknowledged_by,acknowledged_at,resolution,resolved_at)
 values(p_school,v_rooms[1],p_actor,'help','Учебная проверка сценария помощи','resolved',true,'seed-demo-resolved','demo',now()-interval '1 day',
  p_actor,now()-interval '1 day'+interval '30 seconds','Демонстрационный инцидент обработан',now()-interval '1 day'+interval '2 minutes') returning id into v_incident;
 insert into public.incident_events(school_id,incident_id,actor_id,kind,message,created_at) values
  (p_school,v_incident,p_actor,'created','Учебный сигнал зарегистрирован',now()-interval '1 day'),
  (p_school,v_incident,p_actor,'acknowledged','Учебный сигнал принят',now()-interval '1 day'+interval '30 seconds'),
  (p_school,v_incident,p_actor,'resolved','Демонстрационный инцидент закрыт',now()-interval '1 day'+interval '2 minutes');
 perform app_private.queue_notification(p_school,p_actor,'demo:welcome','system','Демонстрационная организация готова',
  'Созданы 60 вымышленных учеников, 3 группы и примеры посещаемости. Реальные сообщения не отправляются.');
 perform app_private.audit(p_school,p_actor,'seed_demo','school',p_school,jsonb_build_object('students',60,'groups',3));
 return jsonb_build_object('students',60,'groups',3,'notification_mode','mock');
end $$;

revoke all on function app_private.audit(uuid,uuid,text,text,uuid,jsonb),
 app_private.queue_notification(uuid,uuid,text,text,text,text,integer,uuid,uuid,uuid,text,integer),
 app_private.notify_attendance(uuid),app_private.notify_incident(uuid,text),app_private.seed_demo(uuid,uuid) from public,anon,authenticated;
