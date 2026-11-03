import { appButton, createRpc, equalSecret, isRecord, json, positiveId, readLimitedJson, RpcError, telegram, validSecret, validUuid, type Rpc, type Runtime } from './runtime.ts';

interface Claim { claimed: boolean; status: 'completed' | 'processing' | 'claimed' }
type Language = 'ru' | 'kk';

const words = {
  ru: {
    welcome: 'EduSafe — посещаемость и помощь. Для подключения получите одноразовый код в своём кабинете EduSafe и откройте выданную ссылку. Родство и права доступа проверяются учебным заведением.',
    linked: 'Telegram подключён к вашему кабинету EduSafe. Уведомления зависят от разрешений и настроек учебного заведения.',
    invalid: 'Код подключения недействителен или истёк. Создайте новую ссылку в своём кабинете EduSafe.',
    help: 'Откройте кабинет EduSafe, чтобы посмотреть посещаемость, сообщить причину отсутствия или изменить настройки. При экстренной ситуации используйте установленный учебным заведением способ связи. Бот не подтверждает, что помощь уже прибыла.',
    acknowledge: 'Сигнал принят сотрудником. Ответственный и актуальный статус доступны в EduSafe.',
    denied: 'Действие недоступно. Проверьте свою учётную запись и полномочия в EduSafe.',
    finished: 'Событие уже обработано. Актуальный статус доступен в EduSafe.',
    unknown: 'Доступные команды: /start, /help, /today, /children, /absence. Посещаемость и причины отсутствия доступны в защищённом кабинете.',
  },
  kk: {
    welcome: 'EduSafe — сабаққа қатысу және көмек. Қосылу үшін EduSafe жеке кабинетінен бір реттік код алып, берілген сілтемені ашыңыз. Өкілдік пен қолжетімділік құқықтарын оқу орны тексереді.',
    linked: 'Telegram EduSafe жеке кабинетіңізге қосылды. Хабарламалар оқу орны берген рұқсаттар мен баптауларға сәйкес жіберіледі.',
    invalid: 'Қосылу коды жарамсыз немесе оның мерзімі өткен. EduSafe жеке кабинетінен жаңа сілтеме жасаңыз.',
    help: 'Сабаққа қатысу мәліметтерін көру, келмеу себебін хабарлау және баптауларды өзгерту үшін EduSafe кабинетін ашыңыз. Шұғыл жағдайда оқу орны белгілеген байланыс тәсілін пайдаланыңыз. Бот көмектің келгенін растамайды.',
    acknowledge: 'Сигналды қызметкер қабылдады. Жауапты қызметкер мен ағымдағы күйді EduSafe жүйесінен қараңыз.',
    denied: 'Бұл әрекетке рұқсат жоқ. EduSafe жүйесіндегі есептік жазбаңыз бен өкілеттіктеріңізді тексеріңіз.',
    finished: 'Оқиға өңделген. Ағымдағы күйін EduSafe жүйесінен қараңыз.',
    unknown: 'Қолданылатын командалар: /start, /help, /today, /children, /absence. Сабаққа қатысу және келмеу себептері қорғалған кабинетте қолжетімді.',
  },
} as const;

function language(from: Record<string, unknown>): Language {
  return typeof from.language_code === 'string' && from.language_code.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

async function respond(runtime: Runtime, token: string, method: 'sendMessage' | 'answerCallbackQuery', payload: Record<string, unknown>): Promise<void> {
  const result = await telegram(runtime, token, method, payload);
  // Blocked user / expired callback is not recoverable by retrying an update.
  if (!result.ok && !result.permanent) throw new Error(result.code);
}

export function createWebhookHandler(runtime: Runtime): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const secret = request.headers.get('x-telegram-bot-api-secret-token');
    if (!validSecret(secret)) return json({ error: 'unauthorized' }, 401);
    let rpc: Rpc;
    try { rpc = createRpc(runtime); }
    catch { return json({ error: 'service_not_configured' }, 503); }
    try {
      const configured = runtime.env('TELEGRAM_WEBHOOK_SECRET');
      const authorized = configured
        ? validSecret(configured) && await equalSecret(secret, configured)
        : await rpc.call('edusafe_authorize_telegram', { p_secret: secret }) === true;
      if (!authorized) return json({ error: 'unauthorized' }, 401);
    } catch { return json({ error: 'authorization_unavailable' }, 503); }

    const token = runtime.env('TELEGRAM_BOT_TOKEN');
    if (!token || runtime.env('TELEGRAM_DELIVERY_ENABLED') !== 'true') return json({ error: 'telegram_not_enabled' }, 503);
    let update: Record<string, unknown>;
    try {
      const parsed = await readLimitedJson(request);
      if (!isRecord(parsed)) return json({ error: 'invalid_update' }, 400);
      update = parsed;
    } catch { return json({ error: 'invalid_update' }, 400); }
    if (typeof update.update_id !== 'number' || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return json({ error: 'invalid_update' }, 400);
    const updateId = update.update_id;
    const message = isRecord(update.message) ? update.message : null;
    const callback = isRecord(update.callback_query) ? update.callback_query : null;
    if (!message && !callback) return json({ ok: true, ignored: true });

    const runId = runtime.uuid();
    let acquired = false;
    let completed = false;
    try {
      const claim = await rpc.call<Claim>('edusafe_claim_telegram_update', { p_update_id: updateId, p_run_id: runId });
      if (!claim?.claimed) {
        if (claim?.status === 'completed') return json({ ok: true, duplicate: true });
        return json({ error: 'update_in_progress' }, 503);
      }
      acquired = true;

      if (message) {
        const chat = isRecord(message.chat) ? message.chat : {};
        const from = isRecord(message.from) ? message.from : {};
        // Account-linking credentials may only be submitted in a direct conversation.
        if (chat.type === 'private' && positiveId(chat.id) && positiveId(from.id) && chat.id === from.id && from.is_bot !== true) {
          const locale = language(from);
          const text = typeof message.text === 'string' ? message.text.trim().slice(0, 1_024) : '';
          const pieces = text.split(/\s+/);
          const command = (pieces[0] || '').split('@')[0].toLowerCase();
          let reply: string = words[locale].unknown;
          if (command === '/start') {
            const linkToken = pieces[1];
            if (!linkToken) reply = words[locale].welcome;
            else if (!/^[A-Za-z0-9_-]{20,64}$/.test(linkToken)) reply = words[locale].invalid;
            else {
              try {
                const result = await rpc.call<{ ok: boolean }>('edusafe_telegram_link', { p_token: linkToken, p_chat_id: chat.id, p_telegram_user_id: from.id });
                reply = result?.ok ? words[locale].linked : words[locale].invalid;
              } catch (error) {
                if (error instanceof RpcError && error.permanent) reply = words[locale].invalid;
                else throw error;
              }
            }
          } else if (['/help', '/today', '/children', '/absence', '/language'].includes(command)) reply = words[locale].help;
          const payload: Record<string, unknown> = { chat_id: chat.id, text: reply, link_preview_options: { is_disabled: true } };
          const button = appButton(runtime, locale);
          if (button) payload.reply_markup = button;
          await respond(runtime, token, 'sendMessage', payload);
        }
      } else if (callback) {
        const from = isRecord(callback.from) ? callback.from : {};
        const originalMessage = isRecord(callback.message) ? callback.message : {};
        const chat = isRecord(originalMessage.chat) ? originalMessage.chat : {};
        if (typeof callback.id === 'string' && callback.id.length <= 256 && positiveId(from.id) && chat.type === 'private' && chat.id === from.id && from.is_bot !== true) {
          const locale = language(from);
          const data = typeof callback.data === 'string' ? callback.data : '';
          const incidentId = data.startsWith('ack:') ? data.slice(4) : '';
          let reply: string = words[locale].denied;
          let alert = true;
          if (validUuid(incidentId)) {
            try {
              const result = await rpc.call<{ ok: boolean; status?: string }>('edusafe_telegram_ack', { p_incident_id: incidentId, p_telegram_user_id: from.id });
              if (result?.ok) {
                reply = result.status === 'resolved' || result.status === 'cancelled' ? words[locale].finished : words[locale].acknowledge;
                alert = false;
              }
            } catch (error) {
              if (!(error instanceof RpcError && error.permanent)) throw error;
            }
          }
          await respond(runtime, token, 'answerCallbackQuery', { callback_query_id: callback.id, text: reply.slice(0, 190), show_alert: alert });
        }
      }

      await rpc.call('edusafe_finish_telegram_update', { p_update_id: updateId, p_run_id: runId, p_success: true });
      completed = true;
      return json({ ok: true });
    } catch {
      runtime.log('telegram_update_retry', { update_id: updateId });
      return json({ error: 'retry_required' }, 503);
    } finally {
      if (acquired && !completed) {
        try { await rpc.call('edusafe_finish_telegram_update', { p_update_id: updateId, p_run_id: runId, p_success: false }); }
        catch { /* The short update lease makes it retryable even if this call fails. */ }
      }
    }
  };
}
