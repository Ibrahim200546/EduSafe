import { redirect } from 'next/navigation';
import { getSupabase, isConfigured } from '@/lib/supabase/server';
import { CheckInScanner } from './scanner';
export const dynamic='force-dynamic';
export const metadata={title:'Отметка на занятии',robots:{index:false,follow:false}};
export default async function CheckInPage({searchParams}:{searchParams:Promise<{token?:string}>}){
 const {token}=await searchParams;if(!isConfigured())redirect('/login');
 const s=await getSupabase();const {data:{user}}=await s.auth.getUser();
 if(!user)redirect('/login?next='+encodeURIComponent('/check-in'+(token?'?token='+encodeURIComponent(token):'')));
 return <CheckInScanner initialToken={token||''}/>;
}
