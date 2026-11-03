/** Dependency-free helpers shared by the two Supabase Edge Functions. */
export interface Rpc {
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

export interface Runtime {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  uuid: () => string;
  log: (event: string, details: Record<string, unknown>) => void;
  rpcFactory?: () => Rpc;
}

export class RpcError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`Database request failed (${status}, ${code})`);
    this.name = 'RpcError';
    this.status = status;
    this.code = code;
  }
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function createRpc(runtime: Runtime): Rpc {
  if (runtime.rpcFactory) return runtime.rpcFactory();
  const url = runtime.env('SUPABASE_URL');
  let key = runtime.env('SUPABASE_SERVICE_ROLE_KEY');
  // New projects can inject a map of server-only secret keys instead.
  if (!key) {
    try {
      const keys = JSON.parse(runtime.env('SUPABASE_SECRET_KEYS') || '{}');
      if (typeof keys.default === 'string') key = keys.default;
    } catch { /* Invalid/missing configuration is rejected below. */ }
  }
  if (!url || !key) throw new Error('service_configuration_missing');
  const base = new URL(url);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('service_configuration_invalid');
  const serviceKey = key;
  return {
    async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      if (!/^edusafe_[a-z_]+$/.test(name)) throw new Error('invalid_rpc_name');
      const headers: Record<string, string> = {
        apikey: serviceKey,
        'content-type': 'application/json',
      };
      // Modern sb_secret_* keys belong in apikey, not in a JWT bearer header.
      if (!serviceKey.startsWith('sb_secret_')) headers.authorization = `Bearer ${serviceKey}`;
      const response = await runtime.fetch(new URL(`/rest/v1/rpc/${name}`, base), {
        method: 'POST', headers, body: JSON.stringify(args),
        signal: AbortSignal.timeout(8_000),
      });
      const body = await response.text();
      if (!response.ok) {
        let code = 'database_error';
        try {
          const parsed = JSON.parse(body);
          if (typeof parsed.code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(parsed.code)) code = parsed.code;
        } catch { /* Never reflect the database error body or its data. */ }
        throw new RpcError(response.status, code);
      }
      if (!body) return null as T;
      try { return JSON.parse(body) as T; }
      catch { throw new RpcError(502, 'invalid_response'); }
    },
  };
}

export function validSecret(value: string | null): value is string {
  return !!value && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

/** Compare fixed-size hashes without an early return for a matching prefix. */
export async function equalSecret(actual: string, expected: string): Promise<boolean> {
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(actual)),
    crypto.subtle.digest('SHA-256', encode.encode(expected)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

export async function readLimitedJson(request: Request, limit = 65_536): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > limit) throw new Error('body_too_large');
  if (!request.body) throw new Error('invalid_json');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error('body_too_large');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type TelegramResult =
  | { ok: true; messageId: string | null }
  | { ok: false; permanent: boolean; code: string; retryAfter: number };

/** No parse_mode is used: notification and user text can never inject markup. */
export async function telegram(
  runtime: Runtime, token: string, method: 'sendMessage' | 'answerCallbackQuery',
  payload: Record<string, unknown>,
): Promise<TelegramResult> {
  try {
    const response = await runtime.fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000),
    });
    let body: Record<string, unknown> = {};
    try { const data = await response.json(); if (isRecord(data)) body = data; }
    catch { /* An uncertain response must not be counted as delivery. */ }
    if (response.ok && body.ok === true) {
      if (method === 'answerCallbackQuery') return { ok: true, messageId: null };
      const result = isRecord(body.result) ? body.result : {};
      if (positiveId(result.message_id)) return { ok: true, messageId: String(result.message_id) };
      return { ok: false, permanent: false, code: 'telegram_uncertain_delivery', retryAfter: 30 };
    }
    const status = typeof body.error_code === 'number' ? body.error_code : response.status;
    const parameters = isRecord(body.parameters) ? body.parameters : {};
    if (status === 429) {
      const retry = typeof parameters.retry_after === 'number' ? parameters.retry_after : 60;
      return { ok: false, permanent: false, code: 'telegram_rate_limited', retryAfter: Math.min(86_400, Math.max(1, Math.ceil(retry))) };
    }
    if (status >= 400 && status < 500) {
      return { ok: false, permanent: true, code: `telegram_${status}`, retryAfter: 0 };
    }
    return { ok: false, permanent: false, code: 'telegram_uncertain_delivery', retryAfter: 30 };
  } catch {
    // A timeout can occur after Telegram accepted the request. Do not label it as undelivered.
    return { ok: false, permanent: false, code: 'telegram_uncertain_delivery', retryAfter: 30 };
  }
}

export class SendGate {
  private nextGlobal = 0;
  private readonly nextChat = new Map<string, number>();
  private readonly runtime: Runtime;
  constructor(runtime: Runtime) { this.runtime = runtime; }
  async wait(chat: string): Promise<void> {
    const waitUntil = Math.max(this.nextGlobal, this.nextChat.get(chat) || 0);
    const delay = waitUntil - this.runtime.now();
    if (delay > 0) await this.runtime.sleep(delay);
    const now = this.runtime.now();
    this.nextGlobal = now + 100; // At most 10/sec from the single worker lease.
    this.nextChat.set(chat, now + 1_100);
  }
}

export function appButton(runtime: Runtime, language: 'ru' | 'kk'): Record<string, unknown> | undefined {
  const raw = runtime.env('APP_BASE_URL');
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    const href = new URL('/app', url.origin).href;
    return { inline_keyboard: [[{ text: language === 'kk' ? 'EduSafe ашу' : 'Открыть EduSafe', url: href }]] };
  } catch { return undefined; }
}
