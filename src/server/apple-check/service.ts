import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {Prisma,PrismaClient,AppleCheckJob} from '@prisma/client';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {withProxyTransaction} from '../proxy-management/transaction';
import {decodeEndpoint,getEligibleInventory} from '../proxy-management/repository';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {hasServerScope,scopedLoginWhere} from '../permissions/server-scope';
import {assertStockWrite} from '../account-store/inventory';

type DB=PrismaClient|Prisma.TransactionClient;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const bad=(s:string)=>new ProxyDomainError('INVALID_INPUT',s);
const conflict=(s:string)=>new ProxyDomainError('STALE_PREVIEW',s,'REVISION_CONFLICT');
const denied=()=>new ProxyDomainError('FORBIDDEN','Không có quyền kiểm tra Apple ID');
const now=()=>new Date();
const LEASE=90_000,HARD=180_000,COOLDOWN=15*60_000;
export const CHECK_RESULTS=['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','CHALLENGE_REQUIRED','INVALID_CREDENTIALS','PROXY_ERROR','NETWORK_ERROR','TIMEOUT','UNKNOWN','CANCELLED'] as const;
export const UNKNOWN_REASON_CODES=['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED','EMAIL_ENTRY_FAILED','PASSWORD_SUBMIT_FAILED','RESPONSE_READ_FAILED'] as const;
const unknownReasons=new Set<string>(UNKNOWN_REASON_CODES);
const reason=z.enum([...CHECK_RESULTS,...UNKNOWN_REASON_CODES]);
const binding=z.object({jobId:z.string().min(1).max(100),leaseToken:z.string().min(20).max(100)}).strict();
const resultBody=binding.extend({result:z.enum(CHECK_RESULTS),reasonCode:reason,cleanup:z.enum(['OK','FAILED']),observedAt:z.iso.datetime()}).strict();
export const checkBatchAccounts=z.array(z.object({accountId:z.string().min(1),expectedRevision:z.number().int().nonnegative(),key:z.string().min(8).max(100)}).strict()).min(1).max(5);
type Body=z.infer<typeof resultBody>;

async function rights(db:DB,s:ActorScope,write=false){
 const current=await loadInfrastructureScope(db,s.userId,s.projectId);
 if(write){assertStockWrite(current,'LOGIN');if(hasServerScope(current))throw denied();}
 return current;
}
async function audit(db:DB,projectId:string,userId:string,action:string,entityId:string,changes:Prisma.InputJsonValue){await db.auditLog.create({data:{projectId,userId,action,entity:'AppleCheck',entityId,changes}});}
function view(j:AppleCheckJob,revision:number|undefined){return {id:j.id,accountId:j.accountId,accountRevision:j.accountRevision,phase:j.phase,result:j.result,reasonCode:j.reasonCode,cleanup:j.cleanup,createdAt:j.createdAt.toISOString(),observedAt:j.observedAt?.toISOString()??null,stale:revision===undefined||revision!==(j.appliedRevision??j.accountRevision),cancelRequested:j.cancelRequested};}
async function jobView(db:DB,j:AppleCheckJob){const a=await db.gmailAccount.findUnique({where:{id:j.accountId},select:{revision:true}});return view(j,a?.revision);}

export async function readChecks(s:ActorScope,db:PrismaClient=prisma){
 const current=await rights(db,s),canManage=current.role==='ADMIN'&&!hasServerScope(current),canCheck=['ADMIN','MODERATOR'].includes(current.role)&&!hasServerScope(current);
 if(current.role!=='ADMIN'&&!current.allowedModules?.includes('INFRASTRUCTURE'))throw denied();
 const accountWhere=scopedLoginWhere(current);
 const jobs=await db.appleCheckJob.findMany({where:{projectId:s.projectId,account:accountWhere},orderBy:{createdAt:'desc'},take:1000,include:{account:{select:{revision:true}}}});
 const w=canManage||canCheck?await db.appleCheckWorker.findUnique({where:{projectId:s.projectId}}):null;
 const customGroups=canManage?await db.proxyGroup.findMany({where:{projectId:s.projectId,archivedAt:null},select:{id:true,name:true},orderBy:{name:'asc'}}):[];
 const groups=canManage?[{id:'TUT',name:'TUT · proxy NEW chưa gán'},...customGroups]:[];
 return {canManage,canCheck,groups,worker:w?{id:w.id,name:w.name,enabled:w.enabled,online:!!w.lastSeenAt&&Date.now()-w.lastSeenAt.getTime()<LEASE,state:w.state,proxyGroupId:w.proxyGroupId,lastSeenAt:w.lastSeenAt?.toISOString()??null}:null,jobs:jobs.map(j=>view(j,j.account.revision))};
}

export async function configureWorker(s:ActorScope,input:{name:string;proxyGroupId:string},db:PrismaClient=prisma){
 const token='mth_apple_'+secret();
 return withProxyTransaction(async tx=>{
  const c=await rights(tx,s,true);if(c.role!=='ADMIN')throw denied();
  const name=z.string().trim().min(1).max(100).parse(input.name);
  if(input.proxyGroupId!=='TUT'&&!await tx.proxyGroup.findFirst({where:{id:input.proxyGroupId,projectId:s.projectId,archivedAt:null}}))throw bad('Chọn nhóm proxy kiểm tra trong dự án');
  if(await tx.appleCheckJob.findFirst({where:{projectId:s.projectId,activeWorkerId:{not:null}}}))throw conflict('Worker còn phiên chưa dọn; dọn xong trước khi đổi kết nối');
  const old=await tx.appleCheckWorker.findUnique({where:{projectId:s.projectId}});
  const data={createdById:s.userId,name,proxyGroupId:input.proxyGroupId,tokenHash:hash(token),previousTokenHash:old?.tokenHash??null,enabled:true,state:'OFFLINE',lastSeenAt:null};
  const w=await tx.appleCheckWorker.upsert({where:{projectId:s.projectId},create:{projectId:s.projectId,...data},update:data});
  await audit(tx,s.projectId,s.userId,'APPLE_CHECK_CONFIGURE',w.id,{proxyGroupId:input.proxyGroupId});
  return {workerId:w.id,token};
 },db);
}
export async function disableWorker(s:ActorScope,db:PrismaClient=prisma){return withProxyTransaction(async tx=>{
 const c=await rights(tx,s,true);if(c.role!=='ADMIN')throw denied();
 const w=await tx.appleCheckWorker.findUnique({where:{projectId:s.projectId}});if(!w)return;
 await tx.appleCheckWorker.update({where:{id:w.id},data:{enabled:false}});
 await tx.appleCheckJob.updateMany({where:{projectId:s.projectId,phase:'QUEUED'},data:{phase:'DONE',result:'CANCELLED',reasonCode:'CANCELLED',cleanup:'OK',activeAccountId:null,cancelRequested:true}});
 await tx.appleCheckJob.updateMany({where:{projectId:s.projectId,activeAccountId:{not:null}},data:{cancelRequested:true}});
 await audit(tx,s.projectId,s.userId,'APPLE_CHECK_DISABLE',w.id,{});
},db);}
type CheckRequest={accountId:string;expectedRevision:number;key:string};
async function requestCheckInTransaction(s:ActorScope,input:CheckRequest,tx:Prisma.TransactionClient){
 await rights(tx,s,true);
 z.string().min(8).max(100).parse(input.key);
 await tx.$queryRaw`SELECT "id" FROM "GmailAccount" WHERE "id"=${input.accountId} FOR UPDATE`;
 const a=await tx.gmailAccount.findFirst({where:{id:input.accountId,projectId:s.projectId,archivedAt:null,loginType:'APPLE_ID'}});if(!a)throw new ProxyDomainError('NOT_FOUND');
 const old=await tx.appleCheckRequest.findUnique({where:{projectId_key:{projectId:s.projectId,key:input.key}},include:{job:true}});
 if(old){if(old.accountId!==a.id||old.accountRevision!==input.expectedRevision)throw conflict('Khoá yêu cầu đã dùng cho nội dung khác');return jobView(tx,old.job);}
 const active=await tx.appleCheckJob.findUnique({where:{activeAccountId:a.id}});if(active){
  await tx.appleCheckRequest.create({data:{projectId:s.projectId,key:input.key,accountId:a.id,accountRevision:input.expectedRevision,jobId:active.id}});return jobView(tx,active);
 }
 if(a.revision!==input.expectedRevision)throw conflict('Tài khoản vừa thay đổi; tải lại trước khi kiểm tra');
 if(!a.password)throw bad('Tài khoản chưa có mật khẩu');
 const w=await tx.appleCheckWorker.findUnique({where:{projectId:s.projectId}});if(!w?.enabled)throw bad('ADMIN cần kết nối worker và chọn nhóm proxy kiểm tra');
 const recent=await tx.appleCheckJob.findFirst({where:{accountId:a.id,submittedAt:{gt:new Date(Date.now()-COOLDOWN)}}});if(recent)throw bad('Tài khoản vừa được kiểm tra; chờ ít nhất 15 phút trước lần tiếp theo');
 const j=await tx.appleCheckJob.create({data:{projectId:s.projectId,accountId:a.id,accountRevision:a.revision,requestedById:s.userId,requestKey:input.key,activeAccountId:a.id}});
 await tx.appleCheckRequest.create({data:{projectId:s.projectId,key:input.key,accountId:a.id,accountRevision:input.expectedRevision,jobId:j.id}});
 await audit(tx,s.projectId,s.userId,'APPLE_CHECK_REQUEST',j.id,{accountId:a.id,revision:a.revision});return view(j,a.revision);
}
export async function requestCheck(s:ActorScope,input:CheckRequest,db:PrismaClient=prisma){return withProxyTransaction(tx=>requestCheckInTransaction(s,input,tx),db);}
export async function requestCheckBatch(s:ActorScope,input:{accounts:CheckRequest[]},db:PrismaClient=prisma){
 const accounts=checkBatchAccounts.parse(input.accounts);
 return withProxyTransaction(async tx=>{
  const jobs:Awaited<ReturnType<typeof requestCheckInTransaction>>[]=[];
  for(const account of accounts)jobs.push(await requestCheckInTransaction(s,account,tx));
  return {jobs};
 },db);
}
export async function cancelCheck(s:ActorScope,id:string,db:PrismaClient=prisma){return withProxyTransaction(async tx=>{
 await rights(tx,s,true);const j=await tx.appleCheckJob.findFirst({where:{id,projectId:s.projectId}});if(!j)throw new ProxyDomainError('NOT_FOUND');
 if(j.phase==='QUEUED'){const x=await tx.appleCheckJob.update({where:{id},data:{phase:'DONE',result:'CANCELLED',reasonCode:'CANCELLED',cleanup:'OK',cancelRequested:true,activeAccountId:null}});return jobView(tx,x);}
 if(j.activeAccountId)return jobView(tx,await tx.appleCheckJob.update({where:{id},data:{cancelRequested:true}}));return jobView(tx,j);
},db);}

async function auth(tx:Prisma.TransactionClient,token:string,cleanupOnly=false){
 if(!/^mth_apple_[A-Za-z0-9_-]{43}$/.test(token))throw denied();
 const w=await tx.appleCheckWorker.findFirst({where:{OR:[{tokenHash:hash(token)},...(cleanupOnly?[{previousTokenHash:hash(token)}]:[])]}});if(!w)throw denied();
 await tx.$queryRaw`SELECT "id" FROM "AppleCheckWorker" WHERE "id"=${w.id} FOR UPDATE`;
 const fresh=await tx.appleCheckWorker.findUniqueOrThrow({where:{id:w.id}});
 let permitted=false;
 try{const c=await loadInfrastructureScope(tx,fresh.createdById,fresh.projectId);permitted=c.role==='ADMIN'&&!hasServerScope(c)&&fresh.enabled&&fresh.tokenHash===hash(token);}catch{if(!cleanupOnly)throw denied();}
 if(!permitted&&!cleanupOnly)throw denied();
 return {w:fresh,permitted};
}
async function own(tx:Prisma.TransactionClient,workerId:string,b:z.infer<typeof binding>,timely=true){
 await tx.$queryRaw`SELECT "id" FROM "AppleCheckJob" WHERE "id"=${b.jobId} FOR UPDATE`;
 const j=await tx.appleCheckJob.findUnique({where:{id:b.jobId}});
 if(!j||j.workerId!==workerId||j.leaseHash!==hash(b.leaseToken))throw denied();
 if(timely&&(!j.expiresAt||j.expiresAt.getTime()<=Date.now()||!j.hardDeadline||j.hardDeadline.getTime()<=Date.now()||j.cancelRequested))throw conflict('Việc đã hết hạn hoặc bị huỷ; dọn phiên và báo kết quả');
 return j;
}
async function accountForJob(tx:Prisma.TransactionClient,j:AppleCheckJob){
 await tx.$queryRaw`SELECT "id" FROM "GmailAccount" WHERE "id"=${j.accountId} FOR UPDATE`;
 const a=await tx.gmailAccount.findFirst({where:{id:j.accountId,projectId:j.projectId,archivedAt:null,loginType:'APPLE_ID'}});
 if(!a||a.revision!==j.accountRevision)throw conflict('Tài khoản đã thay đổi; không đăng nhập thông tin cũ');
 const c=await loadInfrastructureScope(tx,j.requestedById,j.projectId);assertStockWrite(c,'LOGIN');if(hasServerScope(c))throw denied();return a;
}

export async function workerAction(token:string,action:string,body:unknown,db:PrismaClient=prisma):Promise<unknown>{return withProxyTransaction(async tx=>{
 const cleanupOnly=action==='result'||action==='heartbeat-job'||action==='cleanup-recovered'||action==='claim';
 const {w,permitted}=await auth(tx,token,cleanupOnly);
 if(action==='heartbeat'){
  const b=z.object({state:z.enum(['IDLE','BUSY','WAITING_DESKTOP','WAITING_RESOURCES','CLEANUP_FAILED'])}).strict().parse(body);
  await tx.appleCheckWorker.update({where:{id:w.id},data:{lastSeenAt:now(),state:w.state==='CLEANUP_FAILED'?'CLEANUP_FAILED':b.state}});
  return {workerId:w.id,enabled:w.enabled};
 }
 if(action==='claim'){
  const {key}=z.object({key:z.string().min(8).max(100)}).strict().parse(body);
  const previous=await tx.appleCheckJob.findUnique({where:{workerId_claimKey:{workerId:w.id,claimKey:key}}});
  const leaseFor=(id:string)=>createHmac('sha256',token).update('apple-claim:'+id+':'+key).digest('base64url');
  if(previous){
   if(previous.phase==='DONE'&&previous.cleanup==='OK')return {job:null,completed:true};
   return {job:{id:previous.id,leaseToken:leaseFor(previous.id),accountId:previous.accountId,accountRevision:previous.accountRevision,expiresAt:previous.expiresAt!.toISOString(),recoveryOnly:!permitted||previous.phase!=='CLAIMED'||previous.cancelRequested||previous.expiresAt!.getTime()<=Date.now()||!previous.hardDeadline||previous.hardDeadline.getTime()<=Date.now()}};
  }
  if(!permitted)throw denied(); // revoked credentials may recover an existing lease only, never claim fresh work.
  if(w.state==='CLEANUP_FAILED')throw conflict('Dọn phiên lỗi; cần khôi phục cleanup trước khi nhận việc mới');
  const held=await tx.appleCheckJob.findUnique({where:{activeWorkerId:w.id}});
  if(held){
   if(held.expiresAt&&held.expiresAt.getTime()<Date.now()&&held.phase!=='DONE')await tx.appleCheckJob.update({where:{id:held.id},data:{phase:'UNKNOWN',result:'UNKNOWN',reasonCode:'UNKNOWN'}});
   return {job:null}; // Never hand an old submission to another process.
  }
  const j=await tx.appleCheckJob.findFirst({where:{projectId:w.projectId,phase:'QUEUED',cancelRequested:false},orderBy:{createdAt:'asc'}});if(!j)return {job:null};
  try{await accountForJob(tx,j);}catch{await tx.appleCheckJob.update({where:{id:j.id},data:{phase:'DONE',result:'CANCELLED',reasonCode:'CANCELLED',cleanup:'OK',activeAccountId:null}});return {job:null};}
  if(w.proxyGroupId!=='TUT'&&!await tx.proxyGroup.findFirst({where:{id:w.proxyGroupId,projectId:w.projectId,archivedAt:null}}))return {job:null};
  const eligible=await getEligibleInventory(w.projectId,tx);
  const ids=eligible.map(p=>p.endpointId);
  const candidates=await tx.proxyIP.findMany({where:{id:{in:ids},groupId:w.proxyGroupId==='TUT'?null:w.proxyGroupId,appleCheckLeaseJobId:null},orderBy:{id:'asc'}});if(!candidates.length)return {job:null};
  const p=candidates[Math.floor(Math.random()*candidates.length)];
  await tx.$queryRaw`SELECT "id" FROM "ProxyIP" WHERE "id"=${p.id} FOR UPDATE`;
  const leased=await tx.proxyIP.updateMany({where:{id:p.id,appleCheckLeaseJobId:null,revision:p.revision},data:{appleCheckLeaseJobId:j.id}});if(leased.count!==1)return {job:null};
  const leaseToken=leaseFor(j.id),expiresAt=new Date(Date.now()+LEASE),hardDeadline=new Date(Date.now()+HARD);
  await tx.appleCheckJob.update({where:{id:j.id},data:{workerId:w.id,claimKey:key,activeWorkerId:w.id,proxyId:p.id,proxyRevision:p.revision,leaseHash:hash(leaseToken),expiresAt,hardDeadline,phase:'CLAIMED'}});
  await tx.appleCheckWorker.update({where:{id:w.id},data:{lastSeenAt:now(),state:'BUSY'}});
  return {job:{id:j.id,leaseToken,accountId:j.accountId,accountRevision:j.accountRevision,expiresAt:expiresAt.toISOString()}};
 }
 if(action==='route'||action==='submit'){
  const b=binding.parse(body),j=await own(tx,w.id,b);await accountForJob(tx,j);
  if(j.phase!=='CLAIMED')throw conflict('Thông tin đăng nhập đã được yêu cầu; không gửi lại');
  const p=await tx.proxyIP.findFirst({where:{id:j.proxyId!,projectId:j.projectId,appleCheckLeaseJobId:j.id,revision:j.proxyRevision!,inventoryState:'NEW',retiredAt:null,groupId:w.proxyGroupId==='TUT'?null:w.proxyGroupId}});
  if(!p)throw conflict('Proxy đã thay đổi; dừng kiểm tra');
  if(!(await getEligibleInventory(j.projectId,tx,j.id)).some(e=>e.endpointId===p.id))throw conflict('Proxy không còn đủ điều kiện; dừng kiểm tra');
  if(action==='route'){
   const decoded=decodeEndpoint(p);if(!decoded||decoded.format!=='FULL')throw bad('Proxy không đủ thông tin');
   await tx.appleCheckJob.update({where:{id:j.id},data:{routeReadAt:now()}});
   await audit(tx,j.projectId,w.createdById,'APPLE_CHECK_PROXY_READ',j.id,{proxyId:p.id});
   return {proxy:{server:'http://'+decoded.ip+':'+decoded.port,username:decoded.username??'',password:decoded.password??''}};
  }
  if(!j.routeReadAt)throw bad('Kiểm tra đường proxy trước khi lấy thông tin tài khoản');
  const a=await accountForJob(tx,j);if(!a.password)throw bad('Tài khoản chưa có mật khẩu');
  await tx.appleCheckJob.update({where:{id:j.id},data:{phase:'SUBMITTING',submittedAt:now()}});
  await audit(tx,j.projectId,w.createdById,'APPLE_CHECK_LOGIN_READ',j.id,{accountId:a.id,revision:a.revision});
  return {email:a.email,password:decrypt(a.password)};
 }
 if(action==='heartbeat-job'){
  const b=binding.parse(body),j=await own(tx,w.id,b,false);
  let requesterAllowed=true;try{await accountForJob(tx,j);}catch{requesterAllowed=false;}
  const reserved=await tx.proxyIP.findFirst({where:{id:j.proxyId??'',appleCheckLeaseJobId:j.id,revision:j.proxyRevision??-1,inventoryState:'NEW',retiredAt:null}});
  const proxyAllowed=!!reserved&&(await getEligibleInventory(j.projectId,tx,j.id)).some(e=>e.endpointId===reserved.id);
  const cancelled=!proxyAllowed||!requesterAllowed||!permitted||j.cancelRequested||j.phase==='DONE'||!j.hardDeadline||j.hardDeadline.getTime()<=Date.now()||!j.expiresAt||j.expiresAt.getTime()<=Date.now();
  if(!cancelled)await tx.appleCheckJob.update({where:{id:j.id},data:{expiresAt:new Date(Math.min(Date.now()+LEASE,j.hardDeadline!.getTime()))}});
  return {cancelRequested:cancelled};
 }
 if(action==='result')return saveResult(tx,w.id,w.createdById,resultBody.parse(body),permitted);
 if(action==='cleanup-recovered'){
  const b=binding.parse(body),j=await own(tx,w.id,b,false);
  if(j.phase!=='DONE'||!j.resultHash)throw conflict('Ghi kết quả trước khi khôi phục dọn phiên');
  if(j.cleanup==='OK')return jobView(tx,j);
  const x=await tx.appleCheckJob.update({where:{id:j.id},data:{cleanup:'OK',activeAccountId:null,activeWorkerId:null}});
  await tx.proxyIP.updateMany({where:{id:j.proxyId??'',appleCheckLeaseJobId:j.id},data:{appleCheckLeaseJobId:null}});
  await tx.appleCheckWorker.update({where:{id:w.id},data:{state:'IDLE',lastSeenAt:now()}});
  await audit(tx,j.projectId,w.createdById,'APPLE_CHECK_CLEANUP_RECOVERED',j.id,{});return jobView(tx,x);
 }
 throw bad('Lệnh worker không được hỗ trợ');
},db);}

async function saveResult(tx:Prisma.TransactionClient,workerId:string,actorId:string,b:Body,permitted:boolean){
 if(b.result!==b.reasonCode&&!(b.result==='UNKNOWN'&&unknownReasons.has(b.reasonCode)))throw bad('Mã lý do không hợp lệ');
 const j=await own(tx,workerId,b,false),fingerprint=hash(JSON.stringify({result:b.result,reasonCode:b.reasonCode,cleanup:b.cleanup,observedAt:b.observedAt}));
 if(j.resultHash){if(j.resultHash!==fingerprint)throw conflict('Kết quả đã ghi; không ghi đè');return jobView(tx,j);}
 const at=new Date(b.observedAt);if(at.getTime()>Date.now()+30_000||at.getTime()<j.createdAt.getTime()-30_000)throw bad('Thời gian kết quả không hợp lệ');
 if(['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','INVALID_CREDENTIALS'].includes(b.result)&&!j.submittedAt)throw bad('Chưa gửi thông tin đăng nhập; không ghi kết luận tài khoản');
 if(b.result==='CHALLENGE_REQUIRED'&&!j.routeReadAt)throw bad('Chưa kiểm tra đường kết nối; không ghi kết luận xác minh');
 await tx.$queryRaw`SELECT "id" FROM "GmailAccount" WHERE "id"=${j.accountId} FOR UPDATE`;
 const a=await tx.gmailAccount.findUnique({where:{id:j.accountId}});
 let appliedRevision:number|null=null,allowed=permitted;
 try{await rights(tx,{projectId:j.projectId,userId:j.requestedById,role:'ADMIN',capabilities:[]},true);}catch{allowed=false;}
 if(allowed&&b.result==='APPLE_LOCKED'&&a&&!a.archivedAt&&a.revision===j.accountRevision){
  const updated=await tx.gmailAccount.update({where:{id:a.id},data:{status:'APPLE_LOCKED',loginIssueAt:at,loginIssueNote:'Apple báo khoá khi kiểm tra đăng nhập; ngừng cấp mới, giữ nguyên liên kết VM.',revision:{increment:1}}});appliedRevision=updated.revision;
 }
 // Cleanup after revoke may release owned resources, but may not publish an account health assertion.
 const actual=allowed?b.result:'UNKNOWN';
 const actualReason=allowed||b.result==='UNKNOWN'?b.reasonCode:actual;
 const x=await tx.appleCheckJob.update({where:{id:j.id},data:{phase:'DONE',result:actual,reasonCode:actualReason,cleanup:b.cleanup,observedAt:at,resultHash:fingerprint,appliedRevision,activeAccountId:b.cleanup==='OK'?null:j.accountId,activeWorkerId:b.cleanup==='OK'?null:workerId}});
 if(b.cleanup==='OK')await tx.proxyIP.updateMany({where:{id:j.proxyId??'',appleCheckLeaseJobId:j.id},data:{appleCheckLeaseJobId:null}});
 await tx.appleCheckWorker.update({where:{id:workerId},data:{state:b.cleanup==='FAILED'?'CLEANUP_FAILED':'IDLE',lastSeenAt:now()}});
 await audit(tx,j.projectId,actorId,'APPLE_CHECK_RESULT',j.id,{accountId:j.accountId,result:actual,cleanup:b.cleanup,stale:!!a&&a.revision!==j.accountRevision,applied:appliedRevision!==null});
 return jobView(tx,x);
}
