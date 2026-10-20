import {handleOpsRequest} from '@/server/ops-api/api';
// API vận hành AI (21/10/2026): Bearer token only, no session, never the tRPC router. See docs/runbooks/ops-api.md.
export const dynamic='force-dynamic';
export const runtime='nodejs';
type P={params:Promise<{path:string[]}>};
const run=async(req:Request,{params}:P)=>handleOpsRequest(req,(await params).path.join('/'));
export const GET=run;
export const POST=run;
