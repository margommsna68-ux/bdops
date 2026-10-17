import type {AccountLoginType,Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeVM,type VMReader} from '../vm-management/repository';
import {CLEAR,MAX_LINES,parseLinkLines,repeats} from './parse';
import {typeLabel} from './inventory';
// EarnApp account on a VM: one login (Gmail / Apple ID) per EarnApp account, one EarnApp account per VM, one PayPal per EarnApp
// account and a PayPal never receives for a second EarnApp account. Matched by server + VM code. A row that sets login and PayPal
// is checked completely before anything is written, so it is saved whole or not at all; independent rows get their own result.
// A login or PayPal held elsewhere is reported with its position and refused (never moved silently). Same link again = no change.
export interface LinkItem {line:number;vmId:string;expectedRevision:number;login?:string|null;paypal?:string|null}
export interface LinkRow {line:number;vmId:string|null;server:string;vm:string;expectedRevision:number|null;login?:string|null;paypal?:string|null;before:{login:string|null;paypal:string|null};after:{login:string|null;paypal:string|null};outcome:'READY'|'SKIP'|'ERROR';message:string}
const at=(vm:{code:string;server:{code:string}}|null|undefined)=>vm?vm.server.code+' / '+vm.code:'chưa gán VM';
const earnInclude={login:{select:{id:true,email:true,loginType:true}},paypal:{select:{id:true,code:true}},vm:{select:{id:true,code:true,server:{select:{code:true}}}}} as const;
type VMRef={id:string;code:string;revision:number;server:{code:string}};
async function activeVM(db:VMReader,projectId:string,id:string){return db.virtualMachine.findFirst({where:{id,managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,server:{select:{code:true}}}});}
// Full check of one row against the current data. Returns what would change, or why not.
async function check(db:VMReader,projectId:string,vm:VMRef,item:{login?:string|null;paypal?:string|null}){
  const current=await db.earnAppAccount.findUnique({where:{vmId:vm.id},include:earnInclude});
  const before={login:current?.login.email??null,paypal:current?.paypal?.code??null};
  const fail=(message:string)=>({ok:false as const,message,before,after:before});
  if(item.login===undefined&&item.paypal===undefined)return fail('Dòng không có tài khoản hay PayPal');
  if(item.login===null){
    if(item.paypal)return fail('PayPal nhận tiền gắn với tài khoản EarnApp; gán tài khoản trước');
    if(!current)return {ok:true as const,skip:true,message:'VM chưa có tài khoản; không thay đổi',before,after:before,plan:null};
    return {ok:true as const,skip:false,message:'Bỏ gán tài khoản '+current.login.email+' khỏi VM (tài khoản không trở lại NEW)',before,after:{login:null,paypal:null},plan:{release:current.id,target:null}};
  }
  let target:{id:string|null;loginId:string;email:string;paypalId:string|null;paypalCode:string|null};
  if(item.login===undefined||item.login===current?.loginId){
    if(!current)return fail('VM chưa có tài khoản EarnApp; gán tài khoản cùng dòng với PayPal');
    target={id:current.id,loginId:current.loginId,email:current.login.email,paypalId:current.paypalId,paypalCode:current.paypal?.code??null};
  }else{
    const login=await db.gmailAccount.findFirst({where:{id:item.login,projectId},include:{earnApp:{include:earnInclude}}});
    if(!login||login.archivedAt)return fail('Tài khoản không còn trong kho');
    if(login.status!=='ACTIVE')return fail('Tài khoản '+login.email+' đang '+login.status+'; không cấp cho VM');
    if(login.earnApp?.vmId)return fail('Tài khoản '+login.email+' đang giữ cho '+at(login.earnApp.vm)+'; bỏ gán ở đó trước, web không tự chuyển');
    target={id:login.earnApp?.id??null,loginId:login.id,email:login.email,paypalId:login.earnApp?.paypalId??null,paypalCode:login.earnApp?.paypal?.code??null};
  }
  let paypalId=target.paypalId,paypalCode=target.paypalCode;
  if(item.paypal===null){paypalId=null;paypalCode=null;}
  else if(item.paypal!==undefined&&item.paypal!==target.paypalId){
    const pp=await db.payPalAccount.findFirst({where:{id:item.paypal,projectId},include:{earnApp:{include:earnInclude}}});
    if(!pp||pp.archivedAt)return fail('PayPal không còn trong kho');
    if(pp.status!=='ACTIVE')return fail('PayPal '+pp.code+' đang '+pp.status+'; không dùng nhận tiền mới');
    if(pp.earnApp&&pp.earnApp.id!==target.id)return fail('PayPal '+pp.code+' đang nhận cho '+pp.earnApp.login.email+' ('+at(pp.earnApp.vm)+'); một PayPal chỉ nhận cho một EarnApp');
    if(pp.firstEarnAppId&&pp.firstEarnAppId!==target.id){const first=await db.earnAppAccount.findUnique({where:{id:pp.firstEarnAppId},include:{login:{select:{email:true}}}});return fail('PayPal '+pp.code+' đã từng nhận cho EarnApp '+(first?.login.email??'khác')+'; không dùng cho EarnApp thứ hai');}
    paypalId=pp.id;paypalCode=pp.code;
  }
  const after={login:target.email,paypal:paypalCode};
  if(current?.id===target.id&&current.vmId===vm.id&&paypalId===target.paypalId)return {ok:true as const,skip:true,message:'Không thay đổi',before,after,plan:null};
  const parts=[current&&current.loginId!==target.loginId?'Đổi tài khoản':!current?'Gán tài khoản':null,paypalId!==target.paypalId?(paypalId?(target.paypalId?'đổi PayPal':'gán PayPal'):'bỏ PayPal'):null].filter(Boolean);
  return {ok:true as const,skip:false,message:(parts.join(', ')||'Cập nhật')+(target.id?'':' (tạo liên kết EarnApp mới; chưa ghi đã đăng ký)'),before,after,plan:{release:current&&current.id!==target.id?current.id:null,target:{...target,paypalId}}};
}
type Plan=NonNullable<Extract<Awaited<ReturnType<typeof check>>,{ok:true}>['plan']>;
async function write(tx:Prisma.TransactionClient,images:BusinessCollector,projectId:string,vm:VMRef,plan:Plan){
  await images.remember('VM_BINDING',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{revision:{increment:1}}});
  if(plan.release){await images.remember('EARNAPP',plan.release);await tx.earnAppAccount.update({where:{id:plan.release},data:{vmId:null,revision:{increment:1}}});}
  const t=plan.target;if(!t)return;
  await images.remember('GMAIL',t.loginId);await tx.gmailAccount.update({where:{id:t.loginId},data:{revision:{increment:1}}});
  let id=t.id;
  if(id){
    const old=await tx.earnAppAccount.findUniqueOrThrow({where:{id}});await images.remember('EARNAPP',id);
    if(old.paypalId&&old.paypalId!==t.paypalId){await images.remember('PAYPAL',old.paypalId);await tx.payPalAccount.update({where:{id:old.paypalId},data:{revision:{increment:1}}});}
    await tx.earnAppAccount.update({where:{id},data:{vmId:vm.id,paypalId:t.paypalId,revision:{increment:1}}});
  }else{
    const row=await tx.earnAppAccount.create({data:{projectId,loginId:t.loginId,vmId:vm.id,paypalId:t.paypalId}});id=row.id;await images.remember('EARNAPP',id,true);
  }
  if(t.paypalId){const pp=await tx.payPalAccount.findUniqueOrThrow({where:{id:t.paypalId}});await images.remember('PAYPAL',pp.id);await tx.payPalAccount.update({where:{id:pp.id},data:{firstEarnAppId:pp.firstEarnAppId??id,revision:{increment:1}}});}
}
// Preview from a pasted list (Server | VM | Tài khoản | Mã PP) or from items (cell / bulk pick). Nothing is written.
export async function previewLinks(scope:ActorScope,input:{text?:string;items?:Omit<LinkItem,'expectedRevision'>[]},db:PrismaClient=prisma){
  await authorizeVM(scope,'ASSIGN',db);if((input.text===undefined)===(input.items===undefined))throw new ProxyDomainError('INVALID_INPUT');
  const vms=await db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,server:{select:{code:true}}}});
  const byKey=new Map(vms.map(v=>[v.server.code.toLowerCase()+'\u0000'+v.code.toLowerCase(),v])),byId=new Map(vms.map(v=>[v.id,v])),servers=new Set(vms.map(v=>v.server.code.toLowerCase()));
  type Draft={line:number;server:string;vmCode:string;vm:VMRef|undefined;login?:string|null;paypal?:string|null;error:string|null;loginText?:string;paypalText?:string};
  let drafts:Draft[];
  if(input.text!==undefined){
    if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa '+MAX_LINES+' dòng mỗi lần');
    const lines=parseLinkLines(input.text);if(!lines.length||lines.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến '+MAX_LINES+' dòng mỗi lần');
    const emails=lines.map(l=>l.login).filter((s):s is string=>!!s&&s!==CLEAR),codes=lines.map(l=>l.paypal).filter((s):s is string=>!!s&&s!==CLEAR);
    const [logins,pps]=await Promise.all([db.gmailAccount.findMany({where:{projectId:scope.projectId,email:{in:emails,mode:'insensitive'}},select:{id:true,email:true}}),db.payPalAccount.findMany({where:{projectId:scope.projectId,code:{in:codes,mode:'insensitive'}},select:{id:true,code:true}})]);
    const loginBy=new Map(logins.map(l=>[l.email.toLowerCase(),l.id])),ppBy=new Map(pps.map(p=>[p.code.toLowerCase(),p.id]));
    drafts=lines.map(l=>{
      const vm=byKey.get(l.server.toLowerCase()+'\u0000'+l.vm.toLowerCase());let error=l.error;
      if(!error&&!vm)error=!servers.has(l.server.toLowerCase())?'Không tìm thấy server '+l.server:'Không tìm thấy VM '+l.vm+' trên '+l.server+' (máy đã xoá không nhận cập nhật)';
      const login=l.login===undefined?undefined:l.login===CLEAR?null:loginBy.get(l.login);const paypal=l.paypal===undefined?undefined:l.paypal===CLEAR?null:ppBy.get(l.paypal.toLowerCase());
      if(!error&&l.login&&l.login!==CLEAR&&!login)error='Tài khoản '+l.login+' chưa có trong Kho tài khoản (nhập kho trước, web không tự tạo)';
      if(!error&&l.paypal&&l.paypal!==CLEAR&&!paypal)error='Mã PP '+l.paypal+' chưa có trong kho PayPal';
      return {line:l.line,server:l.server,vmCode:l.vm,vm,login,paypal,error,loginText:l.login,paypalText:l.paypal};
    });
  }else{
    if(!input.items!.length||input.items!.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT','Từ 1 đến '+MAX_LINES+' VM mỗi lần');
    drafts=input.items!.map(i=>{const vm=byId.get(i.vmId);return {line:i.line,server:vm?.server.code??'',vmCode:vm?.code??'',vm,login:i.login,paypal:i.paypal,error:vm?null:'VM không còn hoạt động'};});
  }
  const vmAgain=repeats(drafts,d=>d.vm?.id??null,d=>d.line),loginAgain=repeats(drafts,d=>d.login??null,d=>d.line),ppAgain=repeats(drafts,d=>d.paypal??null,d=>d.line);
  const rows:LinkRow[]=[];
  for(const d of drafts){
    const base={line:d.line,vmId:d.vm?.id??null,server:d.vm?.server.code??d.server,vm:d.vm?.code??d.vmCode,expectedRevision:d.vm?.revision??null,login:d.login,paypal:d.paypal,before:{login:null,paypal:null},after:{login:d.loginText??null,paypal:d.paypalText??null}};
    if(d.error||!d.vm){rows.push({...base,outcome:'ERROR',message:d.error||'VM không còn hoạt động'});continue;}
    const twice=vmAgain(d)?'VM lặp ở dòng '+vmAgain(d)!.join(', '):loginAgain(d)?'Cùng tài khoản với dòng '+loginAgain(d)!.join(', ')+'; mỗi tài khoản một VM':ppAgain(d)?'Cùng PayPal với dòng '+ppAgain(d)!.join(', ')+'; mỗi PayPal một EarnApp':null;
    if(twice){rows.push({...base,outcome:'ERROR',message:twice});continue;}
    const r=await check(db,scope.projectId,d.vm,{login:d.login,paypal:d.paypal});
    rows.push({...base,before:r.before,after:r.after,outcome:!r.ok?'ERROR':r.skip?'SKIP':'READY',message:r.message});
  }
  return {rows,ready:rows.filter(r=>r.outcome==='READY').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
// Apply re-checks every row inside one transaction (rights, project, VM revision, current holders), in line order.
export async function applyLinks(scope:ActorScope,input:{key:string;items:LinkItem[]},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>MAX_LINES||new Set(input.items.map(i=>i.vmId)).size!==input.items.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi VM một dòng, tối đa '+MAX_LINES+' dòng');
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_ACCOUNT_LINK',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const rows:{line:number;vmId:string;server:string;vm:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string}[]=[];
    for(const item of [...input.items].sort((a,b)=>a.line-b.line)){
      const vm=await activeVM(tx,scope.projectId,item.vmId),row=(outcome:'APPLIED'|'SKIP'|'ERROR',message:string)=>rows.push({line:item.line,vmId:item.vmId,server:vm?.server.code??'',vm:vm?.code??'',outcome,message});
      if(!vm){row('ERROR','VM không còn hoạt động (đã xoá hoặc không thuộc dự án)');continue;}
      const r=await check(tx,scope.projectId,vm,item);
      if(!r.ok){row('ERROR',r.message);continue;}
      if(r.skip){row('SKIP',r.message);continue;}
      if(vm.revision!==item.expectedRevision){row('ERROR','VM vừa được người khác thay đổi; xem lại dòng này');continue;}
      await write(tx,images,scope.projectId,vm,r.plan!);row('APPLIED',r.message.replace(/^\w/,c=>c));
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
// Bulk pick for selected VMs: VMs without an account get NEW logins of the chosen type (oldest batch first) and, if asked, a NEW
// PayPal each. Returns a preview; the user applies it with applyLinks. VMs that already have an account are listed as unchanged.
export async function planAutoLinks(scope:ActorScope,input:{vmIds:string[];loginType:AccountLoginType;withPaypal:boolean},db:PrismaClient=prisma){
  await authorizeVM(scope,'ASSIGN',db);if(!input.vmIds.length||input.vmIds.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT');
  const vms=(await db.virtualMachine.findMany({where:{id:{in:input.vmIds},managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,server:{select:{code:true}},earnApp:{select:{id:true,paypalId:true}}}})).sort((a,b)=>(a.server.code+'/'+a.code).localeCompare(b.server.code+'/'+b.code,'en',{numeric:true}));
  const [logins,pps]=await Promise.all([db.gmailAccount.findMany({where:{projectId:scope.projectId,archivedAt:null,status:'ACTIVE',loginType:input.loginType,earnApp:null},orderBy:[{batch:{purchasedAt:'asc'}},{createdAt:'asc'},{email:'asc'}],take:input.vmIds.length,select:{id:true}}),
    input.withPaypal?db.payPalAccount.findMany({where:{projectId:scope.projectId,archivedAt:null,status:'ACTIVE',earnApp:null,firstEarnAppId:null},orderBy:[{createdAt:'asc'},{code:'asc'}],take:input.vmIds.length,select:{id:true}}):Promise.resolve([])]);
  let li=0,pi=0;const items:Omit<LinkItem,'expectedRevision'>[]=[];
  vms.forEach((v,n)=>{if(v.earnApp){if(input.withPaypal&&!v.earnApp.paypalId&&pi<pps.length)items.push({line:n+1,vmId:v.id,paypal:pps[pi++].id});return;}if(li>=logins.length)return;items.push({line:n+1,vmId:v.id,login:logins[li++].id,...(input.withPaypal&&pi<pps.length?{paypal:pps[pi++].id}:{})});});
  const skipped=vms.filter(v=>!items.some(i=>i.vmId===v.id)).map(v=>({server:v.server.code,vm:v.code,message:v.earnApp?'Đã có tài khoản':'Hết tài khoản '+typeLabel(input.loginType)+' NEW trong kho'}));
  const preview=items.length?await previewLinks(scope,{items},db):{rows:[],ready:0,skipped:0,errors:0};
  return {...preview,notPlanned:skipped,availableLogins:logins.length,availablePaypals:pps.length};
}
// "Đã đăng ký EarnApp" is its own fact, recorded only by an explicit click; assignment and SDK never set it.
export async function markEarnAppRegistered(scope:ActorScope,input:{vmId:string;registered:boolean;expectedRevision:number;key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARNAPP_REGISTERED',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await activeVM(tx,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND');
    const e=await tx.earnAppAccount.findUnique({where:{vmId:vm.id}});if(!e)throw new ProxyDomainError('INVALID_INPUT','VM chưa có tài khoản EarnApp');
    if(!!e.registeredAt===input.registered)return {id:e.id,changed:false};
    if(e.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Tài khoản vừa được sửa; tải lại');
    await images.remember('EARNAPP',e.id);await tx.earnAppAccount.update({where:{id:e.id},data:{registeredAt:input.registered?new Date():null,registeredById:input.registered?current.userId:null,revision:{increment:1}}});
    return {id:e.id,changed:true};
  },db);
}
export {earnInclude};
