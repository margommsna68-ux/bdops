import {appleWorkerHttp} from '@/server/apple-check/http';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{action:string}>}){return appleWorkerHttp(request,(await context.params).action);}
