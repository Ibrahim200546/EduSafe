const known:Record<string,string>={
  UNAUTHENTICATED:'Войдите в аккаунт, чтобы продолжить.', FORBIDDEN:'Недостаточно прав для этого действия.',
  NOT_FOUND:'Запись не найдена или недоступна.', QR_EXPIRED:'Срок QR-кода истёк. Отсканируйте новый код.',
  QR_INVALID:'QR-код недействителен.', INVALID_QR:'QR-код недействителен или его срок истёк.',
  ALREADY_EXISTS:'Такая запись уже существует.', INVALID_INPUT:'Проверьте введённые данные.',
  NO_MEMBERSHIP:'Сначала создайте организацию или примите приглашение.',
  SUPABASE_NOT_CONFIGURED:'Подключение базы данных ещё не настроено. Демо доступно без регистрации.',
  INVALID_INVITATION:'Приглашение недействительно, использовано или просрочено.',
  CHECKIN_WINDOW_CLOSED:'Окно отметки для этого занятия закрыто. Обратитесь к преподавателю.',
};
export function publicError(error:unknown):{error:string;code:string;status:number}{
  const msg=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message'in error?String(error.message):'UNKNOWN';
  const code=Object.keys(known).find(k=>msg.includes(k));
  if(code)return {error:known[code],code,status:code==='UNAUTHENTICATED'?401:code==='FORBIDDEN'?403:code==='SUPABASE_NOT_CONFIGURED'?503:400};
  const sqlCode=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
  if(sqlCode==='42501')return {error:'Недостаточно прав или доступ к записи отозван.',code:'FORBIDDEN',status:403};
  if(['P0001','22023'].includes(sqlCode)&&/^[А-Яа-яЁё]/.test(msg)&&msg.length<=300)return {error:msg,code:'INVALID_INPUT',status:400};
  if(msg==='Invalid login credentials')return {error:'Неверная почта или пароль.',code:'LOGIN_FAILED',status:400};
  if(msg.includes('Email not confirmed'))return {error:'Подтвердите электронную почту по ссылке из письма.',code:'EMAIL_UNCONFIRMED',status:400};
  if(msg.toLowerCase().includes('rate limit'))return {error:'Слишком много попыток. Подождите немного и повторите.',code:'RATE_LIMIT',status:429};
  if(msg.includes('User already registered'))return {error:'Аккаунт с такой почтой уже существует. Войдите или восстановите пароль.',code:'ALREADY_REGISTERED',status:400};
  return {error:'Не удалось выполнить действие. Обновите страницу и попробуйте снова.',code:'REQUEST_FAILED',status:400};
}
