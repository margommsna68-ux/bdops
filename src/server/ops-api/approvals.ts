import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {checkTotp,totpMessage} from '../users/totp';
import {maskSdk} from '@/lib/sdk-mask';
// Critical ops-API commands wait for an ADMIN's 2FA approval (owner decision 23/10/2026): the AI never holds a code. The request is held
// with the hash of exactly what the AI sent and an allowed summary (names, amounts, masked emails / SDK codes; never credentials). The
// ADMIN of that project, with 2FA on, approves with a TOTP code; the AI's retry with the same Idempotency-Key then runs once (CONSUMED);
// a later retry replays through the service's own idempotency. A different body under an approved key is refused.
export const APPROVAL_TTL_MS=15*60000;
export type ApprovalStatus='PENDING'|'APPROVED'|'REJECTED'|'EXPIRED'|'CONSUMED';
export const APPROVAL_ACTIONS=['WITHDRAWAL_PREPARE','WITHDRAWAL_STATUS','WITHDRAWAL_RECEIPT','VM_PROXY_CREDENTIALS','SDK_REVEAL'] as const;
export const ACTION_LABEL:Record<string,string>={WITHDRAWAL_PREPARE:'Chuẩn bị rút tiền (giữ email PayPal)',WITHDRAWAL_STATUS:'Ghi trạng thái yêu cầu rút',WITHDRAWAL_RECEIPT:'Ghi tiền về PayPal',VM_PROXY_CREDENTIALS:'Lấy proxy đầy đủ của VM',SDK_REVEAL:'Xem mã SDK đầy đủ'};
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
  if(action==='WITHDRAWAL_STATUS'||action==='WITHDRAWAL_RECEIPT')out.withdrawalId=params[0];
  if(action==='SDK_REVEAL'){const s=await db.sdkRecord.findFirst({where:{id:params[0],projectId},select:{code:true,vm:{select:{code:true,server:{select:{code:true}}}}}});if(s){out.sdk=maskSdk(s.code);if(s.vm)out.vm=s.vm.server.code+' / '+s.vm.code;}}
  if(typeof body.jobId==='string')out.jobId=body.jobId;
  if(typeof body.transactionId==='string')out.transactionId=body.transactionId;
  return out;
}
export interface GateInput {projectId:string;tokenId:string;userId:string;action:string;method:string;path:string;objectId:string|null;requestKey:string;payloadHash:string;summary:Record<string,unknown>}
/** Before a critical command runs: throws ApprovalHold (202 / 403 / 410) or returns the approval to consume after success. */
export async function gateApproval(db:PrismaClient,g:GateInput){
  const now=new Date();
  const rows=await db.opsApproval.findMany({where:{requestKey:g.requestKey},orderBy:{requestedAt:'desc'}});
  const open=rows.find(r=>r.status==='PENDING'||r.status==='APPROVED'),consumed=rows.find(r=>r.status==='CONSUMED');
  if(consumed&&consumed.payloadHash===g.payloadHash)return {approval:consumed,replay:true};
  if(open){
    if(open.payloadHash!==g.payloadHash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH','Idempotency-Key này đang chờ / đã được duyệt cho một nội dung khác; dùng key mới');
    if(open.expiresAt<now){await db.opsApproval.update({where:{id:open.id},data:{status:'EXPIRED'}});throw new ApprovalHold('APPROVAL_EXPIRED','Yêu cầu duyệt đã hết hạn (15 phút); gửi lại với Idempotency-Key mới để xin duyệt lại',{approvalId:open.id,expiredAt:open.expiresAt.toISOString()});}
    if(open.status==='PENDING')throw new ApprovalHold('APPROVAL_REQUIRED','Lệnh đang chờ ADMIN duyệt trên web; gửi lại cùng Idempotency-Key sau khi được duyệt',{approvalId:open.id,status:'PENDING',expiresAt:open.expiresAt.toISOString()});
    return {approval:open,replay:false};
  }
  const rejected=rows.find(r=>r.status==='REJECTED');
  if(rejected&&rejected.payloadHash===g.payloadHash)throw new ApprovalHold('APPROVAL_REJECTED','ADMIN đã từ chối lệnh này'+(rejected.decisionNote?': '+rejected.decisionNote:''),{approvalId:rejected.id,status:'REJECTED'});
  const created=await db.opsApproval.create({data:{projectId:g.projectId,tokenId:g.tokenId,userId:g.userId,action:g.action,method:g.method,path:g.path,objectId:g.objectId,requestKey:g.requestKey,payloadHash:g.payloadHash,summary:g.summary as object,expiresAt:new Date(now.getTime()+APPROVAL_TTL_MS)}});
  throw new ApprovalHold('APPROVAL_REQUIRED','Lệnh quan trọng: chờ ADMIN duyệt trên web (Phê duyệt), rồi gửi lại cùng Idempotency-Key trong 15 phút',{approvalId:created.id,status:'PENDING',expiresAt:created.expiresAt.toISOString()});
}
export async function consumeApproval(db:PrismaClient,approvalId:string,requestId:string){
  await db.opsApproval.updateMany({where:{id:approvalId,status:'APPROVED'},data:{status:'CONSUMED',consumedAt:new Date(),consumedRequestId:requestId}});
}
// ─── Web side (ADMIN) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function listApprovals(db:PrismaClient,projectId:string,o:{status?:ApprovalStatus|'OPEN';limit?:number}={}){
  const now=new Date();
  await db.opsApproval.updateMany({where:{projectId,status:'PENDING',expiresAt:{lt:now}},data:{status:'EXPIRED'}});
  const where=o.status==='OPEN'||!o.status?{projectId,status:'PENDING'}:{projectId,status:o.status};
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
  const t=await checkTotp(db,input.actorId,input.code);
  if(t.result!=='OK')throw new ProxyDomainError('FORBIDDEN',totpMessage(t.result,u.totpLockedAt));
  const status:ApprovalStatus=input.approve?'APPROVED':'REJECTED',now=new Date();
  const n=await db.opsApproval.updateMany({where:{id:row.id,status:'PENDING'},data:{status,decidedById:input.actorId,decidedAt:now,decisionNote:input.note?.trim().slice(0,300)||null}});
  if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu vừa được người khác quyết định');
  await db.auditLog.create({data:{projectId:input.projectId,userId:input.actorId,action:input.approve?'OPS_APPROVE':'OPS_REJECT',entity:'OpsApproval',entityId:row.id,changes:{action:row.action,objectId:row.objectId,tokenId:row.tokenId,via:t.via}}});
  return {id:row.id,status};
}
export async function pendingApprovalCount(db:PrismaClient,projectId:string){return db.opsApproval.count({where:{projectId,status:'PENDING',expiresAt:{gt:new Date()}}});}
