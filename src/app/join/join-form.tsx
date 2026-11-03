'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
export function JoinForm({token}:{token:string}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [done,setDone]=useState(false);
 async function accept(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept_invitation',payload:{token:new FormData(e.currentTarget).get('token')}})});const d=await r.json();if(!r.ok)throw new Error(d.error);setDone(true);}catch(e){setError(e instanceof Error?e.message:'Ошибка подключения');}finally{setBusy(false);}}
 return <main className="setup-page"><section className="setup-card"><ShieldCheck size={32} color="#357346"/><h1>Приглашение в EduSafe</h1>{done?<><div className="setup-success">Приглашение принято. Для представителя связь с ребёнком станет доступна после подтверждения администратором.</div><Link href="/app" className="auth-primary">Открыть пространство</Link></>:<><p>Примите приглашение, выданное вашей организацией. Роль и доступ назначены администратором.</p>{error&&<div role="alert" className="auth-error">{error}</div>}<form className="setup-form" onSubmit={accept}><label>Код приглашения<input name="token" defaultValue={token} required minLength={16} maxLength={256} autoComplete="off"/></label><button className="auth-primary" disabled={busy}>{busy?'Проверяем…':'Принять приглашение'}</button></form><div className="setup-actions"><Link href="/app">Вернуться в приложение</Link></div></>}</section></main>;
}
