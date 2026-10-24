import {Prisma,type PrismaClient,type SdkRecord} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {canonicalAmount,parseSdkAmount,SDK_NOTE_MAX} from '@/lib/sdk-money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand,type BusinessCollector} from '../business-management/idempotency';
import {authorizeBusiness} from '../business-management/scope';
import {authorizeVM,type VMReader} from './repository';
import {assertScopedSdkIds,assertScopedVmIds,assertUnrestrictedServers,sdkWhere} from '../permissions/server-scope';
import {authorizeSdkCodes,assertSdkPlacementScope,SDK_SCOPE_REFUSAL,sdkVisibleVmIds,sdkBindingVisible,denyScopedSdkHistory} from './sdk-scope';
import {assertSdkMoneyWrite,carriesMoney,maskSdkEventDetail,sdkMoneyRights,SDK_MONEY_WRITE_REFUSAL} from './sdk-money-rights';
import {normalizeSdk} from './sdk-parse';
// SDK store (owner brief 19/10/2026). One rule for every path that writes an SDK: the SDK cell, Kho SDK, Dán bảng, the older
// sdkApply endpoint, recreating a VM and undo.
// - A VM has at most one current SDK, an SDK at most one current VM (SdkRecord.vmId unique). VirtualMachine.sdkId is a mirror
//   written only by syncMirror below.
// - Owner brief 20/10/2026: a VM also keeps a LIST of codes (SdkRecord.holderVmId, many per VM; see sdk-list.ts). The current code is
//   always in its VM's list; replacing or removing the current code, or recreating the VM, leaves the old code in the list (never
//   lost, never sent to the store by itself). A code in another VM's list moves only by the explicit transfer below.
// - Only an UNLINKED code may be reused or moved. LINKED codes keep their account and history and never become usable again;
//   UNCONFIRMED (old data) is never offered until a person confirms it.
// - Typing / pasting a code that sits on another VM never takes it: the move is a separate, explicit request naming the source VM
//   (fromVmId + its revision) and is written together with source, target and SDK in one transaction.
// - Money and note belong to the code. A new code never inherits them; a replaced code keeps its own; moving keeps them.
// - Recording an SDK never changes the EarnApp account, PayPal or the VM operating status. Linking is its own recorded fact.
type Tx=Prisma.TransactionClient;
export type SdkVM={id:string;code:string;revision:number;archivedAt:Date|null;server:{code:string;archivedAt?:Date|null};operation?:{cycle:number}|null};
const vmSelect={id:true,code:true,revision:true,archivedAt:true,sdkId:true,server:{select:{code:true,archivedAt:true}},operation:{select:{cycle:true}}} as const;
export const where=(vm:{code:string;server:{code:string}})=>vm.server.code+' / '+vm.code;
const placeLabel=(vm:{code:string;archivedAt:Date|null;server:{code:string;archivedAt?:Date|null}})=>where(vm)+(vm.archivedAt||vm.server.archivedAt?' (đã xoá)':'');
export const cycleOf=(vm:{operation?:{cycle:number}|null})=>vm.operation?.cycle??1;
/** Where a money figure written now belongs (review 22/10/2026): the VM whose list holds the code and that VM's current round; a code
 *  in the store only has no VM. The row of a VM shows a figure only when it was checked on that VM in its current round. */
export async function moneyBinding(db:VMReader,record:{vmId:string|null;holderVmId:string|null}){
  const vmId=record.holderVmId??record.vmId;if(!vmId)return {amountVmId:null,amountCycle:null};
  const op=await db.vmOperation.findUnique({where:{vmId},select:{cycle:true}});return {amountVmId:vmId,amountCycle:op?.cycle??1};
}
const staleCycle=(cycle:number)=>'VM đã sang lượt '+cycle+'; lệnh này dành cho lượt cũ. Tải lại rồi làm theo lượt hiện hành';
/** undefined = keep the stored value; null = clear it (an explicit action); a string = set it. */
export interface SdkInfo {amount?:string|null;note?:string|null}
export function checkInfo(info:SdkInfo):SdkInfo{
  const out:SdkInfo={};
  if(info.amount!==undefined){if(info.amount===null)out.amount=null;else{const r=parseSdkAmount(info.amount);if('error' in r)throw new ProxyDomainError('INVALID_INPUT',r.error);out.amount=r.value;}}
  if(info.note!==undefined){const n=info.note===null?null:info.note.trim()||null;if(n&&n.length>SDK_NOTE_MAX)throw new ProxyDomainError('INVALID_INPUT','Ghi chú SDK tối đa '+SDK_NOTE_MAX+' ký tự');out.note=n;}
  return out;
}
/** What would change on this record (null record = a new code: every given value counts). */
export function infoChanges(record:{amount:Prisma.Decimal|string|null;note:string|null}|null,info:SdkInfo){
  const amountNow=record?canonicalAmount(record.amount===null?null:String(record.amount)):null,noteNow=record?.note??null;
  return {amount:info.amount!==undefined&&info.amount!==amountNow?{from:amountNow,to:info.amount}:null,note:info.note!==undefined&&info.note!==noteNow?{from:noteNow,to:info.note}:null};
}
export function refusalOf(record:{code:string;linkState:string}){
  if(record.linkState==='LINKED')return 'SDK '+record.code+' đã nối EarnApp; chỉ giữ để tra cứu, không dùng lại hay chuyển VM';
  if(record.linkState==='UNCONFIRMED')return 'SDK '+record.code+' là dữ liệu cũ chưa xác nhận đã nối EarnApp hay chưa; xác nhận ở Kho SDK trước khi dùng lại';
  return null;
}
export const FOREIGN_CODE='Mã SDK này đã được ghi ở nơi khác ngoài dự án; không nhận vào dự án này';
async function foreignHolder(db:VMReader,projectId:string,code:string){
  return !!(await db.sdkRecord.findFirst({where:{code,projectId:{not:projectId}},select:{id:true}})||await db.virtualMachine.findFirst({where:{sdkId:code,managed:true,server:{projectId:{not:projectId}}},select:{id:true}}));
}
export type PlacementPlan={kind:'SAME'|'NONE'|'CREATE'|'PLACE'|'MOVE'|'REMOVE';code:string|null;current:SdkRecord|null;target:SdkRecord|null;source:(SdkVM&{sdkId:string|null})|null};
/**
 * Decide what putting `code` (null = remove) on `vm` means, without writing. A refusal is returned as text so a paste can report it at
 * its line; the single-VM commands throw it. `from` names the VM a moved code comes from (explicit transfer only).
 */
export async function planPlacement(db:VMReader,projectId:string,vm:SdkVM,code:string|null,from?:{vmId:string;expectedRevision:number}|null,scope?:ActorScope):Promise<{plan:PlacementPlan}|{error:string;code:'OWNER_CONFLICT'|'STALE_PREVIEW'|'INVALID_INPUT'|'NOT_FOUND'}>{
  if(scope)try{await assertSdkPlacementScope(db,scope,vm.id,code,from);const current=await db.sdkRecord.findUnique({where:{vmId:vm.id},select:{id:true}});if(current)await assertScopedSdkIds(db,scope,[current.id]);}catch(e){if(e instanceof ProxyDomainError&&e.code==='NOT_FOUND')return {error:SDK_SCOPE_REFUSAL,code:'NOT_FOUND'};throw e;}
  if(vm.archivedAt||vm.server.archivedAt)return {error:where(vm)+' đã xoá; khôi phục VM trước khi ghi SDK',code:'INVALID_INPUT'};
  const current=await db.sdkRecord.findUnique({where:{vmId:vm.id}});
  if(code===null)return {plan:{kind:current?'REMOVE':'NONE',code:null,current,target:null,source:null}};
  if(current?.code===code)return {plan:{kind:'SAME',code,current,target:current,source:null}};
  const target=await db.sdkRecord.findUnique({where:{projectId_code:{projectId,code}}});
  if(!target){if(await foreignHolder(db,projectId,code))return {error:FOREIGN_CODE,code:'OWNER_CONFLICT'};return {plan:{kind:'CREATE',code,current,target:null,source:null}};}
  const refused=refusalOf(target);if(refused)return {error:refused,code:'OWNER_CONFLICT'};
  const holder=target.holderVmId??target.vmId;
  if(!holder||holder===vm.id){if(from&&holder!==from.vmId)return {error:'SDK '+code+' đang trong kho, không ở VM nguồn đã chọn; tải lại',code:'STALE_PREVIEW'};return {plan:{kind:'PLACE',code,current,target,source:null}};}
  const source=await db.virtualMachine.findUnique({where:{id:holder},select:vmSelect});
  if(!source)return {error:'Không đọc được VM đang giữ SDK; tải lại',code:'NOT_FOUND'};
  if(!from||from.vmId!==source.id)return {error:'SDK '+code+' đang ở '+placeLabel(source)+'. Dùng "Chọn SDK đã lưu" → "Dùng cho VM này" để chuyển rõ nguồn → đích; web không tự lấy mã',code:'OWNER_CONFLICT'};
  if(source.revision!==from.expectedRevision)return {error:placeLabel(source)+' vừa được thay đổi; tải lại rồi chọn lại',code:'STALE_PREVIEW'};
  return {plan:{kind:'MOVE',code,current,target,source}};
}
/**
 * The SDK a write touches must still be the version the person saw (money / note edits bump the SDK revision, not the VM revision).
 * `expected` null (or missing) means "I saw no stored code": refused when the code is stored, so a missing revision never skips the
 * check; a number for a code that is not stored is refused too. Removing a code only needs the VM revision.
 */
export function staleSdk(plan:PlacementPlan,expected:number|null|undefined):string|null{
  if(plan.kind==='NONE'||plan.kind==='REMOVE')return null;
  const rec=plan.kind==='SAME'?plan.current:plan.target,exp=expected??null;
  if(!rec)return exp===null?null:'SDK '+plan.code+' không còn trong kho như lúc kiểm tra; kiểm tra lại';
  if(exp===null)return 'SDK '+rec.code+' đã có trong kho với tiền / ghi chú riêng (có thể vừa được thêm); kiểm tra lại để xem trước khi lưu';
  if(rec.revision!==exp)return 'SDK '+rec.code+' vừa được người khác thay đổi; giá trị mới trên server được giữ. Kiểm tra lại (nội dung đang nhập được giữ)';
  return null;
}
interface WriteCtx {projectId:string;actorId:string;images:BusinessCollector;now:Date;via:string}
async function event(tx:Tx,ctx:WriteCtx,sdkId:string,kind:string,data:{fromVmId?:string|null;toVmId?:string|null;fromLabel?:string|null;toLabel?:string|null;detail?:Prisma.InputJsonValue}={}){
  await tx.sdkEvent.create({data:{projectId:ctx.projectId,sdkId,kind,actorId:ctx.actorId,createdAt:ctx.now,...data,detail:{via:ctx.via,...(data.detail as object||{})}}});
}
/** The VM mirror follows the record at that position. Returns the change (null = none) and bumps the VM revision when it changed. */
export async function syncMirror(tx:Tx,vmId:string,actorId:string,now:Date):Promise<{from:string|null;to:string|null}|null>{
  const [vm,rec]=await Promise.all([tx.virtualMachine.findUnique({where:{id:vmId},select:{sdkId:true}}),tx.sdkRecord.findUnique({where:{vmId},select:{code:true}})]);
  const code=rec?.code??null;if(!vm||vm.sdkId===code)return null;
  await tx.virtualMachine.update({where:{id:vmId},data:{sdkId:code,sdkRecordedAt:code?now:null,sdkRecordedById:code?actorId:null,revision:{increment:1}}});return {from:vm.sdkId,to:code};
}
async function applyInfo(tx:Tx,ctx:WriteCtx,record:SdkRecord,info:SdkInfo){
  const ch=infoChanges(record,info);if(!ch.amount&&!ch.note)return false;
  await ctx.images.remember('SDK',record.id);
  await tx.sdkRecord.update({where:{id:record.id},data:{...(ch.amount?{amount:ch.amount.to,amountAt:ctx.now,amountById:ctx.actorId,amountObservedAt:ctx.now,amountSource:'Web · '+ctx.via,...await moneyBinding(tx,record)}:{}),...(ch.note?{note:ch.note.to,noteAt:ctx.now,noteById:ctx.actorId}:{}),revision:{increment:1}}});
  if(ch.amount)await event(tx,ctx,record.id,'AMOUNT',{detail:ch.amount});
  if(ch.note)await event(tx,ctx,record.id,'NOTE',{detail:ch.note});
  return true;
}
/** Write a plan. Order matters for the unique keys: the codes leave their old positions before the target is placed. */
export async function applyPlacement(tx:Tx,ctx:WriteCtx,vm:SdkVM,plan:PlacementPlan,info:SdkInfo):Promise<{changed:boolean;message:string}>{
  const here=where(vm);
  if(plan.kind==='NONE')return {changed:false,message:'VM chưa có SDK; giữ nguyên'};
  if(plan.kind==='SAME'){const changed=await applyInfo(tx,ctx,plan.current!,info);return {changed,message:changed?'Đã lưu tiền / ghi chú SDK':'Giữ nguyên'};}
  await ctx.images.remember('SDK_SLOT',vm.id);
  const previous=plan.current;
  if(previous){
    await ctx.images.remember('SDK',previous.id);
    // The old current code stays in this VM's SDK list (with its money, note and state); it only stops being the current one.
    await tx.sdkRecord.update({where:{id:previous.id},data:{vmId:null,holderVmId:vm.id,revision:{increment:1}}});
    await event(tx,ctx,previous.id,'REMOVE',{fromVmId:vm.id,fromLabel:here,detail:{replacedBy:plan.code,keptAs:'VM_LIST'}});
  }
  let target:SdkRecord|null=plan.target;
  if(plan.kind==='CREATE'){
    const info0=checkInfo(info);
    target=await tx.sdkRecord.create({data:{projectId:ctx.projectId,code:plan.code!,vmId:null,holderVmId:vm.id,heldAt:ctx.now,heldById:ctx.actorId,linkState:'UNLINKED',createdById:ctx.actorId,createdAt:ctx.now,
      ...(info0.amount!=null?{amount:info0.amount,amountAt:ctx.now,amountById:ctx.actorId,amountObservedAt:ctx.now,amountSource:'Web · '+ctx.via,amountVmId:vm.id,amountCycle:cycleOf(vm)}:{}),...(info0.note?{note:info0.note,noteAt:ctx.now,noteById:ctx.actorId}:{})}});
    await ctx.images.remember('SDK',target.id,true);
    await event(tx,ctx,target.id,'CREATE',{detail:{amount:info0.amount??null,note:info0.note??null}});
  }
  if(plan.kind==='MOVE'){
    const source=plan.source!;await ctx.images.remember('SDK_SLOT',source.id);await ctx.images.remember('SDK',target!.id);
    await tx.sdkRecord.update({where:{id:target!.id},data:{vmId:null,holderVmId:null}});await syncMirror(tx,source.id,ctx.actorId,ctx.now);
    await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:source.id,previousSdk:target!.code,newSdk:null,actorId:ctx.actorId,recordedAt:ctx.now,note:'Chuyển SDK sang '+here}});
  }
  if(target&&plan.kind!=='MOVE')await ctx.images.remember('SDK',target.id);
  if(target){
    const held=target.holderVmId===vm.id&&plan.kind!=='MOVE';
    await tx.sdkRecord.update({where:{id:target.id},data:{vmId:vm.id,holderVmId:vm.id,...(held?{}:{heldAt:ctx.now,heldById:ctx.actorId}),placedAt:ctx.now,placedById:ctx.actorId,revision:{increment:1}}});
    if(plan.kind!=='CREATE')await event(tx,ctx,target.id,plan.kind==='MOVE'?'MOVE':'PLACE',{fromVmId:plan.source?.id??null,fromLabel:plan.source?placeLabel(plan.source):null,toVmId:vm.id,toLabel:here});
    else await event(tx,ctx,target.id,'PLACE',{toVmId:vm.id,toLabel:here});
    // Money / note entered with this placement belong to the destination VM (review 22/10/2026): the record passed on carries the new
    // position, so moneyBinding sees vm.id, never the old holder.
    if(plan.kind!=='CREATE')await applyInfo(tx,ctx,{...target,vmId:vm.id,holderVmId:vm.id},info);
  }
  await syncMirror(tx,vm.id,ctx.actorId,ctx.now);
  await tx.vMSdkHistory.create({data:{projectId:ctx.projectId,vmId:vm.id,previousSdk:previous?.code??null,newSdk:target?.code??null,actorId:ctx.actorId,recordedAt:ctx.now,note:plan.kind==='MOVE'?'Chuyển từ '+placeLabel(plan.source!):plan.kind==='REMOVE'?'Gỡ SDK khỏi VM (mã vẫn giữ)':ctx.via}});
  const kept=previous?'; '+previous.code+' vẫn trong danh sách SDK của VM':'';
  return {changed:true,message:(plan.kind==='REMOVE'?'Đã gỡ SDK khỏi VM':plan.kind==='MOVE'?'Đã chuyển '+plan.code+' từ '+placeLabel(plan.source!):plan.kind==='CREATE'?'Đã ghi SDK mới':'Đã dùng SDK trong kho')+kept};
}
async function loadVM(db:VMReader,projectId:string,vmId:string){
  const vm=await db.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId,managed:true}},select:vmSelect});if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không thuộc dự án này');return vm;
}
// ---- Commands ----------------------------------------------------------------------------------------------------------------------
export interface SdkSaveInput {key:string;vmId:string;expectedVmRevision:number;expectedCycle:number;code:string|null;/** Revision of the stored code being saved as the person saw it; null = a code not stored yet. */expectedSdkRevision?:number|null;amount?:string|null;note?:string|null;from?:{vmId:string;expectedRevision:number}|null}
/** The SDK cell and "Dùng cho VM này": record / replace / remove / move the current SDK of one VM, with its money and note. */
export async function saveVmSdk(scope:ActorScope,input:SdkSaveInput,db:PrismaClient=prisma){
  const code=input.code===null?null:normalizeSdk(input.code);if(input.code!==null&&!code)throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)');
  const info=checkInfo({amount:input.amount,note:input.note});
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:input.from?'SDK_MOVE':'VM_SDK_RECORD',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true,authorize:tx=>authorizeSdkCodes(tx,scope,code===null?[]:[code])},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    if(carriesMoney([info]))await assertSdkMoneyWrite(current,tx);
    return placeVmSdk(tx,images,current,{...input,code},info);
  },db);
}
/**
 * The body of saveVmSdk inside the caller's transaction (review fix 22/10/2026): the same checks (round, VM revision, placement rules, code
 * revision) and writes (record, list, mirror, history), so another command (the AI job's SDK, vm-ops/jobs.ts) can do them in ITS transaction,
 * together with its own checks and its own idempotency record. The caller has authorized ASSIGN; `input.code` is normalized.
 */
export async function placeVmSdk(tx:Tx,images:BusinessCollector,current:ActorScope,input:Omit<SdkSaveInput,'key'>&{code:string|null},info:SdkInfo){
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertSdkPlacementScope(tx,current,input.vmId,input.code,input.from);
    const scope=current,code=input.code;
    const vm=await loadVM(tx,scope.projectId,input.vmId),cycle=cycleOf(vm);
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    if(vm.revision!==input.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW',where(vm)+' vừa được thay đổi; tải lại để kiểm tra (nội dung đang nhập được giữ)');
    const planned=await planPlacement(tx,scope.projectId,vm,code,input.from??null,current);if('error' in planned)throw new ProxyDomainError(planned.code,planned.error);
    const {plan}=planned;
    const stale=staleSdk(plan,input.expectedSdkRevision);if(stale)throw new ProxyDomainError('STALE_PREVIEW',stale);
    const r=await applyPlacement(tx,{projectId:scope.projectId,actorId:current.userId,images,now:new Date(),via:input.from?'Chuyển SDK':'Ô SDK'},vm,plan,info);
    const after=await tx.sdkRecord.findUnique({where:{vmId:vm.id}});
    return {changed:r.changed,message:r.message,sdk:after?{id:after.id,code:after.code,revision:after.revision}:null};
}
/** "Đã nối EarnApp": the current SDK of the VM was linked to the current EarnApp account of the VM, in the current round. */
export async function linkVmSdk(scope:ActorScope,input:{key:string;vmId:string;sdkId:string;expectedSdkRevision:number;earnAppId:string;expectedCycle:number},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'SDK_LINK',module:'INFRASTRUCTURE',reversible:false,skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertScopedSdkIds(tx,current,[input.sdkId]);
    return linkVmSdkIn(tx,images,current,input);
  },db);
}
/** The body of linkVmSdk for a caller that already runs inside its own command / transaction (AI "used" command, 23/10/2026): same
 *  checks and writes, no second command. Membership and resource scope are reloaded here too. */
export async function linkVmSdkIn(tx:Tx,images:BusinessCollector,current:ActorScope,input:{vmId:string;sdkId:string;expectedSdkRevision:number;earnAppId:string;expectedCycle:number}){
  current=await authorizeVM(current,'ASSIGN',tx);
  await assertScopedVmIds(tx,current,[input.vmId]);await assertScopedSdkIds(tx,current,[input.sdkId]);
  const scope=current;
  {
    const vm=await loadVM(tx,scope.projectId,input.vmId),cycle=cycleOf(vm);
    if(vm.archivedAt||vm.server.archivedAt)throw new ProxyDomainError('INVALID_INPUT',where(vm)+' đã xoá');
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const sdk=await tx.sdkRecord.findUnique({where:{vmId:vm.id}});
    if(!sdk)throw new ProxyDomainError('INVALID_INPUT',where(vm)+' chưa có SDK hiện hành; ghi SDK trước');
    if(sdk.id!==input.sdkId||sdk.revision!==input.expectedSdkRevision)throw new ProxyDomainError('STALE_PREVIEW','SDK của '+where(vm)+' vừa thay đổi; tải lại rồi xác nhận lại');
    const earnApp=await tx.earnAppAccount.findFirst({where:{vmId:vm.id,projectId:scope.projectId,closedAt:null},include:{login:{select:{email:true}}}});
    if(!earnApp)throw new ProxyDomainError('INVALID_INPUT',where(vm)+' chưa có tài khoản EarnApp; gán tài khoản ở ô Tài khoản trước');
    if(earnApp.id!==input.earnAppId)throw new ProxyDomainError('STALE_PREVIEW','Tài khoản EarnApp của '+where(vm)+' vừa đổi sang '+earnApp.login.email+'; xác nhận lại');
    if(sdk.linkState==='LINKED'){if(sdk.linkedEarnAppId===earnApp.id)return {changed:false,message:'SDK '+sdk.code+' đã ghi nối với '+earnApp.login.email+' trước đó'};throw new ProxyDomainError('OWNER_CONFLICT','SDK '+sdk.code+' đã ghi nối với tài khoản khác; không ghi đè');}
    const now=new Date();await images.remember('SDK',sdk.id);
    await tx.sdkRecord.update({where:{id:sdk.id},data:{linkState:'LINKED',linkedEarnAppId:earnApp.id,linkedVmId:vm.id,linkedCycle:cycle,linkedAt:now,linkedById:current.userId,revision:{increment:1}}});
    await event(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:'Đã nối EarnApp'},sdk.id,'LINK',{toVmId:vm.id,toLabel:where(vm),detail:{earnAppId:earnApp.id,login:earnApp.login.email,cycle,wasUnconfirmed:sdk.linkState==='UNCONFIRMED'}});
    return {changed:true,message:'Đã ghi SDK '+sdk.code+' nối với '+earnApp.login.email};
  }
}
/** Old data ("Chưa xác nhận"): a person states whether the code was ever linked. Linked is final (undo never takes it back). */
export async function confirmLegacySdk(scope:ActorScope,input:{key:string;sdkId:string;expectedRevision:number;decision:'UNLINKED'|'LINKED'},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'SDK_CONFIRM',module:'INFRASTRUCTURE',reversible:input.decision==='UNLINKED',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertScopedSdkIds(tx,current,[input.sdkId]);
    const sdk=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId}});if(!sdk)throw new ProxyDomainError('NOT_FOUND');
    if(sdk.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','SDK '+sdk.code+' vừa thay đổi; tải lại');
    if(sdk.linkState!=='UNCONFIRMED')return {changed:false,message:'SDK '+sdk.code+' đã được xác nhận trước đó'};
    const now=new Date();await images.remember('SDK',sdk.id);
    await tx.sdkRecord.update({where:{id:sdk.id},data:{linkState:input.decision,confirmedAt:now,confirmedById:current.userId,...(input.decision==='LINKED'?{linkedAt:now,linkedById:current.userId}:{}),revision:{increment:1}}});
    await event(tx,{projectId:scope.projectId,actorId:current.userId,images,now,via:'Xác nhận dữ liệu cũ'},sdk.id,'CONFIRM',{detail:{decision:input.decision}});
    return {changed:true,message:input.decision==='LINKED'?'Đã ghi SDK '+sdk.code+' từng nối EarnApp (chỉ để tra cứu)':'Đã xác nhận SDK '+sdk.code+' chưa từng nối; dùng lại được'};
  },db);
}
/** Recreating the VM (same id / code, new round): the current code stops being current but stays in the VM's SDK list with its state.
 *  An unused code can serve the next account; a used one keeps its mark and history and is never handed out again. */
export async function releaseForRecreate(tx:Tx,images:BusinessCollector,projectId:string,actorId:string,vm:{id:string;code:string;server:{code:string}},cycle:number){
  const sdk=await tx.sdkRecord.findUnique({where:{vmId:vm.id}});if(!sdk)return null;const now=new Date();
  await images.remember('SDK_SLOT',vm.id);await images.remember('SDK',sdk.id);
  await tx.sdkRecord.update({where:{id:sdk.id},data:{vmId:null,holderVmId:vm.id,revision:{increment:1}}});
  await event(tx,{projectId,actorId,images,now,via:'Tạo lại VM'},sdk.id,'RECREATE',{fromVmId:vm.id,fromLabel:where(vm),detail:{closedCycle:cycle,keptAs:'VM_LIST',state:sdk.linkState}});
  await syncMirror(tx,vm.id,actorId,now);
  await tx.vMSdkHistory.create({data:{projectId,vmId:vm.id,previousSdk:sdk.code,newSdk:null,actorId,note:'Tạo lại VM: SDK lượt '+cycle+' vẫn trong danh sách SDK của VM'+(sdk.linkState==='LINKED'?' (đã dùng)':'')}});
  return sdk.code;
}
// ---- Kho SDK paste: SDK | Tiền tích luỹ USD | Ghi chú ----------------------------------------------------------------------------
export const CLEAR='-';
export interface StoreLine {line:number;code:string;amount:string|null|undefined;note:string|null|undefined;issue:string|null}
const STORE_HEADER=/^(sdk|mã sdk|sdk id|tiền|tiền tích luỹ|tiền tích lũy|usd|tiền tích luỹ usd|ghi chú|note)$/i;
export function parseStoreLines(text:string):StoreLine[]{
  const out:StoreLine[]=[];
  text.replace(/\r/g,'').split('\n').forEach((raw,index)=>{
    if(!raw.trim())return;
    let cells:string[];
    if(raw.includes('\t'))cells=raw.split('\t');else if(raw.includes('|'))cells=raw.split('|');else{const t=raw.trim().split(/\s+/);cells=[t[0],t[1]??'',t.slice(2).join(' ')];}
    cells=cells.map(c=>c.trim());
    if(index===0&&cells.filter(Boolean).every(c=>STORE_HEADER.test(c)))return;
    const [codeCell='',amountCell='',...noteCells]=cells,noteCell=noteCells.join(' | ').trim(),line=index+1;
    const code=normalizeSdk(codeCell);let issue:string|null=code?null:'Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-)';
    let amount:string|null|undefined;if(!amountCell)amount=undefined;else if(amountCell===CLEAR)amount=null;else{const r=parseSdkAmount(amountCell);if('error' in r)issue=issue||r.error;else amount=r.value;}
    const note=!noteCell?undefined:noteCell===CLEAR?null:noteCell;if(note&&note.length>SDK_NOTE_MAX)issue=issue||'Ghi chú tối đa '+SDK_NOTE_MAX+' ký tự';
    out.push({line,code:code||codeCell,amount,note,issue});
  });
  return out;
}
export interface StoreRow {line:number;code:string;outcome:'NEW'|'UPDATE'|'SAME'|'ERROR';message:string;sdkId:string|null;expectedRevision:number|null;amount:string|null|undefined;note:string|null|undefined;before:{amount:string|null;note:string|null}|null;/** the stored amount is not sent without the money read right (before.amount is then null, never 0) */moneyHidden:boolean;location:string|null;state:string|null}
export async function previewSdkStore(scope:ActorScope,input:{text:string},db:PrismaClient=prisma){
  await assertUnrestrictedServers(db,scope);
  scope=await authorizeVM(scope,'ASSIGN',db);if(input.text.length>300000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa 1000 dòng mỗi đợt');
  const lines=parseStoreLines(input.text);if(!lines.length||lines.length>1000)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng mỗi đợt');
  const money=await sdkMoneyRights(scope,db);
  const codes=Array.from(new Set(lines.map(l=>l.code))),records=(await db.sdkRecord.findMany({where:{projectId:scope.projectId,code:{in:codes}},include:{vm:{select:{code:true,archivedAt:true,server:{select:{code:true,archivedAt:true}}}},holder:{select:{code:true,archivedAt:true,server:{select:{code:true,archivedAt:true}}}}}})).map(r=>({...r,vm:r.holder||r.vm}));
  const byCode=new Map(records.map(r=>[r.code,r])),seen=new Map<string,number[]>();for(const l of lines)seen.set(l.code,[...(seen.get(l.code)||[]),l.line]);
  const rows:StoreRow[]=[];
  for(const l of lines){
    const rec=byCode.get(l.code),base:StoreRow={line:l.line,code:l.code,outcome:'ERROR',message:'',sdkId:rec?.id??null,expectedRevision:rec?.revision??null,amount:l.amount,note:l.note,before:rec?{amount:money.read?canonicalAmount(rec.amount?.toString()??null):null,note:rec.note}:null,moneyHidden:!money.read,location:rec?.vm?placeLabel(rec.vm):null,state:rec?.linkState??null};
    if(l.issue){rows.push({...base,message:l.issue});continue;}
    if(l.amount!==undefined&&!money.write){rows.push({...base,message:SDK_MONEY_WRITE_REFUSAL});continue;}
    const repeat=seen.get(l.code)!;if(repeat.length>1){rows.push({...base,message:'Mã lặp ở dòng '+repeat.filter(n=>n!==l.line).join(', ')+'; giữ một dòng'});continue;}
    if(!rec){if(await foreignHolder(db,scope.projectId,l.code)){rows.push({...base,message:FOREIGN_CODE});continue;}rows.push({...base,outcome:'NEW',message:'Thêm vào kho'+(l.amount==null?' · chưa ghi tiền':'')});continue;}
    const ch=infoChanges(rec,{amount:l.amount,note:l.note});
    if(!ch.amount&&!ch.note){rows.push({...base,outcome:'SAME',message:'Đã có, giữ nguyên'});continue;}
    rows.push({...base,outcome:'UPDATE',message:'Cập nhật mã đã có'});
  }
  return {rows,ready:rows.filter(r=>r.outcome==='NEW'||r.outcome==='UPDATE').length,same:rows.filter(r=>r.outcome==='SAME').length,errors:rows.filter(r=>r.outcome==='ERROR').length};
}
export async function applySdkStore(scope:ActorScope,input:{key:string;rows:{line:number;code:string;expectedRevision:number|null;amount?:string|null;note?:string|null}[]},db:PrismaClient=prisma){
  if(!input.rows.length||input.rows.length>1000||new Set(input.rows.map(r=>r.code)).size!==input.rows.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi mã một dòng, tối đa 1000 dòng');
  for(const r of input.rows){if(normalizeSdk(r.code)!==r.code)throw new ProxyDomainError('INVALID_INPUT','Mã SDK không hợp lệ ở dòng '+r.line);checkInfo(r);}
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'SDK_STORE',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true,authorize:async tx=>{const current=await authorizeBusiness(scope,'INFRASTRUCTURE',true,tx);await assertUnrestrictedServers(tx,current);return current;}},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertUnrestrictedServers(tx,current);if(carriesMoney(input.rows))await assertSdkMoneyWrite(current,tx);
    const now=new Date(),ctx:WriteCtx={projectId:scope.projectId,actorId:current.userId,images,now,via:'Kho SDK'};
    const out:{line:number;code:string;outcome:'SAVED'|'SAME'|'ERROR';message:string}[]=[];
    for(const r of [...input.rows].sort((a,b)=>a.line-b.line)){
      const info=checkInfo(r),rec=await tx.sdkRecord.findUnique({where:{projectId_code:{projectId:scope.projectId,code:r.code}}});
      if(!rec){
        if(r.expectedRevision!==null){out.push({line:r.line,code:r.code,outcome:'ERROR',message:'Mã vừa bị xoá hoặc đổi; kiểm tra lại'});continue;}
        if(await foreignHolder(tx,scope.projectId,r.code)){out.push({line:r.line,code:r.code,outcome:'ERROR',message:FOREIGN_CODE});continue;}
        const created=await tx.sdkRecord.create({data:{projectId:scope.projectId,code:r.code,linkState:'UNLINKED',createdById:current.userId,createdAt:now,...(info.amount!=null?{amount:info.amount,amountAt:now,amountById:current.userId,amountObservedAt:now,amountSource:'Web · Kho SDK'}:{}),...(info.note?{note:info.note,noteAt:now,noteById:current.userId}:{})}});
        await images.remember('SDK',created.id,true);await event(tx,ctx,created.id,'CREATE',{detail:{amount:info.amount??null,note:info.note??null}});
        out.push({line:r.line,code:r.code,outcome:'SAVED',message:'Đã thêm vào kho'});continue;
      }
      if(r.expectedRevision===null||rec.revision!==r.expectedRevision){
        // A retry after a lost answer finds the values already there: nothing to write, never a second record.
        if(!infoChanges(rec,info).amount&&!infoChanges(rec,info).note){out.push({line:r.line,code:r.code,outcome:'SAME',message:'Đã có, giữ nguyên'});continue;}
        out.push({line:r.line,code:r.code,outcome:'ERROR',message:r.expectedRevision===null?'Mã vừa được người khác thêm vào kho; kiểm tra lại dòng này':'Mã vừa được thay đổi sau khi kiểm tra; kiểm tra lại dòng này'});continue;
      }
      const changed=await applyInfo(tx,ctx,rec,info);out.push({line:r.line,code:r.code,outcome:changed?'SAVED':'SAME',message:changed?'Đã cập nhật':'Giữ nguyên'});
    }
    return {rows:out,saved:out.filter(o=>o.outcome==='SAVED').length,same:out.filter(o=>o.outcome==='SAME').length,errors:out.filter(o=>o.outcome==='ERROR').length};
  },db);
}
/** Edit money / note of one stored code from Kho SDK (any state: info never makes a code usable). */
export async function updateSdkInfo(scope:ActorScope,input:{key:string;sdkId:string;expectedRevision:number;amount?:string|null;note?:string|null},db:PrismaClient=prisma){
  const info=checkInfo(input);
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'SDK_STORE',module:'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    current=await authorizeVM(current,'ASSIGN',tx);
    await assertScopedSdkIds(tx,current,[input.sdkId]);if(carriesMoney([info]))await assertSdkMoneyWrite(current,tx);
    const rec=await tx.sdkRecord.findFirst({where:{id:input.sdkId,projectId:scope.projectId}});if(!rec)throw new ProxyDomainError('NOT_FOUND');
    if(rec.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa thay đổi; tải lại (nội dung đang nhập được giữ)');
    const changed=await applyInfo(tx,{projectId:scope.projectId,actorId:current.userId,images,now:new Date(),via:'Kho SDK'},rec,info);
    return {changed,message:changed?'Đã lưu':'Giữ nguyên'};
  },db);
}
// ---- Reads -------------------------------------------------------------------------------------------------------------------------
export async function readSdkStore(scope:ActorScope,db:PrismaClient=prisma){
  scope=await authorizeVM(scope,'READ',db);const money=(await sdkMoneyRights(scope,db)).read;
  const vmPick={select:{id:true,code:true,serverId:true,revision:true,archivedAt:true,server:{select:{code:true,archivedAt:true}}}} as const;
  const rows=await db.sdkRecord.findMany({where:{projectId:scope.projectId,...sdkWhere(scope)},include:{vm:vmPick,holder:vmPick,linkedEarnApp:{select:{login:{select:{email:true}}}}},orderBy:{code:'asc'}});
  const visible=await sdkVisibleVmIds(db,scope,rows.flatMap(r=>[r.amountVmId,r.amountFailedVmId,r.linkedVmId,r.vmId]));
  // `vm` = the VM whose SDK list holds the code (the same record as the VM cell); `current` = it is that VM's current code.
  // Without the money read right the amount, its times and source are not sent at all (never 0, never "chưa ghi"): `moneyHidden`.
  return rows.map(r=>{const at=r.holder||r.vm,amount=money&&sdkBindingVisible(visible,r.amountVmId),linked=sdkBindingVisible(visible,r.linkedVmId);return {id:r.id,code:r.code,revision:r.revision,amount:amount?canonicalAmount(r.amount?.toString()??null):null,currency:r.currency,amountAt:amount?r.amountAt?.toISOString()??null:null,observedAt:amount?r.amountObservedAt?.toISOString()??null:null,failedAt:money&&sdkBindingVisible(visible,r.amountFailedVmId)?r.amountFailedAt?.toISOString()??null:null,amountSource:amount?r.amountSource:null,moneyHidden:!money,observedCycle:amount?r.amountCycle:null,observedVmId:amount?r.amountVmId:null,note:r.note,state:r.linkState,
    vm:at?{id:at.id,code:at.code,serverId:at.serverId,revision:at.revision,server:at.server.code,deleted:!!(at.archivedAt||at.server.archivedAt)}:null,current:!!r.vmId&&sdkBindingVisible(visible,r.vmId),linkedLogin:linked?r.linkedEarnApp?.login.email??null:null,linkedAt:linked?r.linkedAt?.toISOString()??null:null,updatedAt:r.updatedAt.toISOString()};});
}
export async function readSdkDetail(scope:ActorScope,sdkId:string,db:PrismaClient=prisma){
  scope=await authorizeVM(scope,'READ',db);const money=(await sdkMoneyRights(scope,db)).read;
  await assertScopedSdkIds(db,scope,[sdkId]);denyScopedSdkHistory(scope);
  const rec=await db.sdkRecord.findFirst({where:{id:sdkId,projectId:scope.projectId},include:{events:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:300},linkedEarnApp:{select:{login:{select:{email:true}}}}}});if(!rec)throw new ProxyDomainError('NOT_FOUND');
  const ids=Array.from(new Set([...rec.events.map(e=>e.actorId),rec.amountById,rec.noteById,rec.linkedById].filter((s):s is string=>!!s))),users=await db.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,username:true}});
  const who=(id:string|null)=>{if(!id)return null;if(id==='migration')return 'Chuyển dữ liệu';const u=users.find(x=>x.id===id);return u?u.name||u.username||'Tài khoản cũ':'Tài khoản cũ';};
  return {id:rec.id,code:rec.code,state:rec.linkState,linkedLogin:rec.linkedEarnApp?.login.email??null,linkedAt:rec.linkedAt?.toISOString()??null,linkedBy:who(rec.linkedById),linkedCycle:rec.linkedCycle,amountAt:rec.amountAt?.toISOString()??null,amountBy:who(rec.amountById),noteAt:rec.noteAt?.toISOString()??null,noteBy:who(rec.noteById),
    moneyHidden:!money,events:rec.events.map(e=>({id:e.id,kind:e.kind,from:e.fromLabel,to:e.toLabel,detail:money?e.detail as Record<string,unknown>|null:maskSdkEventDetail(e.detail as Record<string,unknown>|null),at:e.createdAt.toISOString(),by:who(e.actorId)}))};
}
