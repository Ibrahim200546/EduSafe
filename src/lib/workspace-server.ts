import 'server-only';
import { getSupabase } from './supabase/server';
import type { WorkspaceData } from './types';
export async function loadWorkspace():Promise<WorkspaceData>{
 const supabase=await getSupabase();
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError || !user)throw new Error('UNAUTHENTICATED');
 const {data,error}=await supabase.rpc('edusafe_workspace',{p_school_id:null});
 if(error)throw error;
 return {...data,mode:'live'} as WorkspaceData;
}
