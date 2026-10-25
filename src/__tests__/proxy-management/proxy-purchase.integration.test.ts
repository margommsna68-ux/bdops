import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {createProxyBatchService} from '@/server/proxy-management/batches';
import {persistSourceSnapshot} from '@/server/proxy-management/sources';
import {inspectOperation,listOperations,openSnapshot} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {dayDate} from '@/server/business-management/money';
import {freeTestNet,testClient} from './db-fixture';
import type {ActorScope,BatchInput} from '@/server/proxy-management/types';
const db=testClient();afterAll(()=>db.$disconnect());
async function fixture(){
 const projectId=randomUUID(),userId=randomUUID(),net=await freeTestNet(db,'203.8.');
 await db.project.create({data:{id:projectId,code:projectId,name:'Proxy purchase fixture',settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
 await db.user.create({data:{id:userId,email:userId+'@fixture.invalid'}});
 await db.projectMember.create({data:{projectId,userId,role:'MODERATOR',allowedModules:['INFRASTRUCTURE','COSTS'],capabilities:['PROXY_IMPORT']}});
 const account=await db.proxyProviderAccount.create({data:{projectId,code:'fixture',label:'Fixture',credentialCipher:encrypt(JSON.stringify({username:'u',password:'secret'})),nextDueDate:new Date('2026-11-15T00:00:00Z')}});
 const scope:ActorScope={projectId,userId,role:'MODERATOR',capabilities:['PROXY_IMPORT'],allowedModules:['INFRASTRUCTURE','COSTS']};let fail=false;
 const service=createProxyBatchService(db,{refreshSource:async()=>persistSourceSnapshot(projectId,{id:randomUUID(),sourceKey:'GENJY',hash:'purchase-fixture',fetchedAt:new Date().toISOString(),scanSucceeded:true,evidence:[]},db),afterPurchase:async()=>{if(fail)throw new Error('after cost rollback');}});
 const input=(n=1):BatchInput=>({kind:'NEW',text:net+n+':80:u:secret',idempotencyKey:randomUUID(),purchase:{purchasedAt:'2026-10-25',priceMode:'UNIT',amount:'25000',currency:'VND',rate:'25000'}});
 const cleanup=async()=>{const ids=(await db.proxyIP.findMany({where:{projectId},select:{identityId:true}})).flatMap(e=>e.identityId?[e.identityId]:[]);await db.operationJournal.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxyReplacement.deleteMany({where:{projectId}});await db.proxyIP.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxySourceReference.deleteMany({where:{snapshot:{projectId}}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});await db.costRecord.deleteMany({where:{projectId}});await db.profitSplit.deleteMany({where:{projectId}});await db.proxyProviderAccount.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.auditLog.deleteMany({where:{projectId}});await db.projectMember.deleteMany({where:{projectId}});await db.project.delete({where:{id:projectId}});await db.user.delete({where:{id:userId}});};
 return {scope,account,net,service,input,cleanup,setFail:(v:boolean)=>{fail=v;}};
}
it('NEW unit purchase commits one proxy batch/cost with provider link, stable code and no renewal change; retries never charge twice',async()=>{
 const f=await fixture();try{
  const input=f.input();input.text+='\n'+f.net+'2:80:u:secret\n'+f.net+'2:80:u:secret\nbad';
  const preview=await f.service.preview(f.scope,input);expect(preview).toMatchObject({ready:2,errors:2,purchase:{quantity:2,automaticQuantity:2,total:'50000.00000000',usdt:'2.000000'}});
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
  const result=await f.service.commit(f.scope,preview.token,input.idempotencyKey);expect(result.applied).toBe(2);expect(result.costId).toEqual(expect.any(String));
  const cost=await db.costRecord.findUniqueOrThrow({where:{id:result.costId}});expect(cost).toMatchObject({code:'CP-PROXY-'+result.batchId,category:'IP_PROXY',currency:'VND',proxyAccountId:f.account.id,businessManaged:true,profitTreatment:'CASH_COST'});expect(cost.total.toString()).toBe('50000');expect(cost.usdtAmount?.toString()).toBe('2');
  const replay=await f.service.commit(f.scope,preview.token,input.idempotencyKey);expect(replay).toMatchObject({replay:true,costId:cost.id});expect((await f.service.preview(f.scope,input)).purchase?.total).toBe('50000.00000000');expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(1);
  expect((await db.proxyProviderAccount.findUniqueOrThrow({where:{id:f.account.id}})).nextDueDate).toEqual(f.account.nextDueDate);
  await expect(f.service.preview(f.scope,{...input,purchase:{...input.purchase!,quantity:3}})).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
 }finally{await f.cleanup();}
});
it('an injected failure after cost/journal creation rolls back proxies, cost, events and batch status together',async()=>{
 const f=await fixture();try{const input=f.input(),preview=await f.service.preview(f.scope,input);f.setFail(true);
  await expect(f.service.commit(f.scope,preview.token,input.idempotencyKey)).rejects.toThrow('after cost rollback');
  for(const count of [await db.proxyIP.count({where:{projectId:f.scope.projectId}}),await db.proxyStatusEvent.count({where:{projectId:f.scope.projectId}}),await db.costRecord.count({where:{projectId:f.scope.projectId}}),await db.operationJournal.count({where:{projectId:f.scope.projectId}})])expect(count).toBe(0);
  expect((await db.proxyBatch.findUniqueOrThrow({where:{token:preview.token}})).status).toBe('PREVIEW');f.setFail(false);await f.service.commit(f.scope,preview.token,input.idempotencyKey);expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(1);
 }finally{await f.cleanup();}
});
it('partial import retains actual purchase quantity and mixed packages do not invent a provider link',async()=>{
 const f=await fixture();try{const existing={...f.input(1),purchase:undefined};const old=await f.service.preview(f.scope,existing);await f.service.commit(f.scope,old.token,existing.idempotencyKey);
  const input=f.input(1);input.text+='\n'+f.net+'2:80:u:secret\n'+f.net+'3:80:other:pass';
  const autoPreview=await f.service.preview(f.scope,input);expect(autoPreview.purchase).toMatchObject({automaticQuantity:2,quantity:2,quantitySource:'AUTO',importableQuantity:2,total:'50000.00000000'});
  input.idempotencyKey=randomUUID();input.purchase={...input.purchase!,quantity:10};const preview=await f.service.preview(f.scope,input);
  expect(preview.purchase).toMatchObject({automaticQuantity:2,quantity:10,quantitySource:'ACTUAL',importableQuantity:2,total:'250000.00000000'});const result=await f.service.commit(f.scope,preview.token,input.idempotencyKey);const cost=await db.costRecord.findUniqueOrThrow({where:{id:result.costId}});expect(result.applied).toBe(2);expect(cost.amount.toString()).toBe('250000');expect(cost.proxyAccountId).toBeNull();
 }finally{await f.cleanup();}
});
it('money permissions guard preview, commit and APPLIED replay; proxy history never exposes COST data without COSTS',async()=>{
 const f=await fixture();try{const input=f.input(),preview=await f.service.preview(f.scope,input);const result=await f.service.commit(f.scope,preview.token,input.idempotencyKey);
  const proxyJournal=await db.operationJournal.findUniqueOrThrow({where:{batchId:result.batchId}}),costJournal=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,accessModule:'COSTS'}});
  expect(proxyJournal.reversible).toBe(false);expect(openSnapshot(proxyJournal.snapshotCipher)).toMatchObject({version:4});expect(openSnapshot(proxyJournal.snapshotCipher).resources.some(r=>r.resource==='COST')).toBe(false);expect(openSnapshot(costJournal.snapshotCipher).resources[0].resource).toBe('COST');expect(openSnapshot(costJournal.snapshotCipher).version).toBe(4);
  await db.projectMember.update({where:{userId_projectId:{projectId:f.scope.projectId,userId:f.scope.userId}},data:{allowedModules:['INFRASTRUCTURE']}});
  await expect(f.service.preview(f.scope,input)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.service.commit(f.scope,preview.token,input.idempotencyKey)).rejects.toMatchObject({code:'FORBIDDEN'});
  const history=await listOperations(f.scope,db);expect(history.some(r=>r.id===costJournal.id)).toBe(false);const detail=await inspectOperation(f.scope,proxyJournal.id,db);expect(JSON.stringify(detail)).not.toMatch(/25000|usdtAmount|amount|Chi phí/);await expect(inspectOperation(f.scope,costJournal.id,db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.projectMember.update({where:{userId_projectId:{projectId:f.scope.projectId,userId:f.scope.userId}},data:{role:'ADMIN'}});await expect(undoOperation(f.scope,proxyJournal.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT'});expect((await db.costRecord.findUniqueOrThrow({where:{id:result.costId}})).voidedAt).toBeNull();
 }finally{await f.cleanup();}
});
it('commit rechecks cost permissions and profit-period locks after preview before any write',async()=>{
 const f=await fixture();try{const input=f.input(),preview=await f.service.preview(f.scope,input);
  await db.projectMember.update({where:{userId_projectId:{projectId:f.scope.projectId,userId:f.scope.userId}},data:{allowedModules:['INFRASTRUCTURE']}});await expect(f.service.commit(f.scope,preview.token,input.idempotencyKey)).rejects.toMatchObject({code:'FORBIDDEN'});expect(await db.proxyIP.count({where:{projectId:f.scope.projectId}})).toBe(0);
  await db.projectMember.update({where:{userId_projectId:{projectId:f.scope.projectId,userId:f.scope.userId}},data:{allowedModules:['INFRASTRUCTURE','COSTS']}});
  await db.profitSplit.create({data:{projectId:f.scope.projectId,periodStart:dayDate('2026-10-01'),periodEnd:dayDate('2026-10-31'),settled:true,businessManaged:true,basis:'TEAM_RECEIVED',currency:'USDT',totalWithdrawal:0,totalCost:0,netProfit:0}});
  await expect(f.service.commit(f.scope,preview.token,input.idempotencyKey)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);expect(await db.proxyIP.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});
it.each([{currency:'USDT' as const,amount:'2',rate:undefined,total:'2',usdt:'2'},{currency:'PPUSD' as const,amount:'3',rate:undefined,paypalVndRate:'25000',vndUsdtRate:'26000',total:'3',usdt:'2.884615'}])('records $currency using the same USDT normalization as normal costs',async money=>{
 const f=await fixture();try{const input=f.input();input.purchase={...input.purchase!,currency:money.currency,amount:money.amount,rate:money.rate,...('paypalVndRate' in money?{paypalVndRate:money.paypalVndRate,vndUsdtRate:money.vndUsdtRate}:{})};const preview=await f.service.preview(f.scope,input),result=await f.service.commit(f.scope,preview.token,input.idempotencyKey);const cost=await db.costRecord.findUniqueOrThrow({where:{id:result.costId}});expect(cost.total.toString()).toBe(money.total);expect(cost.usdtAmount?.toString()).toBe(money.usdt);if(money.currency==='PPUSD')expect(cost.fxNote).toContain('PAYPAL_VND');
 }finally{await f.cleanup();}
});
