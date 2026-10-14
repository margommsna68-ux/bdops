import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveOperatingAccount} from '@/server/business-management/accounts';
import {saveFinance,voidFinance} from '@/server/business-management/finance';
import {businessReport,readFinanceWorkspace} from '@/server/business-management/report';
import {undoOperation} from '@/server/operation-history/undo';
import {listOperations} from '@/server/operation-history/journal';
afterAll(()=>db.$disconnect());
const range={start:'2026-10-01',end:'2026-10-31',currency:'USD' as const};
it('withdrawn minus costs excludes internal transfers, drafts, voided records and other currencies',async()=>{
 const f=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-1',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db),dest=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-2',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'FUND',date:'2026-10-14',currency:'USD',amount:'100.00',paypalId:pp.id,transactionId:'RECEIPT-1',confirmed:true,vmId:f.vm.id,key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'FUND',date:'2026-10-14',currency:'USD',amount:'999.00',paypalId:pp.id,transactionId:'DRAFT-1',confirmed:false,key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'WITHDRAWAL',date:'2026-10-15',currency:'USD',amount:'80.00',paypalId:pp.id,type:'EXCHANGE',paidToTeam:true,key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'WITHDRAWAL',date:'2026-10-15',currency:'USD',amount:'20.00',paypalId:pp.id,destPaypalId:dest.id,type:'MIXING',key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'COST',date:'2026-10-16',currency:'USD',amount:'30.00',serverId:f.server.id,category:'SERVER',key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'COST',date:'2026-10-16',currency:'VND',amount:'1000000',category:'OTHER',key:randomUUID()},db);
  const discarded=await saveFinance(f.scope,{kind:'COST',date:'2026-10-16',currency:'USD',amount:'1.00',category:'OTHER',key:randomUUID()},db);await voidFinance(f.scope,{kind:'COST',id:discarded.id,expectedRevision:0,reason:'Duplicate note',key:randomUUID()},db);
  expect(await businessReport(f.scope,range,db)).toMatchObject({received:'100.00',withdrawn:'80.00',transferred:'20.00',cost:'30.00',net:'50.00',basis:'WITHDRAWN'});
 }finally{await f.cleanup();}
});
it('manager-only financial writes enforce foreign links, exact money, immutable transaction identity and replay',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-1',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db),foreign=await saveOperatingAccount(other.scope,{kind:'PAYPAL',code:'PP-1',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  const input={kind:'FUND' as const,date:'2026-10-14',currency:'USD' as const,amount:'0.10',paypalId:pp.id,transactionId:'TX-1',confirmed:true,key:randomUUID()};
  await expect(saveFinance(f.worker,input,db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(saveFinance(f.scope,{...input,paypalId:foreign.id,key:randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});
  const first=await saveFinance(f.scope,input,db);expect(await saveFinance(f.scope,input,db)).toMatchObject({id:first.id,replay:true});expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(1);
  await expect(saveFinance(f.scope,{...input,amount:'0.20'},db)).rejects.toMatchObject({code:'KEY_PAYLOAD_MISMATCH'});
  await expect(saveFinance(f.scope,{...input,id:first.id,transactionId:'RENAME-TX',expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(saveFinance(f.scope,{...input,transactionId:'TX-2',failed:true,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(readFinanceWorkspace(f.worker,range,db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('Bangkok last day is included, a new day is excluded and write faults are atomic',async()=>{
 const f=await businessFixture();try{
  const input={kind:'COST' as const,date:'2026-10-31',currency:'USD' as const,amount:'0.20',category:'OTHER',key:randomUUID()};
  await expect(saveFinance(f.scope,input,db,{afterWrite:()=>{throw new Error('Injected failure');}})).rejects.toThrow('Injected failure');expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
  await saveFinance(f.scope,input,db);await saveFinance(f.scope,{...input,date:'2026-11-01',amount:'999',key:randomUUID()},db);expect((await businessReport(f.scope,range,db)).cost).toBe('0.20');
  const op=(await listOperations(f.scope,db)).find(o=>o.kind==='BUSINESS_COST'&&!o.undoneById)!;await undoOperation(f.scope,op.id,'Wrong entry',db);expect((await readFinanceWorkspace(f.scope,{start:'2026-11-01',end:'2026-11-30',currency:'USD'},db)).costs).toHaveLength(0);
 }finally{await f.cleanup();}
});
