"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  QrCode,
  ShieldCheck,
  Users,
  Bell,
  Menu,
  X,
  Smartphone,
  HeartHandshake,
  LockKeyhole,
  LayoutDashboard,
  CalendarDays,
  ClipboardCheck,
  Search,
  Shield,
  School,
  BookOpen,
} from "lucide-react";
import { Brand, Avatar } from "./ui";
const previewNames = [
  "Айлин Нұрлан",
  "Алихан Серік",
  "Амина Ерлан",
  "Арсен Мұрат",
];
export function Landing() {
  const [open, setOpen] = useState(false),
    [locale, setLocale] = useState<"ru" | "kk">("ru");
  const kk = locale === "kk";
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-nav">
          <Brand />
          <nav className={open ? "landing-links is-open" : "landing-links"}>
            <a href="#how" onClick={() => setOpen(false)}>
              {kk ? "Қалай жұмыс істейді" : "Как это работает"}
            </a>
            <a href="#features" onClick={() => setOpen(false)}>
              {kk ? "Мүмкіндіктер" : "Возможности"}
            </a>
            <a href="#safety" onClick={() => setOpen(false)}>
              {kk ? "Қауіпсіздік" : "Защита данных"}
            </a>
          </nav>
          <div className="landing-nav-actions">
            <button
              className="locale-button"
              onClick={() => setLocale(kk ? "ru" : "kk")}
            >
              {kk ? "RU" : "ҚАЗ"}
            </button>
            <a href="/login" className="text-button">
              {kk ? "Кіру" : "Войти"} <ArrowUpRight size={16} />
            </a>
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" />
              {kk ? "МЕКТЕПТЕР МЕН КОЛЛЕДЖДЕРГЕ" : "ДЛЯ ШКОЛ И КОЛЛЕДЖЕЙ"}
            </div>
            <h1>
              {kk ? (
                <>
                  Мектепте бәрі
                  <br />
                  <em>бақылауда.</em>
                </>
              ) : (
                <>
                  В школе всё
                  <br />
                  <em>под присмотром.</em>
                </>
              )}
            </h1>
            <p>
              {kk
                ? "Қатысу, ата-аналармен байланыс және көмек шақыру. Оқу орнының күнделікті жұмысына арналған бірыңғай кеңістік."
                : "Посещаемость, связь с родителями и вызов помощи. Единое пространство для спокойной повседневной жизни учебного заведения."}
            </p>
            <div className="hero-buttons">
              <a className="button button-primary button-lg" href="/demo">
                {kk ? "Демоны көру" : "Посмотреть демо"}
                <ArrowRight size={19} />
              </a>
              <a
                className="button button-outline button-lg"
                href="/login?mode=signup"
              >
                {kk ? "Ұйым құру" : "Создать организацию"}
              </a>
            </div>
            <div className="hero-footnote">
              <span>
                <CheckCircle2 size={16} />
                {kk ? "Телефонда және компьютерде" : "На телефоне и компьютере"}
              </span>
              <span>
                <CheckCircle2 size={16} />
                {kk ? "Кіруде кідіріссіз" : "Без остановки у входа"}
              </span>
            </div>
            <div className="hero-for">
              <span className="tiny-school">
                <School size={21} />
              </span>
              <span>
                {kk
                  ? "Мұғалімге — ыңғайлы. Ата-анаға — түсінікті."
                  : "Учителю — удобно. Родителю — понятно."}
                <strong>
                  {kk ? "Назар — оқушыда." : "В центре внимания — ученик."}
                </strong>
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-grid" />
            <div className="preview-window">
              <div className="preview-top">
                <span className="window-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <LockKeyhole size={10} /> edusafe · рабочее пространство
                </span>
                <span />
              </div>
              <div className="preview-app">
                <div className="preview-sidebar">
                  <ShieldCheck size={25} />
                  <LayoutDashboard size={17} />
                  <ClipboardCheck size={17} />
                  <Users size={17} />
                  <CalendarDays size={17} />
                  <Bell size={17} />
                  <span className="preview-sidebar-bottom">АС</span>
                </div>
                <div className="preview-body">
                  <div className="preview-heading">
                    <div>
                      <span>ОБЗОР УЧЕБНОГО ДНЯ</span>
                      <h3>
                        Доброе утро, Айым <span className="sun-symbol">✳</span>
                      </h3>
                    </div>
                    <span className="preview-date">Сегодня</span>
                  </div>
                  <div className="preview-metrics">
                    <div>
                      <span>Ученики</span>
                      <strong>
                        60<small>3 класса</small>
                      </strong>
                    </div>
                    <div>
                      <span>Присутствуют</span>
                      <strong>
                        42<span className="tiny-pill">70%</span>
                      </strong>
                    </div>
                    <div>
                      <span>Ожидают отметки</span>
                      <strong>
                        6<small>Уточняем</small>
                      </strong>
                    </div>
                  </div>
                  <div className="preview-table">
                    <div className="preview-table-heading">
                      <h4>Журнал посещаемости</h4>
                      <span>
                        8 А <ChevronRight size={11} />
                      </span>
                    </div>
                    <div className="preview-table-label">
                      <span>УЧЕНИК</span>
                      <span>ОТМЕТКА</span>
                      <span>СТАТУС</span>
                    </div>
                    {previewNames.map((name, i) => (
                      <div className="preview-person" key={name}>
                        <span>
                          <Avatar name={name} index={i} />
                          {name}
                        </span>
                        <span>08:{26 + i}</span>
                        <span
                          className={
                            i === 3 ? "preview-status amber" : "preview-status"
                          }
                        >
                          <i />
                          {i === 3 ? "Опоздание" : "Присутствует"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="preview-chart">
                    <div>
                      <span>ПОСЕЩАЕМОСТЬ</span>
                      <strong>Каждая отметка на месте</strong>
                    </div>
                    <div className="mini-chart">
                      {[40, 55, 45, 70, 59, 80, 74, 92, 83, 91, 88, 96].map(
                        (h, i) => (
                          <i key={i} style={{ height: `${h}%` }} />
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="floating-note note-qr">
              <span className="float-icon">
                <QrCode size={27} />
              </span>
              <div>
                <strong>Один QR — весь класс</strong>
                <span>Отмечаются одновременно</span>
              </div>
              <CheckCircle2 size={18} />
            </div>
            <div className="floating-note note-message">
              <div className="float-icon blue">
                <Bell size={21} />
              </div>
              <div>
                <strong>Присутствие подтверждено</strong>
                <span>Родитель получит уведомление</span>
              </div>
              <span className="notification-now">сейчас</span>
            </div>
            <div className="visual-caption">
              {kk
                ? "Көрнекі интерфейс · ойдан шығарылған деректер"
                : "Пример интерфейса · вымышленные данные"}
            </div>
          </div>
        </section>
        <section className="value-strip">
          <div>
            <QrCode />
            <span>{kk ? "QR арқылы қатысу" : "Посещаемость по QR"}</span>
          </div>
          <div>
            <Users />
            <span>{kk ? "Мұғалімнің растауы" : "Подтверждение учителя"}</span>
          </div>
          <div>
            <Bell />
            <span>{kk ? "Ата-анаға хабарлама" : "Уведомления родителям"}</span>
          </div>
          <div>
            <HeartHandshake />
            <span>{kk ? "Бір батырмамен көмек" : "Помощь одним нажатием"}</span>
          </div>
        </section>
        <section className="landing-section" id="how">
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                {kk ? "ҚАРАПАЙЫМ ҮДЕРІС" : "ПОНЯТНЫЙ ПРОЦЕСС"}
              </div>
              <h2>
                {kk
                  ? "Таңертеңгі асығыстық аз.\nНазар көбірек."
                  : "Меньше утренней суеты.\nБольше внимания."}
              </h2>
            </div>
            <p>
              {kk
                ? "Кіруде кезек күтудің қажеті жоқ. Оқушылар кабинетте белгіленеді, мұғалім қатысуды тексереді."
                : "Не нужно выстраиваться к одному сканеру. Ученики отмечаются в кабинете, а преподаватель проверяет присутствие."}
            </p>
          </div>
          <div className="steps-grid">
            {(kk
              ? [
                  [
                    "01",
                    "Еркін өтіңіз",
                    "Цифрлық белгі кіруді кідіртпейді. Телефон болмаса, мұғалім қолмен белгілейді.",
                  ],
                  [
                    "02",
                    "QR сканерлеңіз",
                    "Сабақтың коды бүкіл сыныпқа арналған және қысқа уақыт ішінде жаңарып тұрады.",
                  ],
                  [
                    "03",
                    "Мұғалім растайды",
                    "Өздігінен белгілену мен тексерілген қатысу бөлек сақталады.",
                  ],
                  [
                    "04",
                    "Ата-ана хабардар",
                    "Хабарлама тек расталған деректі немесе нақтыланатын күйді көрсетеді.",
                  ],
                ]
              : [
                  [
                    "01",
                    "Заходите спокойно",
                    "Цифровая отметка не задерживает вход. Нет телефона — преподаватель отметит вручную.",
                  ],
                  [
                    "02",
                    "Сканируйте QR",
                    "Код занятия работает для всего класса и регулярно обновляется.",
                  ],
                  [
                    "03",
                    "Учитель подтверждает",
                    "Самостоятельная отметка и проверенное присутствие учитываются отдельно.",
                  ],
                  [
                    "04",
                    "Родитель в курсе",
                    "Уведомление сообщает точный статус — подтверждение или необходимость уточнения.",
                  ],
                ]
            ).map(([n, title, desc]) => (
              <article className="step-card" key={n}>
                <span className="step-number">{n}</span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="feature-section" id="features">
          <div className="section-heading centered">
            <div className="eyebrow">
              {kk ? "БІР ОРТАҚ КЕҢІСТІК" : "ОДНО РАБОЧЕЕ ПРОСТРАНСТВО"}
            </div>
            <h2>{kk ? "Әркімге керегі ғана." : "Каждому — то, что нужно."}</h2>
            <p>
              {kk
                ? "Рөлге сәйкес қолжетімділік және күнделікті жұмысқа арналған ыңғайлы құралдар."
                : "Доступ по роли и удобные инструменты для повседневных задач."}
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card featured">
              <div className="feature-icon">
                <ClipboardCheck />
              </div>
              <h3>{kk ? "Мұғалімге" : "Преподавателю"}</h3>
              <p>
                {kk
                  ? "Бір экранда сабақ, QR, сынып тізімі және көмек шақыру."
                  : "Занятие, QR, список класса и вызов помощи на одном экране."}
              </p>
              <div className="teacher-illustration">
                <div>
                  <span className="illustration-check">
                    <Check size={15} />
                  </span>
                  Присутствие подтверждено <span>08:42</span>
                </div>
                <div>
                  <span className="illustration-check">
                    <Check size={15} />
                  </span>
                  Присутствие подтверждено <span>08:43</span>
                </div>
                <div>
                  <span className="illustration-wait">
                    <Clock3 size={15} />
                  </span>
                  Ожидает проверки <span>08:44</span>
                </div>
              </div>
            </article>
            <article className="feature-card">
              <div className="feature-icon purple">
                <Smartphone />
              </div>
              <h3>{kk ? "Ата-анаға" : "Родителю"}</h3>
              <p>
                {kk
                  ? "Баланың қатысуы, хабарлама тарихы және қатыспау себебін жіберу."
                  : "Посещаемость ребёнка, история уведомлений и возможность сообщить причину отсутствия."}
              </p>
              <span className="feature-link">
                {kk
                  ? "Өз баласының деректері ғана"
                  : "Только данные своего ребёнка"}
                <LockKeyhole size={15} />
              </span>
            </article>
            <article className="feature-card">
              <div className="feature-icon amber">
                <Shield />
              </div>
              <h3>{kk ? "Әкімшілікке" : "Администрации"}</h3>
              <p>
                {kk
                  ? "Түсінікті жиынтық, сигналдар, жауапты қызметкерлер және әрекеттер тарихы."
                  : "Понятная сводка, активные сигналы, ответственные сотрудники и история действий."}
              </p>
              <span className="feature-link">
                {kk
                  ? "Әр өзгерістің тарихы бар"
                  : "Каждое изменение имеет историю"}
                <BookOpen size={15} />
              </span>
            </article>
          </div>
        </section>
        <section className="security-section" id="safety">
          <div className="security-visual">
            <div className="security-orbit orbit-1" />
            <div className="security-orbit orbit-2" />
            <span className="security-shield">
              <ShieldCheck size={70} strokeWidth={1.4} />
            </span>
            <span className="security-tag tag-a">
              <LockKeyhole size={13} />
              Доступ по роли
            </span>
            <span className="security-tag tag-b">
              <CheckCircle2 size={13} />
              История изменений
            </span>
          </div>
          <div>
            <div className="eyebrow">
              {kk ? "СЕНІМ — НЕГІЗІ" : "В ОСНОВЕ — ДОВЕРИЕ"}
            </div>
            <h2>
              {kk
                ? "Деректерге ұқыпты.\nМәртебеге нақты."
                : "Бережно к данным.\nТочно в формулировках."}
            </h2>
            <p>
              {kk
                ? "Әр пайдаланушы өзіне рұқсат етілген мәліметтерді ғана көреді. Жіберілген хабарлама мен қызметкердің растауы — бөлек күйлер."
                : "Каждый пользователь видит разрешённые ему сведения. Отправленное сообщение и подтверждение сотрудника — разные состояния."}
            </p>
            <ul>
              <li>
                <CheckCircle2 />
                {kk
                  ? "Ұйымдар мен рөлдер бойынша бөлінген қолжетімділік"
                  : "Изоляция организаций и доступ по ролям"}
              </li>
              <li>
                <CheckCircle2 />
                {kk
                  ? "Қатысу тарихы және жауапты тұлғалар"
                  : "История посещаемости и ответственные за изменения"}
              </li>
              <li>
                <CheckCircle2 />
                {kk
                  ? "Телефонсыз оқушыларды қолмен белгілеу"
                  : "Ручная отметка для учеников без телефона"}
              </li>
            </ul>
            <a href="/demo" className="text-button">
              {kk ? "Демонстрацияда тексеру" : "Проверить в демонстрации"}
              <ArrowRight size={17} />
            </a>
          </div>
        </section>
        <section className="landing-cta">
          <span className="cta-symbol">
            <ShieldCheck size={34} />
          </span>
          <h2>
            {kk
              ? "Тыныш оқу күніне\nбір қадам жақын."
              : "На один шаг ближе\nк спокойному учебному дню."}
          </h2>
          <p>
            {kk
              ? "EduSafe мүмкіндіктерін ойдан шығарылған деректермен көріңіз."
              : "Познакомьтесь с EduSafe на вымышленных данных."}
          </p>
          <a href="/demo" className="button button-white button-lg">
            {kk ? "Демоны ашу" : "Открыть демонстрацию"}
            <ArrowUpRight size={19} />
          </a>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>© {new Date().getFullYear()} EduSafe</span>
        <p>
          {kk ? "Қатысу. Байланыс. Қамқорлық." : "Посещаемость. Связь. Забота."}
        </p>
        <a
          href="https://github.com/Ibrahim200546/EduSafe"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
