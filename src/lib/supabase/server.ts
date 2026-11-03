import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function isConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function getSupabase() {
  if (!isConfigured()) throw new Error('SUPABASE_NOT_CONFIGURED');
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (updates) => {
        try { updates.forEach(({name,value,options}) => jar.set(name,value,options)); }
        catch { /* A Server Component cannot set cookies; proxy refreshes before render. */ }
      },
    },
  });
}
