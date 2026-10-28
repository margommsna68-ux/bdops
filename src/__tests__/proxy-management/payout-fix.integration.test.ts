import {afterAll,afterEach,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {VirtualMachine,EarnAppAccount,PayPalEmail,PayPalAccount} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {createPayoutRequest,updatePayoutRequest,recordPayoutReceipt,readVmOpsHistory} from '@/server/vm-ops/payout';
import {editPayoutRequest,unsendPayoutRequest,voidPayoutRequest} from '@/server/vm-ops/payout-fix';
import {moneyOfRequest} from '@/server/vm-ops/ops';
import {applyLinks} from '@/server/account-store/links';
import {undoOperation} from '@/server/operation-history/undo';

// Payout simplification, Task 3 (owner 28/10/2026): edit, unsend ("Bỏ Đã rút") and void ("Xoá ghi nhầm") of a mistaken payout request.
afterAll(()=>db.$disconnect());afterEach(()=>vi.useRealTimers());
const clock=(at:string)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at));};
type Row={vm:VirtualMachine;ea:EarnAppAccount;email:PayPalEmail};
async function setup(n=3){
 const f=await businessFixture(),projectId=f.scope.projectId;
 const pp=await db.payPalAccount.create({data:{projectId,code:'PP-fix-1',primaryEmail:randomUUID()+'@example.invalid'}});
 const pp2=await db.payPalAccount.create({data:{projectId,code:'PP-fix-2',primaryEmail:randomUUID()+'@example.invalid'}});
 const mail=(p:PayPalAccount)=>db.payPalEmail.create({data:{projectId,paypalId:p.id,email:randomUUID()+'@example.invalid'}});
 const rows:Row[]=[];for(let i=0;i<n;i++){
  const vm=i?await db.virtualMachine.create({data:{serverId:f.server.id,code:`VM_F${i}`,managed:true,proxySlotState:'BLANK'}}):f.vm;
  const login=await db.gmailAccount.create({data:{projectId,email:randomUUID()+'@example.invalid'}});
  const ea=await db.earnAppAccount.create({data:{projectId,loginId:login.id,vmId:vm.id}});
  rows.push({vm,ea,email:await mail(pp)});
 }
 const free=await mail(pp),other=[await mail(pp2),await mail(pp2),await mail(pp2)];
 const prep=(i:number,emailId=rows[i].email.id,extra:Record<string,unknown>={})=>createPayoutRequest(f.scope,{key:randomUUID(),vmId:rows[i].vm.id,expectedCycle:1,earnAppId:rows[i].ea.id,paypalEmailId:emailId,amount:'10',date:'2026-10-19',submission:'PREPARING',...extra},db);
 const req=(id:string)=>db.earnPayoutRequest.findUniqueOrThrow({where:{id}});
 const sent=async(id:string)=>updatePayoutRequest(f.scope,{key:randomUUID(),requestId:id,expectedRevision:(await req(id)).revision,action:'SENT'},db);
 const ident=async(id:string)=>{const r=await req(id);return {requestId:id,expectedRevision:r.revision,vmId:r.vmId,expectedCycle:r.cycle,earnAppId:r.earnAppId};};
 const edit=async(id:string,patch:{paypalEmailId?:string;amount?:string;requestedAt?:string;reference?:string|null;note?:string|null},key=randomUUID(),scope=f.scope)=>editPayoutRequest(scope,{key,...await ident(id),...patch},db);
 const unsend=async(id:string,note?:string,key=randomUUID())=>unsendPayoutRequest(f.scope,{key,...await ident(id),note},db);
 const voidIt=async(id:string,reason='Ghi nhầm',key=randomUUID())=>voidPayoutRequest(f.scope,{key,...await ident(id),reason},db);
 const receipt=async(id:string,amount:string)=>recordPayoutReceipt(f.scope,{key:randomUUID(),requestId:id,expectedRequestRevision:(await req(id)).revision,amount,currency:'USD',receivedAt:new Date().toISOString()},db);
 const email=(id:string)=>db.payPalEmail.findUniqueOrThrow({where:{id}});
 const earnApp=(id:string)=>db.earnAppAccount.findUniqueOrThrow({where:{id}});
 const markers=(emailId:string)=>db.payPalPayoutDayEmail.findMany({where:{projectId,paypalEmailId:emailId}});
 const journal=(key:string)=>db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId,commandKey:key}}});
 const cleanup=async()=>{await db.earnPayoutRequestVoid.deleteMany({where:{projectId}});await f.cleanup();};
 return {...f,cleanup,pp,pp2,rows,free,other,prep,req,sent,edit,unsend,voidIt,receipt,email,earnApp,markers,journal};
}
const lastKind=(history:unknown)=>(history as {kind?:string}[]).at(-1)?.kind;

it('edit swaps the email of a SENT request with no money',async()=>{
 const f=await setup();try{const a=f.rows[0].email,b=f.free,ea=f.rows[0].ea;
 const r=await f.prep(0);await f.sent(r.id);
 expect((await f.email(a.id)).usedEarnAppId).toBe(ea.id);expect(await f.markers(a.id)).toHaveLength(1);
 expect(await db.earnAppPayout.count({where:{earnAppId:ea.id,paypalEmailId:a.id}})).toBe(1);
 const out=await f.edit(r.id,{paypalEmailId:b.id,note:'ghi nhầm'});
 expect(out).toMatchObject({id:r.id,changed:true});
 const A=await f.email(a.id),B=await f.email(b.id);
 expect(A).toMatchObject({holdEarnAppId:null,usedEarnAppId:null,usedAt:null});expect(await f.markers(a.id)).toHaveLength(0);
 expect(B.usedEarnAppId).toBe(ea.id);expect(B.holdEarnAppId).toBeNull();expect((await f.earnApp(ea.id)).paypalEmailId).toBe(b.id);
 expect(await db.earnAppPayout.count({where:{earnAppId:ea.id,paypalEmailId:a.id}})).toBe(0);
 expect(await db.earnAppPayout.count({where:{earnAppId:ea.id,paypalEmailId:b.id,endedAt:null}})).toBe(1);
 const after=await f.req(r.id);expect(after).toMatchObject({paypalEmailId:b.id,paypalId:f.pp.id,submission:'SENT',revision:out.revision});
 expect(lastKind(after.history)).toBe('EDIT');expect((await f.markers(b.id)).map(m=>m.requestId)).toEqual([r.id]);
 }finally{await f.cleanup();}
});
it('edit refuses when the old email received money (even a voided receipt)',async()=>{
 const f=await setup();try{const a=f.rows[0].email;
 const r=await f.prep(0);await f.sent(r.id);const rc=await f.receipt(r.id,'5');
 await db.fundTransaction.update({where:{id:rc.receiptId as string},data:{voidedAt:new Date()}});
 await expect(f.edit(r.id,{paypalEmailId:f.free.id,note:'ghi nhầm'})).rejects.toMatchObject({reason:'EMAIL_HAS_MONEY'});
 expect((await f.email(a.id)).usedEarnAppId).toBe(f.rows[0].ea.id);expect((await f.req(r.id)).paypalEmailId).toBe(a.id);
 expect((await f.email(f.free.id)).holdEarnAppId).toBeNull();
 }finally{await f.cleanup();}
});
it('edit to an email held by someone else is refused',async()=>{
 const f=await setup();try{const a=f.rows[0].email,b=f.rows[1].email;
 const r=await f.prep(0);await f.prep(1);
 await expect(f.edit(r.id,{paypalEmailId:b.id})).rejects.toMatchObject({code:'INVALID_INPUT'});
 expect((await f.email(a.id)).holdEarnAppId).toBe(f.rows[0].ea.id);expect((await f.email(b.id)).holdEarnAppId).toBe(f.rows[1].ea.id);
 expect((await f.req(r.id)).paypalEmailId).toBe(a.id);
 }finally{await f.cleanup();}
});
it('two edits racing for the last free email: exactly one wins',async()=>{
 const f=await setup();try{const c=f.other[0];
 const r0=await f.prep(0),r1=await f.prep(1);
 const out=await Promise.allSettled([f.edit(r0.id,{paypalEmailId:c.id}),f.edit(r1.id,{paypalEmailId:c.id})]);
 expect(out.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(out.filter(x=>x.status==='rejected')).toHaveLength(1);
 const winner=out[0].status==='fulfilled'?0:1,loser=1-winner,ids=[r0.id,r1.id];
 expect((await f.email(c.id)).holdEarnAppId).toBe(f.rows[winner].ea.id);
 expect((await f.req(ids[winner])).paypalEmailId).toBe(c.id);
 expect((await f.req(ids[loser])).paypalEmailId).toBe(f.rows[loser].email.id);expect((await f.email(f.rows[loser].email.id)).holdEarnAppId).toBe(f.rows[loser].ea.id);
 expect((await f.email(f.rows[winner].email.id)).holdEarnAppId).toBeNull();
 }finally{await f.cleanup();}
});
it("edit respects the daily limit of the new email's PayPal",async()=>{
 const f=await setup(4);try{
 const r=await f.prep(0);await f.prep(1);await f.prep(2,f.other[0].id);await f.prep(3,f.other[1].id);
 await expect(f.edit(r.id,{paypalEmailId:f.other[2].id})).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 expect((await f.email(f.rows[0].email.id)).holdEarnAppId).toBe(f.rows[0].ea.id);expect((await f.email(f.other[2].id)).holdEarnAppId).toBeNull();
 // Same full PayPal (2/2): the request's own old email frees its slot, so moving inside it is allowed.
 await f.edit(r.id,{paypalEmailId:f.free.id});expect((await f.email(f.free.id)).holdEarnAppId).toBe(f.rows[0].ea.id);
 }finally{await f.cleanup();}
});
it('edit SENT without note is refused; edit amount only on PREPARING needs no note',async()=>{
 const f=await setup();try{const r=await f.prep(0);
 const a=await f.edit(r.id,{amount:'12'});expect(a.changed).toBe(true);
 let row=await f.req(r.id);expect(row.amount.toFixed(2)).toBe('12.00');expect(lastKind(row.history)).toBe('EDIT');
 expect(await f.edit(r.id,{amount:'12.00'})).toMatchObject({changed:false,revision:row.revision});
 await f.sent(r.id);
 await expect(f.edit(r.id,{amount:'11'})).rejects.toMatchObject({code:'INVALID_INPUT'});
 await expect(f.edit(r.id,{paypalEmailId:f.free.id})).rejects.toMatchObject({code:'INVALID_INPUT'});
 await f.edit(r.id,{amount:'11',reference:'EA-1',note:'Gõ nhầm số'});row=await f.req(r.id);
 expect(row.amount.toFixed(2)).toBe('11.00');expect(row.reference).toBe('EA-1');
 expect((row.history as {what:string}[]).at(-1)!.what).toContain('12.00 → 11.00');
 // Narrow rights: a member without the money / payout rights cannot edit.
 await expect(f.edit(r.id,{amount:'10',note:'x'},randomUUID(),f.worker)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('edit frees an email pre-linked through PayPal nhận when it has no money',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea,vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.rows[0].vm.id}});
 const linked=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,paypalEmail:a.id}]},db);expect(linked.applied).toBe(1);
 expect((await f.earnApp(ea.id)).paypalEmailId).toBe(a.id);expect((await f.email(a.id)).usedEarnAppId).toBe(ea.id);
 const r=await f.prep(0);expect((await f.email(a.id)).holdEarnAppId).toBeNull();await f.sent(r.id);
 await f.edit(r.id,{paypalEmailId:f.free.id,note:'Email gán nhầm'});
 const A=await f.email(a.id);expect(A).toMatchObject({usedEarnAppId:null,holdEarnAppId:null});
 expect(await db.earnAppAccount.count({where:{paypalEmailId:a.id}})).toBe(0);expect(await db.earnAppPayout.count({where:{paypalEmailId:a.id}})).toBe(0);
 expect((await f.earnApp(ea.id)).paypalEmailId).toBe(f.free.id);
 // Back in stock: another VM can now prepare a payout with it.
 await f.prep(1,a.id);expect((await f.email(a.id)).holdEarnAppId).toBe(f.rows[1].ea.id);
 }finally{await f.cleanup();}
});
it('after a partial receipt only the amount can be edited (with note); email edit is refused',async()=>{
 const f=await setup();try{const r=await f.prep(0);await f.sent(r.id);await f.receipt(r.id,'6');
 await expect(f.edit(r.id,{paypalEmailId:f.free.id,note:'x'})).rejects.toMatchObject({reason:'EMAIL_HAS_MONEY'});
 await expect(f.edit(r.id,{amount:'9'})).rejects.toMatchObject({code:'INVALID_INPUT'});
 await f.edit(r.id,{amount:'9',note:'Rút thực tế 9'});
 const row=await f.req(r.id);expect(row.amount.toFixed(2)).toBe('9.00');expect(row.paypalEmailId).toBe(f.rows[0].email.id);
 // The date cannot move after money that already arrived.
 await expect(f.edit(r.id,{requestedAt:'2099-01-01',note:'x'})).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();}
});
it('editing the email of a SENT request counts the new email on the submittedAt day, not today',async()=>{
 clock('2026-10-19T05:00:00Z');const f=await setup();try{
 const r=await f.prep(0);await f.sent(r.id);const submittedAt=(await f.req(r.id)).submittedAt!.toISOString();
 vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
 await f.edit(r.id,{paypalEmailId:f.free.id,requestedAt:'2026-10-20',note:'ghi nhầm'});
 expect((await f.markers(f.free.id)).map(m=>m.day)).toEqual(['2026-10-19']);expect(await f.markers(f.rows[0].email.id)).toHaveLength(0);
 const row=await f.req(r.id);expect(row.submittedAt!.toISOString()).toBe(submittedAt);
 expect(new Date(row.requestedAt.getTime()+7*3600e3).toISOString().slice(0,10)).toBe('2026-10-20');
 }finally{await f.cleanup();}
});
it('a past submittedAt day counts that day\'s sends, not today\'s holds',async()=>{
 clock('2026-10-19T05:00:00Z');const f=await setup(5);try{
 const r=await f.prep(0);await f.sent(r.id);
 const s1=await f.prep(1,f.other[0].id);await f.sent(s1.id);
 vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
 // Today PP-fix-2 is full with holds; on the 19th it had one email: the edit is allowed and lands on the 19th.
 const extra=await db.payPalEmail.create({data:{projectId:f.scope.projectId,paypalId:f.pp2.id,email:randomUUID()+'@example.invalid'}});
 await f.prep(2,f.other[1].id);await f.prep(3,extra.id);
 await f.edit(r.id,{paypalEmailId:f.other[2].id,note:'ghi nhầm'});
 expect((await f.markers(f.other[2].id)).map(m=>m.day)).toEqual(['2026-10-19']);
 // On the 19th PP-fix-2 now has two sent emails: a third is refused for that day.
 vi.setSystemTime(new Date('2026-10-19T06:00:00Z'));const s4=await f.prep(4);await f.sent(s4.id);
 vi.setSystemTime(new Date('2026-10-21T05:00:00Z'));
 const spare=await db.payPalEmail.create({data:{projectId:f.scope.projectId,paypalId:f.pp2.id,email:randomUUID()+'@example.invalid'}});
 await expect(f.edit(s4.id,{paypalEmailId:spare.id,note:'ghi nhầm'})).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 }finally{await f.cleanup();}
});
it('edit of an unconfirmed send keeps the new email held on the day of the uncertain click; SENT later binds it',async()=>{
 clock('2026-10-19T05:00:00Z');const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0);await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:(await f.req(r.id)).revision,action:'UNKNOWN'},db);
 vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));
 await f.edit(r.id,{paypalEmailId:f.free.id,note:'Rút bằng email khác'});
 expect(await f.email(a.id)).toMatchObject({holdEarnAppId:null,usedEarnAppId:null});expect(await f.markers(a.id)).toHaveLength(0);
 expect(await f.email(f.free.id)).toMatchObject({holdEarnAppId:ea.id,usedEarnAppId:null});
 expect((await f.markers(f.free.id)).map(m=>m.day)).toEqual(['2026-10-19']);
 expect((await f.req(r.id)).submission).toBe('UNKNOWN');
 await f.sent(r.id);expect((await f.earnApp(ea.id)).paypalEmailId).toBe(f.free.id);expect(await f.email(f.free.id)).toMatchObject({holdEarnAppId:null,usedEarnAppId:ea.id});
 }finally{await f.cleanup();}
});
it('unsend returns SENT to PREPARING, email still held, day marker removed',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0);await f.sent(r.id);
 const out=await f.unsend(r.id,'Bấm nhầm');expect(out).toMatchObject({id:r.id,changed:true,submission:'PREPARING'});
 const row=await f.req(r.id);expect(row).toMatchObject({submission:'PREPARING',submittedAt:null,state:'REQUESTED'});expect(lastKind(row.history)).toBe('UNSEND');
 expect(await f.email(a.id)).toMatchObject({holdEarnAppId:ea.id,usedEarnAppId:null});expect(await f.markers(a.id)).toHaveLength(0);
 expect((await f.earnApp(ea.id)).paypalEmailId).toBeNull();
 expect(await f.unsend(r.id)).toMatchObject({changed:false,submission:'PREPARING'});
 // Sent again: the same email is bound again.
 await f.sent(r.id);expect((await f.earnApp(ea.id)).paypalEmailId).toBe(a.id);expect(await f.markers(a.id)).toHaveLength(1);
 // With money on the email the request cannot go back to "not sent".
 await f.receipt(r.id,'4');await expect(f.unsend(r.id)).rejects.toMatchObject({reason:'EMAIL_HAS_MONEY'});
 }finally{await f.cleanup();}
});
it('unsend counts the held email on today and never takes another operator slot',async()=>{
 clock('2026-10-19T05:00:00Z');const f=await setup();try{const a=f.rows[0].email;
 const r=await f.prep(0);await f.sent(r.id);
 vi.setSystemTime(new Date('2026-10-20T05:00:00Z'));await f.prep(1);await f.prep(2);
 await expect(f.unsend(r.id)).rejects.toMatchObject({reason:'PAYPAL_DAILY_LIMIT'});
 expect(await f.req(r.id)).toMatchObject({submission:'SENT'});expect(await f.email(a.id)).toMatchObject({usedEarnAppId:f.rows[0].ea.id,holdEarnAppId:null});
 expect((await f.markers(a.id)).map(m=>m.day)).toEqual(['2026-10-19']);
 }finally{await f.cleanup();}
});
it('unsend on a PayPal no longer active says so',async()=>{
 const f=await setup();try{const r=await f.prep(0);await f.sent(r.id);
 await db.payPalAccount.update({where:{id:f.pp.id},data:{status:'LIMITED'}});
 await expect(f.unsend(r.id)).rejects.toThrow(/LIMITED/);expect((await f.req(r.id)).submission).toBe('SENT');
 }finally{await f.cleanup();}
});
it('void deletes a request with no receipts and frees its email; VM can request again',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0);await f.sent(r.id);
 const out=await f.voidIt(r.id,'Ghi nhầm VM');expect(out).toMatchObject({requestId:r.id,vmId:f.rows[0].vm.id});
 expect(await db.earnPayoutRequest.findUnique({where:{id:r.id}})).toBeNull();
 expect(await f.email(a.id)).toMatchObject({holdEarnAppId:null,usedEarnAppId:null});expect(await f.markers(a.id)).toHaveLength(0);
 expect((await f.earnApp(ea.id)).paypalEmailId).toBeNull();
 const voids=await db.earnPayoutRequestVoid.findMany({where:{projectId:f.scope.projectId}});expect(voids).toHaveLength(1);
 expect(voids[0]).toMatchObject({id:out.voidId,requestId:r.id,vmId:f.rows[0].vm.id,cycle:1,earnAppId:ea.id,paypalEmailId:a.id,reason:'Ghi nhầm VM',voidedById:f.scope.userId});
 const snap=voids[0].snapshot as {id:string;amount:string;submission:string;history:{kind?:string}[]};
 expect(snap).toMatchObject({id:r.id,amount:'10.00',submission:'SENT'});expect(snap.history.map(h=>h.kind)).toEqual(['PREPARED','SENT','VOID']);
 const hist=await readVmOpsHistory(f.scope,{vmId:f.rows[0].vm.id},db);
 expect(hist.voided).toEqual([expect.objectContaining({reason:'Ghi nhầm VM',paypal:'PP-fix-1',email:a.email,amount:'10.00',currency:'USD'})]);
 // Without the money rights the line is there, the amount is not.
 expect((await readVmOpsHistory(f.worker,{vmId:f.rows[0].vm.id},db)).voided).toEqual([expect.objectContaining({reason:null,amount:null,currency:null})]);
 const again=await f.prep(0);expect(again.id).not.toBe(r.id);expect((await f.email(a.id)).holdEarnAppId).toBe(ea.id);
 }finally{await f.cleanup();}
});
it('void refuses with any receipt, an active merged member, or consumedAt',async()=>{
 const f=await setup(4);try{
 const r0=await f.prep(0);await f.sent(r0.id);const rc=await f.receipt(r0.id,'5');
 await expect(f.voidIt(r0.id)).rejects.toMatchObject({code:'INVALID_INPUT'});
 await db.fundTransaction.update({where:{id:rc.receiptId as string},data:{voidedAt:new Date()}});
 await expect(f.voidIt(r0.id)).rejects.toMatchObject({code:'INVALID_INPUT'});
 const r1=await f.prep(1,undefined,{members:[{vmId:f.rows[2].vm.id,expectedCycle:1}]});
 await expect(f.voidIt(r1.id)).rejects.toMatchObject({code:'INVALID_INPUT'});
 const r3=await f.prep(3,f.other[0].id);await db.earnPayoutRequest.update({where:{id:r3.id},data:{consumedAt:new Date()}});
 await expect(f.voidIt(r3.id)).rejects.toMatchObject({code:'INVALID_INPUT'});
 expect(await db.earnPayoutRequest.count({where:{id:{in:[r0.id,r1.id,r3.id]}}})).toBe(3);
 expect(await db.earnPayoutRequestVoid.count({where:{projectId:f.scope.projectId}})).toBe(0);
 // A reason is required.
 await expect(f.voidIt(r3.id,'  ')).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();}
});
it('undo of a void restores the request, its history and its email hold',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0),before=await f.req(r.id),key=randomUUID();await f.voidIt(r.id,'Bỏ',key);
 await undoOperation(f.scope,(await f.journal(key)).id,'Bấm nhầm',db);
 const row=await f.req(r.id);expect(row).toMatchObject({paypalEmailId:a.id,submission:'PREPARING',state:'REQUESTED',requestedById:before.requestedById});
 expect(row.history).toEqual(before.history);expect((await f.email(a.id)).holdEarnAppId).toBe(ea.id);
 expect(await db.earnPayoutRequestVoid.count({where:{projectId:f.scope.projectId}})).toBe(0);
 }finally{await f.cleanup();}
});
it('undo of a void is refused once the VM has another EarnApp account in the same round',async()=>{
 const f=await setup();try{const r=await f.prep(0),key=randomUUID();await f.voidIt(r.id,'Bỏ',key);
 await db.earnAppAccount.update({where:{id:f.rows[0].ea.id},data:{vmId:null}});
 const login=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid'}});
 await db.earnAppAccount.create({data:{projectId:f.scope.projectId,loginId:login.id,vmId:f.rows[0].vm.id}});
 await expect(undoOperation(f.scope,(await f.journal(key)).id,'x',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 expect(await db.earnPayoutRequest.findUnique({where:{id:r.id}})).toBeNull();
 }finally{await f.cleanup();}
});
it('undo of unsend restores the sent binding',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0);await f.sent(r.id);const key=randomUUID();await f.unsend(r.id,undefined,key);
 await undoOperation(f.scope,(await f.journal(key)).id,'Bấm nhầm',db);
 expect(await f.req(r.id)).toMatchObject({submission:'SENT',paypalEmailId:a.id});
 expect(await f.email(a.id)).toMatchObject({usedEarnAppId:ea.id,holdEarnAppId:null});expect((await f.earnApp(ea.id)).paypalEmailId).toBe(a.id);
 expect(await db.earnAppPayout.count({where:{earnAppId:ea.id,paypalEmailId:a.id,endedAt:null}})).toBe(1);
 }finally{await f.cleanup();}
});
it('undo of an email edit on a sent request is refused (the new email was given for good); editing back is the way',async()=>{
 const f=await setup();try{const a=f.rows[0].email;
 const r=await f.prep(0);await f.sent(r.id);const key=randomUUID();await f.edit(r.id,{paypalEmailId:f.free.id,note:'ghi nhầm'},key);
 await expect(undoOperation(f.scope,(await f.journal(key)).id,'x',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 await f.edit(r.id,{paypalEmailId:a.id,note:'Sửa lại'});
 expect(await f.email(f.free.id)).toMatchObject({usedEarnAppId:null,holdEarnAppId:null});expect((await f.earnApp(f.rows[0].ea.id)).paypalEmailId).toBe(a.id);
 }finally{await f.cleanup();}
});
it('undo of an email edit on a preparation gives the holds back',async()=>{
 const f=await setup();try{const a=f.rows[0].email,ea=f.rows[0].ea;
 const r=await f.prep(0),key=randomUUID();await f.edit(r.id,{paypalEmailId:f.free.id},key);
 await undoOperation(f.scope,(await f.journal(key)).id,'Bấm nhầm',db);
 expect((await f.req(r.id)).paypalEmailId).toBe(a.id);expect((await f.email(a.id)).holdEarnAppId).toBe(ea.id);expect((await f.email(f.free.id)).holdEarnAppId).toBeNull();
 }finally{await f.cleanup();}
});

// Task 4 (owner 28/10/2026): "Tiền đã về" can settle the remainder as a fee in the same command; late money after SUS.
const rcpt=(f:Awaited<ReturnType<typeof setup>>,id:string,amount:string,extra:Record<string,unknown>={},scope=f.scope)=>f.req(id).then(r=>recordPayoutReceipt(scope,{key:randomUUID(),requestId:id,expectedRequestRevision:r.revision,amount,currency:'USD',receivedAt:new Date().toISOString(),...extra} as never,db));
const phaseOf=async(f:Awaited<ReturnType<typeof setup>>,id:string)=>{const r=await db.earnPayoutRequest.findUniqueOrThrow({where:{id},include:{receipts:true}});return moneyOfRequest(r).phase;};
const kinds=(h:unknown)=>(h as {kind?:string}[]).map(x=>x.kind);
async function sentTwenty(f:Awaited<ReturnType<typeof setup>>){const r=await f.prep(0,undefined,{amount:'20'});await f.sent(r.id);return r;}
it('receipt with settleRemainder settles the gap in the same command',async()=>{
 const f=await setup();try{const r=await sentTwenty(f);
 const out=await rcpt(f,r.id,'18.50',{settleRemainder:true});
 expect(out).toMatchObject({settled:true,shortfall:'1.50'});
 const row=await f.req(r.id);expect(row).toMatchObject({settleNote:'Phí / thiếu $1.50',settledById:f.scope.userId});expect(row.shortfall?.toString()).toBe('1.5');expect(row.settledAt).not.toBeNull();
 expect(await phaseOf(f,r.id)).toBe('RECEIVED');expect(kinds(row.history)).toEqual(expect.arrayContaining(['RECEIPT','SETTLE']));
 }finally{await f.cleanup();}
});
it('receipt without settleRemainder leaves 1.50 waiting',async()=>{
 const f=await setup();try{const r=await sentTwenty(f);
 const out=await rcpt(f,r.id,'18.50');expect(out).toMatchObject({settled:false,shortfall:null});
 const row=await f.req(r.id);expect(row.settledAt).toBeNull();expect(await phaseOf(f,r.id)).toBe('WAITING');
 }finally{await f.cleanup();}
});
it('settleRemainder on a full receipt settles nothing',async()=>{
 const f=await setup();try{const r=await sentTwenty(f);
 expect(await rcpt(f,r.id,'20',{settleRemainder:true})).toMatchObject({settled:false,shortfall:null});
 expect((await f.req(r.id)).settledAt).toBeNull();expect(await phaseOf(f,r.id)).toBe('RECEIVED');
 }finally{await f.cleanup();}
});
async function receiptOnly(f:Awaited<ReturnType<typeof setup>>){
 await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.worker.projectId}},data:{capabilities:['PAYPAL_RECEIPT_RECORD']}});
 return {...f.worker,capabilities:['PAYPAL_RECEIPT_RECORD']} as typeof f.worker;
}
it('settleRemainder works for a receipt-only recorder',async()=>{
 const f=await setup();try{const w=await receiptOnly(f);const r=await sentTwenty(f);
 expect(await rcpt(f,r.id,'18.50',{settleRemainder:true},w)).toMatchObject({settled:true,shortfall:'1.50'});
 expect(await phaseOf(f,r.id)).toBe('RECEIVED');expect((await f.req(r.id)).settledById).toBe(w.userId);
 }finally{await f.cleanup();}
});
it('a standalone SETTLE still needs writeMoney',async()=>{
 const f=await setup();try{const w=await receiptOnly(f);const r=await sentTwenty(f);await rcpt(f,r.id,'18.50');
 await expect(updatePayoutRequest(w,{key:randomUUID(),requestId:r.id,expectedRevision:(await f.req(r.id)).revision,action:'SETTLE',note:'phí'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('a late receipt on LOST_SUS reopens and records it',async()=>{
 const f=await setup();try{const r=await sentTwenty(f);await rcpt(f,r.id,'5');
 await db.earnPayoutRequest.update({where:{id:r.id},data:{state:'LOST_SUS',lostAmount:'15',lostAt:new Date()}});
 expect(await phaseOf(f,r.id)).toBe('LOST');
 await rcpt(f,r.id,'15');
 const row=await f.req(r.id);expect(row).toMatchObject({state:'REQUESTED',lostAmount:null,lostAt:null});
 expect(await phaseOf(f,r.id)).toBe('RECEIVED');expect(JSON.stringify(row.history)).toContain('Tiền về muộn sau SUS');
 }finally{await f.cleanup();}
});

// ─── Final whole-branch review: a future withdrawal day is refused on every path (tRPC included) ───────────────────────────
it('edit refuses a requestedAt after today on the tRPC / service path (same rule as the ops API)',async()=>{
 const f=await setup(1);try{const r=await f.prep(0);
 const tomorrow=new Date(Date.now()+7*3600000+86400000).toISOString().slice(0,10);
 await expect(f.edit(r.id,{requestedAt:tomorrow})).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/tương lai/)});
 const {appRouter}=await import('@/server/routers/_app');
 const api=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as never);
 const row=await f.req(r.id);
 await expect(api.vmOps.editPayout({projectId:f.scope.projectId,key:randomUUID(),requestId:r.id,expectedRevision:row.revision,vmId:row.vmId,expectedCycle:row.cycle,earnAppId:row.earnAppId,requestedAt:tomorrow})).rejects.toThrow(/tương lai/);
 expect((await f.req(r.id)).requestedAt.getTime()).toBe(row.requestedAt.getTime());
 // today is still allowed
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 expect(await f.edit(r.id,{requestedAt:today})).toMatchObject({changed:true});
 }finally{await f.cleanup();}
});