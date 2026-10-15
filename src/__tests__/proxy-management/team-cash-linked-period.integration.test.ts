import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveUsdtCost,voidUsdtCost} from '@/server/business-management/usdt-costs';
import {saveTeamReceipt,voidTeamReceipt} from '@/server/business-management/team-receipts';
import {createTeamCashPeriod,settleTeamCashPeriod} from '@/server/business-management/team-cash-profit';
import {teamCashSources} from '@/server/business-management/team-cash-report';
import {readBusinessImage,restoreBusinessImage} from '@/server/business-management/operation-images';
const range={start:'2026-09-01',end:'2026-09-30'};
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}
for(const kind of ['TEAM_PAYMENT','BILL','OTHER'] as const)it(`protects a settled historical ${kind} source from an October void or undo`,async()=>{
 const f=await teamCashFixture();try{
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,date:new Date('2026-09-15'),type:kind,amount:'10',referenceId:randomUUID()}});
  const child=kind==='TEAM_PAYMENT'?await saveTeamReceipt(f.scope,{key:randomUUID(),receivedDate:'2026-10-15',status:'CONFIRMED',amountUsdt:'9',referenceId:randomUUID(),collectorId:f.scope.userId,sourceCollectorExpenseId:source.id},db):await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',category:'OTHER',amount:'10',currency:'USD',rate:'1.1',treatment:'CASH_COST',sourceCollectorExpenseId:source.id},db);
  const p=await createTeamCashPeriod(f.scope,{...range,key:randomUUID(),partners:[{name:'A',percentage:'100'}]},db);
  await settleTeamCashPeriod(f.scope,{id:p.id,expectedRevision:0,key:randomUUID()},db);
  const change={id:child.id,expectedRevision:0,key:randomUUID(),reason:'October correction'},resource=kind==='TEAM_PAYMENT'?'TEAM_RECEIPT':'COST';
  await expect(kind==='TEAM_PAYMENT'?voidTeamReceipt(f.scope,change,db):voidUsdtCost(f.scope,change,db)).rejects.toThrow('Kỳ lợi nhuận đã chốt');
  const image=(await readBusinessImage(db,f.scope.projectId,resource,child.id))!;
  await expect(db.$transaction(tx=>restoreBusinessImage(tx,f.scope.projectId,{resource,id:child.id,before:null,after:image}))).rejects.toThrow('Kỳ lợi nhuận đã chốt');
  expect((await teamCashSources(f.scope,range,db)).report.sourceHash).toBe((await db.profitSplit.findUniqueOrThrow({where:{id:p.id}})).sourceHash);
 }finally{await f.cleanup();}
});
for(const kind of ['TEAM_PAYMENT','BILL','OTHER'] as const)for(const order of ['settle-first','void-first'])it(`${kind} cross-month void versus source settlement keeps the closed report (${order})`,async()=>{
 const f=await teamCashFixture();try{
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,date:new Date('2026-09-15'),type:kind,amount:'10',referenceId:randomUUID()}});
  const child=kind==='TEAM_PAYMENT'?await saveTeamReceipt(f.scope,{key:randomUUID(),receivedDate:'2026-10-15',status:'CONFIRMED',amountUsdt:'9',referenceId:randomUUID(),collectorId:f.scope.userId,sourceCollectorExpenseId:source.id},db):await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',category:'OTHER',amount:'10',currency:'USD',rate:'1.1',treatment:'CASH_COST',sourceCollectorExpenseId:source.id},db);
  const p=await createTeamCashPeriod(f.scope,{...range,key:randomUUID(),partners:[{name:'A',percentage:'100'}]},db),reached=gate(),release=gate();
  const barrier=async()=>{reached.release();await release.promise;},writer=(hold=false)=>{const input={id:child.id,expectedRevision:0,key:randomUUID(),reason:'Correction'},deps=hold?{afterWrite:barrier}:{};return kind==='TEAM_PAYMENT'?voidTeamReceipt(f.scope,input,db,deps):voidUsdtCost(f.scope,input,db,deps);},settle=(hold=false)=>settleTeamCashPeriod(f.scope,{id:p.id,expectedRevision:0,key:randomUUID()},db,hold?{afterWrite:barrier}:{});
  const first=order==='settle-first'?settle(true):writer(true);await reached.promise;
  const second=order==='settle-first'?writer():settle();
  release.release();const results=await Promise.allSettled([first,second]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const closed=await db.profitSplit.findUniqueOrThrow({where:{id:p.id}});if(closed.settled)expect((await teamCashSources(f.scope,range,db)).report.sourceHash).toBe(closed.sourceHash);
 }finally{await f.cleanup();}
});
