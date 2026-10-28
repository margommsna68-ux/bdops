import {createHash} from 'node:crypto';
import type {OpsApproval,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {checkTotp,totpMessage} from '../users/totp';
import {maskSdk} from '@/lib/sdk-mask';
import {assertOpsToken} from './context';
import {activeSession,approveUnderSession,assertApprover} from './approval-session';
// Critical ops-API commands wait for an ADMIN's 2FA approval (owner decision 23/10/2026): the AI never holds a code. The request is held
// with the hash of exactly what the AI sent and an allowed summary (names, amounts, masked emails / SDK codes; never credentials). The
// ADMIN of that project, with 2FA on, approves with a TOTP code; the AI's retry with the same Idempotency-Key then runs once (CONSUMED);
// a later retry replays through the service's own idempotency. A different body under an approved key is refused.
export const APPROVAL_TTL_MS=15*60000;
export type ApprovalStatus='PENDING'|'APPROVED'|'REJECTED'|'EXPIRED'|'CONSUMED'|'LOCKED';
// Owner decision 28/10/2026: only withdrawal prepare waits for an ADMIN (status / receipt / members run directly; old held rows stay as history).
export const APPROVAL_ACTIONS=['WITHDRAWAL_PREPARE'] as const;
// The rows an ADMIN may still decide: held actions + batches holding them. Rows held before 28/10 for other actions stay as history
// (their route now runs directly on retry): they are not listed, counted or approved.
export const SESSION_ENDED_NOTE='Phiên duyệt đã khoá';
export const HELD_ACTIONS=[...APPROVAL_ACTIONS,'BATCH'] as const;
const isHeld=(action:string)=>(HELD_ACTIONS as readonly string[]).includes(action);
export const ACTION_LABEL:Record<string,string>={BATCH:'Lô lệnh (nhiều mục cần duyệt)',ACCOUNT_CREDENTIALS:'Lấy thông tin đăng nhập tài khoản EarnApp',WITHDRAWAL_PREPARE:'Chuẩn bị rút tiền (giữ email PayPal)',WITHDRAWAL_MEMBERS:'Gộp thêm VM vào lệnh rút',WITHDRAWAL_STATUS:'Ghi trạng thái yêu cầu rút',WITHDRAWAL_RECEIPT:'Ghi tiền về PayPal',VM_PROXY_CREDENTIALS:'Lấy proxy đầy đủ của VM',SDK_REVEAL:'Xem mã SDK đầy đủ'};
export function canonical(x:unknown):string{
  if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
  if(x&&typeof x==='object')return '{'+Object.keys(x as object).sort().filter(k=>(x as Record<string,unknown>)[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical((x as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(x);
}
export const payloadHashOf=(method:string,path:string,body:unknown)=>createHash('sha256').update(method+'\u0000'+path+'\u0000'+canonical(body)).digest('hex');
export class ApprovalHold extends Error{constructor(public readonly code:'APPROVAL_REQUIRED'|'APPROVAL_REJECTED'|'APPROVAL_EXPIRED',message:string,public readonly details:Record<string,unknown>){super(message);}}
/** Summary an ADMIN sees (allowed fields only). Resolves VM / server names when the body names a VM. */
export async function approvalSummary(db:PrismaClient,projectId:string,action:string,params:string[],body:Record<string,unknown>){
  const out:Record<string,unknown>={action,label:ACTION_LABEL[action]??action};
  const vmId=typeof body.vmId==='string'?body.vmId:/^VM_/.test(action)?params[0]:null;
  if(vmId){const vm=await db.virtualMachine.findFirst({where:{id:vmId,server:{projectId}},select:{code:true,server:{select:{code:true}}}});if(vm)out.vm=vm.server.code+' / '+vm.code;}
  if(typeof body.amount==='string')out.amount=body.amount+' '+(typeof body.currency==='string'?body.currency.toUpperCase():'');
  if(typeof body.status==='string')out.status=body.status;
  if(typeof body.paypalEmailId==='string'){const e=await db.payPalEmail.findFirst({where:{id:body.paypalEmailId,paypal:{projectId}},select:{email:true,paypal:{select:{code:true}}}});if(e)out.paypal=e.paypal.code+' → '+e.email.replace(/^(.).*(@.*)$/,'$1***$2');}
  if(action==='WITHDRAWAL_STATUS'||action==='WITHDRAWAL_RECEIPT'||action==='WITHDRAWAL_MEMBERS')out.withdrawalId=params[0];
  // Merged payout (27/10/2026): the ADMIN sees which VMs are merged in.
  if(Array.isArray(body.members)){const ids=body.members.map(m=>(m as {vmId?:unknown})?.vmId).filter((x):x is string=>typeof x==='string');const vms=await db.virtualMachine.findMany({where:{id:{in:ids},server:{projectId}},select:{id:true,code:true,server:{select:{code:true}}}});out.members=ids.map(i=>{const v=vms.find(x=>x.id===i);return v?v.server.code+' / '+v.code:i;});}
  if(action==='SDK_REVEAL'){const s=await db.sdkRecord.findFirst({where:{id:params[0],projectId},select:{code:true,vm:{select:{code:true,server:{select:{code:true}}}}}});if(s){out.sdk=maskSdk(s.code);if(s.vm)out.vm=s.vm.server.code+' / '+s.vm.code;}}
  if(typeof body.jobId==='string')out.jobId=body.jobId;
  if(typeof body.transactionId==='string')out.transactionId=body.transactionId;
  return out;
}
export interface GateInput {projectId:string;tokenId:string;userId:string;action:string;method:string;path:string;objectId:string|null;requestKey:string;payloadHash:string;summary:Record<string,unknown>}
type GateResult={approval:OpsApproval;replay:boolean;pending?:undefined;expired?:undefined}|{pending:OpsApproval;approval?:undefined;replay?:undefined;expired?:undefined}|{expired:OpsApproval;approval?:undefined;replay?:undefined;pending?:undefined};
/** Before a critical command runs: throws ApprovalHold (202 / 403 / 410) or returns the approval to consume after success. */
export async function gateApproval(db:PrismaClient,g:GateInput){
 return db.$transaction(async (tx):Promise<GateResult>=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${g.requestKey},0))`;
  const now=new Date(),latest=await tx.opsApproval.findFirst({where:{requestKey:g.requestKey},orderBy:{requestedAt:'desc'},select:{id:true}});
  if(latest){
    // Review fix 28/10/2026: the row itself is locked before its status is read, so a web decision / CLI confirm / session close
    // (all status-guarded writes on this row) either commits before — and is honoured — or waits until this gate has decided.
    await tx.$queryRaw`SELECT "id" FROM "OpsApproval" WHERE "id"=${latest.id} FOR UPDATE`;
    return decide(await tx.opsApproval.findUniqueOrThrow({where:{id:latest.id}}));
  }
  const created=await tx.opsApproval.create({data:{projectId:g.projectId,tokenId:g.tokenId,userId:g.userId,action:g.action,method:g.method,path:g.path,objectId:g.objectId,requestKey:g.requestKey,payloadHash:g.payloadHash,summary:g.summary as object,expiresAt:new Date(now.getTime()+APPROVAL_TTL_MS)}});
  return underSession(created);
  async function decide(row:OpsApproval):Promise<GateResult>{
    if(row.payloadHash!==g.payloadHash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH','Idempotency-Key đã dùng cho nội dung khác; dùng key mới');
    if(row.tokenId!==g.tokenId)throw new ApprovalHold('APPROVAL_REJECTED','Yêu cầu duyệt thuộc token cũ; chỉ kết quả đã ghi được phát lại, mục chưa chạy phải xin duyệt mới',{approvalId:row.id,status:'REJECTED'});
    if(row.status==='CONSUMED')return {approval:row,replay:true};
    if(row.status==='REJECTED'||row.status==='LOCKED')throw new ApprovalHold('APPROVAL_REJECTED',row.status==='LOCKED'?'Yêu cầu đã khoá sau 5 lần sai mã; xin lại bằng key mới':'ADMIN đã từ chối lệnh này',{approvalId:row.id,status:row.status});
    if(row.status==='EXPIRED'||row.expiresAt<now){await tx.opsApproval.update({where:{id:row.id},data:{status:'EXPIRED'}});return {expired:row};}
    if(row.status==='APPROVED'){
      // Approved by a session: usable only while a session of this token + project is still in force ("Khóa phiên ngay", expiry,
      // approver demoted / 2FA reset / token revoked end it at once); otherwise the approval lapses (410, new key).
      if(row.sessionId&&!await activeSession(tx,{projectId:row.projectId,tokenId:row.tokenId})){
        const lapsed=await tx.opsApproval.update({where:{id:row.id},data:{status:'EXPIRED',decisionNote:SESSION_ENDED_NOTE}});return {expired:lapsed};
      }
      return {approval:row,replay:false};
    }
    if(row.status!=='PENDING')return {pending:row};
    return underSession(row);
  }
  // A 15-minute approval session of this token + project (re-checked here, FOR SHARE) approves the row at once; otherwise it waits.
  async function underSession(r:OpsApproval):Promise<GateResult>{
    const s=isHeld(r.action)&&r.tokenId===g.tokenId&&r.projectId===g.projectId?await activeSession(tx,{projectId:g.projectId,tokenId:g.tokenId}):null;
    if(!s)return {pending:r};
    const a=await approveUnderSession(tx,s,r);
    // Not PENDING any more (decided meanwhile): honour the real status, never overturn it.
    return a.approved?{approval:a.row,replay:false}:decide(a.row);
  }
 }).then(result=>{
  if(result.expired)throw new ApprovalHold('APPROVAL_EXPIRED','Yêu cầu đã hết hạn; gửi lại với Idempotency-Key mới',{approvalId:result.expired.id,status:'EXPIRED',expiresAt:result.expired.expiresAt.toISOString()});
  if(result.pending)throw new ApprovalHold('APPROVAL_REQUIRED','Chờ ADMIN duyệt trên web hoặc nhập mã 2FA tại CLI, rồi gửi lại cùng key trong 15 phút',{approvalId:result.pending.id,status:'PENDING',expiresAt:result.pending.expiresAt.toISOString()});
  return result;
 });
}
export async function consumeApproval(db:PrismaClient,approvalId:string,requestId:string){
  await db.opsApproval.updateMany({where:{id:approvalId,status:'APPROVED'},data:{status:'CONSUMED',consumedAt:new Date(),consumedRequestId:requestId}});
}
// ─── Web side (ADMIN) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function listApprovals(db:PrismaClient,projectId:string,o:{status?:ApprovalStatus|'OPEN';limit?:number}={}){
  const now=new Date();
  await db.opsApproval.updateMany({where:{projectId,status:'PENDING',expiresAt:{lt:now}},data:{status:'EXPIRED'}});
  const where=o.status==='OPEN'||!o.status||o.status==='PENDING'?{projectId,status:'PENDING',action:{in:[...HELD_ACTIONS]}}:{projectId,status:o.status};
  const rows=await db.opsApproval.findMany({where,orderBy:{requestedAt:'desc'},take:o.limit??100});
  const users=await db.user.findMany({where:{id:{in:[...new Set(rows.flatMap(r=>[r.userId,r.decidedById].filter((x):x is string=>!!x)))]}},select:{id:true,username:true,name:true}});
  const tokens=await db.opsToken.findMany({where:{id:{in:[...new Set(rows.map(r=>r.tokenId))]}},select:{id:true,name:true,prefix:true}});
  const who=(id:string|null)=>{const u=id?users.find(x=>x.id===id):null;return u?(u.name||u.username||u.id):null;};
  return rows.map(r=>({id:r.id,action:r.action,label:ACTION_LABEL[r.action]??r.action,status:r.status as ApprovalStatus,summary:r.summary as Record<string,unknown>,requestedAt:r.requestedAt.toISOString(),expiresAt:r.expiresAt.toISOString(),requestedBy:who(r.userId),token:(()=>{const t=tokens.find(x=>x.id===r.tokenId);return t?t.name+' ('+t.prefix+')':null;})(),decidedBy:who(r.decidedById),decidedAt:r.decidedAt?.toISOString()??null,decisionNote:r.decisionNote,consumedAt:r.consumedAt?.toISOString()??null}));
}
/** An ADMIN of the project with 2FA on decides with a TOTP code (checked and consumed like any other code; never the session's unlock). */
export async function decideApproval(db:PrismaClient,input:{approvalId:string;actorId:string;projectId:string;approve:boolean;code:string;note?:string|null}){
  const m=await db.projectMember.findUnique({where:{userId_projectId:{userId:input.actorId,projectId:input.projectId}},select:{role:true}});
  if(m?.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN','Chỉ ADMIN của dự án được duyệt lệnh AI');
  const u=await db.user.findUniqueOrThrow({where:{id:input.actorId},select:{totpEnabledAt:true,totpLockedAt:true,disabledAt:true}});
  if(u.disabledAt)throw new ProxyDomainError('FORBIDDEN','Tài khoản đã bị vô hiệu hoá');
  if(!u.totpEnabledAt)throw new ProxyDomainError('FORBIDDEN','Bật 2FA (Google Authenticator) cho tài khoản của bạn trước khi duyệt lệnh AI');
  const row=await db.opsApproval.findFirst({where:{id:input.approvalId,projectId:input.projectId}});
  if(!row)throw new ProxyDomainError('NOT_FOUND','Không có yêu cầu này');
  if(row.status!=='PENDING')throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu đã '+(row.status==='APPROVED'?'được duyệt':row.status==='REJECTED'?'bị từ chối':row.status==='CONSUMED'?'được AI thực hiện':'hết hạn'));
  if(row.expiresAt<new Date()){await db.opsApproval.update({where:{id:row.id},data:{status:'EXPIRED'}});throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu đã hết hạn; AI phải gửi lại');}
  if(input.approve&&!isHeld(row.action))throw new ProxyDomainError('STALE_PREVIEW','Lệnh này không còn cần duyệt; AI gửi lại cùng key sẽ chạy thẳng');
  const t=await checkTotp(db,input.actorId,input.code);
  if(t.result!=='OK')throw new ProxyDomainError('FORBIDDEN',totpMessage(t.result,u.totpLockedAt));
  const status:ApprovalStatus=input.approve?'APPROVED':'REJECTED',now=new Date();
  const n=await db.opsApproval.updateMany({where:{id:row.id,status:'PENDING'},data:{status,decidedById:input.actorId,decidedAt:now,decisionNote:input.note?.trim().slice(0,300)||null}});
  if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu vừa được người khác quyết định');
  await db.auditLog.create({data:{projectId:input.projectId,userId:input.actorId,action:input.approve?'OPS_APPROVE':'OPS_REJECT',entity:'OpsApproval',entityId:row.id,changes:{action:row.action,objectId:row.objectId,tokenId:row.tokenId,via:t.via}}});
  return {id:row.id,status};
}
export async function pendingApprovalCount(db:PrismaClient,projectId:string){return db.opsApproval.count({where:{projectId,status:'PENDING',expiresAt:{gt:new Date()},action:{in:[...HELD_ACTIONS]}}});}
// ─── CLI side (owner decision 23/10 evening): the AI's token confirms with the ADMIN's TOTP typed at the CLI ───────────────────
export const CONFIRM_MAX_FAILED=5;
export function approvalView(r:{id:string;action:string;status:string;summary:unknown;requestedAt:Date;expiresAt:Date;decidedAt:Date|null;consumedAt:Date|null;confirmFailed:number;decisionNote:string|null}){
  return {approvalId:r.id,action:r.action,label:ACTION_LABEL[r.action]??r.action,status:r.status,summary:r.summary,requestedAt:r.requestedAt.toISOString(),expiresAt:r.expiresAt.toISOString(),decidedAt:r.decidedAt?.toISOString()??null,consumedAt:r.consumedAt?.toISOString()??null,attemptsLeft:Math.max(0,CONFIRM_MAX_FAILED-r.confirmFailed),decisionNote:r.decisionNote};
}
export async function readApprovalForToken(db:PrismaClient,input:{approvalId:string;tokenId:string;projectId:string}){
  const r=await db.opsApproval.findFirst({where:{id:input.approvalId,tokenId:input.tokenId,projectId:input.projectId}});
  if(!r)throw new ProxyDomainError('NOT_FOUND','Không có yêu cầu duyệt này của token');
  if(r.status==='PENDING'&&r.expiresAt<new Date()){await db.opsApproval.update({where:{id:r.id},data:{status:'EXPIRED'}});r.status='EXPIRED';}
  return approvalView(r);
}
/**
 * The AI's own approval, confirmed with the code of a named ADMIN of the project (typed at the CLI by that ADMIN, never stored).
 * The ADMIN must have 2FA on; the code goes through checkTotp (one use per step, 3 wrong → the ADMIN's 30-minute lock); a wrong code
 * also counts on the approval: CONFIRM_MAX_FAILED → LOCKED (the AI must ask again with a new key).
 */
export async function confirmApprovalByToken(db:PrismaClient,input:{approvalId:string;tokenId:string;projectId:string;admin:string;totp:string}){
  const row=await db.opsApproval.findFirst({where:{id:input.approvalId,tokenId:input.tokenId,projectId:input.projectId}});
  if(!row)throw new ProxyDomainError('NOT_FOUND','Không có yêu cầu duyệt này của token');
  if(row.status==='LOCKED')throw new ProxyDomainError('FORBIDDEN','Yêu cầu đã bị khoá sau '+CONFIRM_MAX_FAILED+' lần sai mã; gửi lại lệnh với Idempotency-Key mới');
  if(row.status!=='PENDING')throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu đã '+(row.status==='APPROVED'?'được duyệt':row.status==='REJECTED'?'bị từ chối':row.status==='CONSUMED'?'được thực hiện':'hết hạn'));
  if(row.expiresAt<new Date()){await db.opsApproval.update({where:{id:row.id},data:{status:'EXPIRED'}});throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu đã hết hạn (15 phút); gửi lại lệnh với Idempotency-Key mới');}
  const name=String(input.admin||'').trim();
  const admin=await db.user.findFirst({where:{OR:[{username:name},{email:name}],disabledAt:null},select:{id:true,totpEnabledAt:true,totpLockedAt:true}});
  const member=admin?await db.projectMember.findUnique({where:{userId_projectId:{userId:admin.id,projectId:input.projectId}},select:{role:true}}):null;
  if(!admin||member?.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN','Người duyệt phải là ADMIN của dự án');
  if(!admin.totpEnabledAt)throw new ProxyDomainError('FORBIDDEN','ADMIN này chưa bật 2FA; không duyệt được');
  const t=await checkTotp(db,admin.id,input.totp);
  const result=await db.$transaction(async tx=>{
    await assertOpsToken(tx,{userId:row.userId,projectId:row.projectId});
    await tx.$queryRaw`SELECT "id" FROM "OpsApproval" WHERE "id"=${row.id} FOR UPDATE`;
    const fresh=await tx.opsApproval.findUniqueOrThrow({where:{id:row.id}});
    if(fresh.status!=='PENDING'||fresh.confirmFailed>=CONFIRM_MAX_FAILED)throw new ProxyDomainError('FORBIDDEN','Yêu cầu vừa được quyết định hoặc đã bị khoá');
    if(fresh.expiresAt<=new Date())return {expired:true} as const;
    const approver=await assertApprover(tx,admin.id,input.projectId,t);
    if(t.result!=='OK'){
      const failed=fresh.confirmFailed+1,locked=failed>=CONFIRM_MAX_FAILED;
      await tx.opsApproval.update({where:{id:row.id},data:{confirmFailed:failed,...(locked?{status:'LOCKED',decisionNote:'Khoá sau '+CONFIRM_MAX_FAILED+' lần sai mã'}:{})}});
      await tx.auditLog.create({data:{projectId:input.projectId,userId:admin.id,action:'OPS_APPROVE_FAIL',entity:'OpsApproval',entityId:row.id,changes:{tokenId:row.tokenId,result:t.result,failed,locked}}});
      return {failed,locked} as const;
    }
    if(approver.locked)throw new ProxyDomainError('FORBIDDEN','Mã 2FA đang bị khoá');
    const approved=await tx.opsApproval.update({where:{id:row.id},data:{status:'APPROVED',decidedById:admin.id,decidedAt:new Date(),decisionNote:'Duyệt tại CLI bằng mã 2FA'}});
    await tx.auditLog.create({data:{projectId:input.projectId,userId:admin.id,action:'OPS_APPROVE',entity:'OpsApproval',entityId:row.id,changes:{action:row.action,objectId:row.objectId,tokenId:row.tokenId,via:'CLI:'+t.via}}});
    return {approved} as const;
  });
  if(result.expired)throw new ProxyDomainError('FORBIDDEN','Yêu cầu đã hết hạn; gửi lại lệnh với key mới');
  if(result.failed)throw new ProxyDomainError('FORBIDDEN',result.locked?'Sai mã lần thứ 5: yêu cầu bị khoá; xin lại với key mới':totpMessage(t.result,admin.totpLockedAt)+' (còn '+(CONFIRM_MAX_FAILED-result.failed)+' lần).');
  return approvalView(result.approved!);
}
