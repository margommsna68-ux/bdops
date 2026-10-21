import {Prisma,type PrismaClient,type SdkRecord} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {canonicalAmount,formatSdkAmount,parseSdkAmount,SDK_NOTE_MAX} from '@/lib/sdk-money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeVM,type VMReader} from './repository';
import {normalizeSdk} from './sdk-parse';
import {assertSdkMoneyWrite,carriesMoney,sdkMoneyRights,SDK_MONEY_WRITE_REFUSAL} from './sdk-money-rights';
import {checkInfo,cycleOf,FOREIGN_CODE,infoChanges,syncMirror,where,type SdkInfo} from './sdk-store';
// SDK list of a VM (owner brief 20/10/2026). A VM keeps many SDK codes, to use now or later (SdkRecord.holderVmId); the store, the VM
// cell, Dán bảng and Kho SDK all read and write the same records.
// - Adding never replaces or removes another code of the VM, and never changes its current code (SdkRecord.vmId).
// - "Đã dùng" = the code was put into an EarnApp account (linkState LINKED). It is final: never unticked, never handed out again,
//   kept with who / when. Saving, copying, placing in a list or moving a code never marks it used, and a used mark never invents an
//   account link (linkedEarnAppId stays empty unless the account is really known).
// - A code in another VM's list is never taken by typing or pasting: the explicit transfer names the source VM and its revision.
// - Money on a code is the accumulated USD the operator recorded, never a cost, income or profit.
// - Every command checks the right, the VM round (expectedCycle) and the revision of the code it touches; the same request key
//   replays instead of writing twice.
type Tx=Prisma.TransactionClient;
const vmSelect={id:true,code:true,revision:true,archivedAt:true,managed:true,server:{select:{id:true,code:true,archivedAt:true}},operation:{select:{cycle:true}}} as const;
export type ListVM=Prisma.VirtualMachineGetPayload<{select:typeof vmSelect}>;
const label=(vm:{code:string;archivedAt:Date|null;server:{code:string;archivedAt:Date|null}})=>where(vm)+(vm.archivedAt||vm.server.archivedAt?' (đã xoá)':'');
export const RECREATED_LINE='VM đã được tạo lại, kiểm tra lại dòng này';
const staleCycle=(cycle:number)=>'VM đã sang lượt '+cycle+'; lệnh này dành cho lượt cũ. Tải lại rồi làm theo lượt hiện hành';
export const USED_REFUSAL=(code:string)=>'SDK '+code+' đã dùng cho một tài khoản EarnApp; chỉ giữ để tra cứu, không cấp lại';
const UNCONFIRMED_REFUSAL=(code:string)=>'SDK '+code+' là dữ liệu cũ chưa xác nhận đã dùng hay chưa; xác nhận ở Kho SDK trước';
async function foreign(db:VMReader,projectId:string,code:string){
  return !!(await db.sdkRecord.findFirst({where:{code,projectId:{not:projectId}},select:{id:true}})||await db.virtualMachine.findFirst({where:{sdkId:code,managed:true,server:{projectId:{not:projectId}}},select:{id:true}}));
}
export async function loadVM(db:VMReader,projectId:string,vmId:string):Promise<ListVM>{
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},select:vmSelect});
  if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này');
  if(vm.archivedAt||vm.server.archivedAt)throw new ProxyDomainError('INVALID_INPUT',where(vm)+' đã xoá; khôi phục VM trước khi ghi SDK');
  return vm;
}
export const holderOf=(r:{holderVmId:string|null;vmId:string|null})=>r.holderVmId??r.vmId;
export type ListPlan={kind:'CREATE'|'SAME'|'TAKE'|'MOVE';code:string;record:SdkRecord|null;source:ListVM|null};
/**
 * What adding `code` to the list of `vm` means, without writing. Errors come back as text (a paste reports them at the line).
 * `from` = the VM the person explicitly moves the code from ("Chọn SDK đã lưu → Dùng cho VM này").
 */
export async function planListAdd(db:VMReader,projectId:string,vm:ListVM,code:string,from?:{vmId:string;expectedRevision:number}|null):Promise<{plan:ListPlan}|{error:string;code:'OWNER_CONFLICT'|'STALE_PREVIEW'|'NOT_FOUND'}>{
  const record=await db.sdkRecord.findUnique({where:{projectId_code:{projectId,code}}});
  if(!record){if(await foreign(db,projectId,code))return {error:FOREIGN_CODE,code:'OWNER_CONFLICT'};return {plan:{kind:'CREATE',code,record:null,source:null}};}
  const holder=holderOf(record);
  if(holder===vm.id)return {plan:{kind:'SAME',code,record,source:null}};
  if(record.linkState==='LINKED')return {error:USED_REFUSAL(code),code:'OWNER_CONFLICT'};
  if(record.linkState==='UNCONFIRMED')return {error:UNCONFIRMED_REFUSAL(code),code:'OWNER_CONFLICT'};
  if(!holder){if(from)return {error:'SDK '+code+' đang trong kho, không ở VM nguồn đã chọn; tải lại',code:'STALE_PREVIEW'};return {plan:{kind:'TAKE',code,record,source:null}};}
  const source=await db.virtualMachine.findUnique({where:{id:holder},select:vmSelect});
  if(!source)return {error:'Không đọc được VM đang giữ SDK; tải lại',code:'NOT_FOUND'};
  if(!from||from.vmId!==source.id)return {error:'SDK '+code+' đang ở danh sách của '+label(source)+'. Dùng "Chọn SDK đã lưu" → "Dùng cho VM này" để chuyển rõ nguồn → đích; web không tự lấy mã',code:'OWNER_CONFLICT'};
  if(source.revision!==from.expectedRevision)return {error:label(source)+' vừa được thay đổi; tải lại rồi chọn lại',code:'STALE_PREVIEW'};
  return {plan:{kind:'MOVE',code,record,source}};
}
export interface Ctx {projectId:string;actorId:string;images:BusinessCollector;now:Date;via:string}
export async function event(tx:Tx,ctx:Ctx,sdkId:string,kind:string,data:{fromVmId?:string|null;toVmId?:string|null;fromLabel?:string|null;toLabel?:string|null;detail?:Prisma.InputJsonValue}={}){
  await tx.sdkEvent.create({data:{projectId:ctx.projectId,sdkId,kind,actorId:ctx.actorId,createdAt:ctx.now,...data,detail:{via:ctx.via,...(data.detail as object||{})}}});
}
/**
 * The record must still be the version the person saw. null = "I saw no stored code": never a right to overwrite. A code that appeared
 * meanwhile is refused unless the request changes nothing (same code, same VM, same or blank money / note = giữ nguyên, see callers).
 * The write itself is conditional too.
 */
export function staleRecord(plan:ListPlan,expected:number|null|undefined){
  const exp=expected??null;
  if(!plan.record)return exp===null?null:'SDK '+plan.code+' không còn trong kho như lúc kiểm tra; kiểm tra lại';
  if(exp===null)return 'SDK '+plan.code+' vừa được thêm với tiền / ghi chú riêng; kiểm tra lại (nội dung đang nhập được giữ)';
  if(plan.record.revision!==exp)return 'SDK '+plan.code+' vừa được người khác thay đổi; kiểm tra lại (nội dung đang nhập được giữ)';
  return null;
}
const hasChanges=(plan:ListPlan,info:SdkInfo)=>{const ch=infoChanges(plan.record,info);return !!(ch.amount||ch.note);};
async function applyInfo(tx:Tx,ctx:Ctx,record:SdkRecord,info:SdkInfo){
  const ch=infoChanges(record,info);if(!ch.amount&&!ch.note)return false;
  await ctx.images.remember('SDK',record.id);
  const n=await tx.sdkRecord.updateMany({where:{id:record.id,revision:record.revision},data:{...(ch.amount?{amount:ch.amount.to,amountAt:ctx.now,amountById:ctx.actorId,amountObservedAt:ctx.now,amountSource:'Web · '+ctx.via}:{}),...(ch.note?{note:ch.note.to,noteAt:ctx.now,noteById:ctx.actorId}:{}),revision:{increment:1}}});
  if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+record.code+' vừa được người khác thay đổi; kiểm tra lại');
  if(ch.amount)await event(tx,ctx,record.id,'AMOUNT',{detail:ch.amount});
  if(ch.note)await event(tx,ctx,record.id,'NOTE',{detail:ch.note});
  return true;
}
/** Write one add. Concurrent adds of the same code: the unique code / the conditional update lets exactly one win. */
/** `createState`: the state of a code created here (UNCONFIRMED for a code surveyed on a machine with unknown history, sdk-observe.ts). */
export async function applyListAdd(tx:Tx,ctx:Ctx,vm:ListVM,plan:ListPlan,info:SdkInfo,opts:{createState?:'UNLINKED'|'UNCONFIRMED'}={}):Promise<{changed:boolean;message:string}>{
  const here=where(vm);
  if(plan.kind==='SAME'){const changed=await applyInfo(tx,ctx,plan.record!,info);return {changed,message:changed?'Đã lưu tiền / ghi chú SDK':'Đã có trong danh sách của VM; giữ nguyên'};}
  if(plan.kind==='CREATE'){
    const i=checkInfo(info);let row:SdkRecord;
    try{row=await tx.sdkRecord.create({data:{projectId:ctx.projectId,code:plan.code,holderVmId:vm.id,heldAt:ctx.now,heldById:ctx.actorId,linkState:opts.createState??'UNLINKED',createdById:ctx.actorId,createdAt:ctx.now,
      ...(i.amount!=null?{amount:i.amount,amountAt:ctx.now,amountById:ctx.actorId,amountObservedAt:ctx.now,amountSource:'Web · '+ctx.via}:{}),...(i.note?{note:i.note,noteAt:ctx.now,noteById:ctx.actorId}:{})}});}
    catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','SDK '+plan.code+' vừa được người khác ghi; kiểm tra lại');throw e;}
    await ctx.images.remember('SDK',row.id,true);
    await event(tx,ctx,row.id,'CREATE',{detail:{amount:i.amount??null,note:i.note??null}});
    await event(tx,ctx,row.id,'HOLD',{toVmId:vm.id,toLabel:here});
    await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:vm.id,previousSdk:null,newSdk:plan.code,actorId:ctx.actorId,recordedAt:ctx.now,note:'Thêm vào danh sách SDK ('+ctx.via+')'}});
    return {changed:true,message:'Đã thêm SDK mới vào danh sách của VM'};
  }
  const rec=plan.record!;await ctx.images.remember('SDK',rec.id);
  if(plan.kind==='MOVE'){
    const source=plan.source!;
    // The code leaves the source list (and stops being its current code) in the same transaction.
    const n=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision,OR:[{holderVmId:source.id},{holderVmId:null,vmId:source.id}]},data:{vmId:null,holderVmId:vm.id,heldAt:ctx.now,heldById:ctx.actorId,revision:{increment:1}}});
    if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác chuyển hoặc sửa; kiểm tra lại');
    if(rec.vmId===source.id){await ctx.images.remember('SDK_SLOT',source.id);await syncMirror(tx,source.id,ctx.actorId,ctx.now);}
    await event(tx,ctx,rec.id,'MOVE',{fromVmId:source.id,fromLabel:label(source),toVmId:vm.id,toLabel:here});
    await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:source.id,previousSdk:rec.code,newSdk:null,actorId:ctx.actorId,recordedAt:ctx.now,note:'Chuyển SDK sang '+here}});
    await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:vm.id,previousSdk:null,newSdk:rec.code,actorId:ctx.actorId,recordedAt:ctx.now,note:'Chuyển từ '+label(source)}});
  }else{
    const n=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision,holderVmId:null,vmId:null,linkState:'UNLINKED'},data:{holderVmId:vm.id,heldAt:ctx.now,heldById:ctx.actorId,revision:{increment:1}}});
    if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác lấy hoặc sửa; kiểm tra lại');
    await event(tx,ctx,rec.id,'HOLD',{toVmId:vm.id,toLabel:here});
    await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:vm.id,previousSdk:null,newSdk:rec.code,actorId:ctx.actorId,recordedAt:ctx.now,note:'Lấy từ kho vào danh sách SDK ('+ctx.via+')'}});
  }
  const fresh=await tx.sdkRecord.findUniqueOrThrow({where:{id:rec.id}});await applyInfo(tx,ctx,fresh,info);
  return {changed:true,message:plan.kind==='MOVE'?'Đã chuyển '+rec.code+' từ '+label(plan.source!):'Đã lấy SDK trong kho vào danh sách của VM'};
}
// ---- Commands on one VM --------------------------------------------------------------------------------------------------------
export interface ListAddInput {key:string;vmId:string;expectedCycle:number;code:string;expectedSdkRevision?:number|null;amount?:string|null;note?:string|null;from?:{vmId:string;expectedRevision:number}|null}
export async function addVmSdk(scope:ActorScope,input:ListAddInput,db:PrismaClient=prisma){
  const code=normalizeSdk(input.code);if(!code)throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)');
  const info=checkInfo({amount:input.amount,note:input.note});
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:input.from?'SDK_MOVE':'VM_SDK_LIST',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);if(carriesMoney([info]))await assertSdkMoneyWrite(current,tx);
    const vm=await loadVM(tx,scope.projectId,input.vmId),cycle=cycleOf(vm);if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const planned=await planListAdd(tx,scope.projectId,vm,code,input.from??null);if('error' in planned)throw new ProxyDomainError(planned.code,planned.error);
    if(planned.plan.kind==='SAME'&&!hasChanges(planned.plan,info))return {changed:false,message:'Đã có trong danh sách của VM; giữ nguyên'};
    const stale=staleRecord(planned.plan,input.expectedSdkRevision);if(stale)throw new ProxyDomainError('STALE_PREVIEW',stale);
    const r=await applyListAdd(tx,{projectId:scope.projectId,actorId:current.userId,images,now:new Date(),via:input.from?'Chuyển SDK':'Ô SDK'},vm,planned.plan,info);
    return {changed:r.changed,message:r.message};
  },db);
}
/** Tick "Đã dùng" on a code of this VM's list: final, with who / when / round; no account is invented. */
export async function markVmSdkUsed(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;sdkId:string;expectedRevision:number},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'SDK_USED',module:'INFRASTRUCTURE',reversible:false,skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await loadVM(tx,scope.projectId,input.vmId),cycle=cycleOf(vm);if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const rec=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId}});if(!rec)throw new ProxyDomainError('NOT_FOUND','SDK không còn trong dự án');
    if(holderOf(rec)!==vm.id)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' không còn trong danh sách của '+where(vm)+'; tải lại');
    if(rec.linkState==='LINKED')return {changed:false,message:'SDK '+rec.code+' đã ghi Đã dùng trước đó'};
    if(rec.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; tải lại');
    const now=new Date();await images.remember('SDK',rec.id);
    const n=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision},data:{linkState:'LINKED',linkedVmId:vm.id,linkedCycle:cycle,linkedAt:now,linkedById:current.userId,...(rec.linkState==='UNCONFIRMED'?{confirmedAt:now,confirmedById:current.userId}:{}),revision:{increment:1}}});
    if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; tải lại');
    await event(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:'Đã dùng'},rec.id,'USED',{toVmId:vm.id,toLabel:where(vm),detail:{cycle,account:null,wasUnconfirmed:rec.linkState==='UNCONFIRMED'}});
    return {changed:true,message:'Đã ghi SDK '+rec.code+' đã dùng'};
  },db);
}
/** Take an unused code out of this VM's list (back to the store, money / note kept). A used code stays for lookup. */
export async function removeVmSdk(scope:ActorScope,input:{key:string;vmId:string;expectedCycle:number;sdkId:string;expectedRevision:number},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_SDK_LIST',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    const vm=await loadVM(tx,scope.projectId,input.vmId),cycle=cycleOf(vm);if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const rec=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId}});if(!rec)throw new ProxyDomainError('NOT_FOUND','SDK không còn trong dự án');
    if(holderOf(rec)!==vm.id)return {changed:false,message:'SDK '+rec.code+' không còn ở VM này'};
    if(rec.linkState==='LINKED')throw new ProxyDomainError('INVALID_INPUT',USED_REFUSAL(rec.code));
    if(rec.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; tải lại');
    const now=new Date();await images.remember('SDK',rec.id);
    await tx.sdkRecord.update({where:{id:rec.id},data:{vmId:null,holderVmId:null,revision:{increment:1}}});
    if(rec.vmId===vm.id){await images.remember('SDK_SLOT',vm.id);await syncMirror(tx,vm.id,current.userId,now);}
    await event(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:'Ô SDK'},rec.id,'REMOVE',{fromVmId:vm.id,fromLabel:where(vm),detail:{keptAs:'STORE'}});
    await tx.vMSdkHistory.create({data:{projectId:scope.projectId,vmId:vm.id,previousSdk:rec.code,newSdk:null,actorId:current.userId,recordedAt:now,note:'Bỏ khỏi danh sách SDK của VM (mã về kho)'}});
    return {changed:true,message:'Đã đưa '+rec.code+' về kho'};
  },db);
}
// ---- Dán bảng → SDK ------------------------------------------------------------------------------------------------------------
// A. With VM codes: [Server |] VM | SDK | Tiền USD | Ghi chú (matched by server + VM code, never by row order).
// B. Without VM codes: SDK | Tiền USD | Ghi chú, from a chosen start VM on a chosen server: line n goes to the VM numbered start + n
//    (the codes of the range, e.g. VM_011 → VM_020), never to the order of the table, its filter, sort or selection. A blank line in
//    the middle keeps its place; a missing / deleted VM or a bad line is reported at the line; nothing shifts, no VM is created.
export const CLEAR='-';
export type PasteMode='VM'|'RANGE';
export interface PasteLine {line:number;blank:boolean;server:string|null;vm:string|null;code:string;amount:string|null|undefined;note:string|null|undefined;issue:string|null}
const HEADER=/^(server|vm|máy|mã vm|sdk|mã sdk|sdk id|tiền|tiền tích luỹ|tiền tích lũy|usd|tiền usd|tiền tích luỹ usd|ghi chú|note)$/i;
function cellsOf(raw:string){return (raw.includes('\t')?raw.split('\t'):raw.includes('|')?raw.split('|'):(()=>{const t=raw.trim().split(/\s+/);return t;})()).map(c=>c.trim());}
function moneyNote(amountCell:string,noteCells:string[]):{amount:string|null|undefined;note:string|null|undefined;issue:string|null}{
  let amount:string|null|undefined,issue:string|null=null;
  if(!amountCell)amount=undefined;else if(amountCell===CLEAR)amount=null;else{const r=parseSdkAmount(amountCell);if('error' in r)issue='Tiền tích luỹ: '+r.error;else amount=r.value;}
  const n=noteCells.join(' | ').trim(),note=!n?undefined:n===CLEAR?null:n;if(note&&note.length>SDK_NOTE_MAX)issue=issue||'Ghi chú SDK tối đa '+SDK_NOTE_MAX+' ký tự';
  return {amount,note,issue};
}
/** Lines of a paste. Leading / trailing blank lines are dropped; blank lines inside are kept (RANGE: they hold their VM). */
export function parseSdkPaste(mode:PasteMode,text:string,serverCode:string|null,serverCodes:string[]=[]):PasteLine[]{
  const servers=new Set(serverCodes.map(c=>c.toLowerCase()));
  const raw=text.replace(/\r/g,'').split('\n');let first=raw.findIndex(l=>l.trim()),last=raw.length-1;while(last>=0&&!raw[last].trim())last--;
  if(first<0)return [];
  const out:PasteLine[]=[];
  for(let i=first;i<=last;i++){
    const r=raw[i],line=i+1;
    if(!r.trim()){out.push({line,blank:true,server:null,vm:null,code:'',amount:undefined,note:undefined,issue:null});continue;}
    let cells=cellsOf(r);
    if(i===first&&cells.filter(Boolean).every(c=>HEADER.test(c))){first=i+1;continue;}
    let server:string|null=null,vm:string|null=null;
    if(mode==='VM'){
      // A Server column is recognised by its value (a server of the project), so "VM | SDK | tiền" and "Server | VM | SDK" both work.
      const withServer=cells.length>=3&&servers.has(cells[0].toLowerCase());
      if(withServer){server=cells[0];vm=cells[1];cells=cells.slice(2);}else{server=serverCode;vm=cells[0]??'';cells=cells.slice(1);}
    }
    const [codeCell='',amountCell='',...noteCells]=cells,code=normalizeSdk(codeCell),mn=moneyNote(amountCell,noteCells);
    const issue=mode==='VM'&&!vm?'Thiếu mã VM':!code?'Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)':mn.issue;
    out.push({line,blank:false,server,vm,code:code||codeCell,amount:mn.amount,note:mn.note,issue});
  }
  return out;
}
/** VM_011 → {prefix:'VM_', n:11, width:3}; codes of the range keep the padding of the start code. */
export function rangeStart(code:string){const m=/^(.*?)(\d+)$/.exec(code.trim());return m?{prefix:m[1],n:Number(m[2]),width:m[2].length}:null;}
export const rangeCode=(s:{prefix:string;n:number;width:number},offset:number)=>s.prefix+String(s.n+offset).padStart(s.width,'0');
export interface PasteRow {line:number;vm:string|null;server:string|null;vmId:string|null;expectedCycle:number|null;code:string|null;outcome:'NEW'|'TAKE'|'UPDATE'|'SAME'|'SKIP'|'ERROR';message:string;expectedSdkRevision:number|null;amount?:string|null;note?:string|null;info:string|null}
export interface PastePreview {mode:PasteMode;rows:PasteRow[];ready:number;same:number;skipped:number;errors:number;range:{from:string;to:string;count:number}|null}
const MAX=1000;
function infoText(ch:ReturnType<typeof infoChanges>){
  const parts:string[]=[];if(ch.amount)parts.push('Tiền '+(formatSdkAmount(ch.amount.from)||'chưa ghi')+' → '+(formatSdkAmount(ch.amount.to)||'xoá'));if(ch.note)parts.push('Ghi chú '+(ch.note.from?'"'+ch.note.from.slice(0,40)+'"':'trống')+' → '+(ch.note.to?'"'+ch.note.to.slice(0,40)+'"':'xoá'));
  return parts.join(' · ')||null;
}
export async function previewSdkPaste(scope:ActorScope,input:{mode:PasteMode;text:string;serverId?:string|null;startVmId?:string|null},db:PrismaClient=prisma):Promise<PastePreview>{
  await authorizeVM(scope,'ASSIGN',db);if(input.text.length>300000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa '+MAX+' dòng mỗi đợt');
  const server=input.serverId?await db.server.findFirst({where:{id:input.serverId,projectId:scope.projectId,managed:true}}):null;
  if(input.serverId&&!server)throw new ProxyDomainError('NOT_FOUND','Server không thuộc dự án này');
  if(input.mode==='RANGE'&&(!server||!input.startVmId))throw new ProxyDomainError('INVALID_INPUT','Chọn server và VM bắt đầu');
  const serverRows=await db.server.findMany({where:{projectId:scope.projectId,managed:true},select:{code:true}});
  const lines=parseSdkPaste(input.mode,input.text,server?.code??null,serverRows.map(x=>x.code));if(!lines.length||lines.length>MAX)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến '+MAX+' dòng mỗi đợt');
  const vms=await db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},select:vmSelect}),money=await sdkMoneyRights(scope,db);
  const key=(s:string,v:string)=>s.toLowerCase()+'\u0000'+v.toLowerCase(),byKey=new Map<string,ListVM>();
  for(const v of vms){const k=key(v.server.code,v.code),old=byKey.get(k);if(!old||old.archivedAt&&!v.archivedAt)byKey.set(k,v);} // an active VM wins over a deleted one with the same code
  let range:PastePreview['range']=null,start:ReturnType<typeof rangeStart>=null;
  if(input.mode==='RANGE'){
    const startVm=vms.find(v=>v.id===input.startVmId&&v.server.id===server!.id);if(!startVm)throw new ProxyDomainError('NOT_FOUND','VM bắt đầu không thuộc server đã chọn');
    start=rangeStart(startVm.code);if(!start)throw new ProxyDomainError('INVALID_INPUT','Mã VM bắt đầu cần có số ở cuối (ví dụ VM_011)');
    range={from:startVm.code,to:rangeCode(start,lines.length-1),count:lines.length};
  }
  const targets=lines.map((l,i)=>{const vmCode=input.mode==='RANGE'?rangeCode(start!,i):l.vm,srv=input.mode==='RANGE'?server!.code:l.server;return {l,vmCode,srv,vm:vmCode&&srv?byKey.get(key(srv,vmCode)):undefined};});
  const codeLines=new Map<string,number[]>();for(const t of targets)if(!t.l.blank&&!t.l.issue)codeLines.set(t.l.code,[...(codeLines.get(t.l.code)||[]),t.l.line]);
  const rows:PasteRow[]=[];
  for(const t of targets){
    const base:PasteRow={line:t.l.line,vm:t.vmCode??null,server:t.srv??null,vmId:null,expectedCycle:null,code:t.l.code||null,outcome:'ERROR',message:'',expectedSdkRevision:null,info:null};
    if(t.l.blank){rows.push({...base,code:null,outcome:'SKIP',message:input.mode==='RANGE'?'Dòng trống: giữ vị trí, không ghi':'Dòng trống'});continue;}
    if(t.l.issue){rows.push({...base,message:t.l.issue});continue;}
    if(t.l.amount!==undefined&&!money.write){rows.push({...base,message:SDK_MONEY_WRITE_REFUSAL});continue;}
    if(!t.srv){rows.push({...base,message:'Chọn server hoặc dán kèm cột Server'});continue;}
    if(!t.vm){rows.push({...base,message:'Không có VM '+t.vmCode+' trên '+t.srv+' (web không tự tạo VM)'});continue;}
    if(t.vm.archivedAt||t.vm.server.archivedAt){rows.push({...base,message:label(t.vm)+' đã xoá; không ghi'});continue;}
    const found={...base,vm:t.vm.code,server:t.vm.server.code,vmId:t.vm.id,expectedCycle:cycleOf(t.vm)};
    const twice=codeLines.get(t.l.code)!;if(twice.length>1){rows.push({...found,message:'Cùng SDK với dòng '+twice.filter(n=>n!==t.l.line).join(', ')+'; một mã chỉ ghi một lần'});continue;}
    const planned=await planListAdd(db,scope.projectId,t.vm,t.l.code,null);if('error' in planned){rows.push({...found,message:planned.error});continue;}
    const {plan}=planned,ch=infoChanges(plan.record,{amount:t.l.amount,note:t.l.note}),info=infoText(ch),values={amount:t.l.amount,note:t.l.note};
    if(plan.kind==='SAME'){if(!ch.amount&&!ch.note){rows.push({...found,outcome:'SAME',message:'Đã có trong danh sách của VM; giữ nguyên'});continue;}
      rows.push({...found,...values,outcome:'UPDATE',info,expectedSdkRevision:plan.record!.revision,message:'Cập nhật tiền / ghi chú'});continue;}
    rows.push({...found,...values,outcome:plan.kind==='CREATE'?'NEW':'TAKE',info,expectedSdkRevision:plan.record?.revision??null,message:plan.kind==='CREATE'?'Thêm SDK mới':'Lấy SDK trong kho (chưa dùng)'});
  }
  return {mode:input.mode,rows,range,ready:rows.filter(r=>r.outcome==='NEW'||r.outcome==='TAKE'||r.outcome==='UPDATE').length,same:rows.filter(r=>r.outcome==='SAME').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
export interface PasteApplyItem {line:number;vmId:string;expectedCycle:number;code:string;expectedSdkRevision:number|null;amount?:string|null;note?:string|null}
export async function applySdkPaste(scope:ActorScope,input:{key:string;items:PasteApplyItem[]},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>MAX||new Set(input.items.map(i=>i.code)).size!==input.items.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi mã SDK một dòng, tối đa '+MAX+' dòng');
  for(const i of input.items){if(normalizeSdk(i.code)!==i.code)throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ ở dòng '+i.line);if(!Number.isInteger(i.expectedCycle)||i.expectedCycle<1)throw new ProxyDomainError('INVALID_INPUT','Thiếu lượt VM ở dòng '+i.line+'; kiểm tra lại bản dán');checkInfo(i);}
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'VM_SDK_PASTE',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);if(carriesMoney(input.items))await assertSdkMoneyWrite(current,tx);
    const now=new Date(),ctx:Ctx={projectId:scope.projectId,actorId:current.userId,images,now,via:'Dán bảng'};
    const rows:{line:number;vmId:string;code:string;outcome:'APPLIED'|'SAME'|'ERROR';message:string}[]=[];
    for(const item of [...input.items].sort((a,b)=>a.line-b.line)){
      const row=(outcome:'APPLIED'|'SAME'|'ERROR',message:string)=>rows.push({line:item.line,vmId:item.vmId,code:item.code,outcome,message});
      const vm=await tx.virtualMachine.findFirst({where:{id:item.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:vmSelect});
      if(!vm||vm.archivedAt||vm.server.archivedAt){row('ERROR','VM không còn hoạt động (đã xoá hoặc không thuộc dự án)');continue;}
      // The line was checked for one round of this VM; after a recreation it is an old request: never moved to the new round.
      if(cycleOf(vm)!==item.expectedCycle){row('ERROR',RECREATED_LINE);continue;}
      const planned=await planListAdd(tx,scope.projectId,vm,item.code,null);if('error' in planned){row('ERROR',planned.error);continue;}
      const {plan}=planned,info=checkInfo(item);
      // The code is already in this VM's list with the same values (or blank fields): nothing to write, whoever saved it.
      if(plan.kind==='SAME'&&!hasChanges(plan,info)){row('SAME','Đã có trong danh sách của VM; giữ nguyên');continue;}
      const stale=staleRecord(plan,item.expectedSdkRevision);if(stale){row('ERROR',stale);continue;}
      try{const sp='p'+item.line;await tx.$executeRawUnsafe('SAVEPOINT '+sp);try{const r=await applyListAdd(tx,ctx,vm,plan,info);await tx.$executeRawUnsafe('RELEASE SAVEPOINT '+sp);row(r.changed?'APPLIED':'SAME',r.message);}catch(e){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT '+sp);throw e;}}
      catch(e){if(e instanceof ProxyDomainError){row('ERROR',e.message.replace(/^[A-Z_]+: /,''));continue;}throw e;}
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length,same:rows.filter(r=>r.outcome==='SAME').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
  },db);
}
// ---- Read: the list of every VM, for the grid (unused first, then used; current code marked) --------------------------------------
const ORDER={UNLINKED:0,UNCONFIRMED:1,LINKED:2} as const;
export type VmSdkItem={recordId:string;code:string;revision:number;amount:string|null;amountObservedAt:string|null;amountFailedAt:string|null;amountSource:string|null;moneyHidden:boolean;note:string|null;state:'UNLINKED'|'LINKED'|'UNCONFIRMED';current:boolean;usedAt:string|null;usedBy:string|null;heldAt:string|null};
/** `money` = the caller may read SDK money (sdk-money-rights.ts); without it amount / observedAt / source are null and `moneyHidden`. */
export async function vmSdkLists(db:VMReader,projectId:string,vmIds:string[],money=true){
  const rows=await db.sdkRecord.findMany({where:{projectId,OR:[{holderVmId:{in:vmIds}},{vmId:{in:vmIds}}]},orderBy:[{heldAt:'asc'},{code:'asc'}]});
  const ids=Array.from(new Set(rows.map(r=>r.linkedById).filter((s):s is string=>!!s))),users=ids.length?await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,username:true}}):[];
  const out=new Map<string,VmSdkItem[]>();
  for(const r of rows){const vmId=holderOf(r)!;const list=out.get(vmId)||[];const u=users.find(x=>x.id===r.linkedById);
    list.push({recordId:r.id,code:r.code,revision:r.revision,amount:money?canonicalAmount(r.amount?.toString()??null):null,amountObservedAt:money?r.amountObservedAt?.toISOString()??null:null,amountFailedAt:money?r.amountFailedAt?.toISOString()??null:null,amountSource:money?r.amountSource:null,moneyHidden:!money,note:r.note,state:r.linkState,current:r.vmId===vmId,usedAt:r.linkState==='LINKED'?r.linkedAt?.toISOString()??null:null,usedBy:r.linkState==='LINKED'&&r.linkedById?(u?u.name||u.username||'Tài khoản cũ':'Tài khoản cũ'):null,heldAt:r.heldAt?.toISOString()??null});out.set(vmId,list);}
  for(const list of out.values())list.sort((a,b)=>ORDER[a.state]-ORDER[b.state]);
  return out;
}
