import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {previewStockImport,commitStockImport} from '@/server/account-store/inventory';
import {deleteStock,restoreStock} from '@/server/account-store/delete';
import {readAccountStore} from '@/server/account-store/read';
import {applyLinks} from '@/server/account-store/links';
import {recordOpening,recordTransfer} from '@/server/business-management/paypal-ledger';
import {undoOperation} from '@/server/operation-history/undo';
import {archiveOperatingAccount} from '@/server/business-management/accounts';
afterAll(()=>db.$disconnect());
// Xoá khỏi kho (owner brief 20/10/2026). Synthetic data only (example.invalid).
const u=()=>randomUUID().slice(0,8);
async function setup(){
  const f=await businessFixture();
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
  const x=u(),mail=(n:number)=>`del-${x}-${n}@example.invalid`,pp=(n:number)=>`dpp-${x}-${n}`,ppmail=(n:number,i:number)=>`dpp-${x}-${n}-${i}@example.invalid`;
  const batch={source:'Shop',purchasedAt:'2026-10-20',priceMode:'TOTAL' as const,amount:'10',quantity:4,currency:'USDT',rate:null};
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:[1,2,3,4].map(n=>`${mail(n)}|pw${n}`).join('\n'),batch,key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[1,2,3,4].map(n=>`${pp(n)} ${ppmail(n,1)} ${ppmail(n,2)}`).join('\n'),batch:{...batch,quantity:4},key:randomUUID()},db);
  const login=async(n:number)=>db.gmailAccount.findUniqueOrThrow({where:{email:mail(n)}}),paypal=async(n:number)=>db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId,code:pp(n)},include:{emails:true}});
  const items=async(kind:'LOGIN'|'PAYPAL',ns:number[])=>Promise.all(ns.map(async n=>{const r=kind==='LOGIN'?await login(n):await paypal(n);return {id:r.id,expectedRevision:r.revision};}));
  const act=async(scope:typeof f.scope,fn:typeof deleteStock,kind:'LOGIN'|'PAYPAL',ns:number[],key=randomUUID())=>fn(scope,{kind,items:await items(kind,ns),key},db);
  const costs=()=>db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}});
  const cleanup=async()=>{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,vm2,x,mail,pp,ppmail,login,paypal,items,act,costs,cleanup};
}
it('logins: ADMIN deletes one or many; rows in use are refused with their VM; restore keeps the state; import sees the deleted row; undo and retry',async()=>{
  const f=await setup();try{
    // mail(1) is assigned to VM_001 (EarnApp on an active VM); mail(2) has an old VM link; mail(3) was used and is free again.
    const l1=await f.login(1),l2=await f.login(2),l3=await f.login(3);
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,login:l1.id,expectedRevision:(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).revision}]},db);
    await db.virtualMachine.update({where:{id:f.vm2.id},data:{gmailId:l2.id}});
    const closed=await db.earnAppAccount.create({data:{projectId:f.scope.projectId,loginId:l3.id,closedAt:new Date(),closedReason:'SUS'}});
    const costBefore=await f.costs(),batchBefore=await db.accountPurchaseBatch.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'LOGIN'}});
    const r=await f.act(f.scope,deleteStock,'LOGIN',[1,2,3,4]);
    expect(r.rows.map(x=>x.outcome)).toEqual(['ERROR','ERROR','APPLIED','APPLIED']);expect(r.applied).toBe(2);expect(r.operationId).toEqual(expect.any(String));
    expect(r.rows[0]).toMatchObject({message:expect.stringMatching(/Đang gán cho .*VM_001/),place:{vm:'VM_001'},href:expect.stringContaining('tab=account')});expect(r.rows[1].place).toMatchObject({vm:'VM_002'});
    expect((await f.login(3)).archivedAt).toBeTruthy();expect((await f.login(1)).archivedAt).toBeNull();
    // Nothing else moved: cost, batch counts, the EarnApp link of the deleted used account.
    expect(await f.costs()).toBe(costBefore);expect((await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:batchBefore.id}})).paidQuantity).toBe(batchBefore.paidQuantity);expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:closed.id}})).loginId).toBe(l3.id);
    // Stock: the live list no longer has them, the deleted view does (state DELETED); import of the same email points to Khôi phục.
    const live=await readAccountStore(f.scope,db),gone=await readAccountStore(f.scope,db,{deleted:true});
    expect(live.logins.map(l=>l.email).sort()).toEqual([f.mail(1),f.mail(2)]);expect(gone.logins.map(l=>[l.email,l.state]).sort()).toEqual([[f.mail(3),'DELETED'],[f.mail(4),'DELETED']]);expect(live.rights.admin).toBe(true);
    const again=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`${f.mail(4)}|new-pw`,batch:{source:null,purchasedAt:'2026-10-20',priceMode:'NONE'}},db);
    expect(again.rows[0]).toMatchObject({outcome:'EXISTS',message:expect.stringMatching(/Khôi phục/)});
    // Undo of the delete brings both back; a retry with the same key after a lost answer replays (nothing written twice).
    await undoOperation(f.scope,r.operationId!,'nhầm',db);expect((await f.login(3)).archivedAt).toBeNull();expect((await f.login(4)).archivedAt).toBeNull();
    const key=randomUUID(),its=await f.items('LOGIN',[3]),d3=await deleteStock(f.scope,{kind:'LOGIN',items:its,key},db);expect(d3.applied).toBe(1);
    expect(await deleteStock(f.scope,{kind:'LOGIN',items:its,key},db)).toMatchObject({replay:true,applied:1});expect(await db.operationJournal.count({where:{projectId:f.scope.projectId,kind:'ACCOUNT_STOCK_DELETE'}})).toBe(2);
    // The used account restored is USED (never NEW); an undo of that delete is refused now (the row changed since: restored).
    const back=await f.act(f.scope,restoreStock,'LOGIN',[3,1]);expect(back.rows.map(x=>x.outcome)).toEqual(['APPLIED','SKIP']);
    await expect(undoOperation(f.scope,d3.operationId!,'lại',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    expect((await readAccountStore(f.scope,db)).logins.find(l=>l.email===f.mail(3))).toMatchObject({state:'USED'});
    // Rights: MODERATOR (write right) and the worker are refused; the old "Ẩn tài khoản" path too; nothing written.
    await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR'}});
    await expect(f.act(f.scope,deleteStock,'LOGIN',[4])).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.act(f.scope,restoreStock,'LOGIN',[4])).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(archiveOperatingAccount(f.scope,{kind:'GMAIL',id:(await f.login(4)).id,expectedRevision:(await f.login(4)).revision,key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(f.act(f.worker,deleteStock,'LOGIN',[4])).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await f.login(4)).archivedAt).toBeNull();
  }finally{await f.cleanup();}
});
it('PayPal: refused while an email receives for a VM, a payout request waits, money is left by the book or reconciliation is open; settled history does not block',async()=>{
  const f=await setup();try{
    const [p1,p2,p3,p4]=await Promise.all([1,2,3,4].map(n=>f.paypal(n))),l1=await f.login(1);
    // p1: an email receiving for VM_001. p2: a payout request waiting. p3: 15 USD left by the book. p4: email held for reconciliation.
    const vmRev=(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).revision;
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,login:l1.id,paypalEmail:p1.emails[0].id,expectedRevision:vmRev}]},db);
    const ea=await db.earnAppAccount.findFirstOrThrow({where:{loginId:l1.id}});
    const req=await db.earnPayoutRequest.create({data:{projectId:f.scope.projectId,earnAppId:ea.id,vmId:f.vm.id,cycle:1,paypalId:p2.id,paypalEmailId:p2.emails[0].id,amount:'20',requestedAt:new Date(),requestedById:f.scope.userId}});
    await recordOpening(f.scope,{paypalId:p3.id,date:'2026-10-01',currency:'USD',amount:'15',key:randomUUID()},db);
    await db.payPalEmail.update({where:{id:p4.emails[1].id},data:{reviewHold:true,reviewNote:'cũ'}});
    const r=await f.act(f.scope,deleteStock,'PAYPAL',[1,2,3,4]);
    expect(r.rows.map(x=>x.outcome)).toEqual(['ERROR','ERROR','ERROR','ERROR']);
    expect(r.rows[0]).toMatchObject({message:expect.stringMatching(/đang nhận cho .*VM_001/),place:{vm:'VM_001'}});
    expect(r.rows[1]).toMatchObject({message:expect.stringMatching(/yêu cầu rút/),href:expect.stringContaining('show=in')});
    expect(r.rows[2]).toMatchObject({message:expect.stringMatching(/15\.00 USD/),href:expect.stringContaining('show=out')});
    expect(r.rows[3]).toMatchObject({message:expect.stringMatching(/đối chiếu/),href:'/paypals?view=review'});
    expect(r.operationId).toBeNull();expect((await db.payPalAccount.findMany({where:{projectId:f.scope.projectId,archivedAt:{not:null}}})).length).toBe(0);
    // Settled: the request consumed, the money transferred out, the hold cleared → every PayPal deletes; the book is untouched.
    await db.earnPayoutRequest.update({where:{id:req.id},data:{consumedAt:new Date()}});
    await recordTransfer(f.scope,{paypalId:p3.id,type:'EXCHANGE',date:'2026-10-02',currency:'USD',debited:'15',fee:'0',received:'15',receivedCurrency:'USDT',rate:'1',key:randomUUID()},db);
    await db.payPalEmail.update({where:{id:p4.emails[1].id},data:{reviewHold:false}});
    const funds=await db.fundTransaction.count({where:{projectId:f.scope.projectId}}),outs=await db.withdrawal.count({where:{projectId:f.scope.projectId}});
    const ok=await f.act(f.scope,deleteStock,'PAYPAL',[2,3,4]);expect(ok.rows.map(x=>x.outcome)).toEqual(['APPLIED','APPLIED','APPLIED']);
    expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(funds);expect(await db.withdrawal.count({where:{projectId:f.scope.projectId}})).toBe(outs);
    expect((await db.payPalEmail.findUniqueOrThrow({where:{id:p2.emails[0].id}})).archivedAt).toBeNull(); // emails stay with their PayPal
    // Deleted view lists them (a code stays unique per project, so re-import refuses it and points to Khôi phục); restore brings the
    // PayPal back with its emails' states as they were.
    const gone=await readAccountStore(f.scope,db,{deleted:true});expect(gone.paypals.map(p=>p.code).sort()).toEqual([f.pp(2),f.pp(3),f.pp(4)]);
    const again=await previewStockImport(f.scope,{kind:'PAYPAL',text:`${f.pp(3)} ${f.ppmail(3,1)}`,batch:{source:null,purchasedAt:'2026-10-20',priceMode:'NONE'}},db);expect(again.rows[0]).toMatchObject({outcome:'ERROR'});expect(again.rows[0].message).toMatch(/đã ẩn|xoá/i);
    const back=await f.act(f.scope,restoreStock,'PAYPAL',[2,3]);expect(back.rows.map(x=>x.outcome)).toEqual(['APPLIED','APPLIED']);
    expect((await readAccountStore(f.scope,db)).paypals.find(p=>p.code===f.pp(3))).toMatchObject({state:'NEW'});expect((await readAccountStore(f.scope,db)).paypals.find(p=>p.code===f.pp(2))?.emails.map(e=>e.state)).toEqual(['NEW','NEW']);expect((await readAccountStore(f.scope,db)).paypals.find(p=>p.code===f.pp(1))?.emails[0].state).toBe('ASSIGNED');
  }finally{await f.cleanup();}
});
