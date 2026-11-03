import { redirect } from 'next/navigation';
import { getSupabase, isConfigured } from '@/lib/supabase/server';
import { JoinForm } from './join-form';
export const metadata={title:'Приглашение',robots:{index:false,follow:false}};
export default async function JoinPage({searchParams}:{searchParams:Promise<{token?:string}>}){
 const {token}=await searchParams;
 if(!isConfigured())redirect('/login');
 const supabase=await getSupabase();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/login?next='+encodeURIComponent('/join'+(token?'?token='+encodeURIComponent(token):'')));
 return <JoinForm token={token||''}/>;
}
