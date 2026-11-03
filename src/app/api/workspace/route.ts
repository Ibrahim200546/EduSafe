import { NextResponse } from 'next/server';
import { loadWorkspace } from '@/lib/workspace-server';
import { publicError } from '@/lib/errors';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await loadWorkspace(),{headers:{'Cache-Control':'private, no-store'}});}catch(e){const v=publicError(e);return NextResponse.json(v,{status:v.status});}}
