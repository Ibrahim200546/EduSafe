/**
 * Explicit, stateful HTTP integration test. Not part of `npm test`.
 *
 * Prerequisites: a dedicated confirmed test account with no organization or
 * Telegram binding, plus a running EduSafe server configured with Supabase.
 * This script does not create Auth users, send email, access service keys,
 * call Telegram, or delete database rows. The operator provisions and removes
 * the disposable Auth fixture and the school identified in the final report.
 *
 * Required environment:
 *   EDUSAFE_TEST_EMAIL       Reserved example/invalid/test-domain address.
 *   EDUSAFE_TEST_PASSWORD    Disposable account password, provided via env.
 *   EDUSAFE_TEST_BASE_URL    For example http://localhost:3000.
 *
 * Run: node --import tsx tests/http-integration.mts
 * Help: node --import tsx tests/http-integration.mts --help
 * Never pass credentials as command-line arguments or enable HTTP debug logs.
 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceData } from '../src/lib/types';

type ObjectValue = Record<string, unknown>;
type Result = { status: number; data: unknown; headers: Headers };
type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: ObjectValue;
  origin?: string | null;
  cookieHeader?: string;
  updateCookies?: boolean;
};

class TestFailure extends Error {}

function check(condition: unknown, safeMessage: string): asserts condition {
  if (!condition) throw new TestFailure(safeMessage);
}

function object(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function status(result: Result, expected: number, label: string): void {
  // Only a constrained error code can enter the report. Response bodies,
  // user data, request bodies and Set-Cookie values are never logged.
  const code = object(result.data) && typeof result.data.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(result.data.code)
    ? ` (${result.data.code})` : '';
  check(result.status === expected, `${label}: expected HTTP ${expected}, received ${result.status}${code}.`);
}

function noStore(result: Result, label: string): void {
  check(/\bno-store\b/i.test(result.headers.get('cache-control') || ''), `${label}: private response must prohibit storage.`);
}

const authCookie = /^sb-[A-Za-z0-9_-]+-auth-token(?:\.[0-9]+)?$/;

/** A same-origin cookie jar with separate Set-Cookie parsing for chunked SSR cookies. */
class CookieJar {
  private readonly values = new Map<string, { value: string; expires: number; secure: boolean }>();
  private readonly base: URL;

  constructor(base: URL) { this.base = base; }

  ingest(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair, ...parts] = line.split(';');
      const separator = pair.indexOf('=');
      check(separator > 0, 'Server returned an invalid cookie.');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      const attributes = new Map(parts.map((part) => {
        const index = part.indexOf('=');
        return index < 0
          ? [part.trim().toLowerCase(), '']
          : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
      }));
      const domain = attributes.get('domain')?.replace(/^\./, '').toLowerCase();
      check(!domain || domain === this.base.hostname.toLowerCase(), 'Server attempted to set a cookie for an unexpected domain.');
      check(!attributes.get('path') || attributes.get('path') === '/', 'Unexpected cookie path; integration jar accepts root cookies only.');
      const maxAge = attributes.has('max-age') ? Number(attributes.get('max-age')) : null;
      const expiry = attributes.has('expires') ? Date.parse(attributes.get('expires')!) : Infinity;
      const expires = maxAge !== null && Number.isFinite(maxAge) ? Date.now() + maxAge * 1_000 : expiry;
      if (!value || expires <= Date.now()) {
        this.values.delete(name);
        continue;
      }
      if (authCookie.test(name)) {
        check(attributes.has('httponly'), 'Auth session cookie is not HttpOnly.');
        check(attributes.get('samesite')?.toLowerCase() === 'lax', 'Auth session cookie must use SameSite=Lax.');
        if (this.base.protocol === 'https:') check(attributes.has('secure'), 'HTTPS auth session cookie is not Secure.');
      }
      this.values.set(name, { value, expires, secure: attributes.has('secure') });
    }
  }

  header(): string {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    const values: string[] = [];
    for (const [name, cookie] of this.values) {
      if (cookie.expires <= Date.now()) { this.values.delete(name); continue; }
      // Browsers permit Secure cookies on localhost. Ordinary HTTP hosts are
      // rejected before any request is made, including their credentials.
      if (cookie.secure && this.base.protocol !== 'https:' && !loopback) continue;
      values.push(`${name}=${cookie.value}`);
    }
    return values.join('; ');
  }

  authCount(): number {
    this.header();
    return [...this.values.keys()].filter((name) => authCookie.test(name)).length;
  }
}

function configuration(): { base: URL; email: string; password: string } {
  const email = process.env.EDUSAFE_TEST_EMAIL;
  const password = process.env.EDUSAFE_TEST_PASSWORD;
  const address = process.env.EDUSAFE_TEST_BASE_URL;
  check(email && password && address, 'Set EDUSAFE_TEST_EMAIL, EDUSAFE_TEST_PASSWORD and EDUSAFE_TEST_BASE_URL.');
  const domain = email.toLowerCase().split('@')[1];
  check(domain && /^(?:example\.(?:com|org|net)|(?:[a-z0-9-]+\.)*(?:invalid|test))$/.test(domain), 'Use a disposable account with a reserved example, .invalid or .test email domain.');
  check(password.length >= 10 && password.length <= 128, 'Test password must contain 10–128 characters.');
  let base: URL;
  try { base = new URL(address); } catch { throw new TestFailure('EDUSAFE_TEST_BASE_URL must be an absolute URL.'); }
  check(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Use a base origin without credentials, path, query or fragment.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  check(base.protocol === 'https:' || (base.protocol === 'http:' && loopback), 'Use HTTPS, or HTTP on localhost for local testing.');
  return { base, email, password };
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('Explicit HTTP integration test; creates one disposable mock school and one drill.');
    console.log('Required env: EDUSAFE_TEST_EMAIL, EDUSAFE_TEST_PASSWORD, EDUSAFE_TEST_BASE_URL.');
    console.log('Use a confirmed, unlinked test account. Operator removes fixture rows after the run.');
    console.log('Run: node --import tsx tests/http-integration.mts');
    return;
  }

  const { base, email, password } = configuration();
  const jar = new CookieJar(base);
  const runId = randomUUID();
  const schoolName = `HTTP Integration ${runId.slice(0, 8)}`;
  const report = {
    run_id: runId, passed: false, completed_checks: [] as string[],
    user_id: null as string | null, school_id: null as string | null,
    incident_id: null as string | null, school_name: schoolName,
    fixture_cleanup_required: true, session_logout_verified: false,
  };
  let loggedIn = false;
  let stage = 'login';

  function passed(label: string): void {
    report.completed_checks.push(label);
    console.log(`[PASS] ${label}`);
  }

  async function request(path: string, options: RequestOptions = {}): Promise<Result> {
    const headers = new Headers({ accept: 'application/json' });
    const method = options.method || 'GET';
    if (options.body) headers.set('content-type', 'application/json');
    const origin = options.origin === undefined ? base.origin : options.origin;
    if (origin !== null && method === 'POST') headers.set('origin', origin);
    const cookies = options.cookieHeader ?? jar.header();
    if (cookies) headers.set('cookie', cookies);
    const response = await fetch(new URL(path, base), {
      method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (options.updateCookies !== false) jar.ingest(response.headers);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new TestFailure(`${stage}: HTTP ${response.status} returned a non-JSON response.`); }
    return { status: response.status, headers: response.headers, data };
  }

  async function action(name: string, payload: ObjectValue): Promise<ObjectValue> {
    const result = await request('/api/actions', { method: 'POST', body: { action: name, payload } });
    status(result, 200, stage);
    check(object(result.data) && object(result.data.data), `${stage}: invalid action response.`);
    return result.data.data;
  }

  async function workspace(): Promise<WorkspaceData> {
    const result = await request('/api/workspace');
    status(result, 200, stage);
    noStore(result, stage);
    check(object(result.data) && result.data.mode === 'live' && object(result.data.profile) && uuid(result.data.profile.id), `${stage}: invalid live workspace.`);
    for (const name of ['roles', 'groups', 'students', 'locations', 'lessons', 'attendance', 'checkIns', 'incidents', 'incidentEvents', 'absenceRequests', 'notifications', 'audit', 'teammates', 'guardianLinks']) {
      check(Array.isArray(result.data[name]), `${stage}: missing workspace array.`);
    }
    return result.data as unknown as WorkspaceData;
  }

  function mockOnly(data: WorkspaceData): void {
    check(data.school?.notification_mode === 'mock', `${stage}: test school must remain in mock mode.`);
    check(data.telegramConnected === false, `${stage}: disposable account must not have a Telegram link.`);
    check(data.notifications.every((row) => row.status === 'mock' || row.status === 'suppressed'), `${stage}: unexpected external-delivery queue state in mock school.`);
  }

  try {
    const login = await request('/api/auth', { method: 'POST', body: { action: 'login', email, password } });
    status(login, 200, stage);
    noStore(login, stage);
    check(object(login.data) && login.data.ok === true && jar.authCount() > 0, 'Login did not establish an HttpOnly server session.');
    loggedIn = true;
    passed('password login and HttpOnly session cookies');

    stage = 'empty workspace';
    const initial = await workspace();
    report.user_id = initial.profile.id;
    check(initial.school === null && initial.roles.length === 0 && initial.telegramConnected === false, 'Fixture is not a fresh, unlinked account; no application writes were attempted.');
    check(initial.students.length === 0 && initial.groups.length === 0 && initial.incidents.length === 0, 'Fresh account unexpectedly received organization data.');
    passed('fresh account sees no school or another tenant data');

    stage = 'create mock school';
    const created = await action('create_school', { name: schoolName, timezone: 'Asia/Almaty', seed_demo: true });
    check(uuid(created.id) && created.school_id === created.id, 'School creation did not return a consistent identifier.');
    report.school_id = created.id;
    const seeded = await workspace();
    check(seeded.school?.id === report.school_id && seeded.school.name === schoolName && seeded.profile.id === report.user_id, 'Created school did not persist for the authenticated account.');
    check(seeded.roles.includes('admin') && seeded.groups.length === 3 && seeded.students.length === 60 && seeded.lessons.length > 0 && seeded.locations.length > 0, 'Demo seeding or administrator workspace is incomplete.');
    check([...seeded.groups, ...seeded.students, ...seeded.lessons, ...seeded.locations].every((row) => row.school_id === report.school_id), 'Workspace contains a record from an unexpected organization.');
    mockOnly(seeded);
    passed('school, three groups and sixty fictional students persist in Supabase');

    stage = 'incident idempotency';
    const payload = { location_id: seeded.locations[0].id, kind: 'help', details: 'Автоматическая проверка EduSafe. Фиктивное учебное событие.', idempotency_key: runId, is_drill: true };
    const first = await action('create_incident', payload);
    check(uuid(first.id) && first.status === 'new' && first.already_recorded === false, 'First drill was not registered as new.');
    report.incident_id = first.id;
    const retry = await action('create_incident', payload);
    check(retry.id === first.id && retry.already_recorded === true, 'Idempotent incident retry created or returned a different event.');
    const withIncident = await workspace();
    const matching = withIncident.incidents.filter((row) => row.id === report.incident_id);
    check(matching.length === 1 && matching[0].status === 'new' && matching[0].is_drill && matching[0].created_by === report.user_id, 'Persisted drill identity or state is incorrect.');
    check(withIncident.incidentEvents.filter((row) => row.incident_id === report.incident_id && row.kind === 'created').length === 1, 'Idempotent retry duplicated the creation event.');
    mockOnly(withIncident);
    passed('duplicate incident request produces one persisted drill');

    stage = 'incident acknowledgement';
    await action('acknowledge_incident', { id: report.incident_id });
    await action('acknowledge_incident', { id: report.incident_id });
    const acknowledged = await workspace();
    const incident = acknowledged.incidents.find((row) => row.id === report.incident_id);
    check(incident?.status === 'acknowledged' && incident.acknowledged_by === report.user_id && !!incident.acknowledged_at, 'Acknowledgement or authenticated actor did not persist.');
    check(acknowledged.incidentEvents.filter((row) => row.incident_id === report.incident_id && row.kind === 'acknowledged').length === 1, 'Repeated acknowledgement duplicated the audit event.');
    mockOnly(acknowledged);
    passed('acknowledgement persists once with the authenticated actor');

    stage = 'CSRF rejection';
    const blockedName = `CSRF BLOCKED ${runId.slice(0, 8)}`;
    const blockedBody = { action: 'create_group', payload: { name: blockedName } };
    for (const origin of ['https://cross-origin.edusafe.invalid', null]) {
      const blocked = await request('/api/actions', { method: 'POST', origin, body: blockedBody });
      status(blocked, 403, stage);
      check(object(blocked.data) && blocked.data.code === 'CSRF_REJECTED', 'Mutation was not rejected by the expected CSRF guard.');
    }
    const afterCsrf = await workspace();
    check(afterCsrf.groups.length === seeded.groups.length && !afterCsrf.groups.some((row) => row.name === blockedName), 'A rejected cross-origin request changed organization data.');
    passed('foreign and missing Origin are rejected without mutations');

    stage = 'logout';
    const formerCookies = jar.header();
    const logout = await request('/api/auth', { method: 'POST', body: { action: 'logout' } });
    status(logout, 200, stage);
    noStore(logout, stage);
    check(object(logout.data) && logout.data.ok === true && jar.authCount() === 0, 'Logout did not remove authentication cookies.');
    loggedIn = false;
    report.session_logout_verified = true;
    passed('logout clears the server session cookies');

    stage = 'unauthenticated access';
    const loggedOutRead = await request('/api/workspace');
    status(loggedOutRead, 401, stage);
    const anonymousWrite = await request('/api/actions', { method: 'POST', cookieHeader: '', updateCookies: false, body: blockedBody });
    status(anonymousWrite, 401, stage);
    passed('logged-out reads and anonymous writes are denied');

    stage = 'revoked session replay';
    const replayed = await request('/api/workspace', { cookieHeader: formerCookies, updateCookies: false });
    check(replayed.status === 401 || replayed.status === 403, 'A copied cookie still accessed tenant data after logout.');
    passed('copied pre-logout cookies cannot read a revoked session');
    report.passed = true;
  } catch (error) {
    const message = error instanceof TestFailure ? error.message : 'Unexpected transport/runtime error; details withheld to protect credentials.';
    console.error(`[FAIL] ${stage}: ${message}`);
    process.exitCode = 1;
  } finally {
    if (loggedIn) {
      try {
        const result = await request('/api/auth', { method: 'POST', body: { action: 'logout' } });
        report.session_logout_verified = result.status === 200 && jar.authCount() === 0;
      } catch { /* Operator cleanup still removes the fixture and any sessions. */ }
    }
    // Only disposable record identifiers and fixed labels are output. The
    // operator uses this manifest to clean up exactly this fixture afterwards.
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof TestFailure ? error.message : 'Integration setup failed; sensitive details withheld.');
  process.exitCode = 1;
});
