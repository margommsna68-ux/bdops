import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {previewStockImport,commitStockImport,addPaypalEmails} from '@/server/account-store/inventory';
import {previewLinks,applyLinks,planAutoLinks} from '@/server/account-store/links';
import {readAccountStore} from '@/server/account-store/read';
import {checkReceipts,recordReceipts,recordTransfer,recordOpening,readPaypalLedger,readPaypalEntries,parseReceiptLines} from '@/server/business-management/paypal-ledger';
import {voidFinance,saveFinance} from '@/server/business-management/finance';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
afterAll(()=>db.$disconnect());
// Synthetic data only (example.invalid). Rules of 18/10/2026: one PayPal code, many emails; one email for one EarnApp account.
const u=()=>randomUUID().slice(0,6);
async function setup(vmCount=7){
  const f=await businessFixture(),x=u();
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=vmCount;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK'}}));
  const logins=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:vmCount},(_,i)=>`ea${i+1}-${x}@example.invalid|pw`).join('\n'),batch:{purchasedAt:'2026-10-18',priceMode:'NONE'},key:randomUUID()},db);
  expect(logins.applied).toBe(vmCount);
  const loginIds=(await db.gmailAccount.findMany({where:{projectId:f.scope.projectId},orderBy:{email:'asc'}})).map(l=>l.id);
  return {...f,x,vms,loginIds};
}
const mail=(x:string,n:number)=>`pp13-${n}-${x}@example.invalid`;
const rev=async(id:string)=>(await db.virtualMachine.findUniqueOrThrow({where:{id}})).revision;
const link=async(f:Awaited<ReturnType<typeof setup>>,i:number,item:{login?:string|null;paypalEmail?:string|null;paypal?:string|null})=>applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[i].id,expectedRevision:await rev(f.vms[i].id),...item}]},db);
const emailId=async(projectId:string,email:string)=>(await db.payPalEmail.findFirstOrThrow({where:{projectId,email}})).id;
it('parses "Mã PP email1 email2 …" with spaces, tabs or |; a code with 5 emails is one PayPal, repeated codes are grouped',async()=>{
  const f=await setup(1);try{
    const x=f.x,text=[`pp-13 ${mail(x,1)} ${mail(x,2)}\t${mail(x,3)}`,`PP-13 | ${mail(x,4)} | ${mail(x,5)} | ${mail(x,5)}`,`pp-14 ${mail(x,9)}`,`pp-15 not-an-email`,`pp-16 ${mail(x,1)}`].join('\n');
    const p=await previewStockImport(f.scope,{kind:'PAYPAL',text,batch:{purchasedAt:'2026-10-18',priceMode:'NONE'}},db);
    expect(p.ready).toBe(1);expect(p.emails).toBe(1+0);// pp-13 and pp-16 share mail 1 → both refused; pp-14 is the only new PayPal
    expect(p.rows.find(r=>r.line===4)).toMatchObject({outcome:'ERROR'});expect(p.rows.find(r=>r.line===1)!.message).toMatch(/mã khác/);
    const ok=[`pp-13 ${mail(x,1)} ${mail(x,2)} ${mail(x,3)}`,`PP-13 | ${mail(x,4)} | ${mail(x,5)} | ${mail(x,5)}`].join('\n');
    const q=await previewStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{purchasedAt:'2026-10-18',priceMode:'TOTAL',amount:'30',currency:'USDT'}},db);
    expect(q).toMatchObject({ready:1,emails:5,errors:0});expect(await db.payPalAccount.count({where:{projectId:f.scope.projectId}})).toBe(0);// checking writes nothing
    const key=randomUUID(),c=await commitStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{purchasedAt:'2026-10-18',priceMode:'TOTAL',amount:'30',currency:'USDT'},key},db);
    expect(c).toMatchObject({applied:1,emails:5});const pps=await db.payPalAccount.findMany({where:{projectId:f.scope.projectId},include:{emails:true}});
    expect(pps).toHaveLength(1);expect(pps[0].emails.map(e=>e.email).sort()).toEqual([1,2,3,4,5].map(n=>mail(x,n)).sort());
    // Retry with the same key replays; the same paste as a new purchase brings nothing new: no second PayPal, batch or cost.
    expect((await commitStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{purchasedAt:'2026-10-18',priceMode:'TOTAL',amount:'30',currency:'USDT'},key},db)).replay).toBe(true);
    await expect(commitStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{purchasedAt:'2026-10-18',priceMode:'TOTAL',amount:'30',currency:'USDT'},key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    const costs=await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}});expect(costs).toBe(1);
    // Existing code with a new email: shown as ADD (Bổ sung email), not a purchase; adding writes no cost; same again = no change.
    const add=await previewStockImport(f.scope,{kind:'PAYPAL',text:`pp-13 ${mail(x,6)}`,batch:{purchasedAt:'2026-10-18',priceMode:'NONE'}},db);
    expect(add).toMatchObject({ready:0,add:1});expect(add.rows[0].newEmails).toEqual([mail(x,6)]);
    const r1=await addPaypalEmails(f.scope,{paypalId:pps[0].id,emails:[mail(x,6),mail(x,1)],key:randomUUID()},db);expect(r1).toMatchObject({applied:1,skipped:1});
    const r2=await addPaypalEmails(f.scope,{paypalId:pps[0].id,emails:[mail(x,6)],key:randomUUID()},db);expect(r2).toMatchObject({applied:0,skipped:1});
    expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(costs);
    // Codes are unique without case; an email of another PayPal or of another project is refused (the other project not named).
    const other=await businessFixture();try{
      await db.payPalAccount.create({data:{projectId:other.scope.projectId,code:'zz',primaryEmail:mail(x,7),emails:{create:{projectId:other.scope.projectId,email:mail(x,7)}}}});
      const bad=await previewStockImport(f.scope,{kind:'PAYPAL',text:[`pp-20 ${mail(x,2)}`,`pp-21 ${mail(x,7)}`].join('\n'),batch:{purchasedAt:'2026-10-18',priceMode:'NONE'}},db);
      expect(bad.rows[0].message).toMatch(/đã thuộc PP pp-13/);expect(bad.rows[1].message).toBe('Email '+mail(x,7)+' đã thuộc dự án khác');
      expect((await addPaypalEmails(f.scope,{paypalId:pps[0].id,emails:[mail(x,7)],key:randomUUID()},db)).rows[0].message).toBe('Email đã thuộc dự án khác');
    }finally{await other.cleanup();}
    const batch=(await readAccountStore(f.scope,db)).batches.find(b=>b.kind==='PAYPAL')!;expect(batch).toMatchObject({received:1,emails:6});
  }finally{await f.cleanup();}
});
it('five emails of one PayPal go to five EarnApp / VMs; an email serves one EarnApp forever; unassign never returns it to NEW',async()=>{
  const f=await setup(7);try{
    const x=f.x;await commitStockImport(f.scope,{kind:'PAYPAL',text:`pp-13 ${[1,2,3,4,5].map(n=>mail(x,n)).join(' ')}`,batch:{purchasedAt:'2026-10-18',priceMode:'NONE'},key:randomUUID()},db);
    const ids=await Promise.all([1,2,3,4,5].map(n=>emailId(f.scope.projectId,mail(x,n))));
    for(let i=0;i<5;i++)expect((await link(f,i,{login:f.loginIds[i],paypalEmail:ids[i]})).applied).toBe(1);
    const ea=await db.earnAppAccount.findMany({where:{projectId:f.scope.projectId,paypalEmailId:{not:null}}});expect(new Set(ea.map(e=>e.paypalId)).size).toBe(1);expect(ea).toHaveLength(5);
    // No sixth email is invented; a bare PayPal id is refused; an email held by another EarnApp is refused.
    const plan=await planAutoLinks(f.scope,{vmIds:[f.vms[5].id],loginType:'GMAIL',withPaypal:true},db);expect(plan.availablePaypals).toBe(0);expect(plan.rows[0]?.paypalEmail).toBeUndefined();
    const pp=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId}})).id;
    expect((await link(f,5,{login:f.loginIds[5],paypal:pp})).rows[0].message).toMatch(/Chọn email PayPal/);
    expect((await link(f,5,{login:f.loginIds[5],paypalEmail:ids[0]})).rows[0].message).toMatch(/đang nhận cho/);
    // Unassign the EarnApp from VM 1, then remove its PayPal: the email stays used and is never given to another EarnApp.
    expect((await link(f,0,{paypalEmail:null})).applied).toBe(1);
    const store=await readAccountStore(f.scope,db),row=store.paypals[0];expect(row.counts).toMatchObject({total:5,ASSIGNED:4,USED:1,NEW:0});expect(row.state).toBe('ASSIGNED');
    expect((await link(f,5,{login:f.loginIds[5],paypalEmail:ids[0]})).rows[0].message).toMatch(/đã dùng cho EarnApp/);
    // The same EarnApp may take its own email back; the same link again writes nothing.
    expect((await link(f,0,{paypalEmail:ids[0]})).applied).toBe(1);expect((await link(f,0,{paypalEmail:ids[0]})).skipped).toBe(1);
    // History: VM 1's EarnApp had the email, removed it, took it again → three periods, one open.
    const hist=await db.earnAppPayout.findMany({where:{earnAppId:ea.find(e=>e.paypalEmailId===ids[0])!.id},orderBy:{startedAt:'asc'}});expect(hist.filter(h=>!h.endedAt)).toHaveLength(1);
    // A locked PayPal gives no new email: add a 6th email, lock the PayPal, assign → refused.
    await addPaypalEmails(f.scope,{paypalId:pp,emails:[mail(x,6)],key:randomUUID()},db);await db.payPalAccount.update({where:{id:pp},data:{status:'LIMITED'}});
    expect((await link(f,5,{login:f.loginIds[5],paypalEmail:await emailId(f.scope.projectId,mail(x,6))})).rows[0].message).toMatch(/không cấp mới/);
    await db.payPalAccount.update({where:{id:pp},data:{status:'ACTIVE'}});
    // Two people give the 6th email to two VMs at once: exactly one succeeds.
    const six=await emailId(f.scope.projectId,mail(x,6));
    const both=await Promise.allSettled([link(f,5,{login:f.loginIds[5],paypalEmail:six}),link(f,6,{login:f.loginIds[6],paypalEmail:six})]);
    const won=both.filter(r=>r.status==='fulfilled'&&r.value.applied===1).length;expect(won).toBe(1);
    expect(await db.earnAppAccount.count({where:{paypalEmailId:six}})).toBe(1);
    // Paste: Server | VM | Tài khoản | Mã PP alone is refused; Email PP or Mã PP + Email works and checks they match.
    const p=await previewLinks(f.scope,{text:[`business-fixture\tVM_007\t${'ea7-'+x}@example.invalid\tpp-13`,`business-fixture\tVM_007\t${'ea7-'+x}@example.invalid\tpp-99\t${mail(x,2)}`].join('\n')},db);
    expect(p.rows[0].message).toMatch(/Cần email PayPal/);expect(p.rows[1].message).toMatch(/thuộc PP pp-13, không phải pp-99/);
  }finally{await f.cleanup();}
});
// Review 19/10/2026: an email given to its first EarnApp stays used forever; undo of that grant is refused, with or without money.
it('undo of a first email assignment is refused even before any payment; the email stays used; unassign is the way out',async()=>{
  const f=await setup(2);try{
    const x=f.x;await commitStockImport(f.scope,{kind:'PAYPAL',text:`pp-13 ${mail(x,1)} ${mail(x,2)}`,batch:{purchasedAt:'2026-10-18',priceMode:'NONE'},key:randomUUID()},db);
    const [e1,e2]=await Promise.all([emailId(f.scope.projectId,mail(x,1)),emailId(f.scope.projectId,mail(x,2))]);
    await link(f,0,{login:f.loginIds[0],paypalEmail:e1});
    let op=(await listOperations(f.scope,db)).find(o=>o.kind==='VM_ACCOUNT_LINK')!;expect(op.canUndo).toBe(false);
    await expect(undoOperation(f.scope,op.id,'gán nhầm',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect((await db.payPalEmail.findUniqueOrThrow({where:{id:e1}})).usedEarnAppId).not.toBeNull();expect(await db.earnAppPayout.count({where:{paypalEmailId:e1}})).toBe(1);
    await link(f,1,{login:f.loginIds[1],paypalEmail:e2});
    const pp=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId}})).id;
    await recordReceipts(f.scope,{paypalId:pp,date:'2026-10-18',currency:'USD',status:'RECEIVED',text:`${mail(x,2)} | 5`,key:randomUUID()},db);
    op=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_ACCOUNT_LINK')[0];
    await expect(undoOperation(f.scope,op.id,'',db)).rejects.toBeTruthy();
    expect((await db.payPalEmail.findUniqueOrThrow({where:{id:e2}})).usedEarnAppId).not.toBeNull();
  }finally{await f.cleanup();}
});
it('money: 24 + 10 + 12 USD through three emails of pp-13 = 46; out 30 → 16; 31 debited incl. fee 1 → the other side gets 30',async()=>{
  const f=await setup(3);try{
    const x=f.x;await commitStockImport(f.scope,{kind:'PAYPAL',text:[`pp-13 ${mail(x,1)} ${mail(x,2)} ${mail(x,3)}`,`pp-14 ${mail(x,8)}`].join('\n'),batch:{purchasedAt:'2026-10-18',priceMode:'NONE'},key:randomUUID()},db);
    const pp13=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId,code:'pp-13'}})).id,pp14=(await db.payPalAccount.findFirstOrThrow({where:{projectId:f.scope.projectId,code:'pp-14'}})).id;
    await link(f,0,{login:f.loginIds[0],paypalEmail:await emailId(f.scope.projectId,mail(x,1))});
    const text=[`${mail(x,1)} | 24 | TX-A-${x}`,`${mail(x,2)}\t10`,`${mail(x,3)} 12`].join('\n'),base={paypalId:pp13,date:'2026-10-05',currency:'USD',status:'RECEIVED' as const,text};
    const check=await checkReceipts(f.scope,base,db);expect(check).toMatchObject({ready:3,errors:0,total:'46.00'});expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);
    const key=randomUUID(),saved=await recordReceipts(f.scope,{...base,key},db);expect(saved.saved).toBe(3);
    expect((await recordReceipts(f.scope,{...base,key},db)).replay).toBe(true);// lost response + retry: nothing twice
    // The payment keeps the EarnApp / VM using the email then; an unassigned email still records (nothing is assigned).
    const first=await db.fundTransaction.findFirstOrThrow({where:{projectId:f.scope.projectId,transactionId:'TX-A-'+x}});expect(first.vmId).toBe(f.vms[0].id);expect(first.earnAppId).not.toBeNull();
    expect(await db.earnAppAccount.count({where:{projectId:f.scope.projectId,paypalEmailId:{not:null}}})).toBe(1);
    let l=await readPaypalLedger(f.scope,{month:'2026-10'},db);const row=l.paypals.find(p=>p.paypalId===pp13)!.currencies[0];
    expect(row).toMatchObject({currency:'USD',receipts:'46.00',in:'46.00',out:'0.00',balance:'46.00'});
    // Same tx id again, same email/day/amount without id: refused / flagged at the line; "khoản riêng" records it.
    const dup=await checkReceipts(f.scope,{...base,text:[`${mail(x,1)} | 24 | TX-A-${x}`,`${mail(x,2)} | 10`].join('\n')},db);
    expect(dup.rows.map(r=>r.outcome)).toEqual(['ERROR','SUSPECT']);
    expect((await checkReceipts(f.scope,{...base,text:`${mail(x,2)} | 10`,distinct:[1]},db)).rows[0].outcome).toBe('READY');
    expect((await checkReceipts(f.scope,{...base,text:`stranger-${x}@example.invalid | 5`},db)).rows[0].message).toMatch(/không thuộc PP pp-13/);
    // Out 30 without fee → 16; the email keeps receiving.
    await recordTransfer(f.scope,{paypalId:pp13,type:'EXCHANGE',date:'2026-10-06',currency:'USD',debited:'30',key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);expect(l.paypals.find(p=>p.paypalId===pp13)!.currencies[0]).toMatchObject({out:'30.00',balance:'16.00'});
    await recordReceipts(f.scope,{...base,date:'2026-10-07',text:`${mail(x,1)} | 20 | TX-B-${x}`,key:randomUUID()},db);
    // Internal transfer: pp-13 debited 31 incl. fee 1, pp-14 gets 30. Source −31 once; pp-14 +30; not EarnApp income.
    await recordTransfer(f.scope,{paypalId:pp13,type:'MIXING',date:'2026-10-08',currency:'USD',debited:'31',fee:'1',destPaypalId:pp14,received:'30',key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);
    expect(l.paypals.find(p=>p.paypalId===pp13)!.currencies[0]).toMatchObject({in:'66.00',out:'61.00',balance:'5.00'});
    expect(l.paypals.find(p=>p.paypalId===pp14)!.currencies[0]).toMatchObject({receipts:'0.00',internalIn:'30.00',in:'30.00',balance:'30.00'});
    expect(l.totals).toMatchObject({earnApp:{USD:'66.00'},internal:{USD:'30.00'},out:{USD:'61.00'}});
    await expect(recordTransfer(f.scope,{paypalId:pp13,type:'MIXING',date:'2026-10-08',currency:'USD',debited:'31',fee:'1',destPaypalId:pp14,received:'30',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});// same day/amount, no id
    await expect(recordTransfer(f.scope,{paypalId:pp13,type:'EXCHANGE',date:'2026-10-08',currency:'USD',debited:'5',fee:'5',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});// fee inside the total
    // Different currencies keep both sides and the rate actually used; nothing is converted.
    await expect(recordTransfer(f.scope,{paypalId:pp14,type:'MIXING',date:'2026-10-09',currency:'USD',debited:'10',destPaypalId:pp13,received:'9.9',receivedCurrency:'USDT',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await recordTransfer(f.scope,{paypalId:pp14,type:'MIXING',date:'2026-10-09',currency:'USD',debited:'10',destPaypalId:pp13,received:'9.9',receivedCurrency:'USDT',rate:'0.99',key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);const c13=l.paypals.find(p=>p.paypalId===pp13)!.currencies;
    expect(c13.map(c=>c.currency)).toEqual(['USD','USDT']);expect(c13[1]).toMatchObject({internalIn:'9.90',balance:'9.90'});
    // Pending and voided receipts never count; voiding updates every reading of the book.
    await recordReceipts(f.scope,{...base,status:'PENDING',date:'2026-10-10',text:`${mail(x,3)} | 100`,key:randomUUID()},db);
    const tx=await db.fundTransaction.findFirstOrThrow({where:{projectId:f.scope.projectId,transactionId:'TX-B-'+x}});
    await voidFinance(f.scope,{kind:'FUND',id:tx.id,expectedRevision:tx.revision,reason:'ghi nhầm',key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);expect(l.paypals.find(p=>p.paypalId===pp13)!.currencies[0]).toMatchObject({receipts:'46.00',balance:'-15.00'});
    // Opening balance and a month filter: September carries into October's opening.
    await recordOpening(f.scope,{paypalId:pp13,date:'2026-09-01',currency:'USD',amount:'15',key:randomUUID()},db);
    await recordReceipts(f.scope,{...base,date:'2026-09-20',text:`${mail(x,2)} | 7 | TX-C-${x}`,key:randomUUID()},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);expect(l.paypals.find(p=>p.paypalId===pp13)!.currencies[0]).toMatchObject({opening:'22.00',receipts:'46.00',balance:'7.00'});expect(l.asOf).toBe('2026-10-31');
    const sep=await readPaypalLedger(f.scope,{month:'2026-09'},db);expect(sep.paypals.find(p=>p.paypalId===pp13)!.currencies[0]).toMatchObject({opening:'15.00',receipts:'7.00',balance:'22.00'});
    // An old receipt without an email still counts on its PayPal, shown as "Chưa xác định email" (never moved to an email).
    await saveFinance(f.scope,{kind:'FUND',key:randomUUID(),date:'2026-10-11',currency:'USD',amount:'3',transactionId:'OLD-'+x,paypalId:pp13,confirmed:true},db);
    l=await readPaypalLedger(f.scope,{month:'2026-10'},db);const p13=l.paypals.find(p=>p.paypalId===pp13)!;expect(p13.unknownEmail).toEqual({USD:'3.00'});expect(p13.currencies[0].receipts).toBe('49.00');
    // The rows behind Tiền vào / Tiền ra of pp-13 in October.
    const ins=await readPaypalEntries(f.scope,{paypalId:pp13,direction:'IN',month:'2026-10'},db),outs=await readPaypalEntries(f.scope,{paypalId:pp13,direction:'OUT',month:'2026-10'},db);
    expect(outs.rows.map(r=>[r.amount,r.fee])).toEqual(expect.arrayContaining([['30.00',null],['31.00','1.00']]));expect(ins.rows.some(r=>r.kind==='INTERNAL_IN'&&r.currency==='USDT')).toBe(true);
    // Rights: PayPal stock alone reads no money; FUNDS alone sees receipts but no balance.
    await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{role:'MODERATOR',allowedModules:['PAYPALS']}});
    expect((await readPaypalLedger(f.worker,{month:'2026-10'},db)).paypals).toEqual([]);
    await db.projectMember.updateMany({where:{projectId:f.scope.projectId,userId:f.worker.userId},data:{allowedModules:['PAYPALS','FUNDS']}});
    const fundsOnly=(await readPaypalLedger({...f.worker,role:'MODERATOR'},{month:'2026-10'},db)).paypals.find(p=>p.paypalId===pp13)!.currencies[0];expect(fundsOnly).toMatchObject({receipts:'49.00',out:null,balance:null});
    expect(parseReceiptLines('a@example.invalid 1,5\nb@example.invalid 1,234.50').map(r=>r.amount)).toEqual(['1.50','1234.50']);
  }finally{await f.cleanup();}
});
