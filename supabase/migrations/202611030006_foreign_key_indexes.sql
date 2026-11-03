-- Cover referencing keys used by tenant-scoped maintenance, revocation, history
-- queries and PostgreSQL foreign-key checks. This is additive: no existing
-- index is removed because its counters are still zero on a fresh database.
-- One invitations(school_id,student_id) index covers two FK constraints.
-- Apply during initial setup; for a large active installation, schedule index
-- creation separately with CONCURRENTLY after measuring the real workload.

-- Account ownership and actor references grow with retained academic history.
create index schools_created_by_idx on public.schools(created_by);
create index attendance_confirmed_by_idx on public.attendance(confirmed_by);
create index attendance_changes_actor_idx on public.attendance_changes(actor_id);
create index audit_log_actor_idx on public.audit_log(actor_id);
create index guardian_links_approved_by_idx on public.guardian_links(approved_by);
create index absence_requests_created_by_idx on public.absence_requests(created_by);
create index absence_requests_reviewed_by_idx on public.absence_requests(reviewed_by);
create index incidents_created_by_idx on public.incidents(created_by);
create index incidents_acknowledged_by_idx on public.incidents(acknowledged_by);
create index incident_events_actor_idx on public.incident_events(actor_id);

-- Leading school_id supports tenant-bound operations. The full pair also
-- directly covers the composite FK, including history/retention operations.
create index attendance_changes_school_record_idx on public.attendance_changes(school_id,attendance_id);
create index incident_events_school_incident_idx on public.incident_events(school_id,incident_id);
create index absence_requests_school_lesson_idx on public.absence_requests(school_id,lesson_id);
create index lessons_school_location_idx on public.lessons(school_id,location_id);
create index incidents_school_location_idx on public.incidents(school_id,location_id);

-- Attendance cancellation and guardian revocation update an existing outbox.
-- These indexes avoid scanning the complete retained school message history.
create index notifications_school_lesson_idx on public.notifications(school_id,lesson_id);
create index notifications_school_student_recipient_idx on public.notifications(school_id,student_id,recipient_user_id);
create index notifications_school_incident_idx on public.notifications(school_id,incident_id);

-- Private rows remain inaccessible through application roles; indexing does
-- not add grants, Data API exposure, RLS policies or SECURITY DEFINER entrypoints.
create index invitations_school_student_idx on app_private.invitations(school_id,student_id);
create index invitations_created_by_idx on app_private.invitations(created_by);
create index invitations_consumed_by_idx on app_private.invitations(consumed_by);
create index qr_challenges_school_lesson_idx on app_private.qr_challenges(school_id,lesson_id);
create index qr_challenges_created_by_idx on app_private.qr_challenges(created_by);
-- create_telegram_link invalidates prior tokens by user_id before inserting one.
create index telegram_link_tokens_user_expiry_idx on app_private.telegram_link_tokens(user_id,expires_at);
