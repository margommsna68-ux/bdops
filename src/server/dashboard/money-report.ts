import type {PrismaClient} from '@prisma/client';
import type {ActorScope} from '../proxy-management/types';
import {ProxyDomainError} from '../proxy-management/types';
import {readVMWorkspace} from '../vm-management/repository';
import {readVmAccounts} from '../account-store/read';
import {compareCodes} from '../proxy-management/package-terms';
import {readBusinessPulse} from './pulse';
import {PROBLEM_LABEL} from '@/lib/business-pulse';

// Daily "tiền không tăng" report (owner 27/10/2026: ONE consolidated Telegram message at 10:00 Vietnam).
// Same per-VM rule as the business dashboard (businessPulse), but the trend window is the last 24 hours, not "today since 00:00".
// Only operating VMs (not OFF / Chưa cài); a VM without two readings in the window is "chưa đủ số liệu", never "không tăng".
const HOURS=24;
type Row=Awaited<ReturnType<typeof readBusinessPulse>>['rows'][number];
const brief=(r:Row)=>({code:r.code,amount:r.amount,observedAt:r.observedAt,health:r.health,problem:r.problem?PROBLEM_LABEL[r.problem]:null,recordedIssue:r.recordedIssue});
export async function readMoneyReport(scope:ActorScope,db:PrismaClient,now:Date=new Date()){
 const workspace=await readVMWorkspace(scope,db);
 let accounts:Awaited<ReturnType<typeof readVmAccounts>>|null=null;
 try{accounts=await readVmAccounts(scope,db);}catch(e){if(!(e instanceof ProxyDomainError))throw e;}
 const windowStart=new Date(now.getTime()-HOURS*3600e3);
 const pulse=await readBusinessPulse(scope,workspace,accounts,db,now,windowStart);
 if(!pulse.moneyRead)throw new ProxyDomainError('FORBIDDEN','Cần quyền xem tiền để lập báo cáo');
 const active=pulse.rows.filter(r=>r.health!=='PAUSED'&&r.health!=='NEW');
 const codes=[...new Set(active.map(r=>r.server))].sort(compareCodes);
 const servers=codes.map(code=>{
  const own=active.filter(r=>r.server===code).sort((a,b)=>compareCodes(a.code,b.code));
  const by=(t:Row['trend'])=>own.filter(r=>r.trend===t);
  return {server:code,active:own.length,increasing:by('INCREASING').length,flat:by('FLAT').map(brief),decreased:by('DECREASED').map(brief),unknown:by('UNKNOWN').length,
   soon:own.filter(r=>r.threshold==='SOON').length,enough:own.filter(r=>r.threshold==='ENOUGH').length};
 });
 const sum=(f:(s:typeof servers[number])=>number)=>servers.reduce((a,s)=>a+f(s),0);
 return {generatedAt:now.toISOString(),windowStart:windowStart.toISOString(),hours:HOURS,
  totals:{active:sum(s=>s.active),increasing:sum(s=>s.increasing),flat:sum(s=>s.flat.length),decreased:sum(s=>s.decreased.length),unknown:sum(s=>s.unknown),soon:sum(s=>s.soon),enough:sum(s=>s.enough),growth:pulse.growth?.amount??null},
  servers};
}
