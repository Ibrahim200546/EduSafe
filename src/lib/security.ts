export function safeReturnPath(value:unknown, fallback='/app'):string {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return fallback;
  try{
    const url=new URL(value,'https://return.edusafe.invalid');
    if(url.origin!=='https://return.edusafe.invalid'||url.pathname.startsWith('//'))return fallback;
    return url.pathname+url.search+url.hash;
  }catch{return fallback;}
}
export function isSameOrigin(request:Request):boolean {
  const origin=request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
export function csvCell(value:unknown):string {
  let text=String(value??'');
  if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function extractQrToken(raw:string, ownOrigin:string):string|null {
  const trimmed=raw.trim();
  if (/^[a-zA-Z0-9_-]{24,256}$/.test(trimmed)) return trimmed;
  try { const url=new URL(trimmed); if(url.origin!==ownOrigin || url.pathname!=='/check-in') return null; const token=url.searchParams.get('token'); return token && /^[a-zA-Z0-9_-]{24,256}$/.test(token)?token:null; } catch{return null;}
}
