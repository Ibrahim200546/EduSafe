# EduSafe implementation contract

User explicitly requests implementation and deployment to their GitHub repository Ibrahim200546/EduSafe, Vercel, and Supabase. New Supabase project dinubypuzjrvgtcvrkwe in eu-central-1, initially empty. No real children or recipients. Default notifications mock. New stack Next.js App Router + TypeScript + Supabase Auth/Postgres/RLS. Root owns package setup, auth, API routes, deployment, integration. Database agent owns supabase/migrations and database tests. UI agent owns src/components, src/app/globals.css, lib/demo.ts and lib/i18n.ts. Worker agent owns supabase/functions and docs for workers. Coordinate before changing shared types.

## API interface

GET /api/workspace -> WorkspaceData defined src/lib/types.ts (user session from httpOnly server cookies; no service key).
POST /api/actions {action:string, payload:object} -> {data:unknown} or {error:string,code:string}. Same origin / CSRF enforced. All authorization in DB again.
Supabase RPC public.edusafe_workspace(p_school_id uuid default null) -> JSON matching WorkspaceData (without mode; API adds mode=live).
Supabase RPC public.edusafe_action(p_action text,p_payload jsonb) -> JSON with action result, usually {id}, QR returns {token,expires_at,lesson_id}. Public wrappers SECURITY INVOKER call private SECURITY DEFINER functions with explicit auth.uid() + active membership authorization, fixed search_path, restricted EXECUTE. RLS on all public tables. No direct write grants to authenticated. Private worker functions service_role only.

Action names and payloads (snake case):
- create_school {name,timezone?,seed_demo?:boolean}; authenticated user without school can create OWN school, never join another as admin.
- seed_demo {}: admin, own empty organization only, inserts fictional 3 groups and 60 students, lessons relative to today local time; no real notifications.
- create_group {name}; create_location {name,building?,floor?}; create_student {full_name,group_id,is_adult?}; update_student {id,full_name?,group_id?,active?}.
- create_lesson {title,group_id,location_id,starts_at,ends_at,teacher_id?}; update_lesson {id,status?,location_id?,starts_at?,ends_at?}, status scheduled|active|completed|cancelled.
- record_attendance {lesson_id,student_ids:string[],status:unconfirmed|present|late|absent|excused,reason?}; actor admin or assigned teacher. Check-ins never overwrite teacher-confirmed status.
- create_qr {lesson_id}; teacher/admin only; 60sec expiry, UI refresh 30sec. Common random token valid for multiple students. Store hash server-side. Return raw token only at generation.
- check_in {token}; student_id resolved server-side; membership + active enrollment + window; idempotent per student/lesson; self signal only.
- create_incident {location_id?:string,kind:help|medical|security|fire|other,details?:string,idempotency_key:string,is_drill:boolean}; staff only. Return {id}. Durable even without location. Separate initial new, acknowledged, resolved, cancelled. Drill never real recipients.
- acknowledge_incident {id}; security/admin. resolve_incident {id,resolution}; security/admin. cancel_incident {id,reason}; creator/admin, history preserved.
- submit_absence {student_id,lesson_id?,reason}; own student or active verified guardian or admin. review_absence {id,status:approved|rejected,comment?}; assigned teacher/admin.
- create_invitation {role:teacher|security|student|guardian,student_id?,group_ids?:string[],email?}; admin only; returns {token,expires_at}; invitation hash, expires, single use. accept_invitation {token}; signed in user; guardian link starts pending (admin approval); student binding checked. approve_guardian {id}; revoke_guardian {id}; admin only. Role membership can be multiple rows but snapshot role highest permitted role and roles array.
- update_settings {name?,timezone?,grace_minutes?,notifications_enabled?,notification_mode?:mock|telegram,emergency_phone?,locale?}; admin only.
- create_telegram_link {} -> {token,expires_at}; token to link own account, no external send.
- run_attendance_check {} -> summary; admin, only own org. Automatically also via pg_cron.

## Workspace snapshot

JSON arrays always present. All DB fields snake_case. Snapshot teacher scoped to assigned groups/lessons, student own records, guardian active verified children, security incidents+locations only academic data absent. Schools never shared. Calendar times ISO UTC, school timezone for rendering. Most active school chosen by memberships, p_school_id must have active membership.

## UI

Beautiful production-quality light editorial education dashboard, deep navy sidebar, offwhite main, emerald/teal accents, restrained amber/red alerts, nice actual mini bar charts from data. Russian + Kazakh key strings, complete mobile navigation. Landing /, login /login, app /app, demo /demo, QR display /qr/[lessonId], scanner /check-in?token=... . Workspace component receives initialData + mode. Local demo only synthetic data in browser localStorage; prominent demo badge. REAL app calls API, refreshes every ~15sec or explicit refresh; incident detail 5sec; show network errors. No fake connected status. No dependency on AI imagery.

Views: overview, attendance, students, schedule, incidents, notifications, settings. Also student check-in and guardian absent request. Forms/dialogs real action API; demo adapter implements same commands. Invite UI copy link /join?token=. Root owns auth/onboarding/join pages and API.

## Workers

DB notifications table stores outbox rows with recipient_user_id, school_id, event_key, kind, title, body, status(queued|processing|sent|mock|failed|suppressed), priority, attempts, next_attempt_at, leased_until, telegram_message_id, error, created_at. Persist logical uniqueness event_key+recipient+channel. Include notifications_channel? Prefer channel text default telegram. Private function process_due scans expected first lessons with grace and enabled flags, ignores cancelled/excused/inactive, queues neutral unconfirmed notices ONLY verified active guardians, adult authorization flag; handles overdue incident escalation (bounded). No auto "truancy". Revalidate before sends.
Worker RPCs service-only: edusafe_claim_notifications(p_limit int) -> rows; edusafe_finish_notification(p_id uuid,p_status text,p_error text default null,p_message_id text default null,p_retry_after int default null); edusafe_process_due() -> json. Telegram links table service/admin locked; one per user with verified chat id. RPC edusafe_telegram_link(p_token text,p_chat_id bigint,p_telegram_user_id bigint) -> minimal {ok} service only; edusafe_telegram_ack(p_incident_id uuid,p_telegram_user_id bigint) -> minimal service only checks membership.
Edge worker uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY auto-injected. TELEGRAM_BOT_TOKEN optional; mock default. Verify custom worker secret from DB RPC edusafe_authorize_worker(p_secret text) service-only, configured in vault if available. Webhook secret verify before parsing; don't deploy unsecured webhook. Scheduling actual pg_cron if available; secrets never source.

## Quality

No destructive live data changes, no paid services without actual authorized cost. Git push / deployment authorized by current user. No real Telegram sends without explicit configuration. Need build/typecheck and meaningful SQL RLS / concurrency/invariants tests. Docs honest about unverified Telegram/physical camera and demo behavior. Root handles all remote schema changes after review; DB agent must NOT mutate remote project.
