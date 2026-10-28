import type {OpsApprovalSession,Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {checkTotp,totpMessage,TOTP_LOCK_MS,type TotpCheck} from '../users/totp';
import {HELD_ACTIONS,SESSION_ENDED_NOTE} from './approvals';
// Approval session (owner decision 28/10/2026, replaces the 23/10 anti-goal "a TOTP never passes through the chat"): an ADMIN of the
// project with 2FA proves ONE code (typed in the Claude chat and passed to `ops-client session-open`, or on the web) and for 15 minutes
// the withdrawal prepares of exactly that token + project are approved at once. Every use re-checks, inside the transaction that
// approves, that the session is still open and unexpired, the approver is still an enabled ADMIN of the project with 2FA on, not
// TOTP-locked and with the same 2FA version as at opening, and the token is still valid for the project. The code is never stored.
export const APPROVAL_SESSION_MS=15*60000;
type Tx=Prisma.TransactionClient;
const hhmm=(d:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
export const sessionNote=(openedAt:Date)=>'Duyệt theo phiên '+hhmm(openedAt);
/**
 * The approver's standing, read FOR SHARE inside the caller's transaction (a demotion / disable / 2FA reset either lands before — and
 * is seen — or waits for this transaction). `t` is the result of checkTotp; its version must still be the user's version.
 * Throws when not an enabled ADMIN with 2FA on and the same version; returns whether the 2FA is locked now (callers decide).
 */
export async function assertApprover(tx:Tx,adminId:string,projectId:string,t:Pick<TotpCheck,'totpVersion'>){
  const [u]=await tx.$queryRaw<{disabledAt:Date|null;totpEnabledAt:Date|null;totpVersion:number;totpLockedAt:Date|null}[]>`SELECT "disabledAt","totpEnabledAt","totpVersion","totpLockedAt" FROM "User" WHERE "id"=${adminId} FOR SHARE`;
  const [membership]=await tx.$queryRaw<{role:string}[]>`SELECT "role" FROM "ProjectMember" WHERE "userId"=${adminId} AND "projectId"=${projectId} FOR SHARE`;
  if(!u||u.disabledAt||membership?.role!=='ADMIN'||!u.totpEnabledAt||u.totpVersion!==t.totpVersion)throw new ProxyDomainError('FORBIDDEN','Quyền ADMIN hoặc 2FA vừa thay đổi; kiểm tra lại');
  return {totpVersion:u.totpVersion,locked:!!u.totpLockedAt&&new Date(u.totpLockedAt).getTime()+TOTP_LOCK_MS>Date.now()};
}
/** The token row FOR SHARE: exists, not revoked, not expired, the project is in its scope (a revoke waits for or precedes this). */
async function tokenValid(tx:Tx,tokenId:string,projectId:string){
  const [t]=await tx.$queryRaw<{projectIds:string[];expiresAt:Date;revokedAt:Date|null}[]>`SELECT "projectIds","expiresAt","revokedAt" FROM "OpsToken" WHERE "id"=${tokenId} FOR SHARE`;
  // The column has no time zone and holds UTC; read back through the raw query it is compared as UTC (same as assertOpsToken).
  return !!t&&!t.revokedAt&&new Date(t.expiresAt).getTime()>Date.now()&&t.projectIds.includes(projectId);
}
/**
 * The session in force for this token + project, or null. Reads FOR SHARE the session, the token, the approver and the approver's
 * membership, so a close / revoke / demotion / disable / 2FA reset either lands before (null) or waits for the caller's transaction.
 */
// Lock order (review fix round 2): every path takes OpsApproval rows (FOR UPDATE, ordered by id) BEFORE OpsApprovalSession rows.
// gateApproval: approval row, then session FOR SHARE; open: pending / session-approved rows, then close earlier sessions; close:
// lapse the approval rows, then close the sessions. A "Khóa phiên ngay" racing an AI retry waits instead of deadlocking.
export async function activeSession(tx:Tx,input:{projectId:string;tokenId:string}):Promise<OpsApprovalSession|null>{
  for(let attempt=0;attempt<2;attempt++){
    const now=new Date(),s=await tx.opsApprovalSession.findFirst({where:{projectId:input.projectId,tokenId:input.tokenId,closedAt:null,expiresAt:{gt:now}},orderBy:{openedAt:'desc'},select:{id:true}});
    if(!s)return null;
    const r=await sessionInForce(tx,s.id);
    // Closed while we waited for the lock (e.g. replaced by a new session): look once more for the newer one.
    if(r==='CLOSED')continue;
    return r&&r.projectId===input.projectId&&r.tokenId===input.tokenId?r:null;
  }
  return null;
}
/** One given session, locked FOR SHARE and fully re-validated (open, unexpired, version, token, approver); 'CLOSED' when closed. */
async function sessionInForce(tx:Tx,sessionId:string):Promise<OpsApprovalSession|null|'CLOSED'>{
  await tx.$queryRaw`SELECT "id" FROM "OpsApprovalSession" WHERE "id"=${sessionId} FOR SHARE`;
  const fresh=await tx.opsApprovalSession.findUnique({where:{id:sessionId}});
  if(!fresh)return null;
  if(fresh.closedAt)return 'CLOSED';
  if(fresh.expiresAt.getTime()<=Date.now()||fresh.totpVersion==null)return null;
  if(!await tokenValid(tx,fresh.tokenId,fresh.projectId))return null;
  try{const a=await assertApprover(tx,fresh.approvedById,fresh.projectId,{totpVersion:fresh.totpVersion});if(a.locked)return null;}
  catch(e){if(e instanceof ProxyDomainError)return null;throw e;}
  return fresh;
}
/** Is THIS session (the one that approved a row) still in force for that token + project? */
export async function sessionStillActive(tx:Tx,input:{sessionId:string;projectId:string;tokenId:string}){
  const r=await sessionInForce(tx,input.sessionId);
  return !!r&&r!=='CLOSED'&&r.projectId===input.projectId&&r.tokenId===input.tokenId;
}
/**
 * Approve a PENDING approval row under the session; called by gateApproval inside its transaction. Status-guarded: a row that is no
 * longer PENDING (rejected, locked, expired, consumed…) is never touched; the caller gets the row as it is now and honours it.
 */
export async function approveUnderSession(tx:Tx,s:OpsApprovalSession,row:{id:string;action:string;objectId:string|null;tokenId:string}){
  const n=await tx.opsApproval.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'APPROVED',sessionId:s.id,decidedById:s.approvedById,decidedAt:new Date(),decisionNote:sessionNote(s.openedAt)}});
  const now=await tx.opsApproval.findUniqueOrThrow({where:{id:row.id}});
  if(n.count!==1)return {approved:false,row:now} as const;
  await tx.auditLog.create({data:{projectId:s.projectId,userId:s.approvedById,action:'OPS_APPROVE',entity:'OpsApproval',entityId:row.id,changes:{action:row.action,objectId:row.objectId,tokenId:row.tokenId,via:'SESSION',sessionId:s.id}}});
  return {approved:true,row:now} as const;
}
interface OpenInput {projectId:string;tokenId:string;admin:string;totp:string;via:'CLI'|'WEB';actorId?:string}
/**
 * Open (or replace) the token's session with one ADMIN code. CLI: the ADMIN is named (username / email). WEB: the ADMIN is the signed-in
 * actor and proves their own code. Same checks as confirmApprovalByToken: ADMIN of the project, 2FA on, checkTotp (one use per step,
 * 3 wrong → the ADMIN's 30-minute lock), re-checked FOR SHARE in the transaction. Opening also approves every pending held row of
 * the token. The code is never written anywhere.
 */
export async function openApprovalSession(db:PrismaClient,input:OpenInput){
  if(input.via==='WEB'&&!input.actorId)throw new ProxyDomainError('FORBIDDEN','Thiếu người duyệt');
  const name=String(input.admin||'').trim();
  const admin=input.via==='WEB'?await db.user.findFirst({where:{id:input.actorId,disabledAt:null},select:{id:true,totpEnabledAt:true,totpLockedAt:true}})
    :name?await db.user.findFirst({where:{OR:[{username:name},{email:name}],disabledAt:null},select:{id:true,totpEnabledAt:true,totpLockedAt:true}}):null;
  const member=admin?await db.projectMember.findUnique({where:{userId_projectId:{userId:admin.id,projectId:input.projectId}},select:{role:true}}):null;
  if(!admin||member?.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN','Người duyệt phải là ADMIN của dự án');
  if(!admin.totpEnabledAt)throw new ProxyDomainError('FORBIDDEN','ADMIN này chưa bật 2FA; không mở phiên duyệt được');
  // Before a code is spent: the token must be a live token of this project.
  const tok=await db.opsToken.findUnique({where:{id:input.tokenId},select:{projectIds:true,revokedAt:true,expiresAt:true}});
  if(!tok||!tok.projectIds.includes(input.projectId))throw new ProxyDomainError('NOT_FOUND','Không có token này trong dự án');
  if(tok.revokedAt||tok.expiresAt<=new Date())throw new ProxyDomainError('FORBIDDEN','Token đã bị thu hồi hoặc hết hạn');
  const t=await checkTotp(db,admin.id,input.totp);
  const result=await db.$transaction(async tx=>{
    // One opener at a time per token + project, so two opens never leave two sessions in force.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ops-session:'+input.projectId+':'+input.tokenId},0))`;
    if(!await tokenValid(tx,input.tokenId,input.projectId))throw new ProxyDomainError('FORBIDDEN','Token đã bị thu hồi hoặc hết hạn');
    const a=await assertApprover(tx,admin.id,input.projectId,t);
    if(t.result!=='OK'){
      await tx.auditLog.create({data:{projectId:input.projectId,userId:admin.id,action:'OPS_SESSION_OPEN_FAIL',entity:'OpsToken',entityId:input.tokenId,changes:{tokenId:input.tokenId,via:input.via,result:t.result}}});
      return {failed:true} as const;
    }
    if(a.locked)throw new ProxyDomainError('FORBIDDEN','Mã 2FA đang bị khoá');
    const now=new Date(),expiresAt=new Date(now.getTime()+APPROVAL_SESSION_MS),held=[...HELD_ACTIONS] as string[];
    // Approval rows first (lock order): the token's pending held rows and the unused approvals of its earlier sessions.
    await tx.$queryRaw`SELECT "id" FROM "OpsApproval" WHERE "projectId"=${input.projectId} AND "tokenId"=${input.tokenId} AND ("status"='PENDING' OR ("status"='APPROVED' AND "sessionId" IS NOT NULL)) AND "action"=ANY(${held}::text[]) ORDER BY "id" FOR UPDATE`;
    const earlier=(await tx.opsApprovalSession.findMany({where:{projectId:input.projectId,tokenId:input.tokenId,closedAt:null},select:{id:true}})).map(x=>x.id);
    const closed=await tx.opsApprovalSession.updateMany({where:{id:{in:earlier},closedAt:null},data:{closedAt:now,closedById:admin.id}});
    const s=await tx.opsApprovalSession.create({data:{projectId:input.projectId,tokenId:input.tokenId,approvedById:admin.id,via:input.via,openedAt:now,expiresAt,totpVersion:a.totpVersion}});
    // Unused approvals granted by the replaced session carry over to the new one (the same token, an ADMIN code proved just now).
    if(earlier.length)await tx.opsApproval.updateMany({where:{sessionId:{in:earlier},status:'APPROVED'},data:{sessionId:s.id}});
    const pending=await tx.opsApproval.findMany({where:{projectId:input.projectId,tokenId:input.tokenId,status:'PENDING',expiresAt:{gt:now},action:{in:held}},select:{id:true,action:true,objectId:true}});
    let approvedPending=0;
    if(pending.length){
      const n=await tx.opsApproval.updateMany({where:{id:{in:pending.map(p=>p.id)},status:'PENDING'},data:{status:'APPROVED',sessionId:s.id,decidedById:admin.id,decidedAt:now,decisionNote:sessionNote(now)}});
      approvedPending=n.count;
      await tx.auditLog.createMany({data:pending.map(p=>({projectId:input.projectId,userId:admin.id,action:'OPS_APPROVE',entity:'OpsApproval',entityId:p.id,changes:{action:p.action,objectId:p.objectId,tokenId:input.tokenId,via:'SESSION',sessionId:s.id}}))});
    }
    await tx.auditLog.create({data:{projectId:input.projectId,userId:admin.id,action:'OPS_SESSION_OPEN',entity:'OpsApprovalSession',entityId:s.id,changes:{tokenId:input.tokenId,via:input.via,factor:t.via,expiresAt:expiresAt.toISOString(),approvedPending,closedPrevious:closed.count}}});
    return {session:s,approvedPending} as const;
  });
  if('failed' in result)throw new ProxyDomainError('FORBIDDEN',totpMessage(t.result,admin.totpLockedAt));
  return {sessionId:result.session.id,expiresAt:result.session.expiresAt.toISOString(),approvedPending:result.approvedPending};
}
/** Close now ("Khóa phiên ngay" / `ops-client session-close`): the token's sessions, one session, or (web, neither given) all of the project. */
export async function closeApprovalSession(db:PrismaClient,input:{projectId:string;tokenId?:string;sessionId?:string;actorId:string}){
  return db.$transaction(async tx=>{
    const now=new Date(),where={projectId:input.projectId,closedAt:null,expiresAt:{gt:now},...(input.tokenId?{tokenId:input.tokenId}:{}),...(input.sessionId?{id:input.sessionId}:{})};
    const ids=(await tx.opsApprovalSession.findMany({where,select:{id:true}})).map(x=>x.id);
    // "Khóa phiên ngay" stops at once: approvals granted by these sessions and not yet used lapse (the AI must ask again, new key).
    // Approval rows first (lock order), then the sessions.
    let lapsed={count:0};
    if(ids.length){
      await tx.$queryRaw`SELECT "id" FROM "OpsApproval" WHERE "sessionId"=ANY(${ids}::text[]) AND "status"='APPROVED' ORDER BY "id" FOR UPDATE`;
      lapsed=await tx.opsApproval.updateMany({where:{sessionId:{in:ids},status:'APPROVED'},data:{status:'EXPIRED',decisionNote:SESSION_ENDED_NOTE}});
    }
    const n=ids.length?await tx.opsApprovalSession.updateMany({where:{...where,id:{in:ids}},data:{closedAt:now,closedById:input.actorId}}):{count:0};
    await tx.auditLog.create({data:{projectId:input.projectId,userId:input.actorId,action:'OPS_SESSION_CLOSE',entity:'OpsApprovalSession',entityId:input.sessionId??input.tokenId??input.projectId,changes:{tokenId:input.tokenId??null,sessionId:input.sessionId??null,closed:n.count,lapsedApprovals:lapsed.count}}});
    return {closed:n.count};
  });
}
/** Web "Duyệt tất cả đang chờ": one code of the acting ADMIN approves every pending held row of the project. */
export async function approveAllPending(db:PrismaClient,input:{projectId:string;actorId:string;code:string}){
  const m=await db.projectMember.findUnique({where:{userId_projectId:{userId:input.actorId,projectId:input.projectId}},select:{role:true}});
  if(m?.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN','Chỉ ADMIN của dự án được duyệt lệnh AI');
  const u=await db.user.findUniqueOrThrow({where:{id:input.actorId},select:{totpEnabledAt:true,totpLockedAt:true,disabledAt:true}});
  if(u.disabledAt)throw new ProxyDomainError('FORBIDDEN','Tài khoản đã bị vô hiệu hoá');
  if(!u.totpEnabledAt)throw new ProxyDomainError('FORBIDDEN','Bật 2FA (Google Authenticator) cho tài khoản của bạn trước khi duyệt lệnh AI');
  const t=await checkTotp(db,input.actorId,input.code);
  if(t.result!=='OK')throw new ProxyDomainError('FORBIDDEN',totpMessage(t.result,u.totpLockedAt));
  return db.$transaction(async tx=>{
    const a=await assertApprover(tx,input.actorId,input.projectId,t);
    if(a.locked)throw new ProxyDomainError('FORBIDDEN','Mã 2FA đang bị khoá');
    const now=new Date(),rows=await tx.opsApproval.findMany({where:{projectId:input.projectId,status:'PENDING',expiresAt:{gt:now},action:{in:[...HELD_ACTIONS]}},select:{id:true,action:true,objectId:true,tokenId:true}});
    if(!rows.length)return {approved:0};
    // Lock the rows still PENDING (a row decided meanwhile by another ADMIN drops out), update exactly those and audit exactly those.
    const locked=await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "OpsApproval" WHERE "id"=ANY(${rows.map(r=>r.id)}::text[]) AND "status"='PENDING' ORDER BY "id" FOR UPDATE`;
    const ids=new Set(locked.map(r=>r.id)),changed=rows.filter(r=>ids.has(r.id));
    if(!changed.length)return {approved:0};
    const n=await tx.opsApproval.updateMany({where:{id:{in:changed.map(r=>r.id)},status:'PENDING'},data:{status:'APPROVED',decidedById:input.actorId,decidedAt:now,decisionNote:'Duyệt tất cả đang chờ'}});
    await tx.auditLog.createMany({data:changed.map(r=>({projectId:input.projectId,userId:input.actorId,action:'OPS_APPROVE',entity:'OpsApproval',entityId:r.id,changes:{action:r.action,objectId:r.objectId,tokenId:r.tokenId,via:'ALL:'+t.via}}))});
    return {approved:n.count};
  });
}
/** Web read: the sessions in force (each re-validated) and the live tokens of the project a session can be opened for. */
export async function readApprovalSessions(db:PrismaClient,projectId:string){
  const now=new Date();
  const open=await db.opsApprovalSession.findMany({where:{projectId,closedAt:null,expiresAt:{gt:now}},orderBy:{openedAt:'desc'}});
  const live=await db.$transaction(async tx=>{const ok:string[]=[];for(const s of open){const a=await activeSession(tx,{projectId,tokenId:s.tokenId});if(a?.id===s.id)ok.push(s.id);}return ok;});
  const tokens=await db.opsToken.findMany({where:{projectIds:{has:projectId},revokedAt:null,expiresAt:{gt:now}},select:{id:true,name:true,prefix:true,userId:true},orderBy:{createdAt:'desc'}});
  const users=await db.user.findMany({where:{id:{in:[...new Set([...open.map(s=>s.approvedById),...tokens.map(t=>t.userId)])]}},select:{id:true,username:true,name:true}});
  const who=(id:string)=>{const u=users.find(x=>x.id===id);return u?(u.name||u.username||u.id):null;};
  return {
    sessions:open.filter(s=>live.includes(s.id)).map(s=>{const t=tokens.find(x=>x.id===s.tokenId);return {id:s.id,tokenId:s.tokenId,token:t?t.name+' ('+t.prefix+')':null,approvedBy:who(s.approvedById),via:s.via,openedAt:s.openedAt.toISOString(),expiresAt:s.expiresAt.toISOString()};}),
    tokens:tokens.map(t=>({id:t.id,name:t.name,prefix:t.prefix,user:who(t.userId)})),
  };
}
/** `GET me`: the token's session in force (the one ending last when the token covers several projects). */
export async function sessionForToken(db:PrismaClient,tokenId:string,projectIds:string[]){
  const found=await db.$transaction(async tx=>{let best:OpsApprovalSession|null=null;for(const projectId of projectIds){const s=await activeSession(tx,{projectId,tokenId});if(s&&(!best||s.expiresAt>best.expiresAt))best=s;}return best;});
  if(!found)return {open:false,expiresAt:null,approvedBy:null};
  const u=await db.user.findUnique({where:{id:found.approvedById},select:{username:true,name:true,email:true}});
  return {open:true,expiresAt:found.expiresAt.toISOString(),approvedBy:u?.username||u?.name||u?.email||null};
}
