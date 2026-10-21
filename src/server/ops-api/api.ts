import {createHash,randomUUID} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,userMessage,type DomainReason} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {checkPin} from '../business-management/pin';
import {dayText} from '../business-management/money';
import {balanceRights,recordBalanceChecks} from '../vm-ops/balance';
import {createPayoutRequest,payoutRights,recordPayoutReceipt,suggestPayout,updatePayoutRequest} from '../vm-ops/payout';
import {hashToken,memberOps,userActive,OPS_SCOPES,type OpsScope} from './tokens';
import {activeJobs,addVmOpsNote,claimVmJob,finishPrepareJob,finishProxyJob,jobView,proxyForJob,recordJobSdk,releaseVmJob,stepVmJob,APPLY_RESULTS,JOB_KINDS,type OpsCaller} from '../vm-ops/jobs';
import {setVmStatus} from '../vm-ops/ops';
import {runWithOpsAuth} from './context';
import {hit,peek} from './limits';
import {ipAllowed,maskEmail,normalIp,redactSecrets,requestIp} from './safety';
import {balanceAsOf,balanceView,requestSelect,vmSelect,vmView,withdrawalView,type ViewRights} from './views';
// /api/ops/v1 (owner brief 21/10/2026). A thin layer: authenticate the token, check what the token allows, then call the same services
// the web uses (they check the user's current rights inside their transaction). Answers keep one envelope:
//   { ok: true, data, error: null } | { ok: false, data: null, error: { code, message, details? } }
// Nothing here logs headers or bodies; the audit (OpsAudit) keeps only the allowed fields.
export type OpsCode='UNAUTHORIZED'|'TOKEN_EXPIRED'|'TOKEN_REVOKED'|'FORBIDDEN'|'PIN_REQUIRED'|'PIN_INVALID'|'PIN_LOCKED'|'RATE_LIMITED'|'NOT_FOUND'|'AMBIGUOUS'|'REVISION_CONFLICT'|'CYCLE_CHANGED'|'ACCOUNT_CHANGED'|'IDEMPOTENCY_CONFLICT'|'DUPLICATE'|'VALIDATION'|'INTERNAL';
const STATUS:Record<OpsCode,number>={UNAUTHORIZED:401,TOKEN_EXPIRED:401,TOKEN_REVOKED:401,FORBIDDEN:403,PIN_REQUIRED:401,PIN_INVALID:401,PIN_LOCKED:403,RATE_LIMITED:429,NOT_FOUND:404,AMBIGUOUS:409,REVISION_CONFLICT:409,CYCLE_CHANGED:409,ACCOUNT_CHANGED:409,IDEMPOTENCY_CONFLICT:409,DUPLICATE:409,VALIDATION:422,INTERNAL:500};
export class OpsError extends Error{constructor(public readonly code:OpsCode,message:string,public readonly details?:Record<string,unknown>,public readonly retryAfter?:number){super(message);}}
const fail=(code:OpsCode,message:string,details?:Record<string,unknown>,retryAfter?:number)=>new OpsError(code,message,details,retryAfter);
const json=(status:number,body:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
function fromDomain(e:ProxyDomainError):OpsError{
  const byReason:Record<DomainReason,OpsCode>={CYCLE_CHANGED:'CYCLE_CHANGED',ACCOUNT_CHANGED:'ACCOUNT_CHANGED',REVISION_CONFLICT:'REVISION_CONFLICT',DUPLICATE:'DUPLICATE',NOT_FOUND:'NOT_FOUND',VALIDATION:'VALIDATION',UNAUTHORIZED:'UNAUTHORIZED',TOKEN_REVOKED:'TOKEN_REVOKED',TOKEN_EXPIRED:'TOKEN_EXPIRED'};
  const code:OpsCode=e.reason?byReason[e.reason]:e.code==='FORBIDDEN'?'FORBIDDEN':e.code==='NOT_FOUND'?'NOT_FOUND':e.code==='INVALID_INPUT'?'VALIDATION':e.code==='KEY_PAYLOAD_MISMATCH'?'IDEMPOTENCY_CONFLICT':'REVISION_CONFLICT';
  const message=e.code==='KEY_PAYLOAD_MISMATCH'?'Idempotency-Key này đã dùng cho một nội dung khác; dùng key mới cho lệnh mới':redactSecrets(userMessage(e))!;
  return fail(code,message,e.details);
}
// ─── Routing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Ctx {db:PrismaClient;requestId:string;ip:string|null;token:{id:string;userId:string;projectIds:string[];scopes:string[];prefix:string;name:string;expiresAt:Date};url:URL;body:unknown;key:string|null;audit:{projectId?:string|null;objectId?:string|null;replay?:boolean}}
type Handler=(c:Ctx,params:string[])=>Promise<unknown>;
interface Route {method:'GET'|'POST';path:RegExp;scope:OpsScope|null;action:string;run:Handler}
const ID='([A-Za-z0-9_-]{1,64})';
const routes:Route[]=[
  {method:'GET',path:/^me$/,scope:null,action:'ME',run:me},
  {method:'GET',path:/^projects$/,scope:'READ',action:'PROJECTS',run:projects},
  {method:'GET',path:/^servers$/,scope:'READ',action:'SERVERS',run:servers},
  {method:'GET',path:/^vms$/,scope:'READ',action:'VMS',run:vms},
  {method:'GET',path:/^vms\/resolve$/,scope:'READ',action:'VM_RESOLVE',run:resolveVm},
  {method:'GET',path:new RegExp('^vms/'+ID+'$'),scope:'READ',action:'VM',run:vmDetail},
  {method:'GET',path:new RegExp('^earnapp-accounts/'+ID+'$'),scope:'READ',action:'EARNAPP',run:earnAppDetail},
  {method:'GET',path:/^paypal\/suggest$/,scope:'PAYOUT',action:'PAYPAL_SUGGEST',run:paypalSuggest},
  {method:'GET',path:/^withdrawals$/,scope:'READ',action:'WITHDRAWALS',run:withdrawals},
  {method:'GET',path:new RegExp('^withdrawals/'+ID+'$'),scope:'READ',action:'WITHDRAWAL',run:withdrawalDetail},
  {method:'POST',path:new RegExp('^vms/'+ID+'/balance-check$'),scope:'BALANCE_WRITE',action:'BALANCE_CHECK',run:balanceCheck},
  {method:'POST',path:/^withdrawals\/prepare$/,scope:'PAYOUT',action:'WITHDRAWAL_PREPARE',run:prepare},
  {method:'POST',path:new RegExp('^withdrawals/'+ID+'/status$'),scope:'PAYOUT',action:'WITHDRAWAL_STATUS',run:status},
  {method:'POST',path:new RegExp('^withdrawals/'+ID+'/receipts$'),scope:'RECEIPT',action:'WITHDRAWAL_RECEIPT',run:receipt},
  // Real machines (21/10/2026): take a VM in hand, steps, the full proxy of that VM, the SDK of this install, status, Blocked, notes.
  {method:'GET',path:new RegExp('^jobs/'+ID+'$'),scope:'READ',action:'JOB',run:jobDetail},
  {method:'POST',path:new RegExp('^vms/'+ID+'/claim$'),scope:'VM_OPS',action:'VM_CLAIM',run:claim},
  {method:'POST',path:new RegExp('^jobs/'+ID+'/step$'),scope:'VM_OPS',action:'JOB_STEP',run:jobStep},
  {method:'POST',path:new RegExp('^jobs/'+ID+'/release$'),scope:'VM_OPS',action:'JOB_RELEASE',run:jobRelease},
  {method:'POST',path:new RegExp('^vms/'+ID+'/proxy-credentials$'),scope:'PROXY_CREDENTIALS',action:'VM_PROXY_CREDENTIALS',run:proxyCredentials},
  {method:'POST',path:new RegExp('^vms/'+ID+'/sdk$'),scope:'VM_OPS',action:'VM_SDK',run:vmSdk},
  {method:'POST',path:new RegExp('^vms/'+ID+'/status$'),scope:'VM_OPS',action:'VM_STATUS',run:vmStatus},
  {method:'POST',path:new RegExp('^vms/'+ID+'/proxy-blocked$'),scope:'VM_OPS',action:'VM_PROXY_BLOCKED',run:vmBlocked},
  {method:'POST',path:new RegExp('^vms/'+ID+'/notes$'),scope:'VM_OPS',action:'VM_NOTE',run:vmNote},
  {method:'POST',path:new RegExp('^jobs/'+ID+'/finish-prepare$'),scope:'VM_OPS',action:'JOB_FINISH_PREPARE',run:finishPrepare},
  {method:'POST',path:new RegExp('^jobs/'+ID+'/finish-proxy$'),scope:'VM_OPS',action:'JOB_FINISH_PROXY',run:finishProxy},
];
const KEY=/^[A-Za-z0-9._:-]{8,100}$/;
const ipOrInvalid=(v:string)=>normalIp(v)??'INVALID',idOrNull=(v:string|null)=>v&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v)?v:null;
function networkDiag(h:Headers){
  const real=h.get('x-real-ip'),xff=h.get('x-forwarded-for');
  return {xRealIp:real===null?null:ipOrInvalid(real),forwardedFor:xff===null?null:xff.split(',').slice(0,10).map(x=>ipOrInvalid(x)),
    railwayRequestId:idOrNull(h.get('x-railway-request-id')),railwayEdge:idOrNull(h.get('x-railway-edge'))};
}
export async function handleOpsRequest(req:Request,path:string,db:PrismaClient=prisma):Promise<Response>{
  const requestId=randomUUID(),{ip,source:ipSource}=requestIp(req.headers),method=req.method.toUpperCase();
  if(method==='GET'&&path==='health'){
    // ?diag=net: only the network fields needed to check where the address comes from, each reduced to a valid IP or "INVALID";
    // never other headers (no Authorization, PIN, Cookie). They describe the caller's own request only.
    const net=new URL(req.url).searchParams.get('diag')==='net'?networkDiag(req.headers):undefined;
    return json(200,{ok:true,data:{service:'moneytohome-ops',version:'v1',verifiedIp:ip,ipSource,...(net?{network:net}:{})},error:null},{'x-request-id':requestId});
  }
  const route=routes.find(r=>r.method===method&&r.path.test(path)),params=route?(path.match(route.path)!.slice(1)):[];
  let token:Ctx['token']|null=null,userId:string|null=null;const audit:Ctx['audit']={},action=route?.action??'UNKNOWN';
  const write=method==='POST';
  const done=async(status:number,result:string,body:unknown,headers:Record<string,string>={})=>{
    // Every write and every refused call is traced (allowed fields only); successful reads are not.
    if(write||status>=400)await db.opsAudit.create({data:{requestId,tokenId:token?.id??null,userId,projectId:audit.projectId??null,action,objectId:audit.objectId??null,ip,httpStatus:status,result,replay:!!audit.replay}}).catch(()=>undefined);
    return json(status,body,{'x-request-id':requestId,...headers});
  };
  const error=(e:OpsError)=>done(STATUS[e.code],e.code,{ok:false,data:null,error:{code:e.code,message:e.message,...(e.details?{details:e.details}:{})}},e.retryAfter?{'retry-after':String(e.retryAfter)}:{});
  try{
    // 1. Who is calling (failed attempts are limited per address).
    const ipKey=ip||'unknown';if((await peek(db,'authFail',ipKey)).over)throw fail('RATE_LIMITED','Quá nhiều lần xác thực sai từ địa chỉ này; thử lại sau',undefined,(await peek(db,'authFail',ipKey)).retryAfter);
    const auth=req.headers.get('authorization')||'',m=auth.match(/^Bearer\s+(mth_[A-Za-z0-9_-]{20,100})$/);
    const denied=async(code:OpsCode,message:string)=>{await hit(db,'authFail',ipKey);return fail(code,message);};
    if(!m)throw await denied('UNAUTHORIZED','Thiếu hoặc sai Authorization: Bearer <token>');
    const row=await db.opsToken.findUnique({where:{tokenHash:hashToken(m[1])}});
    if(!row)throw await denied('UNAUTHORIZED','Token không hợp lệ');
    token={id:row.id,userId:row.userId,projectIds:row.projectIds,scopes:row.scopes,prefix:row.prefix,name:row.name,expiresAt:row.expiresAt};userId=row.userId;
    if(row.revokedAt)throw await denied('TOKEN_REVOKED','Token đã bị thu hồi');
    if(row.expiresAt<new Date())throw await denied('TOKEN_EXPIRED','Token đã hết hạn');
    if(!ipAllowed(ip,row.allowedIps))throw fail('FORBIDDEN','Địa chỉ gọi không nằm trong danh sách IP của token');
    if(!await userActive(db,row.userId))throw fail('FORBIDDEN','Tài khoản của token đang bị khoá hoặc không còn đăng nhập được');
    // 2. How often.
    const rate=await hit(db,write?'write':'read',row.id);if(rate.over)throw fail('RATE_LIMITED','Gọi quá nhanh; thử lại sau',undefined,rate.retryAfter);
    if(!row.lastUsedAt||Date.now()-row.lastUsedAt.getTime()>60000||row.lastUsedIp!==ip)await db.opsToken.update({where:{id:row.id},data:{lastUsedAt:new Date(),lastUsedIp:ip}}).catch(()=>undefined);
    // 3. What the token allows (the services then check the user's own rights).
    if(!route)throw fail('NOT_FOUND','Không có endpoint này trong API vận hành');
    if(route.scope&&!row.scopes.includes(route.scope))throw fail('FORBIDDEN','Token không được cấp thao tác này');
    let body:unknown=null,key:string|null=null;
    if(write){
      key=req.headers.get('idempotency-key');if(!key||!KEY.test(key))throw fail('VALIDATION','Lệnh ghi cần Idempotency-Key (8–100 ký tự A-Z a-z 0-9 . _ : -)');
      const text=await req.text();if(text.length>20000)throw fail('VALIDATION','Nội dung quá lớn');
      try{body=JSON.parse(text||'{}');}catch{throw fail('VALIDATION','Nội dung phải là JSON');}
      const projectId=(body as {projectId?:unknown})?.projectId;audit.projectId=typeof projectId==='string'?projectId.slice(0,64):null;
      // 4. PIN of the user, every write (also a retry). Wrong PINs count for the user (3 → 30 minutes, as on the web) and for the token.
      const pin=req.headers.get('x-ops-pin');if(!pin)throw fail('PIN_REQUIRED','Lệnh ghi cần X-Ops-Pin');
      const tokenPin=await peek(db,'pinFail',row.id);if(tokenPin.over)throw fail('PIN_LOCKED','Token này đã nhập sai PIN quá số lần cho phép; chờ hết khoá',undefined,tokenPin.retryAfter);
      const p=await checkPin(db,row.userId,pin);
      if(p==='NOT_SET')throw fail('PIN_REQUIRED','Tài khoản chưa đặt PIN');
      if(p==='LOCKED'||p==='LOCKED_NOW'){if(p==='LOCKED_NOW')await hit(db,'pinFail',row.id);throw fail('PIN_LOCKED','PIN đang bị khoá (sai 3 lần); chờ 30 phút hoặc nhờ quản lý mở khoá');}
      if(p==='INVALID'){await hit(db,'pinFail',row.id);throw fail('PIN_INVALID','PIN chưa đúng');}
    }
    const c:Ctx={db,requestId,ip,token,url:new URL(req.url),body,key,audit};
    const data=write?await runWithOpsAuth({tokenId:row.id,userId:row.userId,operation:route.scope!},()=>route.run(c,params)):await route.run(c,params);
    return done(200,audit.replay?'REPLAY':'OK',{ok:true,data,error:null});
  }catch(e){
    if(e instanceof OpsError)return error(e);
    if(e instanceof ProxyDomainError)return error(fromDomain(e));
    if(e instanceof z.ZodError)return error(fail('VALIDATION','Dữ liệu chưa hợp lệ',{fields:e.issues.slice(0,10).map(i=>({path:i.path.join('.'),message:i.message}))}));
    console.error('ops-api',requestId,action,e instanceof Error?e.name:'error');
    return error(fail('INTERNAL','Lỗi máy chủ; dùng lại cùng Idempotency-Key để thử lại an toàn'));
  }
}
// ─── Scope helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// A project outside the token, or one the user is no longer a member of, is "not found" (nothing about other projects leaks).
async function projectOf(c:Ctx,raw:unknown){
  const projectId=typeof raw==='string'?raw:null;if(!projectId)throw fail('VALIDATION','Thiếu projectId');
  c.audit.projectId=projectId;
  if(!c.token.projectIds.includes(projectId))throw fail('NOT_FOUND','Không có dự án này trong phạm vi token');
  try{await loadInfrastructureScope(c.db,c.token.userId,projectId);}catch{throw fail('NOT_FOUND','Không có dự án này trong phạm vi token');}
  const ops=await memberOps(c.db,c.token.userId,projectId);if(!ops.READ)throw fail('FORBIDDEN','Tài khoản chưa có quyền đọc Server / VM ở dự án này');
  return {projectId,ops};
}
const q=(c:Ctx,name:string)=>c.url.searchParams.get(name);
// What an answer may show = the user's rights ∩ the token's operations: a right that only comes with a write operation (EARN_BALANCE,
// EARN_PAYOUT, PAYPAL_RECEIPT_RECORD) opens its data only when the token carries that operation; reading the PayPal money is READ.
async function rightsOf(c:Ctx,projectId:string):Promise<ViewRights>{
  const scope={userId:c.token.userId,projectId,role:'USER' as const,capabilities:[]},[b,p]=await Promise.all([balanceRights(scope,c.db),payoutRights(scope,c.db)]),has=(s:OpsScope)=>c.token.scopes.includes(s);
  const payoutEmail=p.payout&&has('PAYOUT')||p.receipt&&has('RECEIPT');
  return {balanceRead:p.money||b.write&&has('BALANCE_WRITE'),requestMoney:p.money||payoutEmail,payoutEmail};
}
const scopeOf=(c:Ctx,projectId:string)=>({userId:c.token.userId,projectId,role:'USER' as const,capabilities:[] as string[]});
// Cursor pages: a stable order with the id last; the cursor is the last id of the page; limit 1–200 (default 50).
function page(c:Ctx){const raw=q(c,'limit'),limit=raw==null?50:Number(raw);if(!Number.isInteger(limit)||limit<1||limit>200)throw fail('VALIDATION','limit từ 1 đến 200');const cursor=q(c,'cursor');if(cursor&&!/^[A-Za-z0-9_-]{1,64}$/.test(cursor))throw fail('VALIDATION','cursor không hợp lệ');return {limit,cursor};}
function paged<T extends {id:string}>(rows:T[],limit:number){const more=rows.length>limit,items=rows.slice(0,limit);return {items,nextCursor:more?items[items.length-1].id:null};}
// ─── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function me(c:Ctx){
  const u=await c.db.user.findUniqueOrThrow({where:{id:c.token.userId},select:{id:true,username:true,name:true}});
  const projects=await c.db.project.findMany({where:{id:{in:c.token.projectIds},members:{some:{userId:u.id}}},select:{id:true,code:true,name:true},orderBy:{name:'asc'}});
  const list=await Promise.all(projects.map(async p=>{const can=await memberOps(c.db,u.id,p.id),m=await c.db.projectMember.findUniqueOrThrow({where:{userId_projectId:{userId:u.id,projectId:p.id}}});
    return {projectId:p.id,code:p.code,name:p.name,role:m.role,capabilities:m.capabilities.filter(x=>['EARN_BALANCE','EARN_PAYOUT','PAYPAL_RECEIPT_RECORD','VM_PROXY_FOR_OPS'].includes(x)),
      effective:Object.fromEntries((OPS_SCOPES).map(s=>[s,can[s]&&c.token.scopes.includes(s)]))};}));
  return {user:{id:u.id,username:u.username,name:u.name},token:{id:c.token.id,prefix:c.token.prefix,name:c.token.name,expiresAt:c.token.expiresAt.toISOString(),scopes:c.token.scopes},projects:list};
}
async function projects(c:Ctx){
  const rows=await c.db.project.findMany({where:{id:{in:c.token.projectIds},members:{some:{userId:c.token.userId}}},select:{id:true,code:true,name:true},orderBy:{name:'asc'}});
  return {items:rows.map(p=>({id:p.id,code:p.code,name:p.name}))};
}
async function servers(c:Ctx){
  const {projectId}=await projectOf(c,q(c,'projectId')),{limit,cursor}=page(c);
  const rows=await c.db.server.findMany({where:{projectId,managed:true,archivedAt:null},select:{id:true,code:true,_count:{select:{vms:{where:{managed:true,archivedAt:null}}}}},orderBy:[{code:'asc'},{id:'asc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  const r=paged(rows,limit);return {items:r.items.map(s=>({id:s.id,code:s.code,vmCount:s._count.vms})),nextCursor:r.nextCursor};
}
async function vms(c:Ctx){
  const {projectId}=await projectOf(c,q(c,'projectId')),{limit,cursor}=page(c),serverId=q(c,'serverId');
  const rows=await c.db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null},...(serverId?{serverId}:{})},select:vmSelect,orderBy:[{server:{code:'asc'}},{code:'asc'},{id:'asc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  const r=paged(rows,limit);return {items:r.items.map(vmView),nextCursor:r.nextCursor};
}
async function resolveVm(c:Ctx){
  const {projectId}=await projectOf(c,q(c,'projectId')),server=q(c,'server')?.trim(),vm=q(c,'vm')?.trim();
  if(!server||!vm)throw fail('VALIDATION','Cần server và vm (mã đúng như trên web)');
  // Exact codes (case-insensitive, no partial match); a deleted VM or server never matches.
  const rows=await c.db.virtualMachine.findMany({where:{managed:true,archivedAt:null,code:{equals:vm,mode:'insensitive'},server:{projectId,managed:true,archivedAt:null,code:{equals:server,mode:'insensitive'}}},select:vmSelect,take:3});
  if(!rows.length)throw fail('NOT_FOUND','Không có VM '+vm+' trên server '+server+' trong dự án');
  if(rows.length>1)throw fail('AMBIGUOUS','Có '+rows.length+' VM khớp '+server+' / '+vm+' (khác hoa / thường); gọi /vms?serverId= rồi dùng id',{candidates:rows.map(r=>({id:r.id,serverCode:r.server.code,code:r.code}))});
  c.audit.objectId=rows[0].id;return vmView(rows[0]);
}
async function loadVm(c:Ctx,projectId:string,id:string){
  const vm=await c.db.virtualMachine.findFirst({where:{id,managed:true,server:{projectId,managed:true}},select:vmSelect});if(!vm)throw fail('NOT_FOUND','Không có VM này trong dự án');return vm;
}
async function vmDetail(c:Ctx,[id]:string[]){
  const {projectId}=await projectOf(c,q(c,'projectId')),vm=await loadVm(c,projectId,id),rights=await rightsOf(c,projectId),{limit,cursor}=page(c);c.audit.objectId=vm.id;
  const view=vmView(vm),cycle=view.expectedCycle,earnAppId=view.earnAppAccount?.id??null;
  const [sdks,request,cycles]=await Promise.all([
    c.db.sdkRecord.findMany({where:{projectId,holderVmId:vm.id},select:{linkState:true,amount:true,currency:true}}),
    earnAppId?c.db.earnPayoutRequest.findUnique({where:{earnAppId},select:requestSelect}):Promise.resolve(null),
    c.db.vmCycle.findMany({where:{projectId,vmId:vm.id},select:{id:true,number:true,reason:true,earnAppId:true,loginId:true,payoutRequestId:true,closedAt:true},orderBy:[{number:'desc'},{id:'asc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})}),
  ]);
  const logins=await c.db.gmailAccount.findMany({where:{id:{in:cycles.map(x=>x.loginId).filter((x):x is string=>!!x)}},select:{id:true,email:true}});
  const money=rights.balanceRead||rights.requestMoney,ref:Record<string,string>={};
  // SDK money is a note an operator kept on the code (reference only): never added to the EarnApp balance, shown with money rights.
  if(money)for(const s of sdks)if(s.amount!=null)ref[s.currency]=(Number(ref[s.currency]||0)+Number(s.amount)).toFixed(2);
  const pc=paged(cycles,limit),job=(await activeJobs(c.db,projectId,[vm.id])).get(vm.id)??null;
  return {...view,activeJob:job,
    sdk:{total:sdks.length,unused:sdks.filter(s=>s.linkState==='UNLINKED').length,used:sdks.filter(s=>s.linkState==='LINKED').length,unconfirmed:sdks.filter(s=>s.linkState==='UNCONFIRMED').length,referenceMoney:money?ref:null,note:'Tiền SDK là ghi chú tham khảo, không phải số dư EarnApp'},
    balance:earnAppId?await balanceView(c.db,projectId,{id:vm.id,cycle,earnAppId},rights.balanceRead):null,
    withdrawal:request&&request.vmId===vm.id&&request.cycle===cycle?withdrawalView(request,rights,{currentCycle:cycle}):null,
    pastCycles:{items:pc.items.map(x=>({number:x.number,reason:x.reason,earnAppAccountId:x.earnAppId,login:maskEmail(logins.find(l=>l.id===x.loginId)?.email),withdrawalId:x.payoutRequestId,closedAt:x.closedAt.toISOString()})),nextCursor:pc.nextCursor}};
}
async function earnAppDetail(c:Ctx,[id]:string[]){
  const {projectId}=await projectOf(c,q(c,'projectId')),rights=await rightsOf(c,projectId);
  const ea=await c.db.earnAppAccount.findFirst({where:{id,projectId},select:{id:true,closedAt:true,closedReason:true,registeredAt:true,login:{select:{email:true,loginType:true}},vm:{select:{id:true,code:true,archivedAt:true,server:{select:{code:true}},operation:{select:{cycle:true}}}},paypalEmail:{select:{id:true,email:true,paypal:{select:{code:true}}}},payoutRequest:{select:requestSelect}}});
  if(!ea)throw fail('NOT_FOUND','Không có tài khoản EarnApp này trong dự án');c.audit.objectId=ea.id;
  return {id:ea.id,state:ea.closedAt?'CLOSED':ea.vm?'ON_VM':'NOT_ON_VM',closedAt:ea.closedAt?.toISOString()??null,closedReason:ea.closedReason,registeredAt:ea.registeredAt?.toISOString()??null,login:maskEmail(ea.login.email),loginType:ea.login.loginType,
    vm:ea.vm&&!ea.vm.archivedAt?{id:ea.vm.id,code:ea.vm.code,serverCode:ea.vm.server.code,expectedCycle:ea.vm.operation?.cycle??1}:null,
    receivingEmail:ea.paypalEmail?{paypalEmailId:ea.paypalEmail.id,paypalCode:ea.paypalEmail.paypal.code,email:rights.payoutEmail?ea.paypalEmail.email:maskEmail(ea.paypalEmail.email)}:null,
    withdrawal:ea.payoutRequest?withdrawalView(ea.payoutRequest,rights,{currentCycle:ea.vm?.operation?.cycle??null}):null};
}
async function paypalSuggest(c:Ctx){
  const {projectId}=await projectOf(c,q(c,'projectId')),earnAppId=q(c,'earnAppAccountId'),currency=q(c,'currency'),amount=q(c,'amount');
  if(!earnAppId)throw fail('VALIDATION','Thiếu earnAppAccountId');if(!currency)throw fail('VALIDATION','Thiếu currency (ví dụ USD)');
  if(amount!=null&&!/^\d{1,10}(\.\d{1,2})?$/.test(amount))throw fail('VALIDATION','amount là chuỗi thập phân, ví dụ "10.00"');
  c.audit.objectId=earnAppId;return suggestPayout(scopeOf(c,projectId),{earnAppId,amount,currency},c.db);
}
const WITHDRAWAL_FILTER:Record<string,object>={PREPARING:{submission:'PREPARING',state:'REQUESTED'},SUBMITTED_ON_EARNAPP:{submission:'SENT',state:'REQUESTED'},UNKNOWN_RESULT:{submission:'UNKNOWN',state:'REQUESTED'},FAILED:{state:'FAILED'},CANCELLED:{state:'CANCELLED'}};
async function withdrawals(c:Ctx){
  const {projectId}=await projectOf(c,q(c,'projectId')),{limit,cursor}=page(c),st=q(c,'status'),rights=await rightsOf(c,projectId);
  if(st&&!WITHDRAWAL_FILTER[st])throw fail('VALIDATION','status: '+Object.keys(WITHDRAWAL_FILTER).join(' | '));
  const rows=await c.db.earnPayoutRequest.findMany({where:{projectId,...(st?WITHDRAWAL_FILTER[st]:{})},select:requestSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit+1,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  const cycles=new Map((await c.db.vmOperation.findMany({where:{vmId:{in:rows.map(r=>r.vmId)}},select:{vmId:true,cycle:true}})).map(o=>[o.vmId,o.cycle]));
  const r=paged(rows,limit);return {items:r.items.map(x=>withdrawalView(x,rights,{currentCycle:cycles.get(x.vmId)??1})),nextCursor:r.nextCursor};
}
async function loadRequest(c:Ctx,projectId:string,id:string){
  const r=await c.db.earnPayoutRequest.findFirst({where:{id,projectId},select:requestSelect});if(!r)throw fail('NOT_FOUND','Không có yêu cầu rút này trong dự án');
  const ops=await c.db.vmOperation.findUnique({where:{vmId:r.vmId},select:{cycle:true}});return {r,cycle:ops?.cycle??1};
}
async function withdrawalDetail(c:Ctx,[id]:string[]){
  const {projectId}=await projectOf(c,q(c,'projectId')),rights=await rightsOf(c,projectId),{r,cycle}=await loadRequest(c,projectId,id);c.audit.objectId=r.id;
  return withdrawalView(r,rights,{currentCycle:cycle,history:true});
}
// ─── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The service command key comes from the user, the project and the client's Idempotency-Key (not the token): a rotated token still
// replays the same command. The service compares the normalised content (never the token or PIN).
const serviceKey=(c:Ctx,projectId:string)=>'ops:'+createHash('sha256').update(c.token.userId+'\u0000'+projectId+'\u0000'+c.key).digest('hex').slice(0,48);
const id64=z.string().min(1).max(64),money=z.string().regex(/^\d{1,10}(\.\d{1,2})?$/,'Số tiền là chuỗi thập phân, ví dụ "10.00"'),cur=z.string().regex(/^[A-Za-z]{3,5}$/,'Đồng tiền 3–5 chữ cái'),iso=z.string().datetime({offset:true,message:'Thời điểm ISO 8601 có múi giờ'});
const note=z.string().max(300).nullish();
const BalanceBody=z.object({projectId:id64,expectedVmRevision:z.number().int().min(0),expectedCycle:z.number().int().min(1),earnAppAccountId:id64,status:z.enum(['OK','ERROR']),amount:money.nullish(),currency:cur.nullish(),withdrawable:z.boolean().nullish(),checkedAt:iso,errorMessage:note,evidenceNote:note}).strict();
type BalanceRecorded={checkId:string;vmId:string;cycle:number;earnAppId:string;outcome:string;amount:string|null;currency:string;withdrawable:string;checkedAt:string;recordedAt:string};
async function balanceCheck(c:Ctx,[vmId]:string[]){
  const b=BalanceBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  if(b.status==='OK'&&(b.amount==null||!b.currency))throw fail('VALIDATION','status OK cần amount và currency ("0.00" là hợp lệ)');
  if(b.status==='ERROR'&&b.amount!=null)throw fail('VALIDATION','status ERROR không nhận amount; số dư tốt gần nhất được giữ');
  if(b.status==='ERROR'&&!b.errorMessage?.trim())throw fail('VALIDATION','status ERROR cần errorMessage');
  if(b.withdrawable===true&&!b.evidenceNote?.trim())throw fail('VALIDATION','withdrawable=true cần evidenceNote: căn cứ đã thấy điều kiện rút trên EarnApp');
  const scope=scopeOf(c,projectId);let rec:BalanceRecorded|undefined;
  try{
    const r=await recordBalanceChecks(scope,{key:serviceKey(c,projectId),source:'AI',strict:true,items:[{vmId,expectedCycle:b.expectedCycle,earnAppId:b.earnAppAccountId,expectedVmRevision:b.expectedVmRevision,checkedAt:b.checkedAt,outcome:b.status==='OK'?'OK':'FAILED',amount:b.amount??null,currency:b.currency?.toUpperCase()??null,
      withdrawable:b.withdrawable===true?'YES':b.withdrawable===false?'NO':'UNKNOWN',failure:redactSecrets(b.errorMessage?.trim()||null),evidence:redactSecrets(b.evidenceNote?.trim()||null)}]},c.db);
    c.audit.replay=!!r.replay;rec=(r.recorded as BalanceRecorded[]|undefined)?.[0];
  }catch(e){throw await withCurrentVm(c,projectId,vmId,e);}
  if(!rec)throw fail('INTERNAL','Lệnh ghi không trả bản ghi; dùng lại cùng Idempotency-Key');
  // recorded / vm / balance = this command as it was first written (also on a replay); current = the VM now, named apart.
  const rights=await rightsOf(c,projectId),vm=await c.db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},select:vmSelect}),view=vm?vmView(vm):null;c.audit.objectId=rec.checkId;
  return {replay:!!c.audit.replay,
    recorded:{checkId:rec.checkId,vmId:rec.vmId,expectedCycle:rec.cycle,earnAppAccountId:rec.earnAppId,status:rec.outcome==='OK'?'OK':'ERROR',amount:rights.balanceRead?rec.amount:null,currency:rec.currency,withdrawable:rec.withdrawable==='YES'?true:rec.withdrawable==='NO'?false:null,checkedAt:rec.checkedAt,recordedAt:rec.recordedAt},
    vm:{id:rec.vmId,expectedCycle:rec.cycle,earnAppAccountId:rec.earnAppId},
    balance:await balanceAsOf(c.db,projectId,rec,rights.balanceRead),
    current:view?{vm:{id:view.id,expectedCycle:view.expectedCycle,revision:view.revision,earnAppAccountId:view.earnAppAccount?.id??null,deleted:view.deleted},
      balance:view.earnAppAccount?await balanceView(c.db,projectId,{id:view.id,cycle:view.expectedCycle,earnAppId:view.earnAppAccount.id},rights.balanceRead):null}:null};
}
// A conflict answers with the current state the caller may see, so it can decide; nothing is retried with the new revision.
async function withCurrentVm(c:Ctx,projectId:string,vmId:string,e:unknown){
  const err=e instanceof ProxyDomainError?fromDomain(e):e;
  if(err instanceof OpsError&&['REVISION_CONFLICT','CYCLE_CHANGED','ACCOUNT_CHANGED'].includes(err.code)){
    const vm=await c.db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},select:vmSelect});
    if(vm){const v=vmView(vm);return fail(err.code,err.message,{...err.details,current:{vmId:v.id,expectedCycle:v.expectedCycle,revision:v.revision,earnAppAccountId:v.earnAppAccount?.id??null,deleted:v.deleted}});}
  }
  return err;
}
async function withCurrentRequest(c:Ctx,projectId:string,requestId:string,e:unknown){
  const err=e instanceof ProxyDomainError?fromDomain(e):e;
  if(err instanceof OpsError&&['REVISION_CONFLICT','CYCLE_CHANGED','ACCOUNT_CHANGED','DUPLICATE','VALIDATION'].includes(err.code)){
    const r=await c.db.earnPayoutRequest.findFirst({where:{id:requestId,projectId},select:requestSelect});
    if(r){const ops=await c.db.vmOperation.findUnique({where:{vmId:r.vmId},select:{cycle:true}});return fail(err.code,err.message,{...err.details,current:withdrawalView(r,await rightsOf(c,projectId),{currentCycle:ops?.cycle??1})});}
  }
  return err;
}
const PrepareBody=z.object({projectId:id64,vmId:id64,expectedVmRevision:z.number().int().min(0),expectedCycle:z.number().int().min(1),earnAppAccountId:id64,paypalEmailId:id64,amount:money,currency:cur,requestedAt:iso}).strict();
async function prepare(c:Ctx){
  const b=PrepareBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=b.vmId;
  const at=new Date(b.requestedAt);if(at.getTime()>Date.now()+5*60e3)throw fail('VALIDATION','requestedAt ở tương lai');
  let rec:{id:string;vmId:string;cycle:number;earnAppId:string;paypalEmailId:string;amount:string;currency:string;submission:string;requestedOn:string};
  try{
    const r=await createPayoutRequest(scopeOf(c,projectId),{key:serviceKey(c,projectId),vmId:b.vmId,expectedCycle:b.expectedCycle,expectedVmRevision:b.expectedVmRevision,earnAppId:b.earnAppAccountId,paypalEmailId:b.paypalEmailId,amount:b.amount,currency:b.currency.toUpperCase(),date:dayText(at),submission:'PREPARING',reference:null},c.db);
    rec=r as unknown as typeof rec;c.audit.replay=!!r.replay;
  }catch(e){
    const err=await withCurrentVm(c,projectId,b.vmId,e);
    if(err instanceof OpsError&&err.code==='DUPLICATE'&&typeof err.details?.withdrawalId==='string'){const {r,cycle}=await loadRequest(c,projectId,err.details.withdrawalId);throw fail('DUPLICATE','EarnApp này đã có yêu cầu rút; mỗi EarnApp chỉ một lượt rút. Dùng yêu cầu cũ, không tạo mới',{withdrawalId:r.id,current:withdrawalView(r,await rightsOf(c,projectId),{currentCycle:cycle})});}
    throw err;
  }
  c.audit.objectId=rec.id;const {r,cycle}=await loadRequest(c,projectId,rec.id),rights=await rightsOf(c,projectId);
  return {replay:!!c.audit.replay,
    recorded:{withdrawalId:rec.id,vmId:rec.vmId,cycle:rec.cycle,earnAppAccountId:rec.earnAppId,paypalEmailId:rec.paypalEmailId,amount:rights.requestMoney?rec.amount:null,currency:rec.currency,submission:'PREPARING',requestedOn:rec.requestedOn},
    current:{withdrawal:withdrawalView(r,rights,{currentCycle:cycle})}};
}
const StatusBody=z.object({projectId:id64,vmId:id64,expectedVmRevision:z.number().int().min(0),expectedCycle:z.number().int().min(1),earnAppAccountId:id64,expectedRequestRevision:z.number().int().min(0),status:z.enum(['SUBMITTED_ON_EARNAPP','UNKNOWN_RESULT']),evidenceNote:note,observedAt:iso}).strict();
async function status(c:Ctx,[id]:string[]){
  const b=StatusBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=id;
  if(b.status==='SUBMITTED_ON_EARNAPP'&&!b.evidenceNote?.trim())throw fail('VALIDATION','SUBMITTED_ON_EARNAPP cần evidenceNote: đã thấy yêu cầu trong lịch sử rút của EarnApp');
  if(new Date(b.observedAt).getTime()>Date.now()+5*60e3)throw fail('VALIDATION','observedAt ở tương lai');
  let rec:{changed?:boolean;action?:string;vmId?:string;cycle?:number;earnAppId?:string;revision?:number;submission?:string;state?:string;observedAt?:string|null}={};
  try{
    const r=await updatePayoutRequest(scopeOf(c,projectId),{key:serviceKey(c,projectId),requestId:id,expectedRevision:b.expectedRequestRevision,action:b.status==='SUBMITTED_ON_EARNAPP'?'SENT':'UNKNOWN',note:redactSecrets(b.evidenceNote?.trim()||null),vmId:b.vmId,expectedCycle:b.expectedCycle,earnAppId:b.earnAppAccountId,expectedVmRevision:b.expectedVmRevision,observedAt:b.observedAt},c.db);
    c.audit.replay=!!r.replay;rec=r as typeof rec;
  }catch(e){throw await withCurrentRequest(c,projectId,id,e);}
  const {r,cycle}=await loadRequest(c,projectId,id),changed=rec.changed!==false;
  return {replay:!!c.audit.replay,changed,
    recorded:changed?{withdrawalId:id,status:rec.action==='SENT'?'SUBMITTED_ON_EARNAPP':'UNKNOWN_RESULT',vmId:rec.vmId,cycle:rec.cycle,earnAppAccountId:rec.earnAppId,revisionAfter:rec.revision,observedAt:rec.observedAt??null}:{withdrawalId:id,status:null,note:'Không thay đổi (đã ở trạng thái này)'},
    current:{withdrawal:withdrawalView(r,await rightsOf(c,projectId),{currentCycle:cycle})}};
}
const ReceiptBody=z.object({projectId:id64,expectedRequestRevision:z.number().int().min(0),amount:money,currency:cur,receivedAt:iso,transactionId:z.string().min(1).max(100).nullish(),evidenceNote:note}).strict();
async function receipt(c:Ctx,[id]:string[]){
  const b=ReceiptBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=id;
  let rec:{receiptId:string;requestId:string;amount:string;currency:string;receivedOn:string;receivedAt:string;transactionId:string|null;earnAppId:string;paypalEmailId:string};
  try{
    const r=await recordPayoutReceipt(scopeOf(c,projectId),{key:serviceKey(c,projectId),requestId:id,expectedRequestRevision:b.expectedRequestRevision,amount:b.amount,currency:b.currency.toUpperCase(),receivedAt:b.receivedAt,transactionId:b.transactionId?.trim()||null,evidence:redactSecrets(b.evidenceNote?.trim()||null)},c.db);
    rec=r as unknown as typeof rec;c.audit.replay=!!r.replay;
  }catch(e){throw await withCurrentRequest(c,projectId,id,e);}
  const {r,cycle}=await loadRequest(c,projectId,id),rights=await rightsOf(c,projectId);c.audit.objectId=rec.receiptId;
  return {replay:!!c.audit.replay,
    recorded:{receiptId:rec.receiptId,withdrawalId:rec.requestId,earnAppAccountId:rec.earnAppId,paypalEmailId:rec.paypalEmailId,amount:rights.requestMoney?rec.amount:null,currency:rec.currency,receivedOn:rec.receivedOn,receivedAt:rec.receivedAt,transactionId:rec.transactionId},
    current:{withdrawal:withdrawalView(r,rights,{currentCycle:cycle,history:true})}};
}

// ─── Real machines (21/10/2026) ──────────────────────────────────────────────────────────────────────────────────────────────────
// MoneyToHome never reaches the machine: the operator works with AE Mini Tool and records here what it observed (vm-ops/jobs.ts).
const caller=(c:Ctx):OpsCaller=>({tokenId:c.token.id,tokenLabel:c.token.name+' ('+c.token.prefix+')'});
const cycleN=z.number().int().min(1),rev=z.number().int().min(0),opsNote=z.string().max(500).nullish();
async function vmNow(c:Ctx,projectId:string,vmId:string){
  const vm=await c.db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},select:vmSelect});if(!vm)return null;
  return {...vmView(vm),activeJob:(await activeJobs(c.db,projectId,[vm.id])).get(vm.id)??null};
}
async function jobOf(c:Ctx,projectId:string,id:string){const job=await c.db.vmJob.findFirst({where:{id,projectId}});if(!job)throw fail('NOT_FOUND','Không có việc này trong dự án');return job;}
async function asOps<T>(c:Ctx,projectId:string,vmId:string,fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){throw await withCurrentVm(c,projectId,vmId,e);}}
async function jobDetail(c:Ctx,[id]:string[]){
  const {projectId}=await projectOf(c,q(c,'projectId')),job=await jobOf(c,projectId,id);c.audit.objectId=job.id;
  const sdk=job.sdkId?await c.db.sdkRecord.findUnique({where:{id:job.sdkId},select:{code:true}}):null;
  return {...jobView(job,{sdkCode:sdk?.code}),current:await vmNow(c,projectId,job.vmId)};
}
const ClaimBody=z.object({projectId:id64,expectedCycle:cycleN,kind:z.enum(JOB_KINDS),ttlMinutes:z.number().int().min(5).max(240).nullish()}).strict();
async function claim(c:Ctx,[vmId]:string[]){
  const b=ClaimBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  const r=await asOps(c,projectId,vmId,()=>claimVmJob(scopeOf(c,projectId),{key:serviceKey(c,projectId),vmId,expectedCycle:b.expectedCycle,kind:b.kind,ttlMinutes:b.ttlMinutes??null},c.db,caller(c)));
  c.audit.replay=!!r.replay;c.audit.objectId=r.job.id;
  return {replay:!!r.replay,recorded:{job:r.job,vm:r.vm,resumed:r.resumed,already:r.already},current:await vmNow(c,projectId,vmId)};
}
const StepBody=z.object({projectId:id64,step:z.string().min(2).max(40),note:opsNote,machineRef:z.string().max(120).nullish(),ttlMinutes:z.number().int().min(5).max(240).nullish()}).strict();
async function jobStep(c:Ctx,[id]:string[]){
  const b=StepBody.parse(c.body),{projectId}=await projectOf(c,b.projectId),job=await jobOf(c,projectId,id);c.audit.objectId=job.id;
  const r=await stepVmJob(scopeOf(c,projectId),{key:serviceKey(c,projectId),jobId:id,step:b.step,note:redactSecrets(b.note?.trim()||null),machineRef:b.machineRef??null,ttlMinutes:b.ttlMinutes??null},c.db,caller(c));
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:r.job,current:await vmNow(c,projectId,job.vmId)};
}
const ReleaseBody=z.object({projectId:id64,note:opsNote}).strict();
async function jobRelease(c:Ctx,[id]:string[]){
  const b=ReleaseBody.parse(c.body),{projectId}=await projectOf(c,b.projectId),job=await jobOf(c,projectId,id);c.audit.objectId=job.id;
  const r=await releaseVmJob(scopeOf(c,projectId),{key:serviceKey(c,projectId),jobId:id,note:redactSecrets(b.note?.trim()||null)},c.db,caller(c));
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:r.job,current:await vmNow(c,projectId,job.vmId)};
}
// The only answer of the API with a full proxy: the VM in hand (active job of this token), its current configuration. Not journaled;
// audited as VM_PROXY_FOR_OPS (who, token, VM, proxy id, configuration) without the credentials.
const ProxyBody=z.object({projectId:id64,jobId:id64,expectedCycle:cycleN}).strict();
async function proxyCredentials(c:Ctx,[vmId]:string[]){
  const b=ProxyBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  const r=await asOps(c,projectId,vmId,()=>proxyForJob(scopeOf(c,projectId),{vmId,jobId:b.jobId,expectedCycle:b.expectedCycle},c.db,caller(c)));
  return {replay:false,recorded:{vmId:r.vmId,cycle:r.cycle,configurationId:r.configurationId,endpointId:r.endpointId},proxy:r.proxy};
}
const SdkBody=z.object({projectId:id64,jobId:id64,expectedCycle:cycleN,expectedVmRevision:rev,code:z.string().min(8).max(128)}).strict();
async function vmSdk(c:Ctx,[vmId]:string[]){
  const b=SdkBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  const r=await asOps(c,projectId,vmId,()=>recordJobSdk(scopeOf(c,projectId),{key:serviceKey(c,projectId),vmId,jobId:b.jobId,expectedCycle:b.expectedCycle,expectedVmRevision:b.expectedVmRevision,code:b.code},c.db,caller(c)));
  // replay = the same key and request answered from the first command (recorded identical); readBack = a new command with the code already saved.
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:{vmId,jobId:r.jobId,sdk:r.sdk,changed:r.changed,readBack:r.readBack},current:await vmNow(c,projectId,vmId)};
}
// Statuses an operator records from what it saw. New VM / Chờ áp dụng proxy end only through finish-prepare / finish-proxy; Blocked has
// its own endpoint (the proxy it found blocked); VM deleted is the owner's.
const AI_STATUSES=['OK','NOT_LINKED','LINKED','EARN_ERROR','OFF','SUSPENDED','MAIL_LOGGED'] as const;
const StatusBodyVm=z.object({projectId:id64,expectedCycle:cycleN,expectedStatusRevision:rev,status:z.enum(AI_STATUSES),note:opsNote}).strict();
async function statusRow(c:Ctx,projectId:string,vmId:string,r:{rows:{outcome:string;message:string;status:string|null}[];replay?:boolean}){
  const row=r.rows[0];
  if(row.outcome==='ERROR'){
    const reason=/lượt/.test(row.message)?'CYCLE_CHANGED':/quyền/i.test(row.message)?null:'REVISION_CONFLICT';
    throw await withCurrentVm(c,projectId,vmId,reason?new ProxyDomainError('STALE_PREVIEW',row.message,reason):new ProxyDomainError('FORBIDDEN',row.message));
  }
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:{vmId,outcome:row.outcome,status:row.status,message:row.message},current:await vmNow(c,projectId,vmId)};
}
async function vmStatus(c:Ctx,[vmId]:string[]){
  const b=StatusBodyVm.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  if((b.status==='EARN_ERROR'||b.status==='SUSPENDED')&&!b.note?.trim())throw fail('VALIDATION','Ghi lý do khi báo '+b.status);
  const r=await asOps(c,projectId,vmId,()=>setVmStatus(scopeOf(c,projectId),{key:serviceKey(c,projectId),items:[{vmId,status:b.status,expectedCycle:b.expectedCycle,expectedRevision:b.expectedStatusRevision}],note:redactSecrets(b.note?.trim()||null)},c.db,{operator:true}));
  return statusRow(c,projectId,vmId,r);
}
const BlockedBody=z.object({projectId:id64,expectedCycle:cycleN,expectedStatusRevision:rev,configurationId:id64,evidence:z.string().min(3).max(300),observedAt:iso.nullish()}).strict();
async function vmBlocked(c:Ctx,[vmId]:string[]){
  const b=BlockedBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  const cfg=await c.db.vMConfiguration.findFirst({where:{id:b.configurationId,projectId,vmId},select:{endpointId:true}});
  if(!cfg?.endpointId)throw fail('NOT_FOUND','Không có cấu hình proxy này của VM');
  const note='AI báo Blocked'+(b.observedAt?' lúc '+b.observedAt:'')+': '+redactSecrets(b.evidence.trim());
  const r=await asOps(c,projectId,vmId,()=>setVmStatus(scopeOf(c,projectId),{key:serviceKey(c,projectId),items:[{vmId,status:'PROXY_BLOCKED',expectedCycle:b.expectedCycle,expectedRevision:b.expectedStatusRevision,expectedEndpointId:cfg.endpointId}],note},c.db,{operator:true}));
  return statusRow(c,projectId,vmId,r);
}
const NoteBody=z.object({projectId:id64,expectedCycle:cycleN,note:z.string().min(1).max(500),jobId:id64.nullish()}).strict();
async function vmNote(c:Ctx,[vmId]:string[]){
  const b=NoteBody.parse(c.body),{projectId}=await projectOf(c,b.projectId);c.audit.objectId=vmId;
  const r=await asOps(c,projectId,vmId,()=>addVmOpsNote(scopeOf(c,projectId),{key:serviceKey(c,projectId),vmId,expectedCycle:b.expectedCycle,note:b.note,jobId:b.jobId??null},c.db,caller(c),t=>redactSecrets(t)??''));
  c.audit.replay=!!r.replay;c.audit.objectId=r.recorded.noteId;return {replay:!!r.replay,recorded:r.recorded,current:await vmNow(c,projectId,vmId)};
}
const Checks=z.object({machine:z.boolean(),proxy:z.boolean(),internet:z.boolean(),earnapp:z.boolean(),firefox:z.boolean()}).strict();
const FinishPrepareBody=z.object({projectId:id64,configurationId:id64,checks:Checks,note:opsNote}).strict();
async function finishPrepare(c:Ctx,[id]:string[]){
  const b=FinishPrepareBody.parse(c.body),{projectId}=await projectOf(c,b.projectId),job=await jobOf(c,projectId,id);c.audit.objectId=job.id;
  const r=await asOps(c,projectId,job.vmId,()=>finishPrepareJob(scopeOf(c,projectId),{key:serviceKey(c,projectId),jobId:id,configurationId:b.configurationId,checks:b.checks,note:redactSecrets(b.note?.trim()||null)},c.db,caller(c)));
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:{...r.recorded,job:r.job},current:await vmNow(c,projectId,job.vmId)};
}
const FinishProxyBody=z.object({projectId:id64,configurationId:id64,result:z.enum(APPLY_RESULTS),note:opsNote}).strict();
async function finishProxy(c:Ctx,[id]:string[]){
  const b=FinishProxyBody.parse(c.body),{projectId}=await projectOf(c,b.projectId),job=await jobOf(c,projectId,id);c.audit.objectId=job.id;
  const r=await asOps(c,projectId,job.vmId,()=>finishProxyJob(scopeOf(c,projectId),{key:serviceKey(c,projectId),jobId:id,configurationId:b.configurationId,result:b.result,note:redactSecrets(b.note?.trim()||null)},c.db,caller(c)));
  c.audit.replay=!!r.replay;return {replay:!!r.replay,recorded:{...r.recorded,job:r.job},current:await vmNow(c,projectId,job.vmId)};
}
