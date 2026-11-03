-- EduSafe: organization isolation, evidence-based attendance and durable alerts.
-- All demo records are fictional. No credentials or recipient chat IDs are seeded.
create schema if not exists app_private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'Asia/Almaty',
  grace_minutes integer not null default 15 check (grace_minutes between 1 and 120),
  notifications_enabled boolean not null default false,
  notification_mode text not null default 'mock' check (notification_mode in ('mock','telegram')),
  emergency_phone text check (char_length(emergency_phone) <= 40),
  locale text not null default 'ru' check (locale in ('ru','kk')),
  created_by uuid not null references auth.users(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','teacher','security','student','guardian')),
  group_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(school_id,user_id,role)
);
create index memberships_user_school on public.memberships(user_id,school_id) where active;
create index memberships_school_role on public.memberships(school_id,role) where active;

create table public.school_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(school_id,name), unique(school_id,id)
);
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null check (char_length(name) between 1 and 100),
  building text not null default 'Главный корпус' check (char_length(building) <= 100),
  floor integer not null default 1 check (floor between -5 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(school_id,name,building), unique(school_id,id)
);
create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  group_id uuid not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  user_id uuid references auth.users(id) on delete set null,
  is_adult boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (school_id,group_id) references public.school_groups(school_id,id),
  unique(school_id,id), unique(school_id,user_id)
);
create index students_group on public.students(school_id,group_id) where active;
create index students_user on public.students(user_id) where user_id is not null;
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  group_id uuid not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  foreign key(school_id,student_id) references public.students(school_id,id),
  foreign key(school_id,group_id) references public.school_groups(school_id,id),
  check(ends_at is null or ends_at >= starts_at)
);
create unique index enrollments_one_current on public.enrollments(school_id,student_id) where ends_at is null;
create index enrollments_group_time on public.enrollments(school_id,group_id,starts_at,ends_at);
create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  adult_authorized boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(school_id,student_id) references public.students(school_id,id),
  unique(school_id,student_id,guardian_id)
);
create index guardian_links_guardian on public.guardian_links(guardian_id,school_id,status);
create index guardian_links_student on public.guardian_links(school_id,student_id,status);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  group_id uuid not null,
  location_id uuid,
  teacher_id uuid references auth.users(id),
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','active','completed','cancelled')),
  created_at timestamptz not null default now(),
  foreign key(school_id,group_id) references public.school_groups(school_id,id),
  foreign key(school_id,location_id) references public.locations(school_id,id),
  check(ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  unique(school_id,id), unique(school_id,group_id,starts_at)
);
create index lessons_school_time on public.lessons(school_id,starts_at);
create index lessons_teacher on public.lessons(teacher_id,starts_at);
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  lesson_id uuid not null,
  student_id uuid not null,
  status text not null default 'unconfirmed' check(status in ('unconfirmed','present','late','absent','excused')),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  reason text check(char_length(reason) <= 1000),
  version integer not null default 0 check(version >= 0),
  updated_at timestamptz not null default now(),
  foreign key(school_id,lesson_id) references public.lessons(school_id,id),
  foreign key(school_id,student_id) references public.students(school_id,id),
  unique(school_id,lesson_id,student_id), unique(school_id,id),
  check((status = 'unconfirmed') or (confirmed_by is not null and confirmed_at is not null))
);
create index attendance_student_lesson on public.attendance(school_id,student_id,lesson_id);
create index attendance_status on public.attendance(school_id,lesson_id,status);
create table public.attendance_changes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  attendance_id uuid not null,
  actor_id uuid not null references auth.users(id),
  old_status text,
  new_status text not null,
  reason text,
  version integer not null,
  created_at timestamptz not null default now(),
  foreign key(school_id,attendance_id) references public.attendance(school_id,id)
);
create index attendance_changes_record on public.attendance_changes(attendance_id,created_at);
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  lesson_id uuid not null,
  student_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key(school_id,lesson_id) references public.lessons(school_id,id),
  foreign key(school_id,student_id) references public.students(school_id,id),
  unique(school_id,lesson_id,student_id)
);
create index check_ins_student on public.check_ins(school_id,student_id,created_at);
create table app_private.qr_challenges (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  lesson_id uuid not null,
  created_by uuid not null references auth.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(school_id,lesson_id) references public.lessons(school_id,id)
);
create index qr_challenges_expiry on app_private.qr_challenges(expires_at);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  school_id uuid not null references public.schools(id),
  location_id uuid,
  created_by uuid not null references auth.users(id),
  kind text not null default 'help' check(kind in ('help','medical','security','fire','other')),
  details text not null default '' check(char_length(details) <= 2000),
  status text not null default 'new' check(status in ('new','acknowledged','resolved','cancelled')),
  is_drill boolean not null default true,
  idempotency_key text not null check(char_length(idempotency_key) between 8 and 128),
  request_hash text not null,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolution text check(char_length(resolution) <= 2000),
  resolved_at timestamptz,
  escalation_step integer not null default 0 check(escalation_step between 0 and 3),
  next_escalation_at timestamptz not null default now() + interval '60 seconds',
  foreign key(school_id,location_id) references public.locations(school_id,id),
  unique(school_id,id), unique(school_id,created_by,idempotency_key)
);
create index incidents_school_state_time on public.incidents(school_id,status,created_at desc);
create index incidents_due on public.incidents(next_escalation_at) where status = 'new';
create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  incident_id uuid not null,
  actor_id uuid references auth.users(id),
  kind text not null,
  message text not null default '',
  created_at timestamptz not null default now(),
  foreign key(school_id,incident_id) references public.incidents(school_id,id)
);
create index incident_events_incident on public.incident_events(incident_id,created_at);
create table public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  lesson_id uuid,
  reason text not null check(char_length(reason) between 3 and 1000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  comment text check(char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  foreign key(school_id,student_id) references public.students(school_id,id),
  foreign key(school_id,lesson_id) references public.lessons(school_id,id)
);
create index absence_requests_school_state on public.absence_requests(school_id,status,created_at desc);
create index absence_requests_student on public.absence_requests(school_id,student_id,lesson_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  recipient_user_id uuid not null references auth.users(id),
  event_key text not null,
  kind text not null,
  title text not null,
  body text not null,
  channel text not null default 'telegram' check(channel = 'telegram'),
  status text not null default 'queued' check(status in ('queued','processing','sent','mock','failed','suppressed')),
  priority integer not null default 20,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  leased_until timestamptz,
  lease_token uuid,
  telegram_message_id text,
  error text,
  student_id uuid,
  lesson_id uuid,
  incident_id uuid,
  expected_status text,
  expected_version integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(school_id,student_id) references public.students(school_id,id),
  foreign key(school_id,lesson_id) references public.lessons(school_id,id),
  foreign key(school_id,incident_id) references public.incidents(school_id,id),
  unique(school_id,event_key,recipient_user_id,channel)
);
create index notifications_due on public.notifications(priority desc,next_attempt_at) where status in ('queued','processing');
create index notifications_recipient on public.notifications(recipient_user_id,school_id,created_at desc);
create index notifications_school_time on public.notifications(school_id,created_at desc);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_school_time on public.audit_log(school_id,created_at desc);

create table app_private.invitations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  token_hash text not null unique,
  role text not null check(role in ('teacher','security','student','guardian')),
  student_id uuid,
  group_ids uuid[] not null default '{}',
  email text,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '48 hours',
  consumed_by uuid references auth.users(id),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(school_id,student_id) references public.students(school_id,id)
);
create table app_private.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table app_private.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null,
  telegram_user_id bigint not null,
  active boolean not null default true,
  linked_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create unique index telegram_links_active_chat on app_private.telegram_links(chat_id) where active;
create unique index telegram_links_active_user on app_private.telegram_links(telegram_user_id) where active;
create table app_private.integration_secrets (
  name text primary key check(name in ('worker','telegram_webhook')),
  secret_hash text not null,
  updated_at timestamptz not null default now()
);
create table app_private.worker_lease (
  name text primary key,
  run_id uuid not null,
  leased_until timestamptz not null
);
create table app_private.telegram_updates (
  update_id bigint primary key,
  run_id uuid not null,
  status text not null check(status in ('processing','done','retry')),
  leased_until timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- No exposed table is accessible anonymously, including tables with no policies.
alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.school_groups enable row level security;
alter table public.locations enable row level security;
alter table public.students enable row level security;
alter table public.enrollments enable row level security;
alter table public.guardian_links enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_changes enable row level security;
alter table public.check_ins enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.absence_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table app_private.qr_challenges enable row level security;
alter table app_private.invitations enable row level security;
alter table app_private.telegram_link_tokens enable row level security;
alter table app_private.telegram_links enable row level security;
alter table app_private.integration_secrets enable row level security;
alter table app_private.worker_lease enable row level security;
alter table app_private.telegram_updates enable row level security;
revoke all on all tables in schema app_private from public,anon,authenticated;
revoke all on public.schools,public.profiles,public.memberships,public.school_groups,public.locations,
 public.students,public.enrollments,public.guardian_links,public.lessons,public.attendance,
 public.attendance_changes,public.check_ins,public.incidents,public.incident_events,
 public.absence_requests,public.notifications,public.audit_log from anon,authenticated;
grant select on public.schools,public.profiles,public.memberships,public.school_groups,public.locations,
 public.students,public.enrollments,public.guardian_links,public.lessons,public.attendance,
 public.attendance_changes,public.check_ins,public.incidents,public.incident_events,
 public.absence_requests,public.notifications,public.audit_log to authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema app_private to service_role;
grant usage on schema app_private to authenticated,service_role;
grant usage,select on all sequences in schema public to service_role;
