export type Role = 'admin' | 'teacher' | 'security' | 'student' | 'guardian';
export type AttendanceStatus = 'unconfirmed' | 'present' | 'late' | 'absent' | 'excused';
export interface School { id:string; name:string; timezone:string; grace_minutes:number; notifications_enabled:boolean; notification_mode:'mock'|'telegram'; emergency_phone:string|null; locale?:string; }
export interface Profile { id:string; full_name:string; email?:string; }
export interface Group { id:string; school_id:string; name:string; }
export interface Location { id:string; school_id:string; name:string; building:string; floor:number; }
export interface Student { id:string; school_id:string; group_id:string; full_name:string; user_id:string|null; is_adult:boolean; active:boolean; }
export interface Lesson { id:string; school_id:string; group_id:string; location_id:string|null; teacher_id:string|null; title:string; starts_at:string; ends_at:string; status:'scheduled'|'active'|'completed'|'cancelled'; }
export interface Attendance { id:string; school_id:string; lesson_id:string; student_id:string; status:AttendanceStatus; confirmed_by:string|null; confirmed_at:string|null; reason:string|null; updated_at:string; version?:number; }
export interface CheckIn { id:string; school_id:string; lesson_id:string; student_id:string; created_at:string; }
export interface Incident { id:string; school_id:string; location_id:string|null; created_by:string; kind:'help'|'medical'|'security'|'fire'|'other'; details:string; status:'new'|'acknowledged'|'resolved'|'cancelled'; is_drill:boolean; created_at:string; acknowledged_by:string|null; acknowledged_at:string|null; resolution:string|null; resolved_at:string|null; number?:number; }
export interface IncidentEvent { id:string; incident_id:string; actor_id:string|null; kind:string; message:string; created_at:string; }
export interface AbsenceRequest { id:string; school_id:string; student_id:string; lesson_id:string|null; reason:string; status:'pending'|'approved'|'rejected'; created_by:string; created_at:string; comment?:string|null; }
export interface Notification { id:string; school_id:string; recipient_user_id:string; kind:string; title:string; body:string; status:'queued'|'processing'|'sent'|'mock'|'failed'|'suppressed'; created_at:string; error:string|null; attempts:number; }
export interface AuditEntry { id:string; school_id:string; actor_id:string|null; action:string; entity_type:string; entity_id:string|null; detail:Record<string,unknown>; created_at:string; }
export interface Member { user_id:string; role:Role; full_name:string; group_ids:string[]; }
export interface GuardianLink { id:string; student_id:string; guardian_id:string; status:'pending'|'active'|'revoked'; adult_authorized:boolean; }
export interface WorkspaceData { school:School|null; profile:Profile; role:Role; roles:Role[]; groups:Group[]; students:Student[]; locations:Location[]; lessons:Lesson[]; attendance:Attendance[]; checkIns:CheckIn[]; incidents:Incident[]; incidentEvents:IncidentEvent[]; absenceRequests:AbsenceRequest[]; notifications:Notification[]; audit:AuditEntry[]; teammates:Member[]; guardianLinks:GuardianLink[]; telegramConnected:boolean; mode:'live'|'demo'; }
export interface ActionResponse { data?:Record<string,unknown>; error?:string; code?:string; }
export type AppView = 'overview'|'attendance'|'students'|'schedule'|'incidents'|'notifications'|'settings';
