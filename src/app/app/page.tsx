import { redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
import { loadWorkspace } from '@/lib/workspace-server';
import { Onboarding } from './onboarding';
import { isConfigured } from '@/lib/supabase/server';
export const dynamic='force-dynamic';
export const metadata={title:'Пространство школы',robots:{index:false,follow:false}};
export default async function AppPage(){
 if(!isConfigured())redirect('/login');
 let data;try{data=await loadWorkspace();}catch(e){if(e instanceof Error&&e.message==='UNAUTHENTICATED')redirect('/login?next=/app');throw e;}
 if(!data.school)return <Onboarding name={data.profile.full_name}/>;
 return <Workspace initialData={data} mode="live"/>;
}
