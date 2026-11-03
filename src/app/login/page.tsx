import { AuthForm } from './auth-form';
import { safeReturnPath } from '@/lib/security';
import { isConfigured } from '@/lib/supabase/server';
export const metadata={title:'Вход в школу',robots:{index:false,follow:false}};
export default async function LoginPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const q=await searchParams;return <AuthForm next={safeReturnPath(q.next)} mode={typeof q.mode==='string'?q.mode:'login'} message={typeof q.message==='string'?q.message:''} configured={isConfigured()}/>;
}
