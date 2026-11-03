import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/security';
function redirect(url:URL){const response=NextResponse.redirect(url);response.headers.set('Cache-Control','private, no-store, max-age=0');response.headers.set('Pragma','no-cache');response.headers.set('Expires','0');return response;}
export async function GET(request:Request){
 const url=new URL(request.url);const next=safeReturnPath(url.searchParams.get('next'));
 try{
  const supabase=await getSupabase();const code=url.searchParams.get('code');
  if(code){const {error}=await supabase.auth.exchangeCodeForSession(code);if(!error)return redirect(new URL(next,url.origin));}
  const token_hash=url.searchParams.get('token_hash');const type=url.searchParams.get('type');
  if(token_hash&&type&&['signup','recovery','email','invite','email_change'].includes(type)){
   const {error}=await supabase.auth.verifyOtp({token_hash,type:type as EmailOtpType});
   if(!error)return redirect(new URL(type==='recovery'?'/login?mode=password':next,url.origin));
  }
 }catch{ /* Show a safe actionable message; never expose auth codes in logs. */ }
 return redirect(new URL('/login?message=confirmation',url.origin));
}
