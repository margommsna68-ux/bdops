import type {AccountLoginType,Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeVM,type VMReader} from '../vm-management/repository';
import {CLEAR,MAX_LINES,parseLinkLines,repeats} from './parse';
import {typeLabel} from './inventory';
// EarnApp account on a VM (owner rules 18/10/2026): one login (Gmail / Apple ID) per EarnApp account, one EarnApp account per VM,
// one current receiving PayPal email per EarnApp account. A PayPal code has many emails, so many EarnApp accounts may use the
// same PayPal, each through its own email; an email serves one EarnApp account forever (PayPalEmail.usedEarnAppId is never cleared
// by unassigning). The PayPal is always chosen as "Mã PP → email"; a bare PayPal code is refused. A locked / stopped PayPal or an
// email held for reconciliation is never given out. Matched by server + VM code. A row that sets login and email is checked
// completely before anything is written, so it is saved whole or not at all; independent rows get their own result. A login or
// email held elsewhere is reported with its position and refused (never moved silently). Same link again = no change.
export interface LinkItem {line:number;vmId:string;expectedRevision:number;login?:string|null;paypalEmail?:string|null;paypal?:string|null}
export interface LinkRow {line:number;vmId:string|null;server:string;vm:string;expectedRevision:number|null;login?:string|null;paypalEmail?:string|null;before:{login:string|null;paypal:string|null};after:{login:string|null;paypal:string|null};outcome:'READY'|'SKIP'|'ERROR';message:string}
const at=(vm:{code:string;server:{code:string}}|null|undefined)=>vm?vm.server.code+' / '+vm.code:'chưa gán VM';
const earnInclude={login:{select:{id:true,email:true,loginType:true}},paypal:{select:{id:true,code:true}},paypalEmail:{select:{id:true,email:true}},vm:{select:{id:true,code:true,server:{select:{code:true}}}}} as const;
const payoutLabel=(e:{paypal:{code:string}|null;paypalEmail:{email:string}|null}|null|undefined)=>!e?.paypal?null:e.paypal.code+' · '+(e.paypalEmail?.email??'chưa xác định email');
type VMRef={id:string;code:string;revision:number;server:{code:string}};
async function activeVM(db:VMReader,projectId:string,id:string){return db.virtualMachine.findFirst({where:{id,managed:true,archivedAt:null,server:{projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,server:{select:{code:true}}}});}
// Can this email be given to this EarnApp account now? (null target = an EarnApp account created by this row)
export async function emailFor(db:VMReader,projectId:string,emailId:string,earnAppId:string|null){
  const email=await db.payPalEmail.findFirst({where:{id:emailId,projectId},include:{paypal:{select:{id:true,code:true,status:true,archivedAt:true}},earnApp:{include:earnInclude}}});
  if(!email||email.archivedAt||email.paypal.archivedAt)return {ok:false as const,message:'Email PayPal không còn trong kho'};
  const who=email.paypal.code+' · '+email.email;
  if(email.paypal.status!=='ACTIVE')return {ok:false as const,message:'PayPal '+email.paypal.code+' đang '+email.paypal.status+'; email của PP này không cấp mới'};
  if(email.reviewHold)return {ok:false as const,message:'Email '+who+' đang tạm giữ để đối chiếu dữ liệu cũ; xử lý ở Cần đối chiếu trước'};
  if(email.earnApp&&email.earnApp.id!==earnAppId)return {ok:false as const,message:'Email '+who+' đang nhận cho '+email.earnApp.login.email+' ('+at(email.earnApp.vm)+'); mỗi email một EarnApp'};
  if(email.usedEarnAppId&&email.usedEarnAppId!==earnAppId){const first=await db.earnAppAccount.findUnique({where:{id:email.usedEarnAppId},include:{login:{select:{email:true}}}});return {ok:false as const,message:'Email '+who+' đã dùng cho EarnApp '+(first?.login.email??'khác')+'; email đã dùng không cấp cho EarnApp khác'};}
  return {ok:true as const,email:{id:email.id,email:email.email,paypalId:email.paypal.id,code:email.paypal.code}};
}
// Full check of one row against the current data. Returns what would change, or why not.
async function check(db:VMReader,projectId:string,vm:VMRef,item:{login?:string|null;paypalEmail?:string|null;paypal?:string|null}){
  const current=await db.earnAppAccount.findUnique({where:{vmId:vm.id},include:earnInclude});
  const before={login:current?.login.email??null,paypal:payoutLabel(current)};
  const fail=(message:string)=>({ok:false as const,message,before,after:before});
  // Old callers sent a PayPal id: a PayPal has many emails now, so the email must be chosen (null still removes it).
  if(item.paypal)return fail('Chọn email PayPal (Mã PP → Email); một PP có nhiều email, mỗi email cho một EarnApp');
  const emailItem=item.paypalEmail!==undefined?item.paypalEmail:item.paypal===null?null:undefined;
  if(item.login===undefined&&emailItem===undefined)return fail('Dòng không có tài khoản hay email PayPal');
  if(item.login===null){
    if(emailItem)return fail('Email PayPal nhận tiền gắn với tài khoản EarnApp; gán tài khoản trước');
    if(!current)return {ok:true as const,skip:true,message:'VM chưa có tài khoản; không thay đổi',before,after:before,plan:null};
    return {ok:true as const,skip:false,message:'Bỏ gán tài khoản '+current.login.email+' khỏi VM (tài khoản và email PayPal không trở lại NEW)',before,after:{login:null,paypal:null},plan:{release:current.id,target:null}};
  }
  type Target={id:string|null;loginId:string;email:string;paypalId:string|null;paypalEmailId:string|null;label:string|null};
  let target:Target;
  if(item.login===undefined||item.login===current?.loginId){
    if(!current)return fail('VM chưa có tài khoản EarnApp; gán tài khoản cùng dòng với email PayPal');
    target={id:current.id,loginId:current.loginId,email:current.login.email,paypalId:current.paypalId,paypalEmailId:current.paypalEmailId,label:payoutLabel(current)};
  }else{
    const login=await db.gmailAccount.findFirst({where:{id:item.login,projectId},include:{earnApp:{include:earnInclude}}});
    if(!login||login.archivedAt)return fail('Tài khoản không còn trong kho');
    if(login.status!=='ACTIVE')return fail('Tài khoản '+login.email+' đang '+login.status+'; không cấp cho VM');
    if(login.earnApp?.vmId)return fail('Tài khoản '+login.email+' đang giữ cho '+at(login.earnApp.vm)+'; bỏ gán ở đó trước, web không tự chuyển');
    target={id:login.earnApp?.id??null,loginId:login.id,email:login.email,paypalId:login.earnApp?.paypalId??null,paypalEmailId:login.earnApp?.paypalEmailId??null,label:payoutLabel(login.earnApp)};
  }
  let paypalId=target.paypalId,paypalEmailId=target.paypalEmailId,label=target.label;
  if(emailItem===null){paypalId=null;paypalEmailId=null;label=null;}
  else if(emailItem!==undefined&&emailItem!==target.paypalEmailId){
    const r=await emailFor(db,projectId,emailItem,target.id);if(!r.ok)return fail(r.message);
    paypalId=r.email.paypalId;paypalEmailId=r.email.id;label=r.email.code+' · '+r.email.email;
  }
  const after={login:target.email,paypal:label};
  if(current?.id===target.id&&current.vmId===vm.id&&paypalEmailId===target.paypalEmailId&&paypalId===target.paypalId)return {ok:true as const,skip:true,message:'Không thay đổi',before,after,plan:null};
  const changed=paypalEmailId!==target.paypalEmailId||paypalId!==target.paypalId;
  const parts=[current&&current.loginId!==target.loginId?'Đổi tài khoản':!current?'Gán tài khoản':null,changed?(paypalEmailId?(target.paypalId?'đổi email PayPal':'gán email PayPal'):'bỏ PayPal'):null].filter(Boolean);
  return {ok:true as const,skip:false,message:(parts.join(', ')||'Cập nhật')+(target.id?'':' (tạo liên kết EarnApp mới; chưa ghi đã đăng ký)'),before,after,plan:{release:current&&current.id!==target.id?current.id:null,target:{...target,paypalId,paypalEmailId,payoutChanged:changed}}};
}
type Plan=NonNullable<Extract<Awaited<ReturnType<typeof check>>,{ok:true}>['plan']>;
async function write(tx:Prisma.TransactionClient,images:BusinessCollector,projectId:string,vm:VMRef,plan:Plan,actorId:string){
  await images.remember('VM_BINDING',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{revision:{increment:1}}});
  if(plan.release){await images.remember('EARNAPP',plan.release);await tx.earnAppAccount.update({where:{id:plan.release},data:{vmId:null,revision:{increment:1}}});}
  const t=plan.target;if(!t)return;
  await images.remember('GMAIL',t.loginId);await tx.gmailAccount.update({where:{id:t.loginId},data:{revision:{increment:1}}});
  let id=t.id,oldPaypal:string|null=null;
  if(id){
    const old=await tx.earnAppAccount.findUniqueOrThrow({where:{id}});await images.remember('EARNAPP',id);oldPaypal=old.paypalId;
    // Free the unique email slot first only by moving this account to the new email (an email is never taken from another account).
    await tx.earnAppAccount.update({where:{id},data:{vmId:vm.id,paypalId:t.paypalId,paypalEmailId:t.paypalEmailId,revision:{increment:1}}});
  }else{
    const row=await tx.earnAppAccount.create({data:{projectId,loginId:t.loginId,vmId:vm.id,paypalId:t.paypalId,paypalEmailId:t.paypalEmailId}});id=row.id;await images.remember('EARNAPP',id,true);
  }
  for(const pp of new Set([oldPaypal,t.paypalId].filter((x):x is string=>!!x))){await images.remember('PAYPAL',pp);await tx.payPalAccount.update({where:{id:pp},data:{revision:{increment:1}}});}
  if(t.paypalEmailId){
    const email=await tx.payPalEmail.findUniqueOrThrow({where:{id:t.paypalEmailId}});await images.remember('PAYPAL_EMAIL',email.id);
    await tx.payPalEmail.update({where:{id:email.id},data:{usedEarnAppId:email.usedEarnAppId??id,usedAt:email.usedAt??new Date(),revision:{increment:1}}});
  }
  // History of the receiving email: close the open period, open a new one (old payments keep their own snapshot).
  if(t.payoutChanged){
    const open=await tx.earnAppPayout.findMany({where:{earnAppId:id,endedAt:null}});
    for(const o of open){await images.remember('PAYOUT',o.id);await tx.earnAppPayout.update({where:{id:o.id},data:{endedAt:new Date()}});}
    if(t.paypalId){const row=await tx.earnAppPayout.create({data:{projectId,earnAppId:id,paypalId:t.paypalId,paypalEmailId:t.paypalEmailId,vmId:vm.id,createdById:actorId}});await images.remember('PAYOUT',row.id,true);}
  }
}
// Preview from a pasted list (Server | VM | Tài khoản | Email PP, or … | Mã PP | Email PP) or from items (cell / bulk pick). Nothing is written.
export async function previewLinks(scope:ActorScope,input:{text?:string;items?:Omit<LinkItem,'expectedRevision'>[]},db:PrismaClient=prisma){
  await authorizeVM(scope,'ASSIGN',db);if((input.text===undefined)===(input.items===undefined))throw new ProxyDomainError('INVALID_INPUT');
  const vms=await db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,server:{select:{code:true}}}});
  const byKey=new Map(vms.map(v=>[v.server.code.toLowerCase()+'\u0000'+v.code.toLowerCase(),v])),byId=new Map(vms.map(v=>[v.id,v])),servers=new Set(vms.map(v=>v.server.code.toLowerCase()));
  type Draft={line:number;server:string;vmCode:string;vm:VMRef|undefined;login?:string|null;paypalEmail?:string|null;paypal?:string|null;error:string|null;loginText?:string;paypalText?:string};
  let drafts:Draft[];
  if(input.text!==undefined){
    if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa '+MAX_LINES+' dòng mỗi lần');
    const lines=parseLinkLines(input.text);if(!lines.length||lines.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến '+MAX_LINES+' dòng mỗi lần');
    const emails=lines.map(l=>l.login).filter((s):s is string=>!!s&&s!==CLEAR),ppMails=lines.map(l=>l.paypalEmail).filter((s):s is string=>!!s&&s!==CLEAR);
    const [logins,mails]=await Promise.all([db.gmailAccount.findMany({where:{projectId:scope.projectId,email:{in:emails,mode:'insensitive'}},select:{id:true,email:true}}),db.payPalEmail.findMany({where:{projectId:scope.projectId,email:{in:ppMails,mode:'insensitive'}},select:{id:true,email:true,paypal:{select:{code:true}}}})]);
    const loginBy=new Map(logins.map(l=>[l.email.toLowerCase(),l.id])),mailBy=new Map(mails.map(m=>[m.email.toLowerCase(),m]));
    drafts=lines.map(l=>{
      const vm=byKey.get(l.server.toLowerCase()+'\u0000'+l.vm.toLowerCase());let error=l.error;
      if(!error&&!vm)error=!servers.has(l.server.toLowerCase())?'Không tìm thấy server '+l.server:'Không tìm thấy VM '+l.vm+' trên '+l.server+' (máy đã xoá không nhận cập nhật)';
      const login=l.login===undefined?undefined:l.login===CLEAR?null:loginBy.get(l.login);const mail=l.paypalEmail&&l.paypalEmail!==CLEAR?mailBy.get(l.paypalEmail):undefined;
      const paypalEmail=l.paypalEmail===undefined?undefined:l.paypalEmail===CLEAR?null:mail?.id;
      if(!error&&l.login&&l.login!==CLEAR&&!login)error='Tài khoản '+l.login+' chưa có trong Kho tài khoản (nhập kho trước, web không tự tạo)';
      if(!error&&l.paypalEmail&&l.paypalEmail!==CLEAR&&!mail)error='Email PayPal '+l.paypalEmail+' chưa có trong kho PayPal (Bổ sung email vào PP trước)';
      if(!error&&mail&&l.paypalCode&&mail.paypal.code.toLowerCase()!==l.paypalCode.toLowerCase())error='Email '+l.paypalEmail+' thuộc PP '+mail.paypal.code+', không phải '+l.paypalCode;
      return {line:l.line,server:l.server,vmCode:l.vm,vm,login,paypalEmail,error,loginText:l.login,paypalText:l.paypalEmail&&l.paypalEmail!==CLEAR?(mail?mail.paypal.code+' · ':'')+l.paypalEmail:l.paypalEmail};
    });
  }else{
    if(!input.items!.length||input.items!.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT','Từ 1 đến '+MAX_LINES+' VM mỗi lần');
    drafts=input.items!.map(i=>{const vm=byId.get(i.vmId);return {line:i.line,server:vm?.server.code??'',vmCode:vm?.code??'',vm,login:i.login,paypalEmail:i.paypalEmail,paypal:i.paypal,error:vm?null:'VM không còn hoạt động'};});
  }
  const vmAgain=repeats(drafts,d=>d.vm?.id??null,d=>d.line),loginAgain=repeats(drafts,d=>d.login??null,d=>d.line),ppAgain=repeats(drafts,d=>d.paypalEmail??null,d=>d.line);
  const rows:LinkRow[]=[];
  for(const d of drafts){
    const base={line:d.line,vmId:d.vm?.id??null,server:d.vm?.server.code??d.server,vm:d.vm?.code??d.vmCode,expectedRevision:d.vm?.revision??null,login:d.login,paypalEmail:d.paypalEmail,before:{login:null,paypal:null},after:{login:d.loginText??null,paypal:d.paypalText??null}};
    if(d.error||!d.vm){rows.push({...base,outcome:'ERROR',message:d.error||'VM không còn hoạt động'});continue;}
    const twice=vmAgain(d)?'VM lặp ở dòng '+vmAgain(d)!.join(', '):loginAgain(d)?'Cùng tài khoản với dòng '+loginAgain(d)!.join(', ')+'; mỗi tài khoản một VM':ppAgain(d)?'Cùng email PayPal với dòng '+ppAgain(d)!.join(', ')+'; mỗi email một EarnApp':null;
    if(twice){rows.push({...base,outcome:'ERROR',message:twice});continue;}
    const r=await check(db,scope.projectId,d.vm,{login:d.login,paypalEmail:d.paypalEmail,paypal:d.paypal});
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
      try{await write(tx,images,scope.projectId,vm,r.plan!,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được cấp cho EarnApp khác; tải lại');throw e;}
      row('APPLIED',r.message);
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
// Bulk pick for selected VMs: VMs without an account get NEW logins of the chosen type (oldest batch first) and, if asked, an unused
// PayPal email each (emails never used, not held, of an active PayPal; several emails of one PayPal may go to different VMs).
// Returns a preview; the user applies it with applyLinks. VMs that already have an account are listed as unchanged.
export async function planAutoLinks(scope:ActorScope,input:{vmIds:string[];loginType:AccountLoginType;withPaypal:boolean},db:PrismaClient=prisma){
  await authorizeVM(scope,'ASSIGN',db);if(!input.vmIds.length||input.vmIds.length>MAX_LINES)throw new ProxyDomainError('INVALID_INPUT');
  const vms=(await db.virtualMachine.findMany({where:{id:{in:input.vmIds},managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,server:{select:{code:true}},earnApp:{select:{id:true,paypalId:true,paypalEmailId:true}}}})).sort((a,b)=>(a.server.code+'/'+a.code).localeCompare(b.server.code+'/'+b.code,'en',{numeric:true}));
  const [logins,mails]=await Promise.all([db.gmailAccount.findMany({where:{projectId:scope.projectId,archivedAt:null,status:'ACTIVE',loginType:input.loginType,earnApp:null},orderBy:[{batch:{purchasedAt:'asc'}},{createdAt:'asc'},{email:'asc'}],take:input.vmIds.length,select:{id:true}}),
    input.withPaypal?db.payPalEmail.findMany({where:{projectId:scope.projectId,archivedAt:null,reviewHold:false,usedEarnAppId:null,earnApp:null,paypal:{archivedAt:null,status:'ACTIVE'}},orderBy:[{paypal:{createdAt:'asc'}},{paypal:{code:'asc'}},{createdAt:'asc'},{email:'asc'}],take:input.vmIds.length,select:{id:true}}):Promise.resolve([])]);
  let li=0,pi=0;const items:Omit<LinkItem,'expectedRevision'>[]=[];
  vms.forEach((v,n)=>{if(v.earnApp){if(input.withPaypal&&!v.earnApp.paypalId&&pi<mails.length)items.push({line:n+1,vmId:v.id,paypalEmail:mails[pi++].id});return;}if(li>=logins.length)return;items.push({line:n+1,vmId:v.id,login:logins[li++].id,...(input.withPaypal&&pi<mails.length?{paypalEmail:mails[pi++].id}:{})});});
  const skipped=vms.filter(v=>!items.some(i=>i.vmId===v.id)).map(v=>({server:v.server.code,vm:v.code,message:v.earnApp?'Đã có tài khoản':'Hết tài khoản '+typeLabel(input.loginType)+' NEW trong kho'}));
  const preview=items.length?await previewLinks(scope,{items},db):{rows:[],ready:0,skipped:0,errors:0};
  return {...preview,notPlanned:skipped,availableLogins:logins.length,availablePaypals:mails.length};
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
