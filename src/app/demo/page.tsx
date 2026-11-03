import { Workspace } from '@/components/workspace';
import { createDemoData } from '@/lib/demo';
export const dynamic='force-dynamic';
export const metadata={title:'Демонстрация',robots:{index:false,follow:false}};
export default function DemoPage(){return <Workspace initialData={createDemoData()} mode="demo"/>;}
