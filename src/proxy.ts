import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request:NextRequest) {
  let response = NextResponse.next({request});
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookieOptions:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'},
    cookies:{getAll:()=>request.cookies.getAll(),setAll:(updates,headers)=>{
      updates.forEach(({name,value})=>request.cookies.set(name,value));
      response=NextResponse.next({request});
      updates.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      if (headers) Object.entries(headers).forEach(([name,value])=>response.headers.set(name,value));
    }},
  });
  // Verify access tokens with Auth, never authorize using a client-supplied getSession().user.
  await supabase.auth.getUser();
  response.headers.set('Cache-Control','private, no-store, max-age=0');
  return response;
}
export const config={matcher:['/app/:path*','/api/:path*','/join','/qr/:path*','/check-in','/auth/:path*']};
