import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {assertInfrastructureAction,loadInfrastructureScope} from '../permissions/infrastructure';
import {assertUnrestrictedServers} from '../permissions/server-scope';
import {runBusinessCommand} from '../business-management/idempotency';
import {currentProxyOf,loadChangeVM,pendingApply,reissueProxyConfig} from '../vm-management/proxy-change';
import {loadCatalog} from './repository';
import {matchPackage} from './catalog';
import {ProxyDomainError,type ActorScope} from './types';
type Reader=PrismaClient|Prisma.TransactionClient;
// Proxy package / credential maintenance commands (owner 29/10/2026). Both are checked, journaled business commands (key + replay,
// undo through the operation journal). Credentials never appear in the journal summary, the request hash or the audit log: only
// sha256 digests (like ACCOUNT_STOCK_EDIT); images keep the encrypted cipher only.
async function authorizeManage(tx:Reader,scope:ActorScope){
  const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'MANAGE');
  if(current.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');
  await assertUnrestrictedServers(tx,current);return current;
}
const bangkokDay=(d:Date)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
/**
 * Rename a package code (the provider renumbers package IDs after each payment: 231243 → 252037). One transaction: the package row,
 * every endpoint's packageCode, a "Mã cũ" line in the note. The package id (reminders, costs) never changes. Refused when the new code
 * already exists. Undo restores the old code on the package and on every endpoint.
 */
export async function renamePackage(scope:ActorScope,input:{key:string;code:string;newCode:string;expectedRevision?:number},db:PrismaClient=prisma){
  const code=input.code.trim(),newCode=input.newCode.trim();
  if(!code||!newCode||newCode.length>80)throw new ProxyDomainError('INVALID_INPUT','Mã gói mới 1–80 ký tự');
  if(code===newCode)throw new ProxyDomainError('INVALID_INPUT','Mã gói mới trùng mã hiện tại');
  return runBusinessCommand(scope,{key:input.key,payload:{code,newCode,expectedRevision:input.expectedRevision??null},kind:'PACKAGE_RENAME',module:'INFRASTRUCTURE',authorize:tx=>authorizeManage(tx,scope)},async(tx,images)=>{
    const account=await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code}}});if(!account)throw new ProxyDomainError('NOT_FOUND','Không có gói '+code);
    if(input.expectedRevision!==undefined&&account.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Gói vừa được sửa; tải lại');
    if(await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code:newCode}}}))throw new ProxyDomainError('DUPLICATE_INPUT','Mã gói '+newCode+' đã có');
    const now=new Date(),line='Mã cũ: '+code+' (đổi '+bangkokDay(now)+')';
    let note=account.note?account.note+' · '+line:line;if(note.length>500)note=note.slice(note.length-500);
    const label=account.label===code||account.label.startsWith(newCode)?newCode:account.label;
    await images.remember('ACCOUNT',account.id);
    await tx.proxyProviderAccount.update({where:{id:account.id},data:{code:newCode,label,note,revision:{increment:1}}});
    const endpoints=await tx.proxyIP.findMany({where:{projectId:scope.projectId,packageCode:code},select:{id:true},orderBy:{id:'asc'}});
    for(const e of endpoints)await images.remember('ENDPOINT',e.id);
    if(endpoints.length)await tx.proxyIP.updateMany({where:{id:{in:endpoints.map(e=>e.id)}},data:{packageCode:newCode,revision:{increment:1}}});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_CATALOG',entity:'ProxyProviderAccount',entityId:account.id,changes:{rename:{from:code,to:newCode},endpoints:endpoints.length}}});
    return {packageId:account.id,code:newCode,oldCode:code,label,endpoints:endpoints.length};
  },db);
}

export interface CredentialChangeInput {key:string;endpointIds?:string[];ip?:string;username:string;password:string;updatePackageCredentials?:boolean;preview?:boolean;force?:boolean}
// Fleet command states still waiting for / running on a machine (same list as fleet-commands/guards ACTIVE).
const FLEET_ACTIVE=['QUEUED','CLAIMED','DISPATCHED','UNKNOWN'];
const digest=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');
const CRED=/^[^\s:|]{1,200}$/;
/** Parse "user:pass" (the owner pastes it like that); credentials must not contain spaces, ':' or '|'. */
export function parseCredentialPair(text:string){const t=text.trim(),i=t.indexOf(':');if(i<=0)return null;const username=t.slice(0,i),password=t.slice(i+1);return CRED.test(username)&&CRED.test(password)?{username,password}:null;}
async function planCredentials(tx:Reader,scope:ActorScope,input:CredentialChangeInput){
  const username=input.username.trim(),password=input.password.trim();
  if(!CRED.test(username)||!CRED.test(password))throw new ProxyDomainError('INVALID_INPUT','User/pass mới không hợp lệ (không để trống, không có khoảng trắng, dấu : hoặc |)');
  const ids=input.endpointIds?.length?Array.from(new Set(input.endpointIds)):null,ip=input.ip?.trim()||null;
  if(!ids&&!ip)throw new ProxyDomainError('INVALID_INPUT','Chọn proxy hoặc nhập IP');
  if(ids&&ids.length>2000)throw new ProxyDomainError('INVALID_INPUT','Tối đa 2000 proxy mỗi lần');
  const rows=await tx.proxyIP.findMany({where:{projectId:scope.projectId,retiredAt:null,inventoryState:{notIn:['RETIRED','VOID']},...(ids?{id:{in:ids}}:{host:ip!})},orderBy:[{host:'asc'},{port:'asc'}]});
  if(ids&&rows.length!==ids.length)throw new ProxyDomainError('NOT_FOUND','Có proxy không còn trong kho (đã xoá hoặc không thuộc dự án)');
  if(!rows.length)throw new ProxyDomainError('NOT_FOUND','Không có proxy nào của IP '+ip+' trong kho');
  if(rows.some(r=>!r.credentialCipher||!r.host||!r.port))throw new ProxyDomainError('INVALID_INPUT','Có proxy chưa đủ IP:port:user:pass; sửa từng dòng');
  const changing=rows.filter(r=>{const c=JSON.parse(decrypt(r.credentialCipher!)) as {username:string;password:string};return c.username!==username||c.password!==password;});
  const catalog=await loadCatalog(scope.projectId,tx,true),before=Array.from(new Set(rows.map(r=>r.packageCode)));
  let refusal:string|null=null,packageAfter:string|null,packageAccount:{id:string;code:string}|null=null;
  if(input.updatePackageCredentials){
    // The whole package moves to the new user/pass: every current proxy of it must be in this change, otherwise the rest would fall out.
    if(before.length!==1||!before[0])refusal='Cập nhật user/pass của gói chỉ khi tất cả proxy chọn cùng một gói';
    else{
      const code=before[0],all=await tx.proxyIP.count({where:{projectId:scope.projectId,packageCode:code,retiredAt:null,inventoryState:{notIn:['RETIRED','VOID']}}});
      const owner=catalog.find(c=>c.username===username&&c.password===password&&c.code!==code);
      if(all!==rows.length)refusal='Gói '+code+' còn '+(all-rows.length)+' proxy khác chưa chọn; chọn đủ cả gói hoặc bỏ cập nhật user/pass của gói';
      else if(owner)refusal='User/pass mới đã thuộc gói '+owner.code;
      else packageAccount={id:catalog.find(c=>c.code===code)!.id,code};
    }
    packageAfter=before.length===1?before[0]:null;
  }else{
    packageAfter=matchPackage({ip:'',port:null,username,password,format:'FULL'},catalog);
    if(!packageAfter)refusal='User/pass mới chưa thuộc gói nào: thêm gói với user/pass này trước, hoặc chọn cập nhật user/pass của gói (khi đổi cả gói)';
  }
  // VMs using these proxies get a new configuration "Chờ áp dụng trên máy", except a BLOCKED proxy: its VM waits for the provider's
  // replacement (Kho proxy → Nhận replace), so only its credentials change (review 29/10/2026).
  const vms:{vmId:string;endpointId:string}[]=[],blockedVms:string[]=[],alreadyPendingVmIds:string[]=[];let review=0;
  const blocked=new Set(changing.filter(r=>r.inventoryState==='BLOCKED').map(r=>r.id));
  const holds=await tx.vMProxyAllocation.findMany({where:{endpointId:{in:changing.map(r=>r.id)},releasedAt:null,role:{in:['DESIRED','INSTALLED']},vm:{managed:true,archivedAt:null}},select:{vmId:true,endpointId:true}});
  for(const h of holds){
    if(vms.some(v=>v.vmId===h.vmId)||blockedVms.includes(h.vmId))continue;
    const vm=await loadChangeVM(tx as Prisma.TransactionClient,h.vmId);
    if(currentProxyOf(vm).endpointId!==h.endpointId){review++;continue;}
    if(blocked.has(h.endpointId)){blockedVms.push(h.vmId);continue;}
    vms.push({vmId:h.vmId,endpointId:h.endpointId});if(pendingApply(vm))alreadyPendingVmIds.push(h.vmId);
  }
  // Work in progress on these VMs / proxies: an active VM job, a fleet command not finished, an Apple ID check holding the proxy.
  const vmIds=vms.map(v=>v.vmId),activeWork:{vmId:string|null;endpointId:string|null;kind:'VM_JOB'|'FLEET_COMMAND'|'APPLE_CHECK'}[]=[];
  if(vmIds.length){
    for(const j of await tx.vmJob.findMany({where:{projectId:scope.projectId,vmId:{in:vmIds},state:'ACTIVE'},select:{vmId:true}}))activeWork.push({vmId:j.vmId,endpointId:null,kind:'VM_JOB'});
    for(const c of await tx.fleetCommand.findMany({where:{projectId:scope.projectId,vmId:{in:vmIds},state:{in:FLEET_ACTIVE}},select:{vmId:true}}))activeWork.push({vmId:c.vmId,endpointId:null,kind:'FLEET_COMMAND'});
  }
  for(const r of changing)if(r.appleCheckLeaseJobId)activeWork.push({vmId:null,endpointId:r.id,kind:'APPLE_CHECK'});
  const byState:Record<string,number>={};for(const r of changing)byState[r.inventoryState]=(byState[r.inventoryState]||0)+1;
  return {rows,changing,username,password,refusal,packageBefore:before.filter((c):c is string=>!!c),packageAfter,packageAccount,vms,review,activeWork,summary:{endpoints:changing.length,unchanged:rows.length-changing.length,byState,vms:vms.length,reviewVms:review,blockedVms:blockedVms.length,blockedVmIds:blockedVms,alreadyPendingVmIds,activeWork,package:packageAfter,packageBefore:before.filter((c):c is string=>!!c),updatesPackage:!!packageAccount,refusal}};
}
/**
 * Change user/pass of existing proxies in place (the provider changed them on its site). Ids, IP, port, state, holds and history stay;
 * the package follows the new credentials (or the package itself moves to them with updatePackageCredentials). Every VM using one of
 * these proxies gets a new configuration marked "Chờ áp dụng trên máy" (reissueProxyConfig); the VM status is unchanged.
 * preview:true returns the counts without writing.
 */
export async function changeProxyCredentials(scope:ActorScope,input:CredentialChangeInput,db:PrismaClient=prisma){
  if(input.preview){await authorizeManage(db,scope);return {preview:true as const,...(await planCredentials(db,scope,input)).summary};}
  const payload={endpointIds:input.endpointIds?[...input.endpointIds].sort():null,ip:input.ip?.trim()||null,username:digest(input.username.trim()),password:digest(input.password.trim()),updatePackageCredentials:!!input.updatePackageCredentials,force:!!input.force};
  return runBusinessCommand(scope,{key:input.key,payload,kind:'PROXY_CREDENTIALS',module:'INFRASTRUCTURE',authorize:tx=>authorizeManage(tx,scope)},async(tx,images,current)=>{
    const plan=await planCredentials(tx,current,input);
    if(plan.refusal)throw new ProxyDomainError('INVALID_INPUT',plan.refusal);
    if(plan.activeWork.length&&!input.force)throw new ProxyDomainError('STALE_PREVIEW','Có việc đang chạy trên '+plan.activeWork.length+' VM / proxy (job VM, lệnh fleet hoặc Check Apple ID); chờ xong hoặc xác nhận làm tiếp');
    if(!plan.changing.length)return {preview:false as const,...plan.summary};
    const now=new Date(),cipher=()=>encrypt(JSON.stringify({username:plan.username,password:plan.password}));
    if(plan.packageAccount){await images.remember('ACCOUNT',plan.packageAccount.id);await tx.proxyProviderAccount.update({where:{id:plan.packageAccount.id},data:{credentialCipher:cipher(),revision:{increment:1}}});}
    for(const r of plan.changing){
      await images.remember('ENDPOINT',r.id);
      await tx.proxyIP.update({where:{id:r.id},data:{credentialCipher:cipher(),packageCode:plan.packageAfter,revision:{increment:1}}});
      if(r.identityId&&r.host)await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:r.identityId,endpointId:r.id,ip:r.host,kind:'CREDENTIALS_CHANGED',occurredAt:now,actorId:scope.userId,reason:'Đổi user/pass'+(r.packageCode!==plan.packageAfter?' · gói '+(r.packageCode||'chưa rõ')+' → '+plan.packageAfter:'')}});
    }
    let pending=0;
    for(const v of plan.vms)if(await reissueProxyConfig(tx,images,{projectId:scope.projectId,actorId:current.userId,now,via:'Đổi user/pass'},v.vmId,v.endpointId))pending++;
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_CREDENTIALS_CHANGE',entity:'ProxyIP',entityId:plan.changing[0].host||plan.changing[0].id,changes:{endpoints:plan.changing.length,vms:pending,blockedVms:plan.summary.blockedVms,package:plan.packageAfter,updatesPackage:!!plan.packageAccount,forced:!!input.force&&plan.activeWork.length>0}}});
    return {preview:false as const,...plan.summary,vms:pending};
  },db);
}
