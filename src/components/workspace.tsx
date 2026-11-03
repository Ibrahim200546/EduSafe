"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  ExternalLink,
  FileUp,
  Filter,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  Link2,
  ListFilter,
  LoaderCircle,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Smartphone,
  UserPlus,
  UserRound,
  Users,
  WifiOff,
  X,
  AlertTriangle,
  History,
  LockKeyhole,
} from "lucide-react";
import QRCode from "qrcode";
import { Avatar, Badge, Brand, Empty, Field, Modal, Spinner } from "./ui";
import { copy, type Locale } from "@/lib/i18n";
import {
  createDemoData,
  demoAction,
  demoForRole,
  DEMO_STORAGE_KEY,
} from "@/lib/demo";
import type {
  AppView,
  AttendanceStatus,
  Incident,
  Lesson,
  Role,
  Student,
  WorkspaceData,
} from "@/lib/types";

const icons: Record<AppView, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  attendance: ClipboardCheck,
  students: Users,
  schedule: CalendarDays,
  incidents: ShieldCheck,
  notifications: Bell,
  settings: Settings2,
};
const statusTone: Record<AttendanceStatus, string> = {
  present: "green",
  late: "amber",
  absent: "red",
  excused: "blue",
  unconfirmed: "neutral",
};
const statuses: AttendanceStatus[] = [
  "present",
  "late",
  "absent",
  "excused",
  "unconfirmed",
];
const incidentNames = {
  help: "Нужна помощь",
  medical: "Медицинская помощь",
  security: "Безопасность",
  fire: "Возгорание",
  other: "Другая ситуация",
};
const notificationNames = {
  queued: "В очереди",
  processing: "Обрабатывается",
  sent: "Принято каналом",
  mock: "Демо-журнал",
  failed: "Ошибка",
  suppressed: "Неактуально",
};
const auditNames: Record<string, string> = {
  record_attendance: "Журнал посещаемости обновлён",
  create_student: "Ученик добавлен",
  create_lesson: "Занятие создано",
  create_incident: "Сигнал зарегистрирован",
  acknowledge_incident: "Сигнал принят",
  resolve_incident: "Инцидент закрыт",
  cancel_incident: "Сигнал отменён",
  update_settings: "Настройки сохранены",
  create_invitation: "Приглашение создано",
  submit_absence: "Причина отсутствия отправлена",
  review_absence: "Причина отсутствия рассмотрена",
  "attendance.confirmed": "Посещаемость подтверждена",
};
function localDay(date: string | Date, zone = "Asia/Almaty") {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: zone,
  }).format(new Date(date));
}
function safeCsv(value: unknown) {
  const raw = String(value ?? "");
  return (
    '"' +
    (/^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw).replaceAll('"', '""') +
    '"'
  );
}
function exportCsv(headers: string[], rows: unknown[][], filename: string) {
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...rows].map((r) => r.map(safeCsv).join(";")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function parseCsv(text: string) {
  const first = text.split(/\r?\n/)[0] || "";
  const separator = first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === separator && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function nextDateTime() {
  const date = new Date(Date.now() + 3600000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

type Dialog =
  | "student"
  | "lesson"
  | "group"
  | "location"
  | "invite"
  | "absence"
  | "import"
  | "signal"
  | "incidentDetail"
  | "resolve"
  | "telegram"
  | "qrDemo"
  | "demoScan"
  | null;
export function Workspace({
  initialData,
  mode: modeProp,
}: {
  initialData: WorkspaceData;
  mode?: "demo" | "live";
}) {
  const mode = modeProp || initialData.mode;
  const [base, setBase] = useState(initialData),
    baseRef = useRef(initialData);
  const [locale, setLocale] = useState<Locale>("ru"),
    [demoRole, setDemoRole] = useState<Role>("admin"),
    [view, setView] = useState<AppView>("overview"),
    [mobileNav, setMobileNav] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() =>
      localDay(new Date(), initialData.school?.timezone),
    ),
    [groupFilter, setGroupFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [statusFilter, setStatusFilter] = useState("all");
  const [selectedLesson, setSelectedLesson] = useState(""),
    [selectedStudents, setSelectedStudents] = useState<string[]>([]),
    [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");
  const [adultApprovals, setAdultApprovals] = useState<string[]>([]);
  const [working, setWorking] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [networkError, setNetworkError] = useState(""),
    [lastUpdate, setLastUpdate] = useState<Date | null>(null),
    [toast, setToast] = useState<{ message: string; error?: boolean } | null>(
      null,
    );
  const [dialog, setDialog] = useState<Dialog>(null),
    [editingStudent, setEditingStudent] = useState<Student | null>(null),
    [selectedIncident, setSelectedIncident] = useState(""),
    [resolveMode, setResolveMode] = useState<"resolve" | "cancel">("resolve");
  const [helpLocation, setHelpLocation] = useState(""),
    [inviteRole, setInviteRole] = useState<Role>("teacher"),
    [generatedLink, setGeneratedLink] = useState(""),
    [importRows, setImportRows] = useState<
      { full_name: string; group_id: string }[]
    >([]),
    [importErrors, setImportErrors] = useState<string[]>([]),
    [importProgress, setImportProgress] = useState("");
  const [qrImage, setQrImage] = useState(""),
    [qrLessonId, setQrLessonId] = useState(""),
    [qrRemaining, setQrRemaining] = useState(60);
  const pendingSignal = useRef<Record<string, unknown> | null>(null);
  const t = copy[locale];
  const data = mode === "demo" ? demoForRole(base, demoRole) : base;
  const timezone = data.school?.timezone || "Asia/Almaty";
  const isAdmin = data.role === "admin",
    isTeacher = data.role === "teacher",
    isStaff = ["admin", "teacher", "security"].includes(data.role),
    canJournal = isAdmin || isTeacher;
  const isFamily = data.role === "student" || data.role === "guardian";
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale === "kk" ? "kk-KZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(value));
  const dateText = (value: string | Date) =>
    new Intl.DateTimeFormat(locale === "kk" ? "kk-KZ" : "ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: timezone,
    }).format(new Date(value));
  const closeDialog = useCallback(() => {
    setDialog(null);
    setGeneratedLink("");
  }, []);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const changeBase = useCallback(
    (newData: WorkspaceData) => {
      baseRef.current = newData;
      setBase(newData);
      if (mode === "demo") {
        try {
          localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(newData));
        } catch {}
      }
    },
    [mode],
  );
  useEffect(() => {
    if (mode === "demo") {
      try {
        const raw = localStorage.getItem(DEMO_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as WorkspaceData;
          if (
            saved.mode === "demo" &&
            saved.school &&
            Array.isArray(saved.students) &&
            Array.isArray(saved.incidents) &&
            saved.lessons.some(
              (l) => localDay(l.starts_at) === localDay(new Date()),
            )
          ) {
            baseRef.current = saved;
            setBase(saved);
          }
        }
      } catch {}
    }
    try {
      const lang = localStorage.getItem("edusafe-language");
      if (lang === "ru" || lang === "kk") setLocale(lang);
    } catch {}
    setLastUpdate(new Date());
  }, [mode]);
  useEffect(() => {
    try {
      localStorage.setItem("edusafe-language", locale);
    } catch {}
  }, [locale]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const reload = useCallback(async () => {
    if (mode === "demo") {
      setLastUpdate(new Date());
      return;
    }
    setRefreshing(true);
    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось обновить данные");
      changeBase(result);
      setLastUpdate(new Date());
      setNetworkError("");
    } catch (e) {
      setNetworkError(e instanceof Error ? e.message : "Нет связи с сервером");
    } finally {
      setRefreshing(false);
    }
  }, [mode, changeBase]);
  useEffect(() => {
    if (mode === "demo") return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void reload();
      },
      view === "incidents" ? 5000 : 20000,
    );
    return () => clearInterval(timer);
  }, [mode, reload, view]);
  const requestAction = async (
    action: string,
    payload: Record<string, unknown>,
  ) => {
    if (mode === "demo") {
      const result = demoAction(baseRef.current, action, payload, demoRole);
      changeBase(result.data);
      setLastUpdate(new Date());
      return result.result;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-EduSafe-Client": "web",
        },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Не удалось выполнить действие");
      return result.data || { ok: true };
    } catch (e) {
      if (
        action === "create_incident" &&
        (e instanceof TypeError ||
          (e instanceof Error && e.name === "AbortError"))
      ) {
        const checkController = new AbortController();
        const checkTimer = setTimeout(() => checkController.abort(), 5000);
        try {
          const found = await fetch("/api/actions", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-EduSafe-Client": "web",
            },
            body: JSON.stringify({
              action: "incident_status",
              payload: { idempotency_key: payload.idempotency_key },
            }),
            signal: checkController.signal,
          });
          const state = await found.json();
          if (found.ok && state.data?.id) return state.data;
        } catch {
        } finally {
          clearTimeout(checkTimer);
        }
        throw new Error(
          "Подтверждение сервера не получено. Обновите журнал; повторное нажатие использует тот же номер запроса.",
        );
      }
      if (e instanceof Error && e.name === "AbortError")
        throw new Error(
          "Сервер не ответил вовремя. Проверьте результат перед повтором.",
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  const act = async (
    action: string,
    payload: Record<string, unknown>,
    message?: string,
  ) => {
    if (working) return null;
    setWorking(action);
    try {
      const result = await requestAction(action, payload);
      if (mode === "live") await reload();
      notify(message || t.actionSuccess);
      return result;
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
        true,
      );
      return null;
    } finally {
      setWorking("");
    }
  };
  const submit = async (
    e: FormEvent<HTMLFormElement>,
    action: string,
    transform?: (p: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    const result = await act(action, transform ? transform(values) : values);
    if (result) closeDialog();
  };
  const navigate = (next: AppView) => {
    setView(next);
    setMobileNav(false);
    setSearch("");
    setStatusFilter("all");
  };
  const activeIncidents = data.incidents.filter(
    (i) => i.status === "new" || i.status === "acknowledged",
  );
  const dayLessons = useMemo(
    () =>
      data.lessons
        .filter((l) => localDay(l.starts_at, timezone) === selectedDate)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [data.lessons, selectedDate, timezone],
  );
  const filteredLessons = dayLessons.filter(
    (l) => groupFilter === "all" || l.group_id === groupFilter,
  );
  const lesson =
    filteredLessons.find((l) => l.id === selectedLesson) ||
    filteredLessons.find((l) => l.status !== "cancelled") ||
    filteredLessons[0];
  const groupName = (id: string) =>
    data.groups.find((g) => g.id === id)?.name || "—";
  const locationName = (id: string | null) =>
    data.locations.find((l) => l.id === id)?.name || "Не уточнён";
  const memberName = (id: string | null) =>
    data.teammates.find((m) => m.user_id === id)?.full_name || "Сотрудник";
  const roster = data.students.filter(
    (s) =>
      s.active &&
      s.group_id === lesson?.group_id &&
      s.full_name.toLowerCase().includes(search.toLowerCase()),
  );
  const firstLessonByGroup = new Map<string, Lesson>();
  for (const l of dayLessons)
    if (l.status !== "cancelled" && !firstLessonByGroup.has(l.group_id))
      firstLessonByGroup.set(l.group_id, l);
  const dailyStudents = data.students.filter(
    (s) =>
      s.active &&
      firstLessonByGroup.has(s.group_id) &&
      (groupFilter === "all" || s.group_id === groupFilter),
  );
  const dailyRows = dailyStudents.map((s) => {
    const record = data.attendance.find(
      (a) =>
        a.lesson_id === firstLessonByGroup.get(s.group_id)?.id &&
        a.student_id === s.id,
    );
    return {
      student: s,
      status: record?.status || ("unconfirmed" as AttendanceStatus),
      record,
    };
  });
  const counts = Object.fromEntries(
    statuses.map((s) => [s, dailyRows.filter((r) => r.status === s).length]),
  ) as Record<AttendanceStatus, number>;
  const presentCount = counts.present + counts.late;
  const percent = dailyRows.length
    ? Math.round((presentCount / dailyRows.length) * 100)
    : 0;
  const filteredRoster = roster.filter(
    (s) =>
      statusFilter === "all" ||
      (data.attendance.find(
        (a) => a.lesson_id === lesson?.id && a.student_id === s.id,
      )?.status || "unconfirmed") === statusFilter,
  );
  const selectedEvent = data.incidents.find((i) => i.id === selectedIncident);
  const filteredStudents = data.students.filter(
    (s) =>
      (groupFilter === "all" || s.group_id === groupFilter) &&
      (s.full_name.toLowerCase().includes(search.toLowerCase()) ||
        groupName(s.group_id).toLowerCase().includes(search.toLowerCase())),
  );
  const navItems: AppView[] = isFamily
    ? ["overview", "attendance", "schedule", "notifications", "settings"]
    : data.role === "security"
      ? ["overview", "incidents", "notifications", "settings"]
      : [
          "overview",
          "attendance",
          "students",
          "schedule",
          "incidents",
          "notifications",
          "settings",
        ];
  const showQR = (lessonId: string) => {
    if (mode === "demo") {
      setQrLessonId(lessonId);
      setDialog("qrDemo");
    } else window.open(`/qr/${lessonId}`, "_blank", "noopener,noreferrer");
  };
  const emergency = async () => {
    if (!pendingSignal.current)
      pendingSignal.current = {
        location_id: helpLocation || undefined,
        kind: "help",
        details: "Нужна помощь сотрудника",
        is_drill: mode === "demo",
        idempotency_key: crypto.randomUUID(),
      };
    const result = await act(
      "create_incident",
      pendingSignal.current,
      mode === "demo"
        ? "Учебный сигнал зарегистрирован"
        : "Сервер зарегистрировал сигнал. Ожидаем подтверждения сотрудника.",
    );
    if (result) {
      pendingSignal.current = null;
      setSelectedIncident(String(result.id));
      navigate("incidents");
    }
  };
  const exportAttendance = () => {
    if (!lesson) return;
    exportCsv(
      ["Ученик", "Класс", "Занятие", "Дата", "Статус", "Источник"],
      roster.map((s) => {
        const a = data.attendance.find(
          (r) => r.student_id === s.id && r.lesson_id === lesson.id,
        );
        return [
          s.full_name,
          groupName(s.group_id),
          lesson.title,
          selectedDate,
          t[a?.status || "unconfirmed"],
          a?.confirmed_by
            ? t.teacherCheck
            : data.checkIns.some(
                  (c) => c.student_id === s.id && c.lesson_id === lesson.id,
                )
              ? t.selfCheck
              : t.noCheck,
        ];
      }),
      `EduSafe-attendance-${selectedDate}.csv`,
    );
  };
  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(locale === "kk" ? "Көшірілді" : "Скопировано");
    } catch {
      notify(
        "Не удалось скопировать. Выделите текст и скопируйте вручную.",
        true,
      );
    }
  };
  const readImport = async (file: File | undefined) => {
    setImportRows([]);
    setImportErrors([]);
    if (!file) return;
    if (file.size > 2_000_000) {
      setImportErrors(["Файл должен быть меньше 2 МБ"]);
      return;
    }
    const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
    if (rows.length < 2) {
      setImportErrors(["Нужны заголовки и хотя бы одна строка"]);
      return;
    }
    const header = rows[0].map((s) => s.toLowerCase());
    let nameIndex = header.findIndex((h) =>
        ["full_name", "фио", "имя", "аты-жөні"].includes(h),
      ),
      groupIndex = header.findIndex((h) =>
        ["group", "group_name", "класс", "группа", "сынып"].includes(h),
      );
    if (nameIndex < 0 || groupIndex < 0) {
      setImportErrors([
        "Заголовки должны включать full_name и group (или ФИО и Класс).",
      ]);
      return;
    }
    const errors: string[] = [],
      parsed: { full_name: string; group_id: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const name = rows[i][nameIndex]?.trim(),
        group = base.groups.find(
          (g) => g.name.toLowerCase() === rows[i][groupIndex]?.toLowerCase(),
        );
      if (!name || !group) {
        errors.push(
          `Строка ${i + 1}: ${!name ? "не указано имя" : "класс не найден. Сначала создайте его в настройках"}`,
        );
        continue;
      }
      parsed.push({ full_name: name, group_id: group.id });
    }
    if (parsed.length > 200)
      errors.push("За один импорт можно добавить не более 200 учеников");
    setImportRows(parsed.slice(0, 200));
    setImportErrors(errors);
  };
  const importStudents = async () => {
    if (!importRows.length || importErrors.length) return;
    setWorking("import");
    let done = 0;
    try {
      for (const row of importRows) {
        await requestAction("create_student", row);
        done++;
        setImportProgress(`${done} / ${importRows.length}`);
      }
      if (mode === "live") await reload();
      notify(`Добавлено учеников: ${done}`);
      closeDialog();
    } catch (e) {
      notify(
        `Добавлено ${done}. ${e instanceof Error ? e.message : "Ошибка импорта"}`,
        true,
      );
      setImportRows((prev) => prev.slice(done));
      if (mode === "live") await reload();
    } finally {
      setWorking("");
      setImportProgress("");
    }
  };
  const resetDemo = () => {
    const fresh = createDemoData();
    changeBase(fresh);
    setDemoRole("admin");
    setSelectedDate(localDay(new Date()));
    setView("overview");
    notify("Демонстрация обновлена");
  };

  useEffect(() => {
    if (dialog !== "qrDemo") return;
    let expiry = Date.now() + 60000;
    let alive = true;
    const generate = async () => {
      expiry = Date.now() + 60000;
      const value = JSON.stringify({
        application: "EduSafe",
        mode: "local-demo",
        lesson_id: qrLessonId,
        expires_at: new Date(expiry).toISOString(),
        nonce: crypto.randomUUID(),
      });
      const image = await QRCode.toDataURL(value, {
        width: 400,
        margin: 2,
        color: { dark: "#142e2a", light: "#ffffff" },
      });
      if (alive) setQrImage(image);
    };
    void generate();
    const rotation = setInterval(() => void generate(), 30000);
    const counter = setInterval(
      () =>
        setQrRemaining(Math.max(0, Math.round((expiry - Date.now()) / 1000))),
      1000,
    );
    return () => {
      alive = false;
      clearInterval(rotation);
      clearInterval(counter);
    };
  }, [dialog, qrLessonId]);
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="sidebar-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand light />
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNav(false)}
            aria-label="Закрыть меню"
          >
            <X size={20} />
          </button>
        </div>
        <div className="school-switch">
          <span className="school-square">
            <Building2 size={20} />
          </span>
          <span>
            <strong>{data.school?.name || "EduSafe"}</strong>
            <small>{locale === "kk" ? "Оқу орны" : "Учебное заведение"}</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-section-label">{t.workspace}</div>
        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            const Icon = icons[item];
            return (
              <button
                key={item}
                onClick={() => navigate(item)}
                className={`nav-item ${view === item ? "active" : ""} ${i === 4 ? "nav-item-separated" : ""}`}
              >
                <Icon size={19} />
                <span>{t[item]}</span>
                {item === "incidents" && activeIncidents.length > 0 ? (
                  <b>{activeIncidents.length}</b>
                ) : item === "notifications" &&
                  data.notifications.some((n) => n.status === "failed") ? (
                  <i className="nav-alert-dot" />
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <span className="sidebar-help-icon">
              <ShieldCheck size={20} />
            </span>
            <h4>
              {locale === "kk" ? "Әр оқушы маңызды" : "Каждый ученик важен"}
            </h4>
            <p>
              {locale === "kk"
                ? "Күнделікті қамқорлыққа арналған шағын құралдар."
                : "Небольшие инструменты для ежедневной заботы."}
            </p>
            <a href="/#how">
              {locale === "kk" ? "EduSafe туралы" : "Как устроен EduSafe"}
              <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="user-card">
            <Avatar name={data.profile.full_name || "Пользователь"} size="md" />
            <div>
              <strong>{data.profile.full_name || "Пользователь"}</strong>
              <span>{t[data.role]}</span>
            </div>
            {mode === "live" ? (
              <button
                className="icon-button"
                title={t.logout}
                aria-label={t.logout}
                onClick={async () => {
                  try {
                    const r = await fetch("/api/auth", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "logout" }),
                    });
                    if (!r.ok) throw new Error("Не удалось выйти");
                    window.location.assign("/login");
                  } catch (e) {
                    notify(
                      e instanceof Error ? e.message : "Ошибка выхода",
                      true,
                    );
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            ) : (
              <a href="/" className="icon-button" title="Главная">
                <LogOut size={17} />
              </a>
            )}
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="app-topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span>{t.workspace}</span>
            <ChevronRight size={13} />
            <strong>{t[view]}</strong>
          </div>
          <div className="topbar-right">
            <div className="language-switch" aria-label="Язык интерфейса">
              <button
                onClick={() => setLocale("ru")}
                className={locale === "ru" ? "active" : ""}
              >
                RU
              </button>
              <button
                onClick={() => setLocale("kk")}
                className={locale === "kk" ? "active" : ""}
              >
                ҚАЗ
              </button>
            </div>
            <span className="topbar-divider" />
            <button
              className="icon-button notification-bell"
              aria-label={t.notifications}
              onClick={() => navigate("notifications")}
            >
              <Bell size={19} />
              {data.notifications.some((n) => n.status === "failed") && <i />}
            </button>
            <Avatar name={data.profile.full_name} size="sm" />
          </div>
        </header>
        {mode === "demo" && (
          <div className="demo-banner">
            <span>
              <span className="demo-badge">{t.demo}</span>
              <span>{t.demoDescription}</span>
            </span>
            <div>
              <select
                aria-label="Роль в демонстрации"
                value={demoRole}
                onChange={(e) => {
                  setDemoRole(e.target.value as Role);
                  setView("overview");
                  setSearch("");
                  setGroupFilter("all");
                }}
              >
                {(
                  [
                    "admin",
                    "teacher",
                    "security",
                    "student",
                    "guardian",
                  ] as Role[]
                ).map((role) => (
                  <option key={role} value={role}>
                    {t[role]}
                  </option>
                ))}
              </select>
              <button onClick={resetDemo} title={t.resetDemo}>
                <RefreshCw size={14} />
                <span>{t.resetDemo}</span>
              </button>
              <a href="/login">
                {t.login}
                <ArrowUpRight size={13} />
              </a>
            </div>
          </div>
        )}
        {networkError && (
          <div className="connection-banner" role="alert">
            <WifiOff size={17} />
            <span>{networkError}. Показаны последние загруженные данные.</span>
            <button onClick={() => void reload()}>Повторить</button>
          </div>
        )}
        <main className="workspace-content">
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {view === "overview"
                  ? `${t.schoolDay} / ${dateText(new Date(selectedDate + "T12:00:00+05:00"))}`
                  : t.workspace}
              </div>
              <h1>
                {view === "overview"
                  ? isFamily
                    ? data.role === "guardian"
                      ? t.childStatus
                      : locale === "kk"
                        ? "Менің оқу күнім"
                        : "Мой учебный день"
                    : data.role === "security"
                      ? locale === "kk"
                        ? "Жағдай бақылауда"
                        : "Ситуация под контролем"
                      : `${locale === "kk" ? "Сәлем" : "Здравствуйте"}, ${data.profile.full_name.split(" ")[0] || ""}`
                  : t[view]}
                {view === "overview" &&
                  !isFamily &&
                  data.role !== "security" && (
                    <span className="greeting-sun" aria-hidden="true">
                      ✳
                    </span>
                  )}
              </h1>
              <p>
                {view === "overview"
                  ? t.overviewDescription
                  : view === "attendance"
                    ? t.attendanceDescription
                    : view === "students"
                      ? t.studentsDescription
                      : view === "schedule"
                        ? t.scheduleDescription
                        : view === "incidents"
                          ? t.incidentsDescription
                          : view === "notifications"
                            ? t.notificationsDescription
                            : t.settingsDescription}
              </p>
            </div>
            <div className="page-heading-actions">
              {["overview", "attendance", "schedule"].includes(view) &&
                data.role !== "security" && (
                  <label className="date-control">
                    <CalendarDays size={16} />
                    <input
                      type="date"
                      aria-label={t.date}
                      value={selectedDate}
                      onChange={(e) => {
                        setSelectedDate(
                          e.target.value || localDay(new Date(), timezone),
                        );
                        setSelectedLesson("");
                        setSelectedStudents([]);
                      }}
                    />
                  </label>
                )}
              {view === "students" && isAdmin && (
                <button
                  className="button button-primary"
                  onClick={() => {
                    setEditingStudent(null);
                    setDialog("student");
                  }}
                >
                  <Plus size={17} />
                  {t.createStudent}
                </button>
              )}
              {view === "schedule" && isAdmin && (
                <button
                  className="button button-primary"
                  onClick={() => setDialog("lesson")}
                >
                  <Plus size={17} />
                  {t.createLesson}
                </button>
              )}
              {view === "incidents" && isStaff && (
                <button
                  className="button button-primary"
                  onClick={() => setDialog("signal")}
                >
                  <Plus size={17} />
                  {t.newSignal}
                </button>
              )}
            </div>
          </div>
          {isStaff && data.role !== "security" && (
            <div className="quick-safety-bar">
              <div>
                <span className="safety-bar-icon">
                  <ShieldCheck size={19} />
                </span>
                <strong>
                  {locale === "kk"
                    ? "Көмек әрдайым жақын"
                    : "Помощь всегда под рукой"}
                </strong>
                <span className="safety-subtext">
                  {locale === "kk"
                    ? "Кабинетіңізді таңдаңыз"
                    : "Укажите ваш кабинет"}
                </span>
              </div>
              <div>
                <label className="room-select">
                  <MapPin size={15} />
                  <select
                    aria-label="Кабинет для вызова помощи"
                    value={helpLocation}
                    onChange={(e) => setHelpLocation(e.target.value)}
                  >
                    <option value="">
                      {locale === "kk" ? "Кабинет таңдау" : "Выбрать кабинет"}
                    </option>
                    {data.locations.map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-help"
                  disabled={!!working}
                  onClick={() => void emergency()}
                >
                  {working === "create_incident" ? (
                    <Spinner />
                  ) : (
                    <Siren size={16} />
                  )}
                  <span>{t.help}</span>
                </button>
              </div>
            </div>
          )}
          {view === "overview" && (
            <>
              {data.role !== "security" && (
                <div className="metric-grid">
                  <Metric
                    label={locale === "kk" ? "Оқушылар" : "Ученики на занятиях"}
                    value={dailyRows.length}
                    icon={<Users size={21} />}
                    footer={`${new Set(dailyStudents.map((s) => s.group_id)).size} ${locale === "kk" ? "сынып / топ" : "класса / группы"}`}
                    tone="neutral"
                  />
                  <Metric
                    label={
                      locale === "kk"
                        ? "Қатысу расталды"
                        : "Присутствие подтверждено"
                    }
                    value={presentCount}
                    icon={<CheckCircle2 size={21} />}
                    footer={`${percent}% ${locale === "kk" ? "оқушылар" : "учеников"}`}
                    tone="green"
                    tag={
                      counts.late
                        ? `${counts.late} ${locale === "kk" ? "кешікті" : "с опозданием"}`
                        : undefined
                    }
                  />
                  <Metric
                    label={
                      locale === "kk" ? "Қатыспады" : "Отсутствие подтверждено"
                    }
                    value={counts.absent + counts.excused}
                    icon={<UserRound size={21} />}
                    footer={`${counts.excused} ${locale === "kk" ? "себепті" : "по уважительной причине"}`}
                    tone="red"
                  />
                  <Metric
                    label={
                      locale === "kk"
                        ? "Растау күтілуде"
                        : "Ожидают подтверждения"
                    }
                    value={counts.unconfirmed}
                    icon={<Clock3 size={21} />}
                    footer={
                      locale === "kk"
                        ? "Мұғалім нақтылайды"
                        : "Уточняется преподавателем"
                    }
                    tone="amber"
                  />
                </div>
              )}
              {data.role === "student" && (
                <div className="student-checkin-card">
                  <div className="student-qr-icon">
                    <QrCode size={42} />
                  </div>
                  <div>
                    <h2>
                      {locale === "kk"
                        ? "Сабаққа келгеніңізді белгілеңіз"
                        : "Отметьтесь на занятии"}
                    </h2>
                    <p>
                      {locale === "kk"
                        ? "Кабинеттегі QR кодты сканерлеңіз. Қатысуды мұғалім растайды."
                        : "Отсканируйте QR в кабинете. Присутствие подтвердит преподаватель."}
                    </p>
                  </div>
                  {mode === "demo" ? (
                    <button
                      className="button button-primary"
                      onClick={() => setDialog("demoScan")}
                    >
                      <QrCode size={17} />
                      {t.scan}
                    </button>
                  ) : (
                    <a href="/check-in" className="button button-primary">
                      <QrCode size={17} />
                      {t.scan}
                    </a>
                  )}
                </div>
              )}
              {isFamily && (
                <div className="panel">
                  <PanelTitle
                    title={
                      locale === "kk" ? "Қатысу жағдайы" : "Статус посещаемости"
                    }
                    subtitle={
                      locale === "kk"
                        ? "Таңдалған күннің алғашқы сабағы"
                        : "Первое занятие выбранного дня"
                    }
                    actions={
                      <button
                        className="button button-outline button-sm"
                        onClick={() => setDialog("absence")}
                      >
                        <Plus size={15} />
                        {t.reportAbsence}
                      </button>
                    }
                  />
                  <div className="family-status-list">
                    {dailyRows.length ? (
                      dailyRows.map(({ student, status, record }, i) => (
                        <div key={student.id}>
                          <Avatar
                            name={student.full_name}
                            size="md"
                            index={i}
                          />
                          <span>
                            <strong>{student.full_name}</strong>
                            <small>
                              {groupName(student.group_id)} ·{" "}
                              {firstLessonByGroup.get(student.group_id)?.title}
                            </small>
                          </span>
                          <Badge tone={statusTone[status]}>{t[status]}</Badge>
                          <small>
                            {record?.confirmed_at
                              ? time(record.confirmed_at)
                              : "—"}
                          </small>
                        </div>
                      ))
                    ) : (
                      <Empty
                        title={t.empty}
                        description="На выбранную дату занятий пока нет."
                      />
                    )}
                  </div>
                </div>
              )}
              <div
                className={`overview-grid ${data.role === "security" ? "security-overview" : ""}`}
              >
                {!isFamily && data.role !== "security" && (
                  <div className="panel attendance-chart-panel">
                    <PanelTitle
                      title={t.attendanceByGroup}
                      subtitle={
                        locale === "kk"
                          ? "Алғашқы сабақ бойынша"
                          : "По первому занятию выбранного дня"
                      }
                      actions={
                        <button
                          className="icon-button"
                          title={t.attendance}
                          onClick={() => navigate("attendance")}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      }
                    />
                    {dailyRows.length ? (
                      <>
                        <div className="chart-legend">
                          <span>
                            <i className="dot-green" />
                            {locale === "kk" ? "Қатысты" : "Присутствуют"}
                          </span>
                          <span>
                            <i className="dot-amber" />
                            {locale === "kk" ? "Кешікті" : "Опоздали"}
                          </span>
                          <span>
                            <i className="dot-red" />
                            {locale === "kk" ? "Қатыспады" : "Отсутствуют"}
                          </span>
                          <span>
                            <i className="dot-neutral" />
                            {locale === "kk" ? "Күтілуде" : "Ожидаются"}
                          </span>
                        </div>
                        <div className="group-bars">
                          {data.groups
                            .filter((g) => firstLessonByGroup.has(g.id))
                            .map((g) => {
                              const rows = dailyRows.filter(
                                (r) => r.student.group_id === g.id,
                              );
                              if (!rows.length) return null;
                              return (
                                <div className="group-bar-row" key={g.id}>
                                  <span>{g.name}</span>
                                  <div
                                    className="stacked-bar"
                                    aria-label={`${g.name}: ${rows.filter((r) => r.status === "present" || r.status === "late").length} из ${rows.length} присутствуют`}
                                  >
                                    {statuses.map((s) => {
                                      const count = rows.filter(
                                        (r) => r.status === s,
                                      ).length;
                                      return count ? (
                                        <div
                                          key={s}
                                          title={`${t[s]}: ${count}`}
                                          className={`bar-${s}`}
                                          style={{
                                            width: `${(count / rows.length) * 100}%`,
                                          }}
                                        >
                                          {count > 1 ? count : ""}
                                        </div>
                                      ) : null;
                                    })}
                                  </div>
                                  <strong>
                                    {
                                      rows.filter((r) =>
                                        ["present", "late"].includes(r.status),
                                      ).length
                                    }
                                    <small>/{rows.length}</small>
                                  </strong>
                                </div>
                              );
                            })}
                        </div>
                        <div className="chart-summary">
                          <span>
                            <span className="live-dot" />
                            {locale === "kk"
                              ? "Мұғалім растаған деректер"
                              : "Данные с подтверждением преподавателя"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => navigate("attendance")}
                          >
                            {t.openJournal}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <Empty
                        title="Сводка появится после добавления занятий"
                        description="Добавьте группу, учеников и расписание."
                      />
                    )}
                  </div>
                )}
                <div className="panel signals-preview">
                  <PanelTitle
                    title={t.activeSignals}
                    actions={
                      <span
                        className={`count-label ${activeIncidents.length ? "amber" : ""}`}
                      >
                        {activeIncidents.length}
                      </span>
                    }
                  />
                  {activeIncidents.length ? (
                    <div className="signal-preview-list">
                      {activeIncidents.slice(0, 3).map((incident) => (
                        <button
                          className="signal-preview"
                          key={incident.id}
                          onClick={() => {
                            setSelectedIncident(incident.id);
                            setDialog("incidentDetail");
                          }}
                        >
                          <span
                            className={`signal-icon ${incident.status === "new" ? "red" : "amber"}`}
                          >
                            <ShieldCheck size={20} />
                          </span>
                          <div>
                            <strong>
                              {incident.is_drill
                                ? "Учебный сигнал"
                                : incidentNames[incident.kind]}
                            </strong>
                            <span>
                              <MapPin size={12} />
                              {locationName(incident.location_id)} ·{" "}
                              {time(incident.created_at)}
                            </span>
                            <Badge
                              tone={incident.status === "new" ? "red" : "amber"}
                            >
                              {t[incident.status]}
                            </Badge>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="all-calm">
                      <span>
                        <ShieldCheck size={35} />
                      </span>
                      <h3>
                        {locale === "kk"
                          ? "Белсенді сигнал жоқ"
                          : "Активных сигналов нет"}
                      </h3>
                      <p>
                        {locale === "kk"
                          ? "Жаңа өтініштер осы жерде пайда болады."
                          : "Новые обращения появятся здесь."}
                      </p>
                    </div>
                  )}
                  {isStaff && (
                    <button
                      className="panel-bottom-link"
                      onClick={() => navigate("incidents")}
                    >
                      {locale === "kk"
                        ? "Сигналдар журналы"
                        : "Журнал сигналов"}
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
              {data.role !== "security" && (
                <div className="panel schedule-panel">
                  <PanelTitle
                    title={
                      locale === "kk" ? "Күннің сабақтары" : "Занятия на день"
                    }
                    subtitle={`${dayLessons.filter((l) => l.status !== "cancelled").length} ${locale === "kk" ? "сабақ" : "занятий в расписании"}`}
                    actions={
                      <button
                        className="text-button"
                        onClick={() => navigate("schedule")}
                      >
                        {t.viewAll}
                        <ArrowRight size={15} />
                      </button>
                    }
                  />
                  {dayLessons.length ? (
                    <div className="lesson-cards">
                      {dayLessons
                        .filter((l) => l.status !== "cancelled")
                        .slice(0, 4)
                        .map((l, i) => (
                          <div className="lesson-card" key={l.id}>
                            <div className="lesson-card-top">
                              <span className={`subject-icon subject-${i % 4}`}>
                                <GraduationCap size={20} />
                              </span>
                              <span>
                                {time(l.starts_at)} — {time(l.ends_at)}
                              </span>
                            </div>
                            <h3>{l.title}</h3>
                            <div className="lesson-meta">
                              <span>
                                <Users size={13} />
                                {groupName(l.group_id)}
                              </span>
                              <span>
                                <MapPin size={13} />
                                {locationName(l.location_id)}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedLesson(l.id);
                                navigate("attendance");
                              }}
                            >
                              {isFamily ? "Моя посещаемость" : t.openJournal}
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      title="На этот день занятий нет"
                      description="Выберите другую дату или добавьте занятие."
                    />
                  )}
                </div>
              )}
              {!isFamily && (
                <div className="panel activity-panel">
                  <PanelTitle
                    title={
                      locale === "kk" ? "Соңғы әрекеттер" : "Последние действия"
                    }
                    subtitle={
                      locale === "kk"
                        ? "Өзгерістер тарихы"
                        : "История изменений в организации"
                    }
                  />
                  {data.audit.length ? (
                    <div className="activity-list">
                      {data.audit.slice(0, 5).map((a) => (
                        <div key={a.id}>
                          <span className="activity-dot">
                            <Check size={13} />
                          </span>
                          <div>
                            <strong>
                              {auditNames[a.action] ||
                                a.action.replaceAll("_", " ")}
                            </strong>
                            <small>{memberName(a.actor_id)}</small>
                          </div>
                          <time>{time(a.created_at)}</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="История пока пуста"
                      description="Подтверждения посещаемости и другие изменения появятся здесь."
                    />
                  )}
                </div>
              )}
              {isAdmin && data.students.length === 0 && (
                <div className="getting-started">
                  <GraduationCap size={32} />
                  <div>
                    <h3>Добавьте первые данные</h3>
                    <p>
                      Создайте классы и учеников или заполните пустую
                      организацию вымышленными учебными данными.
                    </p>
                  </div>
                  <button
                    className="button button-outline"
                    disabled={!!working}
                    onClick={() =>
                      void act("seed_demo", {}, "Учебные данные добавлены")
                    }
                  >
                    {working === "seed_demo" ? <Spinner /> : <Plus size={16} />}
                    Учебные данные
                  </button>
                </div>
              )}
            </>
          )}
          {view === "attendance" && (
            <>
              <div className="panel">
                <div className="filter-toolbar">
                  <div className="toolbar-filters">
                    <label className="select-control">
                      <Users size={15} />
                      <select
                        aria-label={t.group}
                        value={groupFilter}
                        onChange={(e) => {
                          setGroupFilter(e.target.value);
                          setSelectedLesson("");
                          setSelectedStudents([]);
                        }}
                      >
                        <option value="all">
                          {locale === "kk" ? "Барлық сыныптар" : "Все классы"}
                        </option>
                        {data.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="select-control lesson-select">
                      <GraduationCap size={15} />
                      <select
                        aria-label={t.lesson}
                        value={lesson?.id || ""}
                        onChange={(e) => {
                          setSelectedLesson(e.target.value);
                          setSelectedStudents([]);
                        }}
                      >
                        {!filteredLessons.length && (
                          <option value="">{t.selectLesson}</option>
                        )}
                        {filteredLessons.map((l) => (
                          <option key={l.id} value={l.id}>
                            {time(l.starts_at)} · {l.title} ·{" "}
                            {groupName(l.group_id)}
                            {l.status === "cancelled" ? " (отменено)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="toolbar-actions">
                    {canJournal && lesson && (
                      <button
                        className="button button-primary button-sm"
                        onClick={() => showQR(lesson.id)}
                      >
                        <QrCode size={16} />
                        {t.createQR}
                      </button>
                    )}
                    <button
                      className="button button-outline button-sm"
                      disabled={!lesson}
                      onClick={exportAttendance}
                    >
                      <ArrowDownToLine size={16} />
                      <span>{t.export}</span>
                    </button>
                  </div>
                </div>
                {lesson && (
                  <div className="journal-summary">
                    <div>
                      <span className="subject-icon subject-0">
                        <GraduationCap size={23} />
                      </span>
                      <div>
                        <h3>
                          {lesson.title}
                          <Badge
                            tone={
                              lesson.status === "cancelled" ? "red" : "neutral"
                            }
                            dot={false}
                          >
                            {groupName(lesson.group_id)}
                          </Badge>
                        </h3>
                        <p>
                          {time(lesson.starts_at)} — {time(lesson.ends_at)}{" "}
                          <span>·</span> Кабинет{" "}
                          {locationName(lesson.location_id)} <span>·</span>{" "}
                          {memberName(lesson.teacher_id)}
                        </p>
                      </div>
                    </div>
                    <div className="journal-confirmed">
                      <strong>
                        {
                          roster.filter((s) =>
                            data.attendance.some(
                              (a) =>
                                a.student_id === s.id &&
                                a.lesson_id === lesson.id &&
                                ["present", "late"].includes(a.status),
                            ),
                          ).length
                        }
                        <span>/{roster.length}</span>
                      </strong>
                      <small>
                        {locale === "kk"
                          ? "қатысу расталды"
                          : "присутствие подтверждено"}
                      </small>
                    </div>
                  </div>
                )}
                <div className="table-toolbar">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      placeholder={t.search}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label={t.search}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Очистить поиск"
                        onClick={() => setSearch("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <label className="select-control">
                    <ListFilter size={15} />
                    <select
                      aria-label="Фильтр статуса"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">
                        {locale === "kk" ? "Барлық күйлер" : "Все статусы"}
                      </option>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {t[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedStudents.length > 0 && canJournal && (
                  <div className="bulk-toolbar">
                    <span>
                      <CheckCheck size={17} />
                      {t.selected}: <strong>{selectedStudents.length}</strong>
                    </span>
                    <div>
                      <select
                        value={bulkStatus}
                        onChange={(e) =>
                          setBulkStatus(e.target.value as AttendanceStatus)
                        }
                        aria-label="Новый статус выбранных учеников"
                      >
                        {statuses.map((s) => (
                          <option value={s} key={s}>
                            {t[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!!working}
                        className="button button-primary button-sm"
                        onClick={async () => {
                          const r = await act("record_attendance", {
                            lesson_id: lesson?.id,
                            student_ids: selectedStudents,
                            status: bulkStatus,
                            expected_versions: Object.fromEntries(
                              selectedStudents.map((id) => [
                                id,
                                data.attendance.find(
                                  (a) =>
                                    a.student_id === id &&
                                    a.lesson_id === lesson?.id,
                                )?.version || 0,
                              ]),
                            ),
                          });
                          if (r) setSelectedStudents([]);
                        }}
                      >
                        {working === "record_attendance" ? (
                          <Spinner />
                        ) : (
                          <Check size={15} />
                        )}{" "}
                        {t.confirmSelected}
                      </button>
                      <button
                        className="icon-button"
                        title="Снять выбор"
                        onClick={() => setSelectedStudents([])}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                )}
                {filteredRoster.length ? (
                  <div className="table-scroll">
                    <table className="data-table attendance-table">
                      <thead>
                        <tr>
                          {canJournal && (
                            <th className="checkbox-cell">
                              <input
                                type="checkbox"
                                aria-label="Выбрать всех учеников"
                                checked={
                                  filteredRoster.length > 0 &&
                                  filteredRoster.every((s) =>
                                    selectedStudents.includes(s.id),
                                  )
                                }
                                onChange={(e) =>
                                  setSelectedStudents(
                                    e.target.checked
                                      ? filteredRoster.map((s) => s.id)
                                      : [],
                                  )
                                }
                              />
                            </th>
                          )}
                          <th>{locale === "kk" ? "Оқушы" : "Ученик"}</th>
                          <th>{t.selfCheck}</th>
                          <th>{t.status}</th>
                          <th>
                            {locale === "kk" ? "Растау" : "Подтверждение"}
                          </th>
                          {canJournal && (
                            <th className="align-right">{t.actions}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRoster.map((s, i) => {
                          const a = data.attendance.find(
                              (a) =>
                                a.student_id === s.id &&
                                a.lesson_id === lesson?.id,
                            ),
                            check = data.checkIns.find(
                              (c) =>
                                c.student_id === s.id &&
                                c.lesson_id === lesson?.id,
                            );
                          return (
                            <tr
                              key={s.id}
                              className={
                                selectedStudents.includes(s.id)
                                  ? "row-selected"
                                  : ""
                              }
                            >
                              {canJournal && (
                                <td className="checkbox-cell">
                                  <input
                                    type="checkbox"
                                    aria-label={`Выбрать ${s.full_name}`}
                                    checked={selectedStudents.includes(s.id)}
                                    onChange={(e) =>
                                      setSelectedStudents((prev) =>
                                        e.target.checked
                                          ? [...prev, s.id]
                                          : prev.filter((id) => id !== s.id),
                                      )
                                    }
                                  />
                                </td>
                              )}
                              <td>
                                <div className="person-cell">
                                  <Avatar name={s.full_name} index={i} />
                                  <div>
                                    <strong>{s.full_name}</strong>
                                    <small>{groupName(s.group_id)}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                {check ? (
                                  <span className="checkin-time">
                                    <QrCode size={14} />
                                    {time(check.created_at)}
                                  </span>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td>
                                <Badge
                                  tone={statusTone[a?.status || "unconfirmed"]}
                                >
                                  {t[a?.status || "unconfirmed"]}
                                </Badge>
                              </td>
                              <td>
                                <span className="source-cell">
                                  {a?.confirmed_by ? (
                                    <>
                                      <CheckCheck size={14} />
                                      {a.confirmed_at
                                        ? time(a.confirmed_at)
                                        : "Учитель"}
                                    </>
                                  ) : (
                                    <>
                                      <Clock3 size={14} />
                                      {locale === "kk"
                                        ? "Күтілуде"
                                        : "Ожидается"}
                                    </>
                                  )}
                                </span>
                              </td>
                              {canJournal && (
                                <td className="align-right">
                                  <select
                                    className="inline-status-select"
                                    aria-label={`Изменить статус ${s.full_name}`}
                                    value={a?.status || "unconfirmed"}
                                    disabled={
                                      !!working ||
                                      lesson?.status === "cancelled"
                                    }
                                    onChange={(e) =>
                                      void act("record_attendance", {
                                        lesson_id: lesson?.id,
                                        student_ids: [s.id],
                                        status: e.target.value,
                                        expected_versions: {
                                          [s.id]: a?.version || 0,
                                        },
                                      })
                                    }
                                  >
                                    {statuses.map((status) => (
                                      <option key={status} value={status}>
                                        {t[status]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={lesson ? t.noResults : "Выберите день с занятиями"}
                    description={
                      lesson
                        ? "Измените поиск или добавьте учеников в класс."
                        : "Расписание выбранного дня пока пусто."
                    }
                  />
                )}
                <div className="table-footer">
                  <span>
                    {locale === "kk" ? "Жазбалар" : "Записей"}:{" "}
                    {filteredRoster.length}
                  </span>
                  <span>
                    <LockKeyhole size={12} />
                    {locale === "kk"
                      ? "Өздігінен белгілену қатысуды растамайды"
                      : "Самостоятельная отметка не подтверждает присутствие"}
                  </span>
                </div>
              </div>
              <div className="panel">
                <PanelTitle
                  title={
                    locale === "kk"
                      ? "Қатыспау себептері"
                      : "Причины отсутствия"
                  }
                  subtitle={`${data.absenceRequests.filter((r) => r.status === "pending").length} ${locale === "kk" ? "өтініш қаралуда" : "заявок на рассмотрении"}`}
                  actions={
                    isFamily || isAdmin ? (
                      <button
                        className="button button-outline button-sm"
                        onClick={() => setDialog("absence")}
                      >
                        <Plus size={15} />
                        {t.reportAbsence}
                      </button>
                    ) : undefined
                  }
                />
                {data.absenceRequests.length ? (
                  <div className="absence-list">
                    {data.absenceRequests.map((r) => (
                      <div key={r.id}>
                        <span className="absence-icon">
                          <Mail size={19} />
                        </span>
                        <div>
                          <strong>
                            {data.students.find((s) => s.id === r.student_id)
                              ?.full_name || "Ученик"}
                          </strong>
                          <p>{r.reason}</p>
                          <small>
                            {dateText(r.created_at)} · {time(r.created_at)}
                          </small>
                        </div>
                        <Badge
                          tone={
                            r.status === "approved"
                              ? "green"
                              : r.status === "rejected"
                                ? "red"
                                : "amber"
                          }
                        >
                          {t[r.status]}
                        </Badge>
                        {canJournal && r.status === "pending" && (
                          <div className="row-buttons">
                            <button
                              className="button button-outline button-sm"
                              disabled={!!working}
                              onClick={() =>
                                void act("review_absence", {
                                  id: r.id,
                                  status: "rejected",
                                  comment: "Причина отклонена",
                                })
                              }
                            >
                              {locale === "kk" ? "Қабылдамау" : "Отклонить"}
                            </button>
                            <button
                              className="button button-primary button-sm"
                              disabled={!!working}
                              onClick={() =>
                                void act("review_absence", {
                                  id: r.id,
                                  status: "approved",
                                  comment: "Причина согласована",
                                })
                              }
                            >
                              <Check size={14} />
                              {locale === "kk" ? "Мақұлдау" : "Одобрить"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={
                      locale === "kk" ? "Өтініштер жоқ" : "Заявок пока нет"
                    }
                    description="Здесь появятся сообщения о причинах отсутствия."
                  />
                )}
              </div>
            </>
          )}
          {view === "students" && (
            <div className="panel">
              <div className="filter-toolbar">
                <div className="toolbar-filters">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      placeholder={t.search}
                      aria-label={t.search}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="select-control">
                    <Users size={15} />
                    <select
                      aria-label={t.group}
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                    >
                      <option value="all">
                        {locale === "kk" ? "Барлық сыныптар" : "Все классы"}
                      </option>
                      {data.groups.map((g) => (
                        <option value={g.id} key={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="toolbar-actions">
                  {isAdmin && (
                    <button
                      className="button button-outline button-sm"
                      onClick={() => {
                        setImportRows([]);
                        setImportErrors([]);
                        setDialog("import");
                      }}
                    >
                      <FileUp size={16} />
                      {locale === "kk" ? "CSV импорттау" : "Импорт CSV"}
                    </button>
                  )}
                  <button
                    className="button button-outline button-sm"
                    onClick={() =>
                      exportCsv(
                        ["full_name", "group", "active"],
                        filteredStudents.map((s) => [
                          s.full_name,
                          groupName(s.group_id),
                          s.active ? "yes" : "no",
                        ]),
                        "EduSafe-students.csv",
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    {t.export}
                  </button>
                </div>
              </div>
              {filteredStudents.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="number-cell">№</th>
                        <th>{locale === "kk" ? "Оқушы" : "Ученик"}</th>
                        <th>{t.group}</th>
                        <th>
                          {locale === "kk" ? "Есептік жазба" : "Учётная запись"}
                        </th>
                        <th>{t.status}</th>
                        {isAdmin && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((s, i) => (
                        <tr key={s.id}>
                          <td className="number-cell">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td>
                            <div className="person-cell">
                              <Avatar name={s.full_name} index={i} />
                              <div>
                                <strong>{s.full_name}</strong>
                                <small>
                                  {s.is_adult
                                    ? "Совершеннолетний студент"
                                    : "Ученик"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="group-tag">
                              {groupName(s.group_id)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`source-cell ${s.user_id ? "green-text" : ""}`}
                            >
                              {s.user_id ? (
                                <>
                                  <CheckCircle2 size={14} />
                                  Подключена
                                </>
                              ) : (
                                <>
                                  <Link2 size={14} />
                                  Не подключена
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            <Badge tone={s.active ? "green" : "neutral"}>
                              {s.active ? "Обучается" : "Архив"}
                            </Badge>
                          </td>
                          {isAdmin && (
                            <td className="align-right">
                              <button
                                className="button button-ghost button-sm"
                                onClick={() => {
                                  setEditingStudent(s);
                                  setDialog("student");
                                }}
                              >
                                {locale === "kk" ? "Өзгерту" : "Изменить"}
                                <ArrowUpRight size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={t.noResults}
                  description="Добавьте ученика или измените фильтры."
                />
              )}
              <div className="table-footer">
                <span>
                  {filteredStudents.length}{" "}
                  {locale === "kk" ? "оқушы" : "учеников"}
                </span>
                <span>
                  {data.groups.length}{" "}
                  {locale === "kk" ? "сынып / топ" : "класса / группы"}
                </span>
              </div>
            </div>
          )}
          {view === "schedule" && (
            <>
              <div className="panel">
                <div className="filter-toolbar">
                  <div className="toolbar-filters">
                    <label className="select-control">
                      <Users size={15} />
                      <select
                        aria-label={t.group}
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                      >
                        <option value="all">Все классы</option>
                        {data.groups.map((g) => (
                          <option value={g.id} key={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Badge dot={false}>{filteredLessons.length} занятий</Badge>
                  </div>
                  <span className="muted small-text">{timezone}</span>
                </div>
                {filteredLessons.length ? (
                  <div className="schedule-list">
                    {filteredLessons.map((l, i) => (
                      <div
                        className={`schedule-row ${l.status === "cancelled" ? "is-cancelled" : ""}`}
                        key={l.id}
                      >
                        <div className="schedule-time">
                          <strong>{time(l.starts_at)}</strong>
                          <span>{time(l.ends_at)}</span>
                        </div>
                        <span className={`subject-icon subject-${i % 4}`}>
                          <GraduationCap size={23} />
                        </span>
                        <div className="schedule-subject">
                          <h3>{l.title}</h3>
                          <div>
                            <span>
                              <Users size={13} />
                              {groupName(l.group_id)}
                            </span>
                            <span>
                              <MapPin size={13} />
                              {locationName(l.location_id)}
                            </span>
                            <span>
                              <UserRound size={13} />
                              {memberName(l.teacher_id)}
                            </span>
                          </div>
                        </div>
                        <Badge
                          tone={
                            l.status === "cancelled"
                              ? "red"
                              : l.status === "completed"
                                ? "green"
                                : "neutral"
                          }
                        >
                          {l.status === "cancelled"
                            ? "Отменено"
                            : l.status === "completed"
                              ? "Завершено"
                              : l.status === "active"
                                ? "Идёт занятие"
                                : "По расписанию"}
                        </Badge>
                        <div className="row-buttons">
                          <button
                            className="button button-outline button-sm"
                            onClick={() => {
                              setSelectedLesson(l.id);
                              navigate("attendance");
                            }}
                          >
                            {t.openJournal}
                            <ArrowUpRight size={14} />
                          </button>
                          {isAdmin && l.status !== "cancelled" && (
                            <button
                              className="icon-button danger-hover"
                              title="Отменить занятие"
                              aria-label={`Отменить ${l.title}`}
                              disabled={!!working}
                              onClick={() =>
                                void act(
                                  "update_lesson",
                                  { id: l.id, status: "cancelled" },
                                  "Занятие отменено; автоуведомления для него не создаются",
                                )
                              }
                            >
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="На выбранный день занятий нет"
                    description="Расписание учитывает дату и часовой пояс вашей организации."
                  >
                    {isAdmin && (
                      <button
                        className="button button-primary button-sm"
                        onClick={() => setDialog("lesson")}
                      >
                        <Plus size={15} />
                        {t.createLesson}
                      </button>
                    )}
                  </Empty>
                )}
              </div>
              <div className="info-note">
                <CalendarDays size={19} />
                <p>
                  {locale === "kk"
                    ? "Сабақ уақыты ұйымның уақыт белдеуінде көрсетіледі. Жойылған сабақтар қатысуды автоматты тексеруге кірмейді."
                    : "Время занятий показано в часовом поясе организации. Отменённые занятия исключаются из автоматических проверок посещаемости."}
                </p>
              </div>
            </>
          )}
          {view === "incidents" && (
            <>
              <div className="incident-stats">
                <div>
                  <span className="signal-icon red">
                    <Siren size={21} />
                  </span>
                  <div>
                    <strong>
                      {data.incidents.filter((i) => i.status === "new").length}
                    </strong>
                    <span>Ожидают принятия</span>
                  </div>
                </div>
                <div>
                  <span className="signal-icon amber">
                    <Clock3 size={21} />
                  </span>
                  <div>
                    <strong>
                      {
                        data.incidents.filter(
                          (i) => i.status === "acknowledged",
                        ).length
                      }
                    </strong>
                    <span>Приняты сотрудником</span>
                  </div>
                </div>
                <div>
                  <span className="signal-icon green">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <strong>
                      {
                        data.incidents.filter((i) => i.status === "resolved")
                          .length
                      }
                    </strong>
                    <span>Обработаны и закрыты</span>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="filter-toolbar">
                  <div className="segmented-tabs">
                    {[
                      ["all", "Все сигналы"],
                      ["active", "Активные"],
                      ["resolved", "Закрытые"],
                      ["cancelled", "Отменённые"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={statusFilter === value ? "active" : ""}
                        onClick={() => setStatusFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => void reload()}
                    aria-label={t.refresh}
                  >
                    {refreshing ? <Spinner /> : <RefreshCw size={17} />}
                  </button>
                </div>
                {data.incidents.filter(
                  (i) =>
                    statusFilter === "all" ||
                    (statusFilter === "active"
                      ? ["new", "acknowledged"].includes(i.status)
                      : i.status === statusFilter),
                ).length ? (
                  <div className="incident-list">
                    {data.incidents
                      .filter(
                        (i) =>
                          statusFilter === "all" ||
                          (statusFilter === "active"
                            ? ["new", "acknowledged"].includes(i.status)
                            : i.status === statusFilter),
                      )
                      .map((i) => (
                        <article
                          key={i.id}
                          className={`incident-card incident-${i.status}`}
                        >
                          <div className="incident-card-header">
                            <div>
                              <span
                                className={`signal-icon ${i.status === "new" ? "red" : i.status === "acknowledged" ? "amber" : "green"}`}
                              >
                                <Siren size={22} />
                              </span>
                              <div>
                                <h3>
                                  {incidentNames[i.kind]}
                                  {i.is_drill && (
                                    <Badge tone="blue" dot={false}>
                                      {t.drill}
                                    </Badge>
                                  )}
                                </h3>
                                <span className="incident-reference">
                                  #{i.number || i.id.slice(0, 8)} ·{" "}
                                  {dateText(i.created_at)} в{" "}
                                  {time(i.created_at)}
                                </span>
                              </div>
                            </div>
                            <Badge
                              tone={
                                i.status === "new"
                                  ? "red"
                                  : i.status === "acknowledged"
                                    ? "amber"
                                    : i.status === "resolved"
                                      ? "green"
                                      : "neutral"
                              }
                            >
                              {t[i.status]}
                            </Badge>
                          </div>
                          <p>{i.details || "Комментарий не указан"}</p>
                          <div className="incident-meta">
                            <span>
                              <MapPin size={15} />
                              {locationName(i.location_id)}
                            </span>
                            <span>
                              <UserRound size={15} />
                              {memberName(i.created_by)}
                            </span>
                            {i.acknowledged_by && (
                              <span className="green-text">
                                <CheckCheck size={15} />
                                Принял: {memberName(i.acknowledged_by)}
                              </span>
                            )}
                          </div>
                          {i.resolution && (
                            <div className="resolution-note">
                              <CheckCircle2 size={15} />
                              {i.resolution}
                            </div>
                          )}
                          <div className="incident-card-actions">
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelectedIncident(i.id);
                                setDialog("incidentDetail");
                              }}
                            >
                              История сигнала <ArrowUpRight size={14} />
                            </button>
                            <div>
                              {(isAdmin || data.role === "security") &&
                                i.status === "new" && (
                                  <button
                                    className="button button-primary button-sm"
                                    disabled={!!working}
                                    onClick={() =>
                                      void act(
                                        "acknowledge_incident",
                                        { id: i.id },
                                        "Вы приняли сигнал",
                                      )
                                    }
                                  >
                                    <Check size={15} />
                                    Принять
                                  </button>
                                )}
                              {(isAdmin || data.role === "security") &&
                                ["new", "acknowledged"].includes(i.status) && (
                                  <button
                                    className="button button-outline button-sm"
                                    onClick={() => {
                                      setSelectedIncident(i.id);
                                      setResolveMode("resolve");
                                      setDialog("resolve");
                                    }}
                                  >
                                    Закрыть инцидент
                                  </button>
                                )}
                              {(isAdmin || i.created_by === data.profile.id) &&
                                ["new", "acknowledged"].includes(i.status) && (
                                  <button
                                    className="button button-ghost button-sm"
                                    onClick={() => {
                                      setSelectedIncident(i.id);
                                      setResolveMode("cancel");
                                      setDialog("resolve");
                                    }}
                                  >
                                    Ошибочный сигнал
                                  </button>
                                )}
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    title="Сигналов с таким статусом нет"
                    description="Зарегистрированные события и их история будут отображаться здесь."
                  />
                )}
              </div>
              <div className="info-note">
                <ShieldCheck size={20} />
                <p>
                  Регистрация сигнала, передача уведомления и подтверждение
                  сотрудника учитываются отдельно.{" "}
                  {data.school?.emergency_phone ? (
                    <>
                      Резервная связь:{" "}
                      <a href={`tel:${data.school.emergency_phone}`}>
                        {data.school.emergency_phone}
                      </a>
                      .
                    </>
                  ) : (
                    "Резервный номер связи можно указать в настройках организации."
                  )}
                </p>
              </div>
            </>
          )}
          {view === "notifications" && (
            <>
              <div className="notification-status-banner">
                <span className="telegram-mark">
                  <Send size={23} />
                </span>
                <div>
                  <h3>
                    Telegram{" "}
                    {data.telegramConnected ? "подключён" : "не подключён"}
                  </h3>
                  <p>
                    {data.school?.notification_mode === "mock"
                      ? "Учебный режим: сообщения сохраняются в журнале, реальным людям не отправляются."
                      : data.telegramConnected
                        ? "Состояние каждого сообщения отображается ниже."
                        : "Подключите свой аккаунт, чтобы получать сообщения в Telegram."}
                  </p>
                </div>
                <button
                  className="button button-outline button-sm"
                  onClick={async () => {
                    setGeneratedLink("");
                    setDialog("telegram");
                  }}
                >
                  <Link2 size={15} />
                  {data.telegramConnected ? "Подключение" : "Подключить"}
                </button>
              </div>
              <div className="panel">
                <div className="filter-toolbar">
                  <div className="segmented-tabs">
                    {[
                      ["all", "Все сообщения"],
                      ["attendance", "Посещаемость"],
                      ["incident", "Сигналы"],
                      ["failed", "Ошибки"],
                    ].map(([val, label]) => (
                      <button
                        key={val}
                        className={statusFilter === val ? "active" : ""}
                        onClick={() => setStatusFilter(val)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="muted small-text">
                    {data.notifications.length} сообщений
                  </span>
                </div>
                {data.notifications.filter(
                  (n) =>
                    statusFilter === "all" ||
                    n.kind.includes(statusFilter) ||
                    n.status === statusFilter,
                ).length ? (
                  <div className="notifications-list">
                    {data.notifications
                      .filter(
                        (n) =>
                          statusFilter === "all" ||
                          n.kind.includes(statusFilter) ||
                          n.status === statusFilter,
                      )
                      .map((n) => (
                        <article key={n.id}>
                          <span
                            className={`notification-icon ${n.kind.includes("incident") ? "amber" : "green"}`}
                          >
                            {n.kind.includes("incident") ? (
                              <ShieldCheck size={21} />
                            ) : (
                              <ClipboardCheck size={21} />
                            )}
                          </span>
                          <div>
                            <h3>{n.title}</h3>
                            <p>{n.body}</p>
                            <div>
                              <time>
                                {dateText(n.created_at)} · {time(n.created_at)}
                              </time>
                              <span>Попыток: {n.attempts}</span>
                            </div>
                            {n.error && <p className="error-text">{n.error}</p>}
                          </div>
                          <Badge
                            tone={
                              n.status === "failed"
                                ? "red"
                                : n.status === "sent"
                                  ? "green"
                                  : n.status === "mock"
                                    ? "blue"
                                    : "neutral"
                            }
                          >
                            {notificationNames[n.status]}
                          </Badge>
                        </article>
                      ))}
                  </div>
                ) : (
                  <Empty
                    title="Сообщений пока нет"
                    description="История появится после обновлений посещаемости или регистрации сигналов."
                  />
                )}
              </div>
            </>
          )}
          {view === "settings" && (
            <div className="settings-layout">
              <div className="settings-main">
                <div className="panel">
                  <PanelTitle
                    title="Организация"
                    subtitle="Название и основные параметры"
                  />
                  {isAdmin ? (
                    <form
                      className="settings-form"
                      onSubmit={(e) =>
                        void submit(e, "update_settings", (p) => ({
                          ...p,
                          grace_minutes: Number(p.grace_minutes),
                          notifications_enabled:
                            p.notifications_enabled === "on",
                        }))
                      }
                    >
                      <Field label="Название учебного заведения">
                        <input
                          name="name"
                          required
                          maxLength={150}
                          defaultValue={data.school?.name}
                        />
                      </Field>
                      <div className="form-grid">
                        <Field label="Часовой пояс">
                          <select name="timezone" defaultValue={timezone}>
                            <option value="Asia/Almaty">
                              Казахстан · Asia/Almaty
                            </option>
                            <option value="Asia/Qyzylorda">
                              Кызылорда · Asia/Qyzylorda
                            </option>
                            <option value="UTC">UTC</option>
                          </select>
                        </Field>
                        <Field label="Ожидание подтверждения, минут">
                          <input
                            type="number"
                            name="grace_minutes"
                            min={1}
                            max={120}
                            defaultValue={data.school?.grace_minutes || 15}
                            required
                          />
                        </Field>
                      </div>
                      <Field
                        label="Резервный номер связи"
                        hint="Показывается сотрудникам, если система недоступна."
                      >
                        <input
                          name="emergency_phone"
                          type="tel"
                          placeholder="+7 ..."
                          maxLength={40}
                          defaultValue={data.school?.emergency_phone || ""}
                        />
                      </Field>
                      <div className="settings-divider" />
                      <div className="settings-section-title">
                        <Bell size={18} />
                        <h3>Уведомления</h3>
                      </div>
                      <label className="switch-row">
                        <span>
                          <strong>Автоматическая проверка посещаемости</strong>
                          <small>
                            Для занятий с актуальным расписанием и разрешёнными
                            получателями
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          name="notifications_enabled"
                          defaultChecked={data.school?.notifications_enabled}
                          className="toggle-switch"
                        />
                      </label>
                      <Field label="Режим отправки">
                        <select
                          name="notification_mode"
                          defaultValue={
                            data.school?.notification_mode || "mock"
                          }
                        >
                          <option value="mock">
                            Учебный журнал — без внешней отправки
                          </option>
                          <option value="telegram">
                            Telegram — после подключения бота и получателей
                          </option>
                        </select>
                      </Field>
                      <div className="form-footer">
                        <span className="small-text muted">
                          Изменения сохраняются в истории
                        </span>
                        <button
                          className="button button-primary"
                          disabled={!!working}
                        >
                          {working === "update_settings" ? (
                            <Spinner />
                          ) : (
                            <Check size={16} />
                          )}{" "}
                          {t.save}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="settings-form">
                      <dl className="details-list">
                        <div>
                          <dt>Название</dt>
                          <dd>{data.school?.name}</dd>
                        </div>
                        <div>
                          <dt>Часовой пояс</dt>
                          <dd>{timezone}</dd>
                        </div>
                        <div>
                          <dt>Резервная связь</dt>
                          <dd>
                            {data.school?.emergency_phone || "Не указана"}
                          </dd>
                        </div>
                      </dl>
                      <div className="info-note">
                        <LockKeyhole size={18} />
                        <p>Параметры организации изменяет администратор.</p>
                      </div>
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="panel">
                    <PanelTitle
                      title="Команда и приглашения"
                      subtitle="Роли назначаются администратором"
                      actions={
                        <button
                          className="button button-outline button-sm"
                          onClick={() => {
                            setInviteRole("teacher");
                            setGeneratedLink("");
                            setDialog("invite");
                          }}
                        >
                          <UserPlus size={15} />
                          Пригласить
                        </button>
                      }
                    />
                    <div className="team-list">
                      {data.teammates.map((m, i) => (
                        <div key={m.user_id + m.role}>
                          <Avatar
                            name={m.full_name || "Пользователь"}
                            index={i}
                          />
                          <span>
                            <strong>{m.full_name || "Пользователь"}</strong>
                            <small>
                              {m.group_ids.length
                                ? m.group_ids.map(groupName).join(", ")
                                : "Учебное заведение"}
                            </small>
                          </span>
                          <Badge
                            dot={false}
                            tone={m.role === "admin" ? "green" : "neutral"}
                          >
                            {t[m.role]}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    {data.guardianLinks.length > 0 && (
                      <div className="guardian-section">
                        <h4>Связи представителей</h4>
                        {data.guardianLinks.map((link) => (
                          <div key={link.id}>
                            <span>
                              <strong>
                                {data.students.find(
                                  (s) => s.id === link.student_id,
                                )?.full_name || "Ученик"}
                              </strong>
                              <small>
                                {memberName(link.guardian_id)} ·{" "}
                                {link.status === "active"
                                  ? "Подтверждена"
                                  : link.status === "pending"
                                    ? "Ожидает проверки"
                                    : "Отозвана"}
                              </small>
                            </span>
                            {link.status === "pending" ? (
                              <div className="guardian-approval">
                                {data.students.find(
                                  (s) => s.id === link.student_id,
                                )?.is_adult && (
                                  <label className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={adultApprovals.includes(link.id)}
                                      onChange={(e) =>
                                        setAdultApprovals((prev) =>
                                          e.target.checked
                                            ? [...prev, link.id]
                                            : prev.filter(
                                                (id) => id !== link.id,
                                              ),
                                        )
                                      }
                                    />
                                    Разрешение совершеннолетнего проверено
                                  </label>
                                )}
                                <button
                                  className="button button-primary button-sm"
                                  disabled={
                                    !!working ||
                                    (Boolean(
                                      data.students.find(
                                        (s) => s.id === link.student_id,
                                      )?.is_adult,
                                    ) &&
                                      !adultApprovals.includes(link.id))
                                  }
                                  onClick={() =>
                                    void act("approve_guardian", {
                                      id: link.id,
                                      adult_authorized: adultApprovals.includes(
                                        link.id,
                                      ),
                                    })
                                  }
                                >
                                  Подтвердить
                                </button>
                              </div>
                            ) : link.status === "active" ? (
                              <button
                                className="button button-ghost button-sm"
                                disabled={!!working}
                                onClick={() =>
                                  void act("revoke_guardian", { id: link.id })
                                }
                              >
                                Отозвать доступ
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="settings-aside">
                <div className="panel">
                  <PanelTitle
                    title="Классы и группы"
                    actions={
                      isAdmin ? (
                        <button
                          className="icon-button"
                          title="Добавить класс"
                          onClick={() => setDialog("group")}
                        >
                          <Plus size={18} />
                        </button>
                      ) : undefined
                    }
                  />
                  {data.groups.length ? (
                    <div className="settings-item-list">
                      {data.groups.map((g) => (
                        <div key={g.id}>
                          <span className="item-icon">
                            <Users size={17} />
                          </span>
                          <strong>{g.name}</strong>
                          <span>
                            {
                              data.students.filter(
                                (s) => s.group_id === g.id && s.active,
                              ).length
                            }{" "}
                            чел.
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty title="Классы не добавлены" />
                  )}
                </div>
                <div className="panel">
                  <PanelTitle
                    title="Помещения"
                    actions={
                      isAdmin ? (
                        <button
                          className="icon-button"
                          title="Добавить кабинет"
                          onClick={() => setDialog("location")}
                        >
                          <Plus size={18} />
                        </button>
                      ) : undefined
                    }
                  />
                  {data.locations.length ? (
                    <div className="settings-item-list">
                      {data.locations.map((l) => (
                        <div key={l.id}>
                          <span className="item-icon">
                            <MapPin size={17} />
                          </span>
                          <strong>
                            {l.name}
                            <small>{l.building}</small>
                          </strong>
                          <span>{l.floor} этаж</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty title="Кабинеты не добавлены" />
                  )}
                </div>
                <div className="panel personal-settings">
                  <span className="telegram-mark">
                    <Send size={25} />
                  </span>
                  <h3>Ваш Telegram</h3>
                  <p>
                    {data.telegramConnected
                      ? "Аккаунт подключён к профилю."
                      : "Получайте сообщения об изменениях и событиях."}
                  </p>
                  <Badge tone={data.telegramConnected ? "green" : "neutral"}>
                    {data.telegramConnected ? t.connected : t.notConnected}
                  </Badge>
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setGeneratedLink("");
                      setDialog("telegram");
                    }}
                  >
                    <Link2 size={15} />
                    Подключение аккаунта
                  </button>
                </div>
                {isAdmin && (
                  <div className="panel maintenance-panel">
                    <h3>Проверка посещаемости</h3>
                    <p>
                      Проверить актуальные занятия и создать необходимые
                      уведомления по правилам организации.
                    </p>
                    <button
                      className="button button-outline button-sm"
                      disabled={!!working}
                      onClick={() =>
                        void act(
                          "run_attendance_check",
                          {},
                          "Проверка выполнена. Результаты доступны в уведомлениях.",
                        )
                      }
                    >
                      {working === "run_attendance_check" ? (
                        <Spinner />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Запустить проверку
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} /> EduSafe <i />{" "}
              {mode === "demo"
                ? "Демонстрационные данные"
                : "Рабочее пространство"}
            </span>
            <div>
              <span>
                {lastUpdate
                  ? `${t.updated} ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(lastUpdate)}`
                  : "Подключаемся…"}
              </span>
              <button
                className="icon-button"
                aria-label={t.refresh}
                onClick={() => void reload()}
              >
                {refreshing ? <Spinner /> : <RefreshCw size={14} />}
              </button>
            </div>
          </footer>
        </main>
      </div>
      {dialog === "student" && (
        <Modal
          title={editingStudent ? "Изменить ученика" : t.createStudent}
          description="Доступ к данным ученика выдаётся через приглашение."
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) =>
              void submit(
                e,
                editingStudent ? "update_student" : "create_student",
                (p) => ({
                  ...p,
                  ...(editingStudent
                    ? { id: editingStudent.id, active: p.active === "on" }
                    : { is_adult: p.is_adult === "on" }),
                }),
              )
            }
          >
            <div className="modal-body">
              <Field label={t.name}>
                <input
                  name="full_name"
                  required
                  maxLength={150}
                  placeholder="Например, Айлин Нұрлан"
                  defaultValue={editingStudent?.full_name}
                />
              </Field>
              <Field label={t.group}>
                <select
                  name="group_id"
                  required
                  defaultValue={editingStudent?.group_id || ""}
                >
                  <option value="" disabled>
                    Выберите класс
                  </option>
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              {!data.groups.length && (
                <div className="form-notice">
                  Сначала добавьте класс в настройках.
                </div>
              )}
              {editingStudent ? (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editingStudent.active}
                  />
                  Продолжает обучение
                </label>
              ) : (
                <label className="checkbox-label">
                  <input type="checkbox" name="is_adult" />
                  Совершеннолетний студент
                </label>
              )}
              <p className="form-help">
                Родительский доступ для совершеннолетних студентов требует
                отдельного разрешения.
              </p>
            </div>
            <FormButtons t={t} busy={!!working} onCancel={closeDialog} />
          </form>
        </Modal>
      )}
      {dialog === "lesson" && (
        <Modal
          title={t.createLesson}
          description={`Время занятия указывается в часовом поясе ${timezone}.`}
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) =>
              void submit(e, "create_lesson", (p) => {
                const offset = timezone === "UTC" ? "Z" : "+05:00";
                return {
                  ...p,
                  starts_at: new Date(
                    String(p.starts_at) + offset,
                  ).toISOString(),
                  ends_at: new Date(String(p.ends_at) + offset).toISOString(),
                  teacher_id: p.teacher_id || undefined,
                };
              })
            }
          >
            <div className="modal-body">
              <Field label="Название занятия">
                <input
                  name="title"
                  required
                  maxLength={120}
                  placeholder="Например, Информатика"
                />
              </Field>
              <div className="form-grid">
                <Field label={t.group}>
                  <select name="group_id" required>
                    <option value="">Выберите класс</option>
                    {data.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.room}>
                  <select name="location_id">
                    <option value="">Не указан</option>
                    {data.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Начало">
                  <input
                    type="datetime-local"
                    name="starts_at"
                    required
                    defaultValue={`${selectedDate}T08:30`}
                  />
                </Field>
                <Field label="Окончание">
                  <input
                    type="datetime-local"
                    name="ends_at"
                    required
                    defaultValue={`${selectedDate}T09:15`}
                  />
                </Field>
              </div>
              <Field label="Преподаватель">
                <select name="teacher_id" defaultValue="">
                  <option value="">Я</option>
                  {data.teammates
                    .filter((m) => m.role === "teacher")
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <FormButtons t={t} busy={!!working} onCancel={closeDialog} />
          </form>
        </Modal>
      )}
      {dialog === "group" && (
        <Modal title="Добавить класс или группу" onClose={closeDialog}>
          <form onSubmit={(e) => void submit(e, "create_group")}>
            <div className="modal-body">
              <Field label="Название">
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="8 А или ИС-21"
                />
              </Field>
            </div>
            <FormButtons t={t} busy={!!working} onCancel={closeDialog} />
          </form>
        </Modal>
      )}
      {dialog === "location" && (
        <Modal title="Добавить помещение" onClose={closeDialog}>
          <form
            onSubmit={(e) =>
              void submit(e, "create_location", (p) => ({
                ...p,
                floor: Number(p.floor),
              }))
            }
          >
            <div className="modal-body">
              <Field label="Название / номер кабинета">
                <input name="name" required maxLength={100} placeholder="201" />
              </Field>
              <div className="form-grid">
                <Field label="Корпус">
                  <input
                    name="building"
                    defaultValue="Главный корпус"
                    required
                    maxLength={100}
                  />
                </Field>
                <Field label="Этаж">
                  <input
                    name="floor"
                    type="number"
                    required
                    min={-5}
                    max={100}
                    defaultValue={1}
                  />
                </Field>
              </div>
            </div>
            <FormButtons t={t} busy={!!working} onCancel={closeDialog} />
          </form>
        </Modal>
      )}
      {dialog === "absence" && (
        <Modal
          title={t.reportAbsence}
          description="Причина будет отправлена уполномоченному сотруднику на рассмотрение."
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) =>
              void submit(e, "submit_absence", (p) => ({
                ...p,
                lesson_id: p.lesson_id || undefined,
              }))
            }
          >
            <div className="modal-body">
              <Field label="Ученик">
                <select required name="student_id">
                  {data.students
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} · {groupName(s.group_id)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Занятие">
                <select name="lesson_id" defaultValue={lesson?.id || ""}>
                  <option value="">Общая заявка</option>
                  {dayLessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {time(l.starts_at)} · {l.title} · {groupName(l.group_id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t.reason}
                hint="Достаточно краткого пояснения. Не указывайте медицинские подробности."
              >
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={4}
                  placeholder="Укажите причину отсутствия"
                />
              </Field>
            </div>
            <FormButtons
              t={t}
              busy={!!working}
              onCancel={closeDialog}
              save="Отправить на рассмотрение"
            />
          </form>
        </Modal>
      )}
      {dialog === "invite" && (
        <Modal
          title="Пригласить пользователя"
          description="Передайте приглашение только проверенному получателю."
          onClose={closeDialog}
        >
          {generatedLink ? (
            <div className="modal-body">
              <div className="success-illustration">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="center-text">Приглашение создано</h3>
              <p className="form-help center-text">
                Ссылка ограничена по сроку и используется один раз. Связь
                родителя потребует подтверждения администратора.
              </p>
              <div className="copy-field">
                <input
                  readOnly
                  value={generatedLink}
                  aria-label="Ссылка приглашения"
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void copyText(generatedLink)}
                  aria-label="Скопировать приглашение"
                >
                  <Copy size={17} />
                </button>
              </div>
              {mode === "demo" && (
                <div className="form-notice">
                  Это демонстрационная ссылка. Рабочие приглашения создаются в
                  вашей организации.
                </div>
              )}
              <button
                className="button button-primary full-width"
                onClick={closeDialog}
              >
                Готово
              </button>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget).entries(),
                );
                const payload = {
                  ...values,
                  role: inviteRole,
                  student_id: values.student_id || undefined,
                  group_ids: values.group_id ? [String(values.group_id)] : [],
                };
                delete (payload as Record<string, unknown>).group_id;
                const result = await act(
                  "create_invitation",
                  payload,
                  "Приглашение создано",
                );
                if (result)
                  setGeneratedLink(
                    `${window.location.origin}/join?token=${encodeURIComponent(String(result.token))}`,
                  );
              }}
            >
              <div className="modal-body">
                <Field label="Роль">
                  <select
                    name="role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                  >
                    {(
                      ["teacher", "security", "student", "guardian"] as Role[]
                    ).map((role) => (
                      <option key={role} value={role}>
                        {t[role]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Email получателя (необязательно)">
                  <input
                    name="email"
                    type="email"
                    placeholder="name@example.com"
                    maxLength={254}
                  />
                </Field>
                {["student", "guardian"].includes(inviteRole) && (
                  <Field label="Связанный ученик">
                    <select name="student_id" required>
                      <option value="">Выберите ученика</option>
                      {data.students
                        .filter((s) => s.active)
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.full_name} · {groupName(s.group_id)}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                {inviteRole === "teacher" && (
                  <Field label="Назначенный класс">
                    <select name="group_id" required>
                      <option value="">Выберите класс</option>
                      {data.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="form-notice">
                  <LockKeyhole size={16} />
                  <span>
                    Роль назначается только в вашей организации. Представитель
                    увидит данные после проверки связи.
                  </span>
                </div>
              </div>
              <FormButtons
                t={t}
                busy={!!working}
                onCancel={closeDialog}
                save="Создать приглашение"
              />
            </form>
          )}
        </Modal>
      )}
      {dialog === "import" && (
        <Modal
          title="Импорт учеников из CSV"
          description="Сначала проверьте список. Существующие данные не удаляются."
          onClose={closeDialog}
          wide
        >
          <div className="modal-body">
            <div className="import-instructions">
              <span className="item-icon">
                <FileUp size={23} />
              </span>
              <div>
                <strong>Два обязательных столбца: full_name и group</strong>
                <p>
                  Имена классов должны совпадать с уже созданными. Разделитель —
                  запятая или точка с запятой. До 200 учеников за импорт.
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    exportCsv(
                      ["full_name", "group"],
                      [["Имя ученика", data.groups[0]?.name || "8 А"]],
                      "EduSafe-import-template.csv",
                    )
                  }
                >
                  Скачать шаблон
                  <ArrowDownToLine size={14} />
                </button>
              </div>
            </div>
            <label className="file-drop">
              <FileUp size={27} />
              <strong>Выберите CSV-файл</strong>
              <span>До 2 МБ · кодировка UTF-8</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void readImport(e.target.files?.[0])}
              />
            </label>
            {importErrors.length > 0 && (
              <div className="form-error">
                <strong>Исправьте файл перед импортом:</strong>
                {importErrors.slice(0, 10).map((error, i) => (
                  <p key={i}>{error}</p>
                ))}
              </div>
            )}
            {importRows.length > 0 && (
              <>
                <h4>К добавлению: {importRows.length}</h4>
                <div className="import-preview">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Имя</th>
                        <th>Класс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 20).map((row, i) => (
                        <tr key={i}>
                          <td>{row.full_name}</td>
                          <td>{groupName(row.group_id)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 20 && (
                    <p className="form-help">
                      И ещё {importRows.length - 20} строк
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button
              className="button button-outline"
              onClick={closeDialog}
              disabled={!!working}
            >
              {t.cancel}
            </button>
            <button
              className="button button-primary"
              onClick={() => void importStudents()}
              disabled={
                !!working || !importRows.length || !!importErrors.length
              }
            >
              {working === "import" ? (
                <>
                  <Spinner />
                  {importProgress}
                </>
              ) : (
                <>
                  <FileUp size={16} />
                  Импортировать
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
      {dialog === "signal" && (
        <Modal
          title="Зарегистрировать сигнал"
          description="Сообщение будет доступно ответственным сотрудникам организации."
          onClose={closeDialog}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const p = Object.fromEntries(new FormData(e.currentTarget));
              if (!pendingSignal.current)
                pendingSignal.current = {
                  ...p,
                  location_id: p.location_id || undefined,
                  is_drill: mode === "demo" || p.is_drill === "on",
                  idempotency_key: crypto.randomUUID(),
                };
              const r = await act(
                "create_incident",
                pendingSignal.current,
                "Сигнал зарегистрирован",
              );
              if (r) {
                pendingSignal.current = null;
                setSelectedIncident(String(r.id));
                closeDialog();
              }
            }}
          >
            <div className="modal-body">
              <Field label="Тип ситуации">
                <select name="kind">
                  {Object.entries(incidentNames).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Помещение">
                <select name="location_id" defaultValue={helpLocation}>
                  <option value="">Помещение не уточнено</option>
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.building}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Краткое описание">
                <textarea
                  name="details"
                  maxLength={1000}
                  rows={3}
                  placeholder="Какая помощь требуется?"
                />
              </Field>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="is_drill"
                  defaultChecked
                  disabled={mode === "demo"}
                />
                Учебный сигнал
              </label>
              <p className="form-help">
                Учебные сигналы помечаются отдельно. В демонстрации реальные
                сообщения не отправляются.
              </p>
            </div>
            <FormButtons
              t={t}
              busy={!!working}
              onCancel={closeDialog}
              save="Зарегистрировать сигнал"
            />
          </form>
        </Modal>
      )}
      {dialog === "incidentDetail" && selectedEvent && (
        <Modal
          title={`${selectedEvent.is_drill ? "Учебный сигнал" : incidentNames[selectedEvent.kind]} · #${selectedEvent.number || selectedEvent.id.slice(0, 8)}`}
          onClose={closeDialog}
        >
          <div className="modal-body">
            <div className="incident-detail-heading">
              <Badge
                tone={
                  selectedEvent.status === "new"
                    ? "red"
                    : selectedEvent.status === "acknowledged"
                      ? "amber"
                      : "green"
                }
              >
                {t[selectedEvent.status]}
              </Badge>
              <span>
                <MapPin size={14} />
                {locationName(selectedEvent.location_id)}
              </span>
            </div>
            <p className="incident-detail-description">
              {selectedEvent.details || "Описание не указано"}
            </p>
            <dl className="details-list">
              <div>
                <dt>Автор</dt>
                <dd>{memberName(selectedEvent.created_by)}</dd>
              </div>
              <div>
                <dt>Регистрация</dt>
                <dd>
                  {dateText(selectedEvent.created_at)} ·{" "}
                  {time(selectedEvent.created_at)}
                </dd>
              </div>
              <div>
                <dt>Подтверждение сотрудником</dt>
                <dd>
                  {selectedEvent.acknowledged_at
                    ? `${memberName(selectedEvent.acknowledged_by)} · ${time(selectedEvent.acknowledged_at)}`
                    : "Ожидается"}
                </dd>
              </div>
            </dl>
            <h4 className="timeline-heading">
              <History size={17} />
              История сигнала
            </h4>
            <div className="incident-timeline">
              {data.incidentEvents
                .filter((event) => event.incident_id === selectedEvent.id)
                .map((event) => (
                  <div key={event.id}>
                    <i />
                    <div>
                      <strong>{event.message || event.kind}</strong>
                      <span>
                        {time(event.created_at)} · {memberName(event.actor_id)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            {selectedEvent.resolution && (
              <div className="resolution-note">
                <CheckCircle2 size={16} />
                {selectedEvent.resolution}
              </div>
            )}
            <div className="form-notice">
              Статус «принят» означает подтверждение сотрудником. Передача
              сообщения в канал учитывается в журнале уведомлений.
            </div>
          </div>
          <div className="modal-footer">
            <button className="button button-outline" onClick={closeDialog}>
              {t.close}
            </button>
            {(isAdmin || data.role === "security") &&
              selectedEvent.status === "new" && (
                <button
                  className="button button-primary"
                  disabled={!!working}
                  onClick={async () => {
                    await act("acknowledge_incident", { id: selectedEvent.id });
                  }}
                >
                  <Check size={16} />
                  Принять сигнал
                </button>
              )}
          </div>
        </Modal>
      )}
      {dialog === "resolve" && selectedEvent && (
        <Modal
          title={
            resolveMode === "resolve"
              ? "Закрыть инцидент"
              : "Отметить ошибочный сигнал"
          }
          description="Событие и все изменения останутся в журнале."
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) =>
              void submit(
                e,
                resolveMode === "resolve"
                  ? "resolve_incident"
                  : "cancel_incident",
                (p) => ({ ...p, id: selectedEvent.id }),
              )
            }
          >
            <div className="modal-body">
              <Field
                label={
                  resolveMode === "resolve"
                    ? "Что было сделано"
                    : "Причина отмены"
                }
              >
                <textarea
                  name={resolveMode === "resolve" ? "resolution" : "reason"}
                  required
                  rows={4}
                  maxLength={1000}
                  placeholder={
                    resolveMode === "resolve"
                      ? "Опишите результат обработки"
                      : "Например, случайное нажатие"
                  }
                />
              </Field>
            </div>
            <FormButtons
              t={t}
              busy={!!working}
              onCancel={closeDialog}
              save={
                resolveMode === "resolve"
                  ? "Закрыть инцидент"
                  : "Сохранить отмену"
              }
            />
          </form>
        </Modal>
      )}
      {dialog === "telegram" && (
        <Modal
          title="Подключить Telegram"
          description="Привязка относится только к вашему аккаунту EduSafe."
          onClose={closeDialog}
        >
          <div className="modal-body">
            <div className="telegram-connect-hero">
              <span className="telegram-mark">
                <Send size={35} />
              </span>
              <h3>Важное — в привычном мессенджере</h3>
              <p>
                Сначала запустите бота, затем передайте ему одноразовый код
                подключения.
              </p>
            </div>
            {generatedLink ? (
              <>
                <div className="copy-field">
                  <input
                    value={`/start ${generatedLink}`}
                    readOnly
                    aria-label="Команда подключения Telegram"
                  />
                  <button
                    className="icon-button"
                    onClick={() => void copyText(`/start ${generatedLink}`)}
                    aria-label="Скопировать команду"
                  >
                    <Copy size={17} />
                  </button>
                </div>
                <div className="form-notice">
                  {mode === "demo"
                    ? "Это учебный код. Он не подключает реальный Telegram."
                    : "Передайте команду боту вашей организации. Код действует ограниченное время. После подключения обновите эту страницу."}
                </div>
                {process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME &&
                  mode === "live" && (
                    <a
                      className="button button-primary full-width"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(generatedLink)}`}
                    >
                      <Send size={16} />
                      Открыть бота
                    </a>
                  )}
              </>
            ) : (
              <button
                className="button button-primary full-width"
                disabled={!!working}
                onClick={async () => {
                  const r = await act(
                    "create_telegram_link",
                    {},
                    "Код подключения создан",
                  );
                  if (r) setGeneratedLink(String(r.token));
                }}
              >
                {working ? <Spinner /> : <Link2 size={16} />}Получить код
                подключения
              </button>
            )}
            <p className="form-help">
              Если бот ещё не настроен, администратору необходимо подключить его
              к проекту. Название и username Telegram не используются как
              доказательство родства.
            </p>
          </div>
        </Modal>
      )}
      {dialog === "qrDemo" && (
        <Modal
          title="QR занятия"
          description="Учебная демонстрация без отправки данных на сервер."
          onClose={closeDialog}
        >
          <div className="modal-body qr-demo-body">
            <Badge tone="blue">Только демонстрация</Badge>
            <h3>{data.lessons.find((l) => l.id === qrLessonId)?.title}</h3>
            <p>
              {groupName(
                data.lessons.find((l) => l.id === qrLessonId)?.group_id || "",
              )}{" "}
              · Кабинет{" "}
              {locationName(
                data.lessons.find((l) => l.id === qrLessonId)?.location_id ||
                  null,
              )}
            </p>
            {qrImage ? (
              <img
                src={qrImage}
                width={260}
                height={260}
                alt="Учебный QR-код EduSafe"
              />
            ) : (
              <div className="qr-placeholder">
                <Spinner />
              </div>
            )}
            <div className="qr-countdown">
              <RefreshCw size={15} />
              Код действует ещё {qrRemaining} с
            </div>
            <p className="form-help">
              Этот QR показывает принцип обновления кода. Для учебной отметки
              переключитесь на роль ученика и нажмите «Сканировать QR». В
              рабочей организации отметки проверяет сервер.
            </p>
          </div>
        </Modal>
      )}
      {dialog === "demoScan" && (
        <Modal
          title="Учебная QR-отметка"
          description="Симуляция сканирования. Камера не используется, данные остаются в браузере."
          onClose={closeDialog}
        >
          <form
            onSubmit={(e) =>
              void submit(e, "check_in", (p) => ({
                token: `demo:${p.lesson_id}`,
              }))
            }
          >
            <div className="modal-body">
              <div className="demo-scan-icon">
                <QrCode size={48} />
              </div>
              <Field label="Выберите занятие">
                <select name="lesson_id" required>
                  {dayLessons
                    .filter((l) => l.status !== "cancelled")
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {time(l.starts_at)} · {l.title}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="form-notice">
                Отметка регистрируется от имени ученика. Статус присутствия
                подтверждается отдельно преподавателем.
              </div>
            </div>
            <FormButtons
              t={t}
              busy={!!working}
              onCancel={closeDialog}
              save="Симулировать сканирование"
            />
          </form>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? (
            <AlertTriangle size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  footer,
  tone,
  tag,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  footer: string;
  tone: string;
  tag?: string;
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <span className="metric-unit">чел.</span>
      </div>
      <div className="metric-footer">
        <span>{footer}</span>
        {tag && <span className="metric-tag">{tag}</span>}
      </div>
    </div>
  );
}
function PanelTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="panel-heading-actions">{actions}</div>}
    </div>
  );
}
function FormButtons({
  t,
  busy,
  onCancel,
  save,
}: {
  t: (typeof copy)["ru"] | (typeof copy)["kk"];
  busy: boolean;
  onCancel: () => void;
  save?: string;
}) {
  return (
    <div className="modal-footer">
      <button
        type="button"
        className="button button-outline"
        onClick={onCancel}
        disabled={busy}
      >
        {t.cancel}
      </button>
      <button className="button button-primary" type="submit" disabled={busy}>
        {busy ? <Spinner /> : <Check size={16} />} {save || t.save}
      </button>
    </div>
  );
}
