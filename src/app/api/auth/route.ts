import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase/server';
import { isSameOrigin, safeReturnPath } from '@/lib/security';
import { publicError } from '@/lib/errors';
const input=z.object({action:z.enum(['login','signup','logout','reset','password']),email:z.string().email().max(254).optional(),password:z.string().max(128).optional(),full_name:z.string().trim().min(2).max(100).optional(),next:z.string().max(1500).optional()}).strict();
function json(body:unknown,init?:ResponseInit){const response=NextResponse.json(body,init);response.headers.set('Cache-Control','private, no-store, max-age=0');response.headers.set('Pragma','no-cache');response.headers.set('Expires','0');return response;}
export async function POST(request:Request){
 if(!isSameOrigin(request))return json({error:'Недопустимый источник запроса.'},{status:403});
 try{
  const raw=await request.text();if(raw.length>4096)return json({error:'Слишком большой запрос.'},{status:413});
  const parsed=input.safeParse(JSON.parse(raw));if(!parsed.success)return json({error:'Проверьте почту и заполнение полей.'},{status:400});
  const {action,email,password,full_name,next}=parsed.data;const supabase=await getSupabase();
  if(action==='logout'){const {error}=await supabase.auth.signOut();if(error)throw error;return json({ok:true});}
  if(action==='password'){
   if(!password||password.length<10)throw new Error('INVALID_INPUT');
   const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('UNAUTHENTICATED');
   const {error}=await supabase.auth.updateUser({password});if(error)throw error;return json({ok:true});
  }
  if(!email)throw new Error('INVALID_INPUT');
  const origin=new URL(request.url).origin;
  if(action==='reset'){
   const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:origin+'/auth/callback?next=/login?mode=password'});
   if(error)throw error;
   return json({ok:true,message:'Если аккаунт существует, на почту отправлена ссылка для восстановления.'});
  }
  if(!password||(action==='signup'&&password.length<10))return json({error:'Пароль для регистрации должен содержать не менее 10 символов.'},{status:400});
  if(action==='signup'){
   if(!full_name)throw new Error('INVALID_INPUT');
   const callback=new URL('/auth/callback',origin);callback.searchParams.set('next',safeReturnPath(next));
   const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name},emailRedirectTo:callback.toString()}});
   if(error)throw error;
   return json({ok:true,confirmationRequired:!data.session,message:!data.session?'Подтвердите почту по ссылке из письма, затем войдите в EduSafe.':undefined});
  }
  const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
  return json({ok:true});
 }catch(e){const v=publicError(e);return json(v,{status:v.status});}
}
