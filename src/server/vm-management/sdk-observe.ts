import type {Prisma,PrismaClient,SdkRecord} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {canonicalAmount,parseSdkAmount} from '@/lib/sdk-money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {assertSdkMoneyWrite} from './sdk-money-rights';
import {authorizeVM} from './repository';
import {normalizeSdk} from './sdk-parse';
import {cycleOf,syncMirror,where} from './sdk-store';
import {applyListAdd,event,loadVM,planListAdd,staleRecord,type Ctx} from './sdk-list';
// SDK codes seen running on a machine, with the accumulated money read there (owner briefs 22/10/2026). Not an install: no job, no new
// EarnApp, no account needed. It writes into the same SDK records as the SDK cell / Kho SDK (sdk-list.ts places the codes):
// - A code already in this VM's list keeps its state (a used code stays used); a new code is created "Chưa xác nhận" (the history of a
//   surveyed code is unknown: never "Chưa dùng" because the web has no account or the app shows Sign in). An unused code in the store
//   joins the list. A code in another VM's list, a used / unconfirmed code outside this VM, or another project's code refuses the whole
//   command: nothing is moved or taken.
// - Each code carries the SDK revision the caller read (null = "I saw no stored code": a code created meanwhile is refused, never
//   overwritten).
// - `current`: the code the machine runs now. It becomes the VM's current code when the VM has none; a VM with ANOTHER current code
//   refuses the command (SDK_CONFLICT with that code), the web never swaps it.
// - Money is the latest USD total read on the machine, on the code itself: amountObservedAt (seen) apart from amountAt (written), the
//   source and the evidence note. An older observation leaves the stored one (OLDER); the same moment with another figure is a conflict;
//   null = could not read (never 0); never added up, never a cost, income, PayPal money, EarnApp balance or "withdrawable". Old money
//   without an observation time stays "time unknown" and any new observation may replace it.
// - Writing money needs the EarnApp balance write right (ADMIN / MODERATOR or capability EARN_BALANCE), checked in the transaction.
// - One command: rights, token, round, VM / SDK revisions and idempotency in one transaction; the same key replays the first answer.
// - Never changes the EarnApp account, the VM status or any install mark.
type Tx=Prisma.TransactionClient;
export const OBSERVE_MAX=20;
export interface ObserveItem {code:string;/** The revision read; null = no stored code was seen. */expectedSdkRevision:number|null;/** undefined = no money in this request; null = could not read it; text = USD read. */amount?:string|null;current?:boolean}
export interface ObserveInput {key:string;vmId:string;expectedCycle:number;expectedVmRevision:number;observedAt:string;source:string;evidence?:string|null;items:ObserveItem[]}
export type AmountOutcome='SAVED'|'SAME'|'OLDER'|'UNREADABLE'|'NOT_SENT';
export interface ObservedRow {code:string;sdkId:string;placed:'CREATED'|'TAKEN'|'IN_LIST';state:SdkRecord['linkState'];current:boolean;revisionAfter:number;amount:{outcome:AmountOutcome;value:string|null;observedAt:string|null;source:string|null}}
const invalid=(m:string)=>new ProxyDomainError('INVALID_INPUT',m,'VALIDATION');
/** Normalise and check the request before the transaction: codes, money, one current code at most; two equal codes are one SDK. */
export function normalizeObservation(input:Omit<ObserveInput,'key'>){
  if(!input.items.length||input.items.length>OBSERVE_MAX)throw invalid('Gửi 1 đến '+OBSERVE_MAX+' mã SDK mỗi lần cho một VM');
  const at=new Date(input.observedAt);if(Number.isNaN(at.getTime()))throw invalid('observedAt không hợp lệ');
  if(at.getTime()>Date.now()+5*60e3)throw invalid('observedAt ở tương lai');
  const source=input.source.trim().slice(0,120);if(!source)throw invalid('Ghi nguồn đọc (source), ví dụ "AE Mini Tool · màn hình EarnApp"');
  const evidence=input.evidence?.trim().slice(0,300)||null;
  const byCode=new Map<string,{code:string;expectedSdkRevision:number|null;amount?:string|null;current:boolean}>();
  for(const it of input.items){
    const code=normalizeSdk(it.code);if(!code)throw invalid('Mã SDK không hợp lệ (8–128 ký tự chữ/số/._:-): '+String(it.code).slice(0,20));
    let amount:string|null|undefined=it.amount;
    // Only checked figures: "5_17", "5,17" or anything else that is not a plain USD decimal is refused, never guessed.
    if(typeof amount==='string'){const r=parseSdkAmount(amount);if('error' in r)throw invalid('Tiền SDK '+code+': '+r.error);amount=r.value;}
    const exp=it.expectedSdkRevision??null,prev=byCode.get(code);
    // Two files with the same code on one machine are one SDK; two different readings of it in one request are refused.
    if(prev){
      if(prev.amount!==undefined&&amount!==undefined&&prev.amount!==amount)throw invalid('SDK '+code+' có hai số tiền khác nhau trong cùng lần đọc; đọc lại máy');
      if(prev.expectedSdkRevision!==exp)throw invalid('SDK '+code+' gửi hai revision khác nhau; đọc lại VM');
      prev.amount=prev.amount===undefined?amount:prev.amount;prev.current=prev.current||!!it.current;continue;
    }
    byCode.set(code,{code,expectedSdkRevision:exp,amount,current:!!it.current});
  }
  const items=[...byCode.values()].sort((a,b)=>a.code.localeCompare(b.code));
  if(items.filter(i=>i.current).length>1)throw invalid('Chỉ một mã là SDK máy đang chạy (current)');
  return {vmId:input.vmId,expectedCycle:input.expectedCycle,expectedVmRevision:input.expectedVmRevision,observedAt:at.toISOString(),source,evidence,items};
}
export const hasAmounts=(items:{amount?:string|null}[])=>items.some(i=>i.amount!==undefined);
const conflict=(m:string,details:Record<string,unknown>)=>new ProxyDomainError('STALE_PREVIEW',m,'SDK_CONFLICT',details);
async function observeAmount(tx:Tx,ctx:Ctx,rec:SdkRecord,amount:string|null|undefined,observedAt:Date,source:string,evidence:string|null):Promise<ObservedRow['amount']>{
  const now=canonicalAmount(rec.amount?.toString()??null),prev=rec.amountObservedAt;
  const kept={value:now,observedAt:prev?.toISOString()??null,source:rec.amountSource};
  if(amount===undefined)return {outcome:'NOT_SENT',...kept};
  if(amount===null){await event(tx,ctx,rec.id,'OBSERVE',{detail:{observedAt:observedAt.toISOString(),source,evidence,readable:false}});return {outcome:'UNREADABLE',...kept};}
  // A reading older than the one stored never replaces it; the same moment with another figure is a conflict to look at.
  if(prev&&observedAt<prev)return {outcome:'OLDER',...kept};
  if(prev&&observedAt.getTime()===prev.getTime()){
    if(now===amount)return {outcome:'SAME',...kept};
    throw conflict('SDK '+rec.code+' đã có số '+now+' USD đọc đúng lúc này; cùng thời điểm khác tiền, đọc lại máy (không ghi gì)',{kind:'SAME_TIME_OTHER_AMOUNT',code:rec.code,sdkId:rec.id,revision:rec.revision,storedAmountUsd:now,observedAt:prev.toISOString()});
  }
  await ctx.images.remember('SDK',rec.id);
  const n=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision},data:{...(now!==amount?{amount,amountAt:ctx.now,amountById:ctx.actorId}:{}),amountObservedAt:observedAt,amountSource:source,revision:{increment:1}}});
  if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; đọc lại VM rồi gửi lại','REVISION_CONFLICT',{code:rec.code});
  await event(tx,ctx,rec.id,now!==amount?'AMOUNT':'OBSERVE',{detail:{from:now,to:amount,observedAt:observedAt.toISOString(),source,evidence}});
  return {outcome:now===amount?'SAME':'SAVED',value:amount,observedAt:observedAt.toISOString(),source};
}
export async function observeVmSdks(scope:ActorScope,input:ObserveInput,db:PrismaClient=prisma,caller:{tokenLabel?:string}={}){
  const request=normalizeObservation(input);
  const source=(caller.tokenLabel?'AI '+caller.tokenLabel+' · ':'')+request.source;
  return runBusinessCommand(scope,{key:input.key,payload:request,kind:'VM_SDK_OBSERVE',module:'INFRASTRUCTURE',reversible:false},async(tx,images,current)=>{
    await authorizeVM(current,'ASSIGN',tx);
    if(hasAmounts(request.items))await assertSdkMoneyWrite(scope,tx);
    const vm=await loadVM(tx,scope.projectId,request.vmId),cycle=cycleOf(vm);
    if(cycle!==request.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW','VM đã sang lượt '+cycle+'; đọc lại VM','CYCLE_CHANGED');
    if(vm.revision!==request.expectedVmRevision)throw new ProxyDomainError('STALE_PREVIEW',where(vm)+' vừa thay đổi; đọc lại VM rồi gửi lại (không ghi gì)','REVISION_CONFLICT');
    // Every code is checked before anything is written: one refusal and nothing of this command is saved.
    const plans=[];
    for(const it of request.items){
      const p=await planListAdd(tx,scope.projectId,vm,it.code,null);
      if('error' in p)throw new ProxyDomainError(p.code==='OWNER_CONFLICT'?'OWNER_CONFLICT':'STALE_PREVIEW',p.error+' (không ghi gì; web không tự chuyển mã)','DUPLICATE',{code:it.code});
      const stale=staleRecord(p.plan,it.expectedSdkRevision);
      if(stale)throw new ProxyDomainError('STALE_PREVIEW',stale.replace(' (nội dung đang nhập được giữ)','')+' (không ghi gì)','REVISION_CONFLICT',{code:it.code,sdk:p.plan.record?{sdkId:p.plan.record.id,revision:p.plan.record.revision,linkState:p.plan.record.linkState}:null});
      plans.push({it,plan:p.plan});
    }
    const running=request.items.find(i=>i.current),held=running?await tx.sdkRecord.findUnique({where:{vmId:vm.id}}):null;
    if(running&&held&&held.code!==running.code)throw conflict(where(vm)+' đang có SDK hiện hành '+held.code+' trên web, khác mã máy đang chạy '+running.code+'; web không tự thay mã, đối chiếu trên máy (không ghi gì)',
      {kind:'CURRENT_DIFFERS',observedCode:running.code,currentCode:held.code,currentSdkId:held.id,currentRevision:held.revision,currentLinkState:held.linkState});
    const now=new Date(),ctx:Ctx={projectId:scope.projectId,actorId:current.userId,images,now,via:'AI ghi nhận SDK đang chạy'},observedAt=new Date(request.observedAt);
    const rows:ObservedRow[]=[];
    for(const {it,plan} of plans){
      if(plan.kind!=='SAME')await applyListAdd(tx,ctx,vm,plan,{},{createState:'UNCONFIRMED'});
      let rec=await tx.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:scope.projectId,code:it.code}}});
      const amount=await observeAmount(tx,ctx,rec,it.amount,observedAt,source,request.evidence);
      rec=await tx.sdkRecord.findUniqueOrThrow({where:{id:rec.id}});
      if(it.current&&rec.vmId!==vm.id){
        await images.remember('SDK_SLOT',vm.id);await images.remember('SDK',rec.id);
        const n=await tx.sdkRecord.updateMany({where:{id:rec.id,revision:rec.revision,vmId:null},data:{vmId:vm.id,placedAt:now,placedById:current.userId,revision:{increment:1}}});
        if(n.count!==1)throw new ProxyDomainError('STALE_PREVIEW','SDK '+rec.code+' vừa được người khác thay đổi; đọc lại VM rồi gửi lại','REVISION_CONFLICT',{code:rec.code});
        await event(tx,ctx,rec.id,'PLACE',{toVmId:vm.id,toLabel:where(vm),detail:{observed:true}});
        await syncMirror(tx,vm.id,current.userId,now);
        await tx.vMSdkHistory.create({data:{projectId:scope.projectId,vmId:vm.id,previousSdk:null,newSdk:rec.code,actorId:current.userId,recordedAt:now,note:'SDK máy đang chạy (AI ghi nhận)'}});
        rec=await tx.sdkRecord.findUniqueOrThrow({where:{id:rec.id}});
      }
      rows.push({code:rec.code,sdkId:rec.id,placed:plan.kind==='CREATE'?'CREATED':plan.kind==='SAME'?'IN_LIST':'TAKEN',state:rec.linkState,current:rec.vmId===vm.id,revisionAfter:rec.revision,amount});
    }
    const after=await tx.virtualMachine.findUniqueOrThrow({where:{id:vm.id},select:{revision:true}});
    return {vmId:vm.id,cycle,observedAt:request.observedAt,source,evidence:request.evidence,items:rows,vmRevisionAfter:after.revision};
  },db);
}
