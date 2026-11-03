import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase/server';
import { isSameOrigin } from '@/lib/security';
import { publicError } from '@/lib/errors';
const actions=z.enum(['create_school','seed_demo','create_group','create_location','create_student','update_student','create_lesson','update_lesson','record_attendance','create_qr','check_in','create_incident','incident_status','acknowledge_incident','resolve_incident','cancel_incident','submit_absence','review_absence','create_invitation','accept_invitation','approve_guardian','revoke_guardian','update_settings','create_telegram_link','disconnect_telegram','set_member_active','run_attendance_check']);
const input=z.object({action:actions,payload:z.record(z.string(),z.unknown()).default({})}).strict();
export async function POST(request:Request){
 if(!isSameOrigin(request))return NextResponse.json({error:'Недопустимый источник запроса.',code:'CSRF_REJECTED'},{status:403});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return NextResponse.json({error:'Ожидается JSON.'},{status:415});
 try{
  const raw=await request.text();if(raw.length>65536)return NextResponse.json({error:'Запрос слишком большой.'},{status:413});
  const parsed=input.safeParse(JSON.parse(raw));if(!parsed.success)return NextResponse.json({error:'Проверьте параметры запроса.',code:'INVALID_INPUT'},{status:400});
  const supabase=await getSupabase();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Войдите в аккаунт.',code:'UNAUTHENTICATED'},{status:401});
  const {data,error}=await supabase.rpc('edusafe_action',{p_action:parsed.data.action,p_payload:parsed.data.payload});
  if(error)throw error;
  return NextResponse.json({data},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){const v=publicError(e);return NextResponse.json(v,{status:v.status});}
}
