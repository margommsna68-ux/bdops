import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {createTeamCashPeriod,settleTeamCashPeriod} from '@/server/business-management/team-cash-profit';
import {teamCashSources} from '@/server/business-management/team-cash-report';
import {undoOperation} from '@/server/operation-history/undo';
const range={start:'2026-10-01',end:'2026-10-31'};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
for(const order of ['settle-first','write-first'])for(const action of ['edit','insert','move-in','move-out','undo'])it(`${action} versus settlement preserves the committed cash report (${order})`,async()=>{
 const f=await teamCashFixture();try{
  const base={key:randomUUID(),date:action==='move-in'?'2026-11-01':'2026-10-31',amount:'25000',currency:'VND',rate:'25000',category:'OTHER',treatment:'CASH_COST' as const};
  const c=await saveUsdtCost(f.scope,base,db),p=await createTeamCashPeriod(f.scope,{...range,key:randomUUID(),partners:[{name:'A',percentage:'100'}]},db),reached=gate(),release=gate();
  const barrier=async()=>{reached.release();await release.promise;};
  const writer=(hold=false)=>action==='undo'?db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:base.key}}}).then(op=>undoOperation(f.scope,op.id,'Undo cost',db,hold?{afterWrite:barrier}:{})):saveUsdtCost(f.scope,{...base,id:action==='insert'?undefined:c.id,expectedRevision:action==='insert'?undefined:0,key:randomUUID(),date:action==='move-out'?'2026-11-01':'2026-10-31',rate:'20000',reason:'Verified change'},db,hold?{afterWrite:barrier}:{});
  const settle=(hold=false)=>settleTeamCashPeriod(f.scope,{id:p.id,expectedRevision:0,key:randomUUID()},db,hold?{afterWrite:barrier}:{});
  const first=order==='settle-first'?settle(true):writer(true);await reached.promise;
  const second=order==='settle-first'?writer():settle();release.release();const results=await Promise.allSettled([first,second]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const closed=await db.profitSplit.findUniqueOrThrow({where:{id:p.id}});if(closed.settled)expect((await teamCashSources(f.scope,range,db)).report.sourceHash).toBe(closed.sourceHash);
 }finally{await f.cleanup();}
});
