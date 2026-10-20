import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope,type DomainReason} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {runBusinessCommand} from '../business-management/idempotency';
import {authorizeBusiness} from '../business-management/scope';
import {ledgerRights} from '../business-management/paypal-ledger';
import {authorizeVM} from '../vm-management/repository';
import {LEDGER_CURRENCY} from '../business-management/types';
import {staleCycle} from './ops';
import type {BalanceCheckView,Withdrawable} from '@/lib/vm-ops';
// EarnApp balance at the VM (owner brief 20/10/2026). People and AI record what they READ on the EarnApp account of a VM, through
// the same command and checks:
// - every line names the VM, its round (expectedCycle) and the EarnApp account seen (earnAppId): another round or another account
//   is refused at the line (an old order never lands on a recreated VM);
// - amount is exact (2 decimals, canonical number; 0 is a value), currency kept as given (USD is never turned into USDT);
// - checkedAt is when it was really read (not the save time); the newest check by checkedAt is the current one, so an older check
//   arriving late is history only; a FAILED check keeps the last good figure;
// - "withdrawable" is what EarnApp showed (YES / NO); a bare balance (a paste) is UNKNOWN, never "có thể rút";
// - never income, cost, a PayPal receipt or team USDT; SDK notes are not read. Evidence is a reference only (no secret).
// One request key per save: a retry replays (no second history line); a new check with the same amount is a new line.
// Rights: write = ADMIN / MODERATOR with Server/VM write, or a member with the EARN_BALANCE capability (e.g. an AI account);
// amounts are visible to the PayPal money readers and to who may record them. VIEWERs and other projects get nothing to write.
export type BalanceSource='CELL'|'PASTE'|'AI'|'OTHER';
export interface BalanceItem {vmId:string;expectedCycle:number;earnAppId:string;/** VM revision seen (ops API); checked in the transaction. */expectedVmRevision?:number;checkedAt:string;outcome:'OK'|'FAILED';amount?:string|null;currency?:string|null;withdrawable?:Withdrawable|null;condition?:string|null;failure?:string|null;evidence?:string|null;line?:number}
const AMOUNT=/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;
export async function balanceRights(scope:ActorScope,db:Parameters<typeof loadInfrastructureScope>[0]=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  let infraWrite=false,infraRead=false;try{await authorizeBusiness(current,'INFRASTRUCTURE',false,db as PrismaClient);infraRead=true;await authorizeBusiness(current,'INFRASTRUCTURE',true,db as PrismaClient);infraWrite=true;}catch{/* keep false */}
  const write=infraWrite&&current.businessMode==='PROXY_VM'&&current.role!=='VIEWER'&&(['ADMIN','MODERATOR'].includes(current.role)||current.capabilities.includes('EARN_BALANCE'));
  const money=(await ledgerRights(current,db as PrismaClient)).funds;
  return {current,read:infraRead&&(money||write),write};
}
function checkItem(i:BalanceItem,now:Date):string|null{
  const at=new Date(i.checkedAt);if(isNaN(at.getTime()))return 'Thời điểm kiểm tra không hợp lệ';
  if(at.getTime()>now.getTime()+5*60e3)return 'Thời điểm kiểm tra ở tương lai';
  if(at.getTime()<now.getTime()-370*24*3600e3)return 'Thời điểm kiểm tra quá cũ';
  if(i.outcome==='OK'){if(i.amount==null||!AMOUNT.test(i.amount))return 'Số dư là số không âm, tối đa 2 chữ số thập phân (0 là giá trị hợp lệ)';if(i.currency&&!LEDGER_CURRENCY.test(i.currency.toUpperCase()))return 'Đồng tiền là mã 3–5 chữ cái';}
  else if(!i.failure?.trim())return 'Ghi lý do khi kiểm tra thất bại';
  if((i.condition||'').length>300||(i.failure||'').length>300||(i.evidence||'').length>300)return 'Ghi chú / căn cứ tối đa 300 ký tự';
  return null;
}
// strict (ops API, one VM per call): a refused line throws with its reason, so nothing is written or journaled and the caller gets a
// clear code; the cell and the paste keep their per-line answers.
export async function recordBalanceChecks(scope:ActorScope,input:{key:string;source:BalanceSource;items:BalanceItem[];strict?:boolean},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>1000)throw new ProxyDomainError('INVALID_INPUT','Từ 1 đến 1000 VM mỗi lần');
  if(new Set(input.items.map(i=>i.vmId)).size!==input.items.length)throw new ProxyDomainError('INVALID_INPUT','Mỗi VM một dòng mỗi lần ghi');
  // The write right is checked before a replay too: a retry after the right was taken away is refused (ops API, 21/10/2026).
  const authorize=async(tx:Prisma.TransactionClient)=>{const r=await balanceRights(scope,tx);if(!r.write)throw new ProxyDomainError('FORBIDDEN','Ghi số dư EarnApp cần quyền ghi Server / VM (quản lý) hoặc quyền "Ghi kiểm tra tiền EarnApp"');return r.current;};
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_BALANCE_CHECK',module:'INFRASTRUCTURE',reversible:false,authorize},async(tx,_images,current)=>{
    const now=new Date(),rows:{line:number;vmId:string;outcome:'APPLIED'|'ERROR';message:string}[]=[];
    for(const [n,i] of input.items.entries()){
      const line=i.line??n+1,row=(outcome:'APPLIED'|'ERROR',message:string)=>rows.push({line,vmId:i.vmId,outcome,message});
      const fail=(reason:DomainReason,message:string)=>{if(input.strict)throw new ProxyDomainError(reason==='VALIDATION'?'INVALID_INPUT':reason==='NOT_FOUND'?'NOT_FOUND':'STALE_PREVIEW',message,reason);row('ERROR',message);};
      const bad=checkItem(i,now);if(bad){fail('VALIDATION',bad);continue;}
      const vm=await tx.virtualMachine.findFirst({where:{id:i.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,server:{select:{code:true}},operation:{select:{cycle:true}},earnApp:{select:{id:true,closedAt:true}}}});
      if(!vm){fail('NOT_FOUND','VM không còn hoạt động trong dự án');continue;}
      const cycle=vm.operation?.cycle??1;if(cycle!==i.expectedCycle){fail('CYCLE_CHANGED',staleCycle(cycle));continue;}
      if(i.expectedVmRevision!==undefined&&vm.revision!==i.expectedVmRevision){fail('REVISION_CONFLICT','VM vừa được sửa; tải lại');continue;}
      if(!vm.earnApp||vm.earnApp.closedAt){fail('ACCOUNT_CHANGED','VM chưa có tài khoản EarnApp ở lượt này');continue;}
      if(vm.earnApp.id!==i.earnAppId){fail('ACCOUNT_CHANGED','VM đã đổi tài khoản EarnApp; kiểm tra lại đúng tài khoản hiện hành');continue;}
      await tx.earnBalanceCheck.create({data:{projectId:scope.projectId,vmId:vm.id,cycle,earnAppId:vm.earnApp.id,checkedAt:new Date(i.checkedAt),outcome:i.outcome,
        amount:i.outcome==='OK'?i.amount!:null,currency:(i.currency||'USD').toUpperCase(),withdrawable:i.outcome==='OK'?i.withdrawable||'UNKNOWN':'UNKNOWN',
        condition:i.condition?.trim()||null,failure:i.outcome==='FAILED'?i.failure!.trim():null,evidence:i.evidence?.trim()||null,source:input.source,recordedById:current.userId}});
      row('APPLIED',i.outcome==='OK'?'Đã ghi số dư':'Đã ghi kiểm tra thất bại (giữ số gần nhất)');
    }
    return {rows,applied:rows.filter(x=>x.outcome==='APPLIED').length,errors:rows.filter(x=>x.outcome==='ERROR').length};
  },db);
}
// Free text (observed condition, failure reason, evidence) is written by people / AI and may name amounts, so it goes out only with
// the balance read right (review fix 20/10/2026). Everyone else gets the neutral operating facts: outcome, withdrawable as observed,
// check time, and whether a note exists; never a rewritten copy of the note.
const view=(c:{outcome:string;amount:{toFixed(n:number):string}|null;currency:string;withdrawable:string;checkedAt:Date;failure:string|null;condition:string|null},money:boolean):BalanceCheckView=>({outcome:c.outcome as 'OK'|'FAILED',amount:money&&c.amount?c.amount.toFixed(2):null,currency:c.currency,withdrawable:c.withdrawable as Withdrawable,checkedAt:c.checkedAt.toISOString(),failure:money?c.failure:null,condition:money?c.condition:null,noteHidden:!money&&!!(c.failure||c.condition)});
/** Newest check and newest good check of each VM's current EarnApp in its current round (for the grid). */
export async function currentBalances(db:PrismaClient,projectId:string,vms:{id:string;cycle:number;earnAppId:string|null}[],read:boolean){
  const ids=vms.filter(v=>v.earnAppId).map(v=>v.id),out=new Map<string,{latest:BalanceCheckView|null;lastOk:BalanceCheckView|null}>();
  if(!ids.length)return out;
  const rows=await db.earnBalanceCheck.findMany({where:{projectId,vmId:{in:ids}},orderBy:[{checkedAt:'desc'},{recordedAt:'desc'}]});
  for(const v of vms){if(!v.earnAppId)continue;const mine=rows.filter(r=>r.vmId===v.id&&r.cycle===v.cycle&&r.earnAppId===v.earnAppId);
    const latest=mine[0],lastOk=mine.find(r=>r.outcome==='OK');out.set(v.id,{latest:latest?view(latest,read):null,lastOk:lastOk?view(lastOk,read):null});}
  return out;
}
export async function readBalanceHistory(scope:ActorScope,input:{vmId:string},db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);const r=await balanceRights(scope,db);
  const vm=await db.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const [rows,users]=await Promise.all([db.earnBalanceCheck.findMany({where:{projectId:scope.projectId,vmId:vm.id},orderBy:[{checkedAt:'desc'}],take:100}),db.user.findMany({where:{memberships:{some:{projectId:scope.projectId}}},select:{id:true,name:true,username:true}})]);
  const who=(id:string)=>{const u=users.find(x=>x.id===id);return u?u.name||u.username||'Tài khoản cũ':'Tài khoản cũ';};
  return {rights:{read:r.read,write:r.write},rows:rows.map(c=>({...view(c,r.read),id:c.id,cycle:c.cycle,source:c.source,evidence:r.read?c.evidence:null,by:who(c.recordedById),recordedAt:c.recordedAt.toISOString()}))};
}
// Dán bảng → Số dư: "VM | Số dư" (one server) or "Server | VM | Số dư". Matched by server + VM code, never by table position; the VM's
// current round and EarnApp are taken at the check and sent with each line (the save refuses a line if they changed). An empty amount
// keeps the stored figure (nothing written); 0 is a value. A paste never says "có thể rút".
export async function previewBalancePaste(scope:ActorScope,input:{text:string;serverId?:string|null},db:PrismaClient=prisma){
  const r=await balanceRights(scope,db);if(!r.write)throw new ProxyDomainError('FORBIDDEN','Ghi số dư EarnApp cần quyền ghi Server / VM (quản lý) hoặc quyền "Ghi kiểm tra tiền EarnApp"');
  if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Dán tối đa 1000 dòng');
  const server=input.serverId?await db.server.findFirst({where:{id:input.serverId,projectId:scope.projectId,managed:true}}):null;if(input.serverId&&!server)throw new ProxyDomainError('NOT_FOUND','Server không thuộc dự án');
  const servers=await db.server.findMany({where:{projectId:scope.projectId,managed:true},select:{code:true}}),codes=new Set(servers.map(s=>s.code.toLowerCase()));
  const vms=await db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,code:true,archivedAt:true,server:{select:{code:true,archivedAt:true}},operation:{select:{cycle:true}},earnApp:{select:{id:true,closedAt:true,login:{select:{email:true}}}}}});
  const byKey=new Map(vms.map(v=>[v.server.code.toLowerCase()+'\u0000'+v.code.toLowerCase(),v]));
  const lines=input.text.replace(/\r/g,'').split('\n').map((raw,i)=>({raw,line:i+1})).filter(l=>l.raw.trim());
  if(!lines.length||lines.length>1000)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng');
  const seen=new Map<string,number>(),rows:{line:number;server:string|null;vm:string|null;vmId:string|null;expectedCycle:number|null;earnAppId:string|null;account:string|null;amount:string|null;outcome:'READY'|'SKIP'|'ERROR';message:string}[]=[];
  for(const [i,l] of lines.entries()){
    let c=(l.raw.includes('\t')?l.raw.split('\t'):l.raw.includes('|')?l.raw.split('|'):l.raw.trim().split(/\s+/)).map(x=>x.trim());
    if(i===0&&/^(server|vm|máy|mã vm)$/i.test(c[0]||''))continue;
    let srv=server?.code??null;if(c.length>=3&&codes.has((c[0]||'').toLowerCase())){srv=c[0];c=c.slice(1);}
    const base={line:l.line,server:srv,vm:c[0]||null,vmId:null,expectedCycle:null,earnAppId:null,account:null,amount:null};
    if(!srv){rows.push({...base,outcome:'ERROR',message:'Chọn server hoặc dán kèm cột Server'});continue;}
    const vm=byKey.get(srv.toLowerCase()+'\u0000'+(c[0]||'').toLowerCase());
    if(!vm){rows.push({...base,outcome:'ERROR',message:'Không có VM '+(c[0]||'')+' trên '+srv+' (web không tự tạo VM)'});continue;}
    if(vm.archivedAt||vm.server.archivedAt){rows.push({...base,outcome:'ERROR',message:'VM đã xoá'});continue;}
    const at={...base,server:vm.server.code,vm:vm.code,vmId:vm.id,expectedCycle:vm.operation?.cycle??1};
    const prev=seen.get(vm.id);if(prev){rows.push({...at,outcome:'ERROR',message:'Trùng VM với dòng '+prev});continue;}seen.set(vm.id,l.line);
    if(!vm.earnApp||vm.earnApp.closedAt){rows.push({...at,outcome:'ERROR',message:'VM chưa có tài khoản EarnApp ở lượt này'});continue;}
    const acc={...at,earnAppId:vm.earnApp.id,account:vm.earnApp.login.email},cell=(c[1]||'').replace(/\s/g,'');
    if(!cell){rows.push({...acc,outcome:'SKIP',message:'Ô trống: giữ nguyên số đã có'});continue;}
    const t=cell.replace(/^\$|USD$/i,''),norm=/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)?t.replace(/\./g,'').replace(',','.'):/^\d+,\d{1,2}$/.test(t)?t.replace(',','.'):t;
    if(!AMOUNT.test(norm)){rows.push({...acc,outcome:'ERROR',message:'Số dư không hợp lệ ("'+cell.slice(0,20)+'"); dùng 10,50 hoặc 10.50'});continue;}
    if(c.length>2&&c.slice(2).some(x=>x)){rows.push({...acc,outcome:'ERROR',message:'Quá nhiều cột; mỗi dòng: '+(server?'VM | Số dư':'Server | VM | Số dư')});continue;}
    rows.push({...acc,amount:norm,outcome:'READY',message:'Ghi số dư (chưa xác nhận điều kiện rút)'});
  }
  return {rows,ready:rows.filter(x=>x.outcome==='READY').length,skipped:rows.filter(x=>x.outcome==='SKIP').length,errors:rows.filter(x=>x.outcome==='ERROR').length};
}
