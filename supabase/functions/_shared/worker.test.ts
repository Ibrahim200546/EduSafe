import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHandler } from './worker.ts';
import { createWebhookHandler } from './webhook.ts';
import { equalSecret, readLimitedJson, SendGate, type Rpc, type Runtime } from './runtime.ts';

type Args = Record<string, unknown>;
type Stub = (args: Args) => unknown | Promise<unknown>;
const secret = 'test_only_0123456789_abcdefghijklmnopqrstuvwxyz';
const eventId = '8da169e2-e17b-48e4-8741-36084d9ca783';
const leaseId = 'db72e741-ec35-430e-864e-170e81722a26';
function job(overrides: Args = {}) {
  return { id: eventId, title: 'Присутствие уточняется', body: 'Сведения для вымышленного ученика', kind: 'attendance', attempts: 0, lease_token: leaseId, notification_mode: 'telegram', chat_id: 123456, ...overrides };
}
function harness(options: { stubs?: Record<string, Stub>; env?: Record<string, string>; fetch?: typeof fetch } = {}) {
  let clock = 1_000;
  const calls: { name: string; args: Args }[] = [];
  const sent: { url: string; body: Args }[] = [];
  const defaults: Record<string, Stub> = {
    edusafe_authorize_worker: () => true,
    edusafe_authorize_telegram: () => true,
    edusafe_acquire_worker: () => true,
    edusafe_process_due: () => ({}),
    edusafe_claim_notifications: () => [],
    edusafe_revalidate_notification: () => ({ valid: true, chat_id: 123456, notification_mode: 'telegram' }),
    edusafe_finish_notification: () => null,
    edusafe_release_worker: () => null,
    edusafe_claim_telegram_update: () => ({ claimed: true, status: 'claimed' }),
    edusafe_finish_telegram_update: () => null,
    edusafe_telegram_link: () => ({ ok: true }),
    edusafe_telegram_ack: () => ({ ok: true }),
  };
  const stubs = { ...defaults, ...options.stubs };
  const rpc: Rpc = {
    async call<T>(name: string, args: Args = {}): Promise<T> {
      calls.push({ name, args });
      assert.ok(stubs[name], `Unexpected RPC: ${name}`);
      return await stubs[name](args) as T;
    },
  };
  const runtime: Runtime = {
    env: (name) => options.env?.[name],
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    uuid: () => leaseId,
    log: () => {},
    rpcFactory: () => rpc,
    fetch: async (input, init) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) });
      if (options.fetch) return options.fetch(input, init);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { headers: { 'content-type': 'application/json' } });
    },
  };
  return { runtime, calls, sent, now: () => clock };
}
function workerRequest(header = secret) {
  return new Request('https://example.test/functions/v1/notification-worker', { method: 'POST', headers: { 'x-edusafe-worker-secret': header }, body: '{}' });
}
function webhookRequest(body: unknown, header = secret) {
  return new Request('https://example.test/functions/v1/telegram-webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': header }, body: JSON.stringify(body) });
}
function finished(calls: { name: string; args: Args }[]) { return calls.filter((c) => c.name === 'edusafe_finish_notification').map((c) => c.args); }
const enabled = { TELEGRAM_BOT_TOKEN: '1234:TEST_ONLY_NO_REAL_NETWORK', TELEGRAM_DELIVERY_ENABLED: 'true' };

test('worker fails closed without a custom secret and makes no DB or external calls', async () => {
  const h = harness();
  const response = await createWorkerHandler(h.runtime)(workerRequest(''));
  assert.equal(response.status, 401);
  assert.equal(h.calls.length, 0);
  assert.equal(h.sent.length, 0);
});

test('an invalid DB-verified secret never obtains a processing lease', async () => {
  const h = harness({ stubs: { edusafe_authorize_worker: () => false } });
  assert.equal((await createWorkerHandler(h.runtime)(workerRequest())).status, 401);
  assert.deepEqual(h.calls.map((c) => c.name), ['edusafe_authorize_worker']);
});

test('concurrent worker is rejected by the shared lease before claiming jobs', async () => {
  const h = harness({ stubs: { edusafe_acquire_worker: () => false } });
  assert.equal((await createWorkerHandler(h.runtime)(workerRequest())).status, 202);
  assert.equal(h.calls.some((c) => c.name === 'edusafe_claim_notifications'), false);
});

test('school mock mode finalizes mock and never sends even with a configured bot', async () => {
  const h = harness({ env: enabled, stubs: {
    edusafe_claim_notifications: () => [job()],
    edusafe_revalidate_notification: () => ({ valid: true, notification_mode: 'mock' }),
  } });
  assert.equal((await createWorkerHandler(h.runtime)(workerRequest())).status, 200);
  assert.equal(finished(h.calls)[0].p_status, 'mock');
  assert.equal(h.sent.length, 0);
});

test('a drill is always mock even when the organization selected Telegram', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job({ is_drill: true })] } });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'mock');
  assert.equal(h.sent.length, 0);
});

test('revoked guardian/event invalidation suppresses a previously queued notification', async () => {
  const h = harness({ env: enabled, stubs: {
    edusafe_claim_notifications: () => [job()],
    edusafe_revalidate_notification: () => ({ valid: false, reason: 'guardian_revoked' }),
  } });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'suppressed');
  assert.equal(finished(h.calls)[0].p_error, 'guardian_revoked');
  assert.equal(h.sent.length, 0);
});

test('a missing bot token is an explicit failure, never a successful send', async () => {
  const h = harness({ env: { TELEGRAM_DELIVERY_ENABLED: 'true' }, stubs: { edusafe_claim_notifications: () => [job()] } });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'failed');
  assert.equal(finished(h.calls)[0].p_error, 'telegram_not_configured');
});

test('external delivery needs an explicit deployment-level enabling switch', async () => {
  const h = harness({ env: { TELEGRAM_BOT_TOKEN: enabled.TELEGRAM_BOT_TOKEN }, stubs: { edusafe_claim_notifications: () => [job()] } });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_error, 'telegram_delivery_disabled');
  assert.equal(h.sent.length, 0);
});

test('HTTP success without a Telegram message id remains uncertain and retryable', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job()] }, fetch: async () => new Response('{"ok":true,"result":{}}') });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'queued');
  assert.equal(finished(h.calls)[0].p_error, 'telegram_uncertain_delivery');
});

test('network timeout is not recorded as sent', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job()] }, fetch: async () => { throw new Error('timeout'); } });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'queued');
  assert.equal(h.calls.some((c) => c.name === 'edusafe_release_worker'), true);
});

test('429 respects retry_after and defers the remaining batch without further sends', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job(), job({ id: '5f75aa1d-748f-4aaf-82ba-34d98728f6a8' })] }, fetch: async () => new Response('{"ok":false,"error_code":429,"parameters":{"retry_after":90}}', { status: 429 }) });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(h.sent.length, 1);
  assert.equal(finished(h.calls).length, 2);
  for (const result of finished(h.calls)) {
    assert.equal(result.p_status, 'queued');
    assert.ok(Number(result.p_retry_after) >= 90);
  }
});

test('a blocked bot is a permanent delivery failure', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job()] }, fetch: async () => new Response('{"ok":false,"error_code":403}', { status: 403 }) });
  await createWorkerHandler(h.runtime)(workerRequest());
  assert.equal(finished(h.calls)[0].p_status, 'failed');
});

test('successful API acceptance records message id with the matching lease token', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_notifications: () => [job({ kind: 'incident_created', incident_id: eventId })] } });
  await createWorkerHandler(h.runtime)(workerRequest());
  const result = finished(h.calls)[0];
  assert.equal(result.p_status, 'sent');
  assert.equal(result.p_message_id, '42');
  assert.equal(result.p_lease_token, leaseId);
  assert.match(String(h.sent[0].body.text), /#8da169e2/);
  assert.equal(h.sent[0].body.parse_mode, undefined);
  assert.ok(h.sent[0].body.reply_markup);
});

test('send gate spaces one chat by at least 1100ms and global sends by 100ms', async () => {
  const h = harness();
  const gate = new SendGate(h.runtime);
  await gate.wait('a'); const first = h.now();
  await gate.wait('b'); const second = h.now();
  await gate.wait('a'); const third = h.now();
  assert.ok(second - first >= 100);
  assert.ok(third - first >= 1100);
});

test('webhook rejects missing header before parsing or processing', async () => {
  const h = harness({ env: enabled });
  assert.equal((await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 1 }, ''))).status, 401);
  assert.equal(h.calls.length, 0);
});

test('completed Telegram update is not processed twice', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_telegram_update: () => ({ claimed: false, status: 'completed' }) } });
  const response = await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 1, message: { text: '/start' } }));
  assert.equal(response.status, 200);
  assert.equal(h.sent.length, 0);
});

test('currently leased duplicate returns retryable response instead of losing the update', async () => {
  const h = harness({ env: enabled, stubs: { edusafe_claim_telegram_update: () => ({ claimed: false, status: 'processing' }) } });
  assert.equal((await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 1, message: { text: '/start' } }))).status, 503);
});

test('a token in a group cannot link an account or reveal a response', async () => {
  const h = harness({ env: enabled });
  const response = await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 2, message: { text: `/start ${'a'.repeat(64)}`, from: { id: 123456 }, chat: { id: -100123, type: 'group' } } }));
  assert.equal(response.status, 200);
  assert.equal(h.calls.some((c) => c.name === 'edusafe_telegram_link'), false);
  assert.equal(h.sent.length, 0);
});

test('private start links only authenticated Telegram sender and does not echo token', async () => {
  const h = harness({ env: enabled });
  const link = 'a'.repeat(64);
  const response = await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 3, message: { text: `/start ${link}`, from: { id: 123456, language_code: 'kk' }, chat: { id: 123456, type: 'private' } } }));
  assert.equal(response.status, 200);
  const args = h.calls.find((c) => c.name === 'edusafe_telegram_link')?.args;
  assert.equal(args?.p_chat_id, 123456);
  assert.equal(args?.p_telegram_user_id, 123456);
  assert.equal(String(h.sent[0].body.text).includes(link), false);
  assert.match(String(h.sent[0].body.text), /қосылды/);
});

test('acknowledgement derives staff identity from Telegram sender and lets the database authorize', async () => {
  const h = harness({ env: enabled });
  await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 4, callback_query: { id: 'cb1', data: `ack:${eventId}`, from: { id: 123456 }, message: { chat: { id: 123456, type: 'private' } } } }));
  const args = h.calls.find((c) => c.name === 'edusafe_telegram_ack')?.args;
  assert.equal(args?.p_incident_id, eventId);
  assert.equal(args?.p_telegram_user_id, 123456);
  assert.equal(h.sent[0].body.show_alert, false);
});

test('an already acknowledged incident never attributes acknowledgement to the latest clicker', async () => {
  const expected = {
    ru: 'Сигнал принят сотрудником. Ответственный и актуальный статус доступны в EduSafe.',
    kk: 'Сигналды қызметкер қабылдады. Жауапты қызметкер мен ағымдағы күйді EduSafe жүйесінен қараңыз.',
  };
  for (const [locale, text] of Object.entries(expected)) {
    // The RPC deliberately returns the same status when another employee already
    // acknowledged the incident; it does not transfer ownership to this sender.
    const h = harness({ env: enabled, stubs: {
      edusafe_telegram_ack: () => ({ ok: true, status: 'acknowledged' }),
    } });
    const response = await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 40, callback_query: { id: 'cb-existing', data: `ack:${eventId}`, from: { id: 123456, language_code: locale }, message: { chat: { id: 123456, type: 'private' } } } }));
    assert.equal(response.status, 200);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].body.text, text);
    assert.equal(h.sent[0].body.show_alert, false);
    assert.equal(h.calls.find((c) => c.name === 'edusafe_telegram_ack')?.args.p_telegram_user_id, 123456);
  }
});

test('malformed callback data cannot invoke an arbitrary RPC', async () => {
  const h = harness({ env: enabled });
  await createWebhookHandler(h.runtime)(webhookRequest({ update_id: 5, callback_query: { id: 'cb2', data: 'delete:all', from: { id: 123456 }, message: { chat: { id: 123456, type: 'private' } } } }));
  assert.equal(h.calls.some((c) => c.name === 'edusafe_telegram_ack'), false);
  assert.equal(h.sent[0].body.show_alert, true);
});

test('body size is bounded even without a Content-Length header', async () => {
  await assert.rejects(() => readLimitedJson(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(70_000) }) })), /body_too_large/);
});

test('hashed secret comparison accepts exact values only', async () => {
  assert.equal(await equalSecret(secret, secret), true);
  assert.equal(await equalSecret(secret + 'x', secret), false);
});
