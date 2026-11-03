import type {
  WorkspaceData,
  Role,
  AttendanceStatus,
  Incident,
  Student,
} from "./types";

export const DEMO_STORAGE_KEY = "edusafe-demo-v3";
const id = (n: number) =>
  `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = [
  "Айлин Нұрлан",
  "Алихан Серік",
  "Амина Ерлан",
  "Арсен Мұрат",
  "Аружан Қанат",
  "Әли Бекзат",
  "Дана Асқар",
  "Данияр Болат",
  "Диляра Руслан",
  "Ерасыл Марат",
  "Жансая Дәурен",
  "Ислам Нұрбек",
  "Камила Тимур",
  "Мадина Ермек",
  "Мирас Сәкен",
  "Нұрай Алмас",
  "Рамазан Арман",
  "София Денис",
  "Томирис Әсет",
  "Ясмин Елдос",
];
const nowIso = () => new Date().toISOString();
const randomId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : id(Math.floor(Math.random() * 999999999));
export function createDemoData(): WorkspaceData {
  const schoolId = id(1),
    admin = id(2);
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const at = (hours: string) =>
    new Date(`${day}T${hours}:00+05:00`).toISOString();
  const groups = ["8 А", "8 Б", "9 А"].map((name, i) => ({
    id: id(10 + i),
    school_id: schoolId,
    name,
  }));
  const locations = ["201", "203", "305", "Спортивный зал"].map((name, i) => ({
    id: id(20 + i),
    school_id: schoolId,
    name,
    building: "Главный корпус",
    floor: i === 2 ? 3 : i === 3 ? 1 : 2,
  }));
  const students: Student[] = Array.from({ length: 60 }, (_, i) => ({
    id: id(100 + i),
    school_id: schoolId,
    group_id: groups[Math.floor(i / 20)].id,
    full_name:
      names[(i + Math.floor(i / 20) * 7) % 20] +
      (i >= 20 ? ` ${["А.", "Б.", "В."][Math.floor(i / 20)]}` : ""),
    user_id: i === 0 ? id(4) : null,
    is_adult: false,
    active: true,
  }));
  const lessons = Array.from({ length: 9 }, (_, i) => ({
    id: id(200 + i),
    school_id: schoolId,
    group_id: groups[i % 3].id,
    location_id: locations[i % 3].id,
    teacher_id: id(3),
    title: [
      "Математика",
      "Информатика",
      "Казахский язык",
      "Физика",
      "Английский язык",
      "История Казахстана",
      "Биология",
      "Литература",
      "География",
    ][i],
    starts_at: at(
      [
        "08:30",
        "08:30",
        "08:30",
        "09:30",
        "09:30",
        "09:30",
        "10:30",
        "10:30",
        "10:30",
      ][i],
    ),
    ends_at: at(
      [
        "09:15",
        "09:15",
        "09:15",
        "10:15",
        "10:15",
        "10:15",
        "11:15",
        "11:15",
        "11:15",
      ][i],
    ),
    status: "scheduled" as const,
  }));
  const statuses: AttendanceStatus[] = [
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "present",
    "late",
    "late",
    "absent",
    "excused",
    "unconfirmed",
    "unconfirmed",
  ];
  const attendance = students.map((s, i) => ({
    id: id(300 + i),
    school_id: schoolId,
    lesson_id: lessons[Math.floor(i / 20)].id,
    student_id: s.id,
    status: statuses[(i + Math.floor(i / 20) * 3) % 20],
    confirmed_by:
      statuses[(i + Math.floor(i / 20) * 3) % 20] === "unconfirmed"
        ? null
        : admin,
    confirmed_at: at("08:40"),
    reason: null,
    updated_at: at("08:40"),
    version: 1,
  }));
  const checkIns = students
    .filter((_, i) => i % 20 < 16)
    .map((s, i) => ({
      id: id(400 + i),
      school_id: schoolId,
      lesson_id: lessons[groups.findIndex((g) => g.id === s.group_id)].id,
      student_id: s.id,
      created_at: at(`08:${String(22 + (i % 9)).padStart(2, "0")}`),
    }));
  const incident: Incident = {
    id: id(500),
    school_id: schoolId,
    location_id: locations[2].id,
    created_by: id(3),
    kind: "help",
    details: "Проверка учебного сценария: требуется помощь сотрудника.",
    status: "acknowledged",
    is_drill: true,
    created_at: new Date(now.getTime() - 12 * 60000).toISOString(),
    acknowledged_by: id(6),
    acknowledged_at: new Date(now.getTime() - 11 * 60000).toISOString(),
    resolution: null,
    resolved_at: null,
    number: 1,
  };
  return {
    school: {
      id: schoolId,
      name: "Школа будущего № 12",
      timezone: "Asia/Almaty",
      grace_minutes: 15,
      notifications_enabled: false,
      notification_mode: "mock",
      emergency_phone: null,
      locale: "ru",
    },
    profile: {
      id: admin,
      full_name: "Айым Садыкова",
      email: "demo@example.invalid",
    },
    role: "admin",
    roles: ["admin"],
    groups,
    students,
    locations,
    lessons,
    attendance,
    checkIns,
    incidents: [incident],
    incidentEvents: [
      {
        id: id(501),
        incident_id: incident.id,
        actor_id: id(3),
        kind: "created",
        message: "Учебный сигнал зарегистрирован",
        created_at: incident.created_at,
      },
      {
        id: id(502),
        incident_id: incident.id,
        actor_id: id(6),
        kind: "acknowledged",
        message: "Сигнал принят ответственным сотрудником",
        created_at: incident.acknowledged_at!,
      },
    ],
    absenceRequests: [
      {
        id: id(600),
        school_id: schoolId,
        student_id: students[17].id,
        lesson_id: lessons[0].id,
        reason: "Согласованное семейное мероприятие. Демонстрационный пример.",
        status: "pending",
        created_by: id(5),
        created_at: at("07:45"),
      },
    ],
    notifications: [
      {
        id: id(700),
        school_id: schoolId,
        recipient_user_id: id(5),
        kind: "attendance",
        title: "Посещаемость обновлена",
        body: "Преподаватель подтвердил присутствие на занятии «Математика».",
        status: "mock",
        created_at: at("08:40"),
        error: null,
        attempts: 0,
      },
      {
        id: id(701),
        school_id: schoolId,
        recipient_user_id: id(6),
        kind: "incident",
        title: "Учебный сигнал · кабинет 305",
        body: "Сигнал принят ответственным сотрудником. Сообщение создано в демонстрационном журнале.",
        status: "mock",
        created_at: incident.created_at,
        error: null,
        attempts: 0,
      },
    ],
    audit: [
      {
        id: id(800),
        school_id: schoolId,
        actor_id: admin,
        action: "attendance.confirmed",
        entity_type: "attendance",
        entity_id: lessons[0].id,
        detail: { message: "Преподаватель проверил журнал 8 А" },
        created_at: at("08:40"),
      },
    ],
    teammates: [
      {
        user_id: admin,
        role: "admin",
        full_name: "Айым Садыкова",
        group_ids: [],
      },
      {
        user_id: id(3),
        role: "teacher",
        full_name: "Данияр Омаров",
        group_ids: groups.map((g) => g.id),
      },
      {
        user_id: id(6),
        role: "security",
        full_name: "Сергей Волков",
        group_ids: [],
      },
      {
        user_id: id(5),
        role: "guardian",
        full_name: "Алия Нұрлан",
        group_ids: [],
      },
      {
        user_id: id(4),
        role: "student",
        full_name: students[0].full_name,
        group_ids: [groups[0].id],
      },
    ],
    guardianLinks: [
      {
        id: id(900),
        student_id: students[0].id,
        guardian_id: id(5),
        status: "active",
        adult_authorized: false,
      },
      {
        id: id(901),
        student_id: students[17].id,
        guardian_id: id(5),
        status: "active",
        adult_authorized: false,
      },
    ],
    telegramConnected: false,
    mode: "demo",
  };
}
export function demoForRole(base: WorkspaceData, role: Role): WorkspaceData {
  const member =
    base.teammates.find((m) => m.role === role) || base.teammates[0];
  let data = {
    ...base,
    role,
    roles: [role],
    profile: {
      id: member.user_id,
      full_name: member.full_name,
      email: "demo@example.invalid",
    },
  };
  if (role === "security")
    return {
      ...data,
      students: [],
      groups: [],
      lessons: [],
      attendance: [],
      checkIns: [],
      absenceRequests: [],
      guardianLinks: [],
    };
  if (role === "student" || role === "guardian") {
    const ids =
      role === "student"
        ? data.students
            .filter((s) => s.user_id === member.user_id)
            .map((s) => s.id)
        : data.guardianLinks
            .filter(
              (l) => l.guardian_id === member.user_id && l.status === "active",
            )
            .map((l) => l.student_id);
    const students = data.students.filter((s) => ids.includes(s.id));
    const groups = data.groups.filter((g) =>
      students.some((s) => s.group_id === g.id),
    );
    const lessons = data.lessons.filter((l) =>
      groups.some((g) => g.id === l.group_id),
    );
    data = {
      ...data,
      students,
      groups,
      lessons,
      attendance: data.attendance.filter((a) => ids.includes(a.student_id)),
      checkIns: data.checkIns.filter((c) => ids.includes(c.student_id)),
      incidents: [],
      incidentEvents: [],
      audit: [],
      absenceRequests: data.absenceRequests.filter((a) =>
        ids.includes(a.student_id),
      ),
      notifications: data.notifications.filter(
        (n) => n.recipient_user_id === member.user_id,
      ),
    };
  }
  return data;
}
export function demoAction(
  base: WorkspaceData,
  action: string,
  p: Record<string, unknown>,
  role: Role = "admin",
): { data: WorkspaceData; result: Record<string, unknown> } {
  const data = structuredClone(base);
  const actor = demoForRole(data, role).profile.id;
  const sid = data.school!.id;
  const now = nowIso();
  let result: Record<string, unknown> = { ok: true };
  const newId = randomId();
  const text = (k: string, def = "") => String(p[k] ?? def).trim();
  const requireText = (k: string) => {
    const v = text(k);
    if (!v) throw new Error("Заполните обязательные поля");
    return v;
  };
  const audit = (entity: string, entityId: string) =>
    data.audit.unshift({
      id: randomId(),
      school_id: sid,
      actor_id: actor,
      action,
      entity_type: entity,
      entity_id: entityId,
      detail: {},
      created_at: now,
    });
  if (action === "create_group") {
    data.groups.push({ id: newId, school_id: sid, name: requireText("name") });
    result = { id: newId };
  } else if (action === "create_location") {
    data.locations.push({
      id: newId,
      school_id: sid,
      name: requireText("name"),
      building: text("building", "Главный корпус"),
      floor: Number(p.floor) || 1,
    });
    result = { id: newId };
  } else if (action === "create_student") {
    data.students.push({
      id: newId,
      school_id: sid,
      full_name: requireText("full_name"),
      group_id: requireText("group_id"),
      user_id: null,
      active: true,
      is_adult: Boolean(p.is_adult),
    });
    result = { id: newId };
  } else if (action === "update_student") {
    const student = data.students.find((s) => s.id === p.id);
    if (!student) throw new Error("Ученик не найден");
    if (p.full_name) student.full_name = text("full_name");
    if (p.group_id) student.group_id = text("group_id");
    if (typeof p.active === "boolean") student.active = p.active;
  } else if (action === "create_lesson") {
    if (new Date(text("ends_at")) <= new Date(text("starts_at")))
      throw new Error("Окончание должно быть позже начала");
    data.lessons.push({
      id: newId,
      school_id: sid,
      title: requireText("title"),
      group_id: requireText("group_id"),
      location_id: text("location_id") || null,
      teacher_id: text("teacher_id") || actor,
      starts_at: requireText("starts_at"),
      ends_at: requireText("ends_at"),
      status: "scheduled",
    });
    result = { id: newId };
  } else if (action === "update_lesson") {
    const lesson = data.lessons.find((l) => l.id === p.id);
    if (!lesson) throw new Error("Занятие не найдено");
    if (p.status) lesson.status = p.status as typeof lesson.status;
  } else if (action === "record_attendance") {
    const lesson = data.lessons.find((l) => l.id === p.lesson_id);
    if (!lesson || lesson.status === "cancelled")
      throw new Error("Занятие недоступно");
    const studentIds = p.student_ids as string[];
    if (!studentIds.length) throw new Error("Выберите учеников");
    for (const studentId of studentIds) {
      if (
        !data.students.some(
          (s) => s.id === studentId && s.group_id === lesson.group_id,
        )
      )
        continue;
      let record = data.attendance.find(
        (a) => a.lesson_id === lesson.id && a.student_id === studentId,
      );
      if (!record) {
        record = {
          id: randomId(),
          school_id: sid,
          lesson_id: lesson.id,
          student_id: studentId,
          status: "unconfirmed",
          confirmed_at: null,
          confirmed_by: null,
          reason: null,
          updated_at: now,
          version: 0,
        };
        data.attendance.push(record);
      }
      record.status = p.status as AttendanceStatus;
      record.confirmed_by = record.status === "unconfirmed" ? null : actor;
      record.confirmed_at = record.status === "unconfirmed" ? null : now;
      record.updated_at = now;
      record.reason = text("reason") || null;
      record.version = (record.version || 0) + 1;
    }
    data.notifications.unshift({
      id: randomId(),
      school_id: sid,
      recipient_user_id: id(5),
      kind: "attendance",
      title: "Журнал обновлён",
      body: `Изменён статус ${studentIds.length} учеников. Демо-сообщение не отправлено в Telegram.`,
      status: "mock",
      created_at: now,
      error: null,
      attempts: 0,
    });
    result = { updated: studentIds.length };
  } else if (action === "check_in") {
    const lessonId = text("token").replace(/^demo:/, "");
    const student = data.students.find((s) => s.user_id === actor && s.active);
    const lesson = data.lessons.find(
      (l) => l.id === lessonId && l.status !== "cancelled",
    );
    if (!student || !lesson || student.group_id !== lesson.group_id)
      throw new Error("Занятие недоступно");
    if (
      !data.checkIns.some(
        (c) => c.student_id === student.id && c.lesson_id === lesson.id,
      )
    )
      data.checkIns.push({
        id: newId,
        school_id: sid,
        lesson_id: lesson.id,
        student_id: student.id,
        created_at: now,
      });
    if (
      !data.attendance.some(
        (a) => a.student_id === student.id && a.lesson_id === lesson.id,
      )
    )
      data.attendance.push({
        id: randomId(),
        school_id: sid,
        lesson_id: lesson.id,
        student_id: student.id,
        status: "unconfirmed",
        confirmed_by: null,
        confirmed_at: null,
        reason: null,
        updated_at: now,
        version: 1,
      });
    result = { ok: true, message: "Самостоятельная отметка зарегистрирована" };
  } else if (action === "create_incident") {
    const old = data.incidents.find(
      (i) =>
        (i as Incident & { idempotency_key?: string }).idempotency_key ===
        p.idempotency_key,
    );
    if (old) return { data: base, result: { id: old.id } };
    const incident: Incident & { idempotency_key: string } = {
      id: newId,
      school_id: sid,
      location_id: text("location_id") || null,
      created_by: actor,
      kind: text("kind", "help") as Incident["kind"],
      details: text("details"),
      status: "new",
      is_drill: true,
      created_at: now,
      acknowledged_by: null,
      acknowledged_at: null,
      resolution: null,
      resolved_at: null,
      number: data.incidents.length + 1,
      idempotency_key: requireText("idempotency_key"),
    };
    data.incidents.unshift(incident);
    data.incidentEvents.push({
      id: randomId(),
      incident_id: newId,
      actor_id: actor,
      kind: "created",
      message: "Учебный сигнал зарегистрирован",
      created_at: now,
    });
    data.notifications.unshift({
      id: randomId(),
      school_id: sid,
      recipient_user_id: id(6),
      kind: "incident",
      title: "Новый учебный сигнал",
      body: "Демонстрационное событие: уведомление сохранено только в браузере.",
      status: "mock",
      created_at: now,
      error: null,
      attempts: 0,
    });
    result = { id: newId };
  } else if (
    ["acknowledge_incident", "resolve_incident", "cancel_incident"].includes(
      action,
    )
  ) {
    const incident = data.incidents.find((i) => i.id === p.id);
    if (!incident) throw new Error("Сигнал не найден");
    if (action === "acknowledge_incident") {
      incident.status = "acknowledged";
      incident.acknowledged_by = actor;
      incident.acknowledged_at = now;
    }
    if (action === "resolve_incident") {
      incident.status = "resolved";
      incident.resolution = requireText("resolution");
      incident.resolved_at = now;
    }
    if (action === "cancel_incident") {
      incident.status = "cancelled";
      incident.resolution = requireText("reason");
      incident.resolved_at = now;
    }
    data.incidentEvents.push({
      id: randomId(),
      incident_id: incident.id,
      actor_id: actor,
      kind: action,
      message: incident.resolution || "Сигнал принят ответственным",
      created_at: now,
    });
    result = { id: incident.id };
  } else if (action === "submit_absence") {
    data.absenceRequests.unshift({
      id: newId,
      school_id: sid,
      student_id: requireText("student_id"),
      lesson_id: text("lesson_id") || null,
      reason: requireText("reason"),
      status: "pending",
      created_by: actor,
      created_at: now,
    });
    result = { id: newId };
  } else if (action === "review_absence") {
    const request = data.absenceRequests.find((a) => a.id === p.id);
    if (!request) throw new Error("Заявка не найдена");
    request.status = p.status as "approved" | "rejected";
    request.comment = text("comment");
  } else if (action === "update_settings") {
    for (const key of [
      "name",
      "timezone",
      "grace_minutes",
      "notifications_enabled",
      "notification_mode",
      "emergency_phone",
      "locale",
    ])
      if (p[key] !== undefined)
        (data.school as unknown as Record<string, unknown>)[key] = p[key];
  } else if (action === "create_invitation") {
    result = {
      token: `demo-${randomId()}`,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
  } else if (action === "create_telegram_link") {
    result = {
      token: `demo-${randomId()}`,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    };
  } else if (action === "approve_guardian" || action === "revoke_guardian") {
    const link = data.guardianLinks.find((l) => l.id === p.id);
    if (link)
      link.status = action === "approve_guardian" ? "active" : "revoked";
  } else if (action === "run_attendance_check") {
    result = {
      checked: data.students.length,
      message: "Проверка демонстрационных записей завершена",
    };
  } else if (action === "seed_demo")
    return { data: createDemoData(), result: { ok: true } };
  else throw new Error("Это действие доступно в рабочей организации");
  audit(
    action.split("_").slice(1).join("_"),
    String(result.id || p.id || newId),
  );
  return { data, result };
}
