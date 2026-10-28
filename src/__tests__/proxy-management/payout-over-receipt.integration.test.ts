import {afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {VirtualMachine,EarnAppAccount,PayPalEmail} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {createPayoutRequest,recordPayoutReceipt,pendingByPaypal,readVmOps} from '@/server/vm-ops/payout';
import {readPayoutReport,readPayoutDashboard} from '@/server/vm-ops/payout-report';
import {recreateRule} from '@/server/vm-ops/ops';
import {markEarnAppSuspended} from '@/server/vm-ops/suspend';
import {undoOperation} from '@/server/operation-history/undo';
import {voidFinance} from '@/server/business-management/finance';
import {recordReceipts} from '@/server/business-management/paypal-ledger';

// Owner decision 28/10/2026: "khi nhập paypal là con số chính xác nhất và là cuối cùng, nếu số đó có lớn hơn xí không sao vẫn cho nhập."
// A receipt above what is open is recorded exactly and closes the request as received with the surplus stated (negative shortfall).
// Synthetic data only (example.invalid), test database only.
afterAll(()=>db.$disconnect());
type Row={vm:VirtualMachine;ea:EarnAppAccount;email:PayPalEmail};
async function setup(){
 const f=await businessFixture(),projectId=f.scope.projectId;
 const pp=await db.payPalAccount.create({data:{projectId,code:'PP-over-1',primaryEmail:randomUUID()+'@example.invalid'}});
 const login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid'}});
 const ea=await db.earnAppAccount.create({data:{projectId,loginId:login.id,vmId:f.vm.id}});
 const row:Row={vm:f.vm,ea,email:await db.payPalEmail.create({data:{projectId,paypalId:pp.id,email:randomUUID()+'@example.invalid'}})};
 const req=(id:string)=>db.earnPayoutRequest.findUniqueOrThrow({where:{id}});
 const create=(amount:string)=>createPayoutRequest(f.scope,{key:randomUUID(),vmId:row.vm.id,expectedCycle:1,earnAppId:row.ea.id,paypalEmailId:row.email.id,amount,date:'2026-10-19',submission:'SENT'},db);
 const receipt=async(id:string,amount:string,o:Record<string,unknown>={})=>recordPayoutReceipt(f.scope,{key:randomUUID(),requestId:id,expectedRequestRevision:(await req(id)).revision,amount,currency:'USD',receivedAt:new Date().toISOString(),...o},db);
 const cleanup=async()=>{await db.earnPayoutRequestVoid.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await f.cleanup();};
 return {...f,cleanup,pp,row,req,create,receipt};
}

it('$20.10 on a $20.04 request: recorded exactly, RECEIVED with surplus 0.06, VM waits for recreation, nothing waiting anywhere',async()=>{
 const f=await setup();try{
  const r=await f.create('20.04');
  const out=await f.receipt(r.id,'20.10',{transactionId:'TX-OVER-'+randomUUID().slice(0,8)});
  expect(out).toMatchObject({settled:true,shortfall:'-0.06',amount:'20.10'});
  const row=await f.req(r.id);
  expect(row.state).toBe('REQUESTED');expect(row.settledAt).not.toBeNull();expect(row.settledById).toBe(f.scope.userId);
  expect(row.shortfall?.toFixed(2)).toBe('-0.06');expect(row.settleNote).toBe('Nhận dư $0.06');
  expect((row.history as {kind?:string;what:string}[]).some(h=>h.kind==='SETTLE'&&/dư/.test(h.what))).toBe(true);
  const fund=await db.fundTransaction.findFirstOrThrow({where:{payoutRequestId:r.id}});expect(fund.amount.toFixed(2)).toBe('20.10');
  const board=(await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!;
  expect(board.request?.phase).toBe('RECEIVED');expect(board.milestone).toBe('RECREATE');
  const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.row.vm.id},include:{operation:true}});
  expect((await recreateRule(db,f.scope.projectId,vm)).reason).toBe('PAYOUT_RECEIVED');
  expect((await pendingByPaypal(db,f.scope.projectId)).get(f.pp.id)).toBeUndefined();
  const report=await readPayoutReport(f.scope,{},db);
  expect(report.rows.find(x=>x.id===r.id)).toMatchObject({status:'RECEIVED',remaining:'0.00',received:'20.10',shortfall:'-0.06'});
  const dash=await readPayoutDashboard(f.scope,{},db);if(!dash.available)throw Error('expected available');
  expect(dash.cards.waiting.requests).toBe(0);expect(dash.cards.attention.requests).toBe(0);
 }finally{await f.cleanup();}
});
it('a second part above the rest settles the surplus on the whole request',async()=>{
 const f=await setup();try{
  const r=await f.create('10.00');await f.receipt(r.id,'4.00');
  const out=await f.receipt(r.id,'6.25');expect(out).toMatchObject({settled:true,shortfall:'-0.25'});
  const row=await f.req(r.id);expect(row.settleNote).toBe('Nhận dư $0.25');
  expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!.request?.phase).toBe('RECEIVED');
 }finally{await f.cleanup();}
});
it('duplicates are still refused: same transaction id, same email + day + amount without id',async()=>{
 const f=await setup();try{
  const a=await f.create('5.00'),tx='TX-DUP-'+randomUUID().slice(0,8);
  await f.receipt(a.id,'5.10',{transactionId:tx});
  await expect(f.receipt(a.id,'5.10',{transactionId:tx})).rejects.toThrow(/một lần/);
 }finally{await f.cleanup();}
});
it('late money after SUS above the lost part reopens as RECEIVED with the surplus',async()=>{
 const f=await setup();try{
  const r=await f.create('15.00');await markEarnAppSuspended(f.scope,{key:randomUUID(),vmId:f.row.vm.id,expectedCycle:1},db);
  expect((await f.req(r.id)).state).toBe('LOST_SUS');
  const out=await f.receipt(r.id,'15.05');expect(out).toMatchObject({settled:true,shortfall:'-0.05'});
  const row=await f.req(r.id);expect(row).toMatchObject({state:'REQUESTED',lostAmount:null,settleNote:'Nhận dư $0.05'});
  expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!.request?.phase).toBe('RECEIVED');
 }finally{await f.cleanup();}
});
// Review 29/10/2026: a surplus up to max($1.00, 5% of the request) is accepted silently; above that it needs acceptSurplus:true.
it('surplus threshold: $104.99 on $100 accepted; $105.01 refused SURPLUS_CONFIRM until acceptSurplus; $1.00 on $5 accepted, $1.01 not',async()=>{
 const one=async(asked:string,got:string,o:Record<string,unknown>={})=>{const f=await setup();try{const r=await f.create(asked);
   try{return await f.receipt(r.id,got,o);}catch(e){expect(await db.fundTransaction.count({where:{payoutRequestId:r.id}})).toBe(0);throw e;}}finally{await f.cleanup();}};
 await expect(one('100.00','105.01')).rejects.toMatchObject({reason:'SURPLUS_CONFIRM'});
 expect(await one('100.00','105.01',{acceptSurplus:true})).toMatchObject({settled:true,shortfall:'-5.01'});
 expect(await one('100.00','104.99')).toMatchObject({settled:true,shortfall:'-4.99'});
 expect(await one('5.00','6.00')).toMatchObject({settled:true,shortfall:'-1.00'});
 await expect(one('5.00','6.01')).rejects.toMatchObject({reason:'SURPLUS_CONFIRM'});
});
it('settle note of a fee uses the US format with $: "Phí / thiếu $1.50"',async()=>{
 const f=await setup();try{
  const r=await f.create('10.00');await f.receipt(r.id,'8.50',{settleRemainder:true});
  expect((await f.req(r.id)).settleNote).toBe('Phí / thiếu $1.50');
 }finally{await f.cleanup();}
});
it('undo of an over-receipt voids the receipt and restores the request unsettled and waiting',async()=>{
 const f=await setup();try{
  const r=await f.create('20.04'),key=randomUUID();
  await recordPayoutReceipt(f.scope,{key,requestId:r.id,expectedRequestRevision:(await f.req(r.id)).revision,amount:'20.10',currency:'USD',receivedAt:new Date().toISOString()},db);
  const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:key}}});
  await undoOperation(f.scope,op.id,'Ghi nhầm',db);
  const row=await f.req(r.id);expect(row).toMatchObject({settledAt:null,settledById:null,settleNote:null,shortfall:null});
  expect((await db.fundTransaction.findFirstOrThrow({where:{payoutRequestId:r.id}})).voidedAt).not.toBeNull();
  expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!.request?.phase).toBe('WAITING');
 }finally{await f.cleanup();}
});
it('voiding the receipt of a surplus settle clears the settle (shortfall, note, who / when): the request waits again',async()=>{
 const f=await setup();try{
  const r=await f.create('20.04');await f.receipt(r.id,'20.10');
  const fund=await db.fundTransaction.findFirstOrThrow({where:{payoutRequestId:r.id}});
  await voidFinance(f.scope,{kind:'FUND',id:fund.id,expectedRevision:fund.revision,reason:'ghi nhầm',key:randomUUID()},db);
  const row=await f.req(r.id);expect(row).toMatchObject({settledAt:null,settledById:null,settleNote:null,shortfall:null});
  expect((row.history as {what:string}[]).some(h=>/Bỏ chốt nhận dư/.test(h.what))).toBe(true);
  expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!.request?.phase).toBe('WAITING');
 }finally{await f.cleanup();}
});
it('Tiền vào PayPal (Kho tài khoản) receipt linked by email: a small surplus settles the request as received; a large one stays REVIEW',async()=>{
 const f=await setup();try{
  const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10);
  const r=await f.create('10.00');
  await recordReceipts(f.scope,{paypalId:f.pp.id,date:today,currency:'USD',status:'RECEIVED',text:f.row.email.email+' | 10.40 | TX-L-'+randomUUID().slice(0,8),key:randomUUID()},db);
  const row=await f.req(r.id);expect(row.shortfall?.toFixed(2)).toBe('-0.40');expect(row.settleNote).toBe('Nhận dư $0.40');expect(row.settledAt).not.toBeNull();
  expect((row.history as {kind?:string}[]).some(h=>h.kind==='SETTLE')).toBe(true);
  expect((await readVmOps(f.scope,db)).vms.find(v=>v.vmId===f.row.vm.id)!.request?.phase).toBe('RECEIVED');
 }finally{await f.cleanup();}
 const g=await setup();try{
  const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10);
  const r=await g.create('10.00');
  await recordReceipts(g.scope,{paypalId:g.pp.id,date:today,currency:'USD',status:'RECEIVED',text:g.row.email.email+' | 12.00 | TX-L-'+randomUUID().slice(0,8),key:randomUUID()},db);
  const row=await g.req(r.id);expect(row.settledAt).toBeNull();expect(row.shortfall).toBeNull();
  expect((await readVmOps(g.scope,db)).vms.find(v=>v.vmId===g.row.vm.id)!.request?.phase).toBe('REVIEW');
 }finally{await g.cleanup();}
});
