import { createRpc, json, SendGate, telegram, validSecret, validUuid, type Rpc, type Runtime } from './runtime.ts';

interface Job {
  id: string;
  title: string;
  body: string;
  kind: string;
  attempts: number;
  lease_token: string;
  notification_mode: 'mock' | 'telegram';
  chat_id: string | number | null;
  incident_id?: string | null;
  is_drill?: boolean;
}
interface Validation {
  valid: boolean;
  reason?: string;
  chat_id?: string | number | null;
  notification_mode?: 'mock' | 'telegram';
}

function message(job: Job): string {
  const body = `${job.title}\n\n${job.body}`;
  return `${body.slice(0, 3_700)}\n\nEduSafe · #${job.id.slice(0, 8)}`;
}

export function createWorkerHandler(runtime: Runtime): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const secret = request.headers.get('x-edusafe-worker-secret');
    if (!validSecret(secret)) return json({ error: 'unauthorized' }, 401);
    let rpc: Rpc;
    try { rpc = createRpc(runtime); }
    catch { return json({ error: 'service_not_configured' }, 503); }
    try {
      if (await rpc.call('edusafe_authorize_worker', { p_secret: secret }) !== true) return json({ error: 'unauthorized' }, 401);
    } catch { return json({ error: 'authorization_unavailable' }, 503); }

    const runId = runtime.uuid();
    let acquired = false;
    let outboundAttempted = false;
    const summary = { run_id: runId, claimed: 0, sent: 0, mock: 0, queued: 0, failed: 0, suppressed: 0 };
    try {
      acquired = await rpc.call<boolean>('edusafe_acquire_worker', { p_run_id: runId, p_seconds: 120 });
      if (!acquired) return json({ status: 'busy' }, 202);
      await rpc.call('edusafe_process_due');
      const jobs = await rpc.call<Job[]>('edusafe_claim_notifications', { p_limit: 8 });
      if (!Array.isArray(jobs)) throw new Error('invalid_claim_response');
      summary.claimed = jobs.length;
      const deadline = runtime.now() + 45_000;
      const gate = new SendGate(runtime);
      const token = runtime.env('TELEGRAM_BOT_TOKEN');
      const deliveryEnabled = runtime.env('TELEGRAM_DELIVERY_ENABLED') === 'true';
      let rateLimitedUntil = 0;

      async function finish(job: Job, status: 'sent' | 'mock' | 'queued' | 'failed' | 'suppressed', error: string | null = null, messageId: string | null = null, retryAfter: number | null = null) {
        await rpc.call('edusafe_finish_notification', {
          p_id: job.id, p_status: status, p_error: error, p_message_id: messageId,
          p_retry_after: retryAfter, p_lease_token: job.lease_token,
        });
        summary[status]++;
      }

      for (const job of jobs) {
        if (runtime.now() >= deadline) {
          await finish(job, 'queued', 'worker_time_budget', null, 60);
          continue;
        }
        if (runtime.now() < rateLimitedUntil) {
          await finish(job, 'queued', 'telegram_rate_limited', null, Math.ceil((rateLimitedUntil - runtime.now()) / 1_000));
          continue;
        }
        const state = await rpc.call<Validation>('edusafe_revalidate_notification', { p_id: job.id, p_lease_token: job.lease_token });
        if (!state || state.valid !== true) {
          await finish(job, 'suppressed', state?.reason || 'event_no_longer_applicable');
          continue;
        }
        const mode = state.notification_mode || job.notification_mode;
        if (mode === 'mock' || job.is_drill === true) {
          await finish(job, 'mock');
          continue;
        }
        if (mode !== 'telegram') {
          await finish(job, 'failed', 'notification_mode_invalid');
          continue;
        }
        if (!deliveryEnabled || !token) {
          await finish(job, 'failed', !deliveryEnabled ? 'telegram_delivery_disabled' : 'telegram_not_configured');
          continue;
        }
        const chat = state.chat_id === undefined ? job.chat_id : state.chat_id;
        if (chat === null || chat === undefined || !/^[1-9][0-9]{0,15}$/.test(String(chat))) {
          await finish(job, 'failed', 'telegram_not_linked');
          continue;
        }
        await gate.wait(String(chat));
        const payload: Record<string, unknown> = { chat_id: chat, text: message(job), link_preview_options: { is_disabled: true } };
        if (validUuid(job.incident_id) && (job.kind === 'incident' || job.kind.startsWith('incident_'))) {
          payload.reply_markup = { inline_keyboard: [[{ text: 'Принял / Қабылдадым', callback_data: `ack:${job.incident_id}` }]] };
        }
        outboundAttempted = true;
        const result = await telegram(runtime, token, 'sendMessage', payload);
        if (result.ok) {
          await finish(job, 'sent', null, result.messageId);
        } else if (result.permanent) {
          await finish(job, 'failed', result.code);
        } else {
          const retry = Math.max(result.retryAfter, Math.min(3_600, 30 * 2 ** Math.min(job.attempts || 0, 6)));
          if (result.code === 'telegram_rate_limited') rateLimitedUntil = runtime.now() + result.retryAfter * 1_000;
          await finish(job, 'queued', result.code, null, retry);
        }
      }
      runtime.log('notification_run_complete', summary);
      return json(summary);
    } catch {
      runtime.log('notification_run_failed', { run_id: runId });
      // Leased jobs not finalized will become eligible after lease expiry.
      return json({ error: 'worker_retry_required', run_id: runId }, 503);
    } finally {
      if (acquired) {
        // Carry the per-chat/global spacing across successive worker invocations.
        // The shared DB lease remains held during this short cooldown.
        if (outboundAttempted) await runtime.sleep(1_100);
        try { await rpc.call('edusafe_release_worker', { p_run_id: runId }); }
        catch { runtime.log('worker_release_failed', { run_id: runId }); }
      }
    }
  };
}
