import {createHash,randomBytes} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError} from '../proxy-management/types';
import {loadInfrastructureScope,assertInfrastructureAction} from '../permissions/infrastructure';
import {verifyBusinessPin} from '../business-management/pin';
import {balanceRights} from '../vm-ops/balance';
import {payoutRights} from '../vm-ops/payout';
import {validIpRule} from './safety';
// Ops API tokens (21/10/2026).
// - mth_ + 32 random bytes (base64url). Only the SHA-256 is stored; `prefix` (12 characters) identifies a token in lists and audit.
// - A token belongs to one user and lists its projects and operations. It never carries rights of its own: every request re-reads the
//   user's membership and rights, so a lowered right or a removed membership applies to the next request.
// - An ADMIN creates it from Thiết lập (session + PIN) only for projects they administer and only for operations the user can do now.
//   The full token is returned once; listing never shows it. Revoking applies to the next request.
// VM_OPS / PROXY_CREDENTIALS (21/10/2026): work on real machines — take a VM, record steps, SDK, status, Blocked, notes; and read the
// full proxy of the VM in hand (right VM_PROXY_FOR_OPS).
export const OPS_SCOPES=['READ','BALANCE_WRITE','PAYOUT','RECEIPT','VM_OPS','PROXY_CREDENTIALS'] as const;
export type OpsScope=typeof OPS_SCOPES[number];
export const SCOPE_LABEL:Record<OpsScope,string>={READ:'Đọc dự án / server / VM / yêu cầu rút',BALANCE_WRITE:'Ghi số dư EarnApp',PAYOUT:'Gợi ý PP, chuẩn bị rút, ghi đã gửi / chưa rõ',RECEIPT:'Ghi khoản nhận PP của yêu cầu rút',VM_OPS:'Vận hành VM: nhận việc, ghi bước, SDK, tình trạng, Blocked, ghi chú',PROXY_CREDENTIALS:'Lấy proxy đầy đủ của VM đang xử lý'};
export const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex');
type Db=PrismaClient|Prisma.TransactionClient;
/** Which operations this member can do now in this project (the same rules the services check). */
export async function memberOps(db:Db,userId:string,projectId:string):Promise<Record<OpsScope,boolean>>{
  const none={READ:false,BALANCE_WRITE:false,PAYOUT:false,RECEIPT:false,VM_OPS:false,PROXY_CREDENTIALS:false};
  let current;try{current=await loadInfrastructureScope(db,userId,projectId);}catch{return none;}
  if(current.businessMode!=='PROXY_VM')return none;
  let read=true;try{assertInfrastructureAction(current,'READ');}catch{read=false;}if(!read)return none;
  const [b,p]=await Promise.all([balanceRights(current,db),payoutRights(current,db)]);
  let assign=true;try{assertInfrastructureAction(current,'ASSIGN');}catch{assign=false;}
  return {READ:true,BALANCE_WRITE:b.write,PAYOUT:p.payout,RECEIPT:p.receipt,VM_OPS:assign,PROXY_CREDENTIALS:assign&&(current.role==='ADMIN'||current.capabilities.includes('VM_PROXY_FOR_OPS'))};
}
/** A user can still act through a token: has a password and is not locked out of signing in. */
export async function userActive(db:Db,userId:string){
  const u=await db.user.findUnique({where:{id:userId},select:{password:true,loginLockedAt:true,disabledAt:true}});
  return !!u?.password&&!u.disabledAt&&!(u.loginLockedAt&&u.loginLockedAt.getTime()+30*60000>Date.now());
}
async function adminOf(db:Db,userId:string,projectId:string){
  const m=await db.projectMember.findUnique({where:{userId_projectId:{userId,projectId}},include:{project:{select:{settings:true}}}});
  return !!m&&m.role==='ADMIN'&&(m.project.settings as {businessMode?:string}|null)?.businessMode==='PROXY_VM';
}
// createKey (22/10/2026): one key per opened form; a retried or double-clicked create returns the token already made (without the secret,
// which is shown once) instead of making a second one.
/** "Không hết hạn" (owner request 22/10/2026): a fixed far date, so every expiry check stays as it is; revoke, a disabled user and the
 * user's current rights still end or limit the token. */
export const NEVER_EXPIRES=Date.UTC(9999,11,31);
export const neverExpires=(d:Date)=>d.getTime()>=NEVER_EXPIRES;
export interface CreateTokenInput {projectId:string;userId:string;name:string;scopes:OpsScope[];projectIds?:string[];expiresInDays:number|null;allowedIps?:string[];pin:string;createKey?:string|null}
export async function createOpsToken(adminId:string,input:CreateTokenInput,db:PrismaClient=prisma){
  const projectIds=Array.from(new Set(input.projectIds?.length?input.projectIds:[input.projectId])),scopes=Array.from(new Set(input.scopes)),ips=Array.from(new Set((input.allowedIps||[]).map(x=>x.trim()).filter(Boolean)));
  const name=input.name.trim();if(!name||name.length>60)throw new ProxyDomainError('INVALID_INPUT','Tên token 1–60 ký tự');
  if(!scopes.length||scopes.some(s=>!OPS_SCOPES.includes(s)))throw new ProxyDomainError('INVALID_INPUT','Chọn ít nhất một thao tác hợp lệ');
  if(input.expiresInDays!==null&&!(Number.isInteger(input.expiresInDays)&&input.expiresInDays>=1&&input.expiresInDays<=90))throw new ProxyDomainError('INVALID_INPUT','Hạn token từ 1 đến 90 ngày, hoặc không hết hạn');
  if(ips.length>20||ips.some(x=>!validIpRule(x)))throw new ProxyDomainError('INVALID_INPUT','Danh sách IP không hợp lệ (IP hoặc IPv4/nn, tối đa 20)');
  if(projectIds.length>10)throw new ProxyDomainError('INVALID_INPUT','Tối đa 10 dự án mỗi token');
  for(const id of projectIds)if(!await adminOf(db,adminId,id))throw new ProxyDomainError('FORBIDDEN','Chỉ ADMIN của dự án Proxy / VM được cấp token cho dự án đó');
  for(const id of projectIds){const can=await memberOps(db,input.userId,id),missing=scopes.filter(s=>!can[s]);
    if(missing.length)throw new ProxyDomainError('FORBIDDEN','Người nhận chưa có quyền: '+missing.map(s=>SCOPE_LABEL[s]).join(', ')+' — cấp quyền ở Kho proxy → Quyền nhân viên trước');}
  if(!await userActive(db,input.userId))throw new ProxyDomainError('FORBIDDEN','Tài khoản nhận token đang khoá hoặc chưa có mật khẩu');
  await verifyBusinessPin(db,adminId,input.pin);
  const key=input.createKey?.trim()||null;
  if(key&&!/^[A-Za-z0-9_-]{8,80}$/.test(key))throw new ProxyDomainError('INVALID_INPUT','Mã yêu cầu không hợp lệ');
  const same=async()=>{const prev=key?await db.opsToken.findUnique({where:{createKey:key}}):null;if(!prev)return null;
    if(prev.createdById!==adminId||prev.userId!==input.userId)throw new ProxyDomainError('FORBIDDEN','Mã yêu cầu đã dùng cho token khác');
    return {id:prev.id,prefix:prev.prefix,token:null as string|null,expiresAt:prev.expiresAt.toISOString(),already:true};};
  const prev=await same();if(prev)return prev;
  const token='mth_'+randomBytes(32).toString('base64url'),prefix=token.slice(0,12);
  let row;
  try{row=await db.opsToken.create({data:{name,prefix,tokenHash:hashToken(token),userId:input.userId,projectIds,scopes,allowedIps:ips,expiresAt:input.expiresInDays===null?new Date(NEVER_EXPIRES):new Date(Date.now()+input.expiresInDays*86400000),createdById:adminId,createKey:key}});}
  catch(e){if((e as {code?:string}).code==='P2002'&&key){const again=await same();if(again)return again;}throw e;}
  for(const id of projectIds)await db.auditLog.create({data:{projectId:id,userId:adminId,action:'OPS_TOKEN_CREATE',entity:'OpsToken',entityId:row.id,changes:{prefix,user:input.userId,scopes,expiresAt:row.expiresAt.toISOString(),ips:ips.length}}});
  return {id:row.id,prefix,token:token as string|null,expiresAt:row.expiresAt.toISOString(),already:false};
}
/** Tokens of one project (ADMIN), and of one user when userId is given (the user page, 22/10/2026): filtered here, never in the browser. */
export async function listOpsTokens(adminId:string,projectId:string,db:PrismaClient=prisma,opts:{userId?:string|null}={}){
  if(!await adminOf(db,adminId,projectId))throw new ProxyDomainError('FORBIDDEN');
  const rows=await db.opsToken.findMany({where:{projectIds:{has:projectId},...(opts.userId?{userId:opts.userId}:{})},orderBy:{createdAt:'desc'},take:200});
  const ids=Array.from(new Set(rows.flatMap(r=>[r.userId,r.createdById]))),users=await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,username:true}});
  const projects=await db.project.findMany({where:{id:{in:Array.from(new Set(rows.flatMap(r=>r.projectIds)))}},select:{id:true,name:true,code:true}});
  const who=(id:string)=>{const u=users.find(x=>x.id===id);return u?u.name||u.username||'—':'—';};
  return rows.map(r=>({id:r.id,name:r.name,prefix:r.prefix,user:who(r.userId),username:users.find(u=>u.id===r.userId)?.username??null,projects:r.projectIds.map(id=>{const p=projects.find(x=>x.id===id);return p?p.name||p.code:'—';}),scopes:r.scopes,allowedIps:r.allowedIps,
    expiresAt:r.expiresAt.toISOString(),createdAt:r.createdAt.toISOString(),createdBy:who(r.createdById),lastUsedAt:r.lastUsedAt?.toISOString()??null,lastUsedIp:r.lastUsedIp,revokedAt:r.revokedAt?.toISOString()??null,
    neverExpires:neverExpires(r.expiresAt),state:r.revokedAt?'REVOKED':r.expiresAt<new Date()?'EXPIRED':'ACTIVE'}));
}
export async function revokeOpsToken(adminId:string,input:{projectId:string;tokenId:string},db:PrismaClient=prisma){
  if(!await adminOf(db,adminId,input.projectId))throw new ProxyDomainError('FORBIDDEN');
  const row=await db.opsToken.findFirst({where:{id:input.tokenId,projectIds:{has:input.projectId}}});if(!row)throw new ProxyDomainError('NOT_FOUND');
  if(row.revokedAt)return {revoked:true,already:true};
  await db.opsToken.update({where:{id:row.id},data:{revokedAt:new Date(),revokedById:adminId}});
  await db.auditLog.create({data:{projectId:input.projectId,userId:adminId,action:'OPS_TOKEN_REVOKE',entity:'OpsToken',entityId:row.id,changes:{prefix:row.prefix}}});
  return {revoked:true,already:false};
}
/** Members an ADMIN may give a token to in this project, with what each can do now. */
export async function tokenCandidates(adminId:string,projectId:string,db:PrismaClient=prisma,opts:{userId?:string|null}={}){
  if(!await adminOf(db,adminId,projectId))throw new ProxyDomainError('FORBIDDEN');
  const members=await db.projectMember.findMany({where:{projectId,...(opts.userId?{userId:opts.userId}:{})},select:{userId:true,role:true,user:{select:{name:true,username:true}}},orderBy:{createdAt:'asc'}});
  return Promise.all(members.map(async m=>({userId:m.userId,role:m.role,name:m.user.name||m.user.username||'—',username:m.user.username,ops:await memberOps(db,m.userId,projectId)})));
}
