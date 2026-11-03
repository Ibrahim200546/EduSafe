import { redirect } from 'next/navigation';
import { loadWorkspace } from '@/lib/workspace-server';
import { QrPresenter } from './qr-presenter';
export const dynamic='force-dynamic';
export const metadata={title:'QR занятия',robots:{index:false,follow:false}};
export default async function QrPage({params}:{params:Promise<{lessonId:string}>}){
 const {lessonId}=await params;let data;try{data=await loadWorkspace();}catch{redirect('/login?next='+encodeURIComponent('/qr/'+lessonId));}
 const lesson=data.lessons.find(x=>x.id===lessonId);
 if(!lesson||!data.roles.some(r=>r==='admin'||r==='teacher'))redirect('/app');
 return <QrPresenter lessonId={lesson.id} title={lesson.title} group={data.groups.find(g=>g.id===lesson.group_id)?.name||''} location={data.locations.find(l=>l.id===lesson.location_id)?.name||''}/>;
}
