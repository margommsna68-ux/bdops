import {it,expect} from 'vitest';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {reviewCollectorSources} from '@/server/business-management/collector-reconciliation';
it('old USD payments stay unverified; bills require classification and commission is separate',async()=>{
 const f=await teamCashFixture();try{
  for(const type of ['TEAM_PAYMENT','TEAM_PAYMENT','TEAM_PAYMENT','TEAM_PAYMENT','BILL','OTHER','COMMISSION_WITHDRAW'])await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,date:new Date('2026-10-15T01:00:00Z'),type,amount:'110',referenceId:'legacy'}});
  const preview=await reviewCollectorSources(f.scope,{start:'2026-10-01',end:'2026-10-31'},db);
  expect(preview.filter(x=>x.kind==='TEAM_PAYMENT')).toHaveLength(4);expect(preview.every(x=>x.amountUsdt===null)).toBe(true);expect(preview.some(x=>x.kind==='COMMISSION_WITHDRAW')).toBe(false);expect(await db.teamReceipt.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});
