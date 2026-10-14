import type {PrismaClient,GmailStatus,PayPalStatus} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from '../proxy-management/transaction';
import {runBusinessCommand} from './idempotency';
import {authorizeBusiness} from './scope';
import {verifyBusinessPin} from './pin';
export interface AccountInput {kind:'GMAIL'|'PAYPAL';id?:string;email:string;code?:string;holder?:string;password?:string;twoFa?:string;token?:string;recoveryEmail?:string;paypalId?:string|null;status?:string;notes?:string;expectedRevision?:number;key:string}
const invalid=()=>{throw new ProxyDomainError('INVALID_INPUT','Thông tin tài khoản chưa hợp lệ');};
const manager=(scope:ActorScope)=>{if(!['ADMIN','MODERATOR'].includes(scope.role))throw new ProxyDomainError('FORBIDDEN','Quản lý mới được thêm/sửa tài khoản');};
export async function saveOperatingAccount(scope:ActorScope,input:AccountInput,db:PrismaClient=prisma){
 const email=input.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320||input.notes&&input.notes.length>1000||[input.password,input.twoFa,input.token].some(s=>s&&s.length>20000))invalid();
 const statuses=input.kind==='GMAIL'?['ACTIVE','SUSPENDED','NEEDS_RECOVERY','NEEDS_2FA_UPDATE','BLOCKED','DISABLED']:['ACTIVE','LIMITED','SUSPENDED','CLOSED','PENDING_VERIFY'];if(input.status&&!statuses.includes(input.status)||input.kind==='PAYPAL'&&(!input.code?.trim()||input.code.length>80))invalid();
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_ACCOUNT',module:input.kind==='PAYPAL'?'PAYPALS':'INFRASTRUCTURE'},async(tx,images,current)=>{
  manager(current);
  if(input.kind==='GMAIL'){
   const old=input.id?await tx.gmailAccount.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null}}):null;if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');if(old&&old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
   const duplicate=await tx.gmailAccount.findFirst({where:{email:{equals:email,mode:'insensitive'},...(old?{id:{not:old.id}}:{})},select:{id:true}});if(duplicate)throw new ProxyDomainError('INVALID_INPUT','Email đã có trong hệ thống; kiểm tra tài khoản hiện có');
   if(input.paypalId){const pp=await tx.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId,archivedAt:null}});if(!pp)throw new ProxyDomainError('NOT_FOUND');}
   for(const id of Array.from(new Set([old?.paypalId,input.paypalId].filter((s):s is string=>!!s)))){await images.remember('PAYPAL',id);await tx.payPalAccount.update({where:{id},data:{revision:{increment:1}}});}
   const data={email,status:(input.status||old?.status||'ACTIVE') as GmailStatus,notes:input.notes,paypalId:input.paypalId,recoveryEmail:input.recoveryEmail,businessManaged:true,...(input.password?{password:encrypt(input.password)}:{}),...(input.twoFa?{twoFaCurrent:encrypt(input.twoFa)}:{}),...(input.token?{token:encrypt(input.token)}:{})};
   if(old)await images.remember('GMAIL',old.id);const row=old?await tx.gmailAccount.update({where:{id:old.id},data:{...data,revision:{increment:1}}}):await tx.gmailAccount.create({data:{...data,projectId:scope.projectId}});if(!old)await images.remember('GMAIL',row.id,true);return {id:row.id};
  }
  const old=input.id?await tx.payPalAccount.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null}}):null;if(input.id&&!old)throw new ProxyDomainError('NOT_FOUND');if(old&&old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
  const data={code:input.code!.trim(),primaryEmail:email,status:(input.status||old?.status||'ACTIVE') as PayPalStatus,holder:input.holder,notes:input.notes,businessManaged:true};if(old)await images.remember('PAYPAL',old.id);
  const row=old?await tx.payPalAccount.update({where:{id:old.id},data:{...data,revision:{increment:1}}}):await tx.payPalAccount.create({data:{...data,projectId:scope.projectId,company:'',createdById:scope.userId}});if(!old)await images.remember('PAYPAL',row.id,true);
  const primary=old?await tx.payPalEmail.findFirst({where:{paypalId:old.id,projectId:scope.projectId,isPrimary:true,archivedAt:null}}):null;
  const credentials={email,isPrimary:true,businessManaged:true,...(input.password?{password:encrypt(input.password)}:{}),...(input.twoFa?{twoFa:encrypt(input.twoFa)}:{}),...(input.token?{hotmailToken:encrypt(input.token)}:{})};
  if(primary)await images.remember('PAYPAL_EMAIL',primary.id);const child=primary?await tx.payPalEmail.update({where:{id:primary.id},data:{...credentials,revision:{increment:1}}}):await tx.payPalEmail.create({data:{...credentials,paypalId:row.id,projectId:scope.projectId}});if(!primary)await images.remember('PAYPAL_EMAIL',child.id,true);return {id:row.id};
 },db);
}
export async function bindVMAccount(scope:ActorScope,input:{vmId:string;gmailId:string|null;expectedRevision:number;key:string},db:PrismaClient=prisma){
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_VM_ACCOUNT',module:'INFRASTRUCTURE'},async(tx,images)=>{
  const vm=await tx.virtualMachine.findFirst({where:{id:input.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}}});if(!vm)throw new ProxyDomainError('NOT_FOUND');if(vm.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
  if(input.gmailId&&!await tx.gmailAccount.findFirst({where:{id:input.gmailId,projectId:scope.projectId,archivedAt:null}}))throw new ProxyDomainError('NOT_FOUND');
  await images.remember('VM_BINDING',vm.id);for(const id of Array.from(new Set([vm.gmailId,input.gmailId].filter((s):s is string=>!!s)))){await images.remember('GMAIL',id);await tx.gmailAccount.update({where:{id},data:{revision:{increment:1}}});}
  await tx.virtualMachine.update({where:{id:vm.id},data:{gmailId:input.gmailId,revision:{increment:1}}});return {id:vm.id};
 },db);
}
export async function archiveOperatingAccount(scope:ActorScope,input:{kind:'GMAIL'|'PAYPAL';id:string;expectedRevision:number;key:string},db:PrismaClient=prisma){
 return runBusinessCommand(scope,{key:input.key,payload:input,kind:'BUSINESS_ACCOUNT_ARCHIVE',module:input.kind==='PAYPAL'?'PAYPALS':'INFRASTRUCTURE'},async(tx,images,current)=>{
  manager(current);const old=input.kind==='GMAIL'?await tx.gmailAccount.findFirst({where:{id:input.id,projectId:scope.projectId}}):await tx.payPalAccount.findFirst({where:{id:input.id,projectId:scope.projectId}});if(!old)throw new ProxyDomainError('NOT_FOUND');if(old.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
  const held=input.kind==='GMAIL'?await tx.virtualMachine.count({where:{gmailId:old.id}}):await tx.gmailAccount.count({where:{paypalId:old.id,archivedAt:null}});if(held)throw new ProxyDomainError('INVALID_INPUT','Tài khoản đang được ghi trên VM hoặc liên kết Gmail. Bỏ liên kết trước khi ẩn.');await images.remember(input.kind,old.id);
  if(input.kind==='GMAIL')await tx.gmailAccount.update({where:{id:old.id},data:{archivedAt:new Date(),revision:{increment:1}}});else await tx.payPalAccount.update({where:{id:old.id},data:{archivedAt:new Date(),revision:{increment:1}}});return {id:old.id};
 },db);
}
export async function readOperatingWorkspace(scope:ActorScope,db:PrismaClient=prisma){
 const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),infra=current.role==='ADMIN'||!!current.allowedModules?.includes('INFRASTRUCTURE'),pp=current.role==='ADMIN'||!!current.allowedModules?.includes('PAYPALS');if(current.businessMode!=='PROXY_VM'||!infra&&!pp)throw new ProxyDomainError('FORBIDDEN');const [gmails,paypals,vms,members]=await Promise.all([
  infra?db.gmailAccount.findMany({where:{projectId:scope.projectId},include:{vms:{select:{id:true,code:true,server:{select:{code:true}}}}},orderBy:{email:'asc'}}):Promise.resolve([]),
  pp?db.payPalAccount.findMany({where:{projectId:scope.projectId},include:{emails:{where:{isPrimary:true,archivedAt:null},select:{password:true,twoFa:true,hotmailToken:true}}},orderBy:{code:'asc'}}):Promise.resolve([]),
  infra?db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,gmailId:true,revision:true,server:{select:{id:true,code:true}}}}):Promise.resolve([]),
  infra?db.projectMember.findMany({where:{projectId:scope.projectId},select:{role:true,allowedModules:true,user:{select:{id:true,name:true,username:true}}}}):Promise.resolve([]),
 ]);
 return {gmails:gmails.map(g=>({id:g.id,email:g.email,status:g.status,notes:g.notes,paypalId:g.paypalId,recoveryEmail:g.recoveryEmail,revision:g.revision,archivedAt:g.archivedAt?.toISOString()||null,credentialsAvailable:!!(g.password||g.twoFaCurrent||g.token),vmRefs:g.vms.map(v=>v.server.code+'/'+v.code)})),paypals:paypals.map(p=>({id:p.id,code:p.code,email:p.primaryEmail,status:p.status,holder:p.holder,notes:p.notes,revision:p.revision,archivedAt:p.archivedAt?.toISOString()||null,credentialsAvailable:!!(p.password||p.emails.some(e=>e.password||e.twoFa||e.hotmailToken))})),vms:vms.map(v=>({...v,serverId:v.server.id,server:v.server.code})),members:members.filter(m=>m.role!=='VIEWER'&&(m.role==='ADMIN'||m.allowedModules.includes('INFRASTRUCTURE'))).map(m=>({id:m.user.id,name:m.user.name||m.user.username||'Nhân viên',role:m.role}))};
}
export async function copyOperatingCredentials(scope:ActorScope,input:{kind:'GMAIL'|'PAYPAL';id:string;pin:string},db:PrismaClient=prisma){
 const area=input.kind==='PAYPAL'?'PAYPALS':'INFRASTRUCTURE',copy=(s:ActorScope)=>{if(s.role==='VIEWER'||s.role!=='ADMIN'&&!s.capabilities.includes('COPY_CREDENTIALS'))throw new ProxyDomainError('FORBIDDEN');};const current=await authorizeBusiness(scope,area,false,db);copy(current);await verifyBusinessPin(db,scope.userId,input.pin);
 return withProxyTransaction(async tx=>{
  const fresh=await authorizeBusiness(scope,area,false,tx);copy(fresh);
  const row=input.kind==='GMAIL'?await tx.gmailAccount.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null}}):await tx.payPalAccount.findFirst({where:{id:input.id,projectId:scope.projectId,archivedAt:null},include:{emails:{where:{isPrimary:true,archivedAt:null}}}});if(!row)throw new ProxyDomainError('NOT_FOUND');
  const gmail=row as {email:string;password:string|null;twoFaCurrent:string|null;token:string|null},paypal=row as {primaryEmail:string;password:string|null;twoFa:string|null;hotmailToken:string|null;emails:{password:string|null;twoFa:string|null;hotmailToken:string|null}[]};
  const values=input.kind==='GMAIL'?{email:gmail.email,password:gmail.password,twoFa:gmail.twoFaCurrent,token:gmail.token}:{email:paypal.primaryEmail,password:paypal.emails[0]?.password||paypal.password,twoFa:paypal.emails[0]?.twoFa||paypal.twoFa,token:paypal.emails[0]?.hotmailToken||paypal.hotmailToken};if(!values.password&&!values.twoFa&&!values.token)throw new ProxyDomainError('INVALID_INPUT','Chưa ghi thông tin đăng nhập');
  let decoded:{email:string;secret:string;twoFa:string|null;token:string|null};try{decoded={email:values.email,secret:values.password?decrypt(values.password):'',twoFa:values.twoFa?decrypt(values.twoFa):null,token:values.token?decrypt(values.token):null};}catch{throw new ProxyDomainError('INVALID_INPUT','Thông tin cũ cần kiểm tra và ghi lại trước khi copy');}
  await tx.auditLog.create({data:{projectId:scope.projectId,userId:scope.userId,action:'COPY_OPERATING_ACCOUNT',entity:input.kind,entityId:input.id,changes:{count:1}}});return decoded;
 },db);
}
