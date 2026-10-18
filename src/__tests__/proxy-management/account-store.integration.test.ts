import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {previewStockImport,commitStockImport,recordBatchCost,setStockStatus} from '@/server/account-store/inventory';
import {previewLinks,applyLinks,planAutoLinks,markEarnAppRegistered} from '@/server/account-store/links';
import {readAccountStore,readVmAccounts} from '@/server/account-store/read';
import {bindVMAccount} from '@/server/business-management/accounts';
import {saveWork,readWorkWorkspace} from '@/server/business-management/work';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {saveUsdtCost,voidUsdtCost} from '@/server/business-management/usdt-costs';
afterAll(()=>db.$disconnect());
// Test data only: synthetic emails on example.invalid, never real accounts.
const u=()=>randomUUID().slice(0,8);
async function setup(){
  const f=await businessFixture();
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
  const vm3=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_003',managed:true,proxySlotState:'BLANK'}});
  return {...f,vms:[f.vm,vm2,vm3]};
}
const costs=(projectId:string)=>db.costRecord.count({where:{projectId,voidedAt:null}});
const rev=async(id:string)=>(await db.virtualMachine.findUniqueOrThrow({where:{id}})).revision;
it('bulk Gmail / Apple ID import keeps every line, never overwrites, protects secrets and records the paid batch once',async()=>{
  const f=await setup();try{
    const [a,b,c]=[u(),u(),u()].map(x=>`acc-${x}@example.invalid`);
    const text=[`${a}|pw-secret-${a}|TOTP${a}|rec-${a}`,`${b}\tpw-b`,`không-phải-email|x`,`${b}|pw-again`,`${c}:pw-c`].join('\n');
    await expect(previewStockImport(f.scope,{kind:'LOGIN',text,batch:{code:'L1',purchasedAt:'2026-10-17',priceMode:'NONE'}},db)).rejects.toMatchObject({code:'INVALID_INPUT'}); // type must be chosen
    const batch={source:'Shop A',purchasedAt:'2026-10-17',priceMode:'UNIT' as const,amount:'25000',quantity:5,currency:'VND',rate:'25000'};
    const preview=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch},db);
    expect(preview.rows.map(r=>r.outcome)).toEqual(['READY','ERROR','ERROR','ERROR','READY']);expect(preview.rows[1].message).toMatch(/dòng 4/);expect(preview.rows[3].message).toMatch(/dòng 2/);
    expect(preview.batch).toMatchObject({existing:false,cost:'WILL_RECORD',total:{amount:'125000.00000000',currency:'VND',usdt:'5.000000',quantity:5}});
    expect(JSON.stringify(preview)).not.toMatch(/pw-|TOTP/);
    const key=randomUUID(),done=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db);
    expect(done).toMatchObject({applied:2,errors:3});expect(await costs(f.scope.projectId)).toBe(1);
    const saved=await db.gmailAccount.findFirstOrThrow({where:{email:a}});expect(saved.loginType).toBe('APPLE_ID');expect(saved.password).not.toContain('pw-secret');expect(saved.recoveryEmail).toBe('rec-'+a);
    expect(JSON.stringify(await db.operationJournal.findMany({where:{projectId:f.scope.projectId}}))).not.toMatch(/pw-secret|TOTP/);
    expect(JSON.stringify(await db.auditLog.findMany({where:{projectId:f.scope.projectId}}))).not.toMatch(/pw-secret|TOTP/);
    // Same key again = replay; the same list appended to that batch = nothing new, no second cost; fixing error lines in the batch adds no cost.
    expect(await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db)).toMatchObject({replay:true,applied:2});
    const append={batchId:done.batch.id};
    const again=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,append,key:randomUUID()},db);expect(again).toMatchObject({applied:0,exists:2});
    const fix=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${b}|pw-b`,append,key:randomUUID()},db);expect(fix).toMatchObject({applied:1});
    expect(await costs(f.scope.projectId)).toBe(1);
    const cost=await db.costRecord.findFirstOrThrow({where:{projectId:f.scope.projectId}});expect(cost).toMatchObject({currency:'VND',category:'GMAIL'});expect(cost.amount.toString()).toBe('125000');expect(cost.usdtAmount?.toString()).toBe('5');
    // A new purchase with nothing new is refused (would duplicate the purchase); an existing password is never overwritten.
    await expect(commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${a}|other-password`,batch,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect((await db.gmailAccount.findFirstOrThrow({where:{email:a}})).password).toBe(saved.password);expect(await costs(f.scope.projectId)).toBe(1);
    // Wrong type for an existing batch is refused; the type is never inferred from the email.
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`new-${u()}@gmail.com|x`,append},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    const store=await readAccountStore(f.scope,db);expect(store.logins.filter(l=>l.batch===done.batch.code).map(l=>l.state)).toEqual(['NEW','NEW','NEW']);
    expect(store.batches[0]).toMatchObject({code:done.batch.code,lineCount:5,paidQuantity:5,received:3,cost:'RECORDED'});expect(JSON.stringify(store)).not.toMatch(/pw-|TOTP/);
  }finally{await f.cleanup();}
});
it('PayPal stock: Mã PP and its emails, lines of one code grouped, conflicts reported per line, no password needed, price missing = no cost',async()=>{
  const f=await setup();try{
    const x=u(),text=[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | pp${x}2@example.invalid`,`tut-${x}1 | pp${x}9@example.invalid`,`tut-${x}3`,`tut-${x}4 | pp${x}2@example.invalid`].join('\n');
    const p=await previewStockImport(f.scope,{kind:'PAYPAL',text,batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'}},db);
    // tut-1 on lines 1 and 3 is one PayPal with two emails; pp2 on two codes is refused on both; tut-3 has no email.
    expect(p.rows.map(r=>r.outcome)).toEqual(['READY','ERROR','READY','ERROR','ERROR']);expect(p).toMatchObject({ready:1,emails:2});
    const ok=[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | pp${x}2@example.invalid`].join('\n');
    const first=await commitStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);expect(first).toMatchObject({applied:2,batch:{code:'PP-'+x}});
    const append={batchId:first.batch.id};
    const next=await previewStockImport(f.scope,{kind:'PAYPAL',text:[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | other${x}@example.invalid`,`tut-${x}5 | pp${x}1@example.invalid`].join('\n'),append},db);
    expect(next.rows.map(r=>[r.outcome,r.message])).toEqual([['ERROR',expect.stringMatching(/mã khác/)],['ADD',expect.stringMatching(/Bổ sung email/)],['ERROR',expect.stringMatching(/mã khác/)]]);
    const known=await previewStockImport(f.scope,{kind:'PAYPAL',text:[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}6 | pp${x}2@example.invalid`].join('\n'),append},db);
    expect(known.rows.map(r=>[r.outcome,r.message])).toEqual([['EXISTS',expect.stringMatching(/Đã có/)],['ERROR',expect.stringMatching(/đã thuộc PP/)]]);
    expect(await costs(f.scope.projectId)).toBe(0);
    const store=await readAccountStore(f.scope,db),batch=store.batches.find(b=>b.code==='PP-'+x)!;expect(batch.cost).toBe('NONE');
    // The payment recorded later, once.
    await recordBatchCost(f.scope,{batchId:batch.id,expectedRevision:batch.revision,priceMode:'TOTAL',amount:'12',currency:'USDT',key:randomUUID()},db);
    await expect(recordBatchCost(f.scope,{batchId:batch.id,expectedRevision:batch.revision+1,priceMode:'TOTAL',amount:'12',currency:'USDT',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await costs(f.scope.projectId)).toBe(1);
  }finally{await f.cleanup();}
});
// Purchase money (owner brief 17/10 evening): a new purchase is always its own batch with a generated code; only an explicit
// "Nhập bổ sung" continues a batch, never with money; the paid total comes from the entered total or unit × quantity bought.
it('two purchases on the same day are two batches and two costs; retry and double click add nothing; append never adds a cost',async()=>{
  const f=await setup();try{
    const mails=(n:number)=>Array.from({length:n},()=>`buy-${u()}@example.invalid|pw`).join('\n');
    const pay=(amount:string)=>({purchasedAt:'2026-10-17',priceMode:'TOTAL' as const,amount,currency:'USDT'});
    const p1=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(2),batch:pay('10')},db);
    expect(p1.batch).toMatchObject({existing:false,cost:'WILL_RECORD',code:expect.stringMatching(/^TK-2026-10-17/)});
    const in1={kind:'LOGIN' as const,loginType:'GMAIL' as const,text:mails(2),batch:pay('10'),key:randomUUID()};
    // Double click / retry after a lost response: the same key runs once.
    const [r1,r1b]=await Promise.all([commitStockImport(f.scope,in1,db),commitStockImport(f.scope,in1,db)]);
    expect(r1b.batch.id).toBe(r1.batch.id);expect(await commitStockImport(f.scope,in1,db)).toMatchObject({replay:true});
    const r2=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(3),batch:pay('20'),key:randomUUID()},db);
    expect(r2.batch.id).not.toBe(r1.batch.id);expect(r2.batch.code).not.toBe(r1.batch.code);
    const all=await db.costRecord.findMany({where:{projectId:f.scope.projectId,voidedAt:null}});
    expect(all.length).toBe(2);expect(all.reduce((t,c)=>t+Number(c.usdtAmount),0)).toBe(30);
    expect(await db.accountPurchaseBatch.count({where:{projectId:f.scope.projectId}})).toBe(2);
    // A typed code that already exists is refused for a new purchase, never merged silently into the old batch.
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),batch:{...pay('5'),code:r1.batch.code}},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),batch:{...pay('5'),code:r1.batch.code},key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    // Explicit append: continues that batch, no cost; money, source or date sent with an append is refused, not ignored.
    const ap=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),append:{batchId:r1.batch.id}},db);
    expect(ap.batch).toMatchObject({existing:true,code:r1.batch.code,cost:'RECORDED'});
    expect(await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),append:{batchId:r1.batch.id},key:randomUUID()},db)).toMatchObject({applied:1,batch:{id:r1.batch.id}});
    await expect(commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),append:{batchId:r1.batch.id},batch:pay('9'),key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:mails(1),append:{batchId:r1.batch.id}},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(2);
    // Two people buying at the same moment: two batches with different codes, no unique clash.
    const mod=randomUUID();await db.user.create({data:{id:mod,email:mod+'@fixture.invalid'}});await db.projectMember.create({data:{projectId:f.scope.projectId,userId:mod,role:'ADMIN'}});
    try{
      const [c1,c2]=await Promise.all([commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),batch:pay('1'),key:randomUUID()},db),commitStockImport({...f.scope,userId:mod},{kind:'LOGIN',loginType:'GMAIL',text:mails(1),batch:pay('2'),key:randomUUID()},db)]);
      expect(c1.batch.code).not.toBe(c2.batch.code);expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(4);
      // Undo a purchase: its cost is voided and its batch withdrawn; the next purchase gets a fresh code.
      const op=(await listOperations(f.scope,db)).find(o=>o.kind==='ACCOUNT_STOCK_IMPORT'&&o.actorId===f.scope.userId)!;await undoOperation(f.scope,op.id,'',db);
      expect(await db.costRecord.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(3);
      const r5=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails(1),batch:pay('3'),key:randomUUID()},db);
      expect([r1,r2,c1,c2].map(r=>r.batch.code)).not.toContain(r5.batch.code);
    }finally{await db.operationJournal.deleteMany({where:{actorId:mod}});await db.auditLog.deleteMany({where:{userId:mod}});await db.projectMember.deleteMany({where:{userId:mod}});}
  }finally{await f.cleanup();}
});
it('unit price × quantity actually bought, never × pasted lines; rights and period lock are checked before anything is written',async()=>{
  const f=await setup();try{
    const [a,b]=[u(),u()].map(x=>`q-${x}@example.invalid`);
    const text=[`${a}|pw`,'sai-định-dạng|x',`${b}|pw`,`${b}|pw2`,`q-${u()}@example.invalid|pw`].join('\n'); // 5 lines, 2 ready (b repeated, one malformed)
    const unit={purchasedAt:'2026-10-17',priceMode:'UNIT' as const,amount:'2',currency:'USDT'};
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text,batch:unit},db)).rejects.toMatchObject({code:'INVALID_INPUT'}); // quantity required
    const p=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text,batch:{...unit,quantity:6}},db);
    expect(p.ready).toBe(2);expect(p.batch.total).toMatchObject({amount:'12.00000000',quantity:6,unit:'2.00000000'});
    const r=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text,batch:{...unit,quantity:6},key:randomUUID()},db);
    const cost=await db.costRecord.findFirstOrThrow({where:{projectId:f.scope.projectId}});expect(cost.amount.toString()).toBe('12');
    const store=await readAccountStore(f.scope,db);expect(store.batches.find(x=>x.id===r.batch.id)).toMatchObject({lineCount:5,paidQuantity:6,received:2,money:{total:'12',unit:'2'}});
    // Total actually paid: kept as entered whatever the number of lines.
    const t=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:[`t-${u()}@example.invalid|pw`,'xx'].join('\n'),batch:{purchasedAt:'2026-10-17',priceMode:'TOTAL',amount:'7.5',currency:'USDT'},key:randomUUID()},db);
    expect((await db.costRecord.findFirstOrThrow({where:{id:(await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:t.batch.id}})).costRecordId!}})).amount.toString()).toBe('7.5');
    // Later payment of an unpriced batch: unit price needs the quantity bought too.
    const n=await commitStockImport(f.scope,{kind:'PAYPAL',text:`PQ-${u()} | pq-${u()}@example.invalid`,batch:{purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
    const nb=await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:n.batch.id}});
    await expect(recordBatchCost(f.scope,{batchId:nb.id,expectedRevision:nb.revision,priceMode:'UNIT',amount:'3',currency:'USDT',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await recordBatchCost(f.scope,{batchId:nb.id,expectedRevision:nb.revision,priceMode:'UNIT',amount:'3',quantity:4,currency:'USDT',key:randomUUID()},db);
    expect((await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:nb.id},include:{costRecord:true}})).costRecord?.amount.toString()).toBe('12');
    // A moderator without the Chi phí right cannot record purchase money; nothing is created.
    const mod=randomUUID();await db.user.create({data:{id:mod,email:mod+'@fixture.invalid'}});await db.projectMember.create({data:{projectId:f.scope.projectId,userId:mod,role:'MODERATOR',allowedModules:['INFRASTRUCTURE']}});
    const before=await db.accountPurchaseBatch.count({where:{projectId:f.scope.projectId}});
    try{
      await expect(commitStockImport({...f.scope,userId:mod,role:'MODERATOR'},{kind:'LOGIN',loginType:'GMAIL',text:`m-${u()}@example.invalid|pw`,batch:{purchasedAt:'2026-10-17',priceMode:'TOTAL',amount:'1',currency:'USDT'},key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(await db.accountPurchaseBatch.count({where:{projectId:f.scope.projectId}})).toBe(before);
    }finally{await db.projectMember.deleteMany({where:{userId:mod}});}
    // Closed profit period: the purchase is refused whole (no batch, no account).
    await db.profitSplit.create({data:{projectId:f.scope.projectId,businessManaged:true,settled:true,currency:'USDT',basis:'TEAM_RECEIVED',periodStart:new Date('2026-09-01'),periodEnd:new Date('2026-09-30T23:59:59Z'),totalWithdrawal:0,totalCost:0,netProfit:0}});
    const late=`late-${u()}@example.invalid`;
    await expect(commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:late+'|pw',batch:{purchasedAt:'2026-09-15',priceMode:'TOTAL',amount:'1',currency:'USDT'},key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await db.gmailAccount.count({where:{email:late}})).toBe(0);expect(await db.accountPurchaseBatch.count({where:{projectId:f.scope.projectId}})).toBe(before);
  }finally{await f.cleanup();}
});
it('batches recorded before the fix that look merged are listed for review; their money is never recomputed',async()=>{
  const f=await setup();try{
    const cost=await db.costRecord.create({data:{projectId:f.scope.projectId,code:'CP-legacy-'+u(),date:new Date('2026-10-17'),amount:10,total:10,currency:'USDT',category:'GMAIL',usdtRate:1,usdtAmount:10,profitTreatment:'CASH_COST',businessManaged:true}});
    const old=await db.accountPurchaseBatch.create({data:{projectId:f.scope.projectId,kind:'LOGIN',loginType:'GMAIL',code:'TK-2026-10-17',purchasedAt:new Date('2026-10-17'),priceMode:'UNIT',unitPrice:2,totalPaid:10,currency:'USDT',lineCount:5,costRecordId:cost.id,createdById:f.scope.userId,costRule:1,createdAt:new Date(Date.now()-3600000)}});
    await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:`old-${u()}@example.invalid`,loginType:'GMAIL',batchId:old.id,status:'ACTIVE',businessManaged:true}});
    const store=await readAccountStore(f.scope,db),legacy=store.review.filter(r=>r.kind==='LEGACY_BATCH_COST');
    expect(legacy.length).toBe(1);expect(legacy[0].message).toMatch(/TK-2026-10-17.*5 dòng dán.*1 đã nhận/);expect(legacy[0].message).toMatch(/nhập thêm sau/);
    // It belongs to the login side and opens that purchase in Lịch sử nhập kho.
    expect(legacy[0]).toMatchObject({group:'LOGIN',subject:'Lô TK-2026-10-17',open:{type:'batch',code:'TK-2026-10-17'}});
    // A new purchase on the same day gets its own code next to the old one.
    const r=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`n-${u()}@example.invalid|pw`,batch:{purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
    expect(r.batch.code).toBe('TK-2026-10-17-2');
    // Lịch sử nhập kho: same purchase date → the purchase created last comes first (stable, not by code); no quantity is invented.
    const later=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`n2-${u()}@example.invalid|pw`,batch:{purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
    const order=(await readAccountStore(f.scope,db)).batches.filter(b=>b.purchasedAt==='2026-10-17').map(b=>b.code);
    expect(order.slice(0,3)).toEqual([later.batch.code,'TK-2026-10-17-2','TK-2026-10-17']);
    expect((await readAccountStore(f.scope,db)).batches.find(b=>b.code===later.batch.code)!.paidQuantity).toBeNull();
    expect((await db.costRecord.findUniqueOrThrow({where:{id:cost.id}})).amount.toString()).toBe('10');
  }finally{await f.cleanup();}
});
// The current cost record is the paid amount: after an adjustment in Chi phí the store shows exactly what the ledger holds
// (amount, currency, rate, USDT, state); the batch keeps the original price as history and nothing is recomputed or added.
it('Kho tài khoản follows the cost ledger after adjust, currency change, undo, void and re-record; append adds nothing',async()=>{
  const f=await setup();try{
    const r=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:[`s1-${u()}@example.invalid|pw`,`s2-${u()}@example.invalid|pw`].join('\n'),batch:{purchasedAt:'2026-10-17',priceMode:'UNIT',amount:'5',quantity:2,currency:'USDT'},key:randomUUID()},db);
    const batchOf=async()=>{const s=await readAccountStore(f.scope,db);return {b:s.batches.find(x=>x.id===r.batch.id)!,login:s.logins.find(l=>l.batchId===r.batch.id)!};};
    const ledger=async()=>db.costRecord.findFirstOrThrow({where:{id:(await db.accountPurchaseBatch.findUniqueOrThrow({where:{id:r.batch.id}})).costRecordId!}});
    const agree=async()=>{const {b,login}=await batchOf(),c=await ledger();
      if(c.voidedAt){expect(b.cost).toBe('VOIDED');expect(b.money?.total??null).toBeNull();expect(login.price).toBeNull();expect(login.priceState).toBe('VOIDED');return {b,login,c};}
      expect(b.cost).toBe('RECORDED');expect(b.money).toMatchObject({total:c.amount.toString(),currency:c.currency,usdt:c.usdtAmount?.toString()??null,rate:c.usdtRate?.toString()??null});
      if(b.money!.unit)expect(Number(b.money!.unit)*b.paidQuantity!).toBe(Number(c.amount));
      expect(Number(login.price!.amount)).toBeCloseTo(Number(c.amount)/2,4);expect(login.price!.currency).toBe(c.currency);return {b,login,c};};
    let s=await agree();expect(s.b.money).toMatchObject({total:'10',unit:'5',adjusted:false});expect(s.b.costLink).toEqual({id:s.c.id,month:'2026-10'});
    const costs0=await db.costRecord.count({where:{projectId:f.scope.projectId}});
    const edit=async(amount:string,currency:string,rate?:string)=>{const c=await ledger();await saveUsdtCost(f.scope,{id:c.id,expectedRevision:c.revision,key:randomUUID(),reason:'Điều chỉnh theo hoá đơn',date:'2026-10-17',amount,currency,rate,category:'GMAIL',treatment:'CASH_COST'},db);};
    // Total corrected to 20 USDT: the store shows 20, no unit × quantity formula, allocation 10; the original 2 × 5 stays as history.
    await edit('20','USDT');s=await agree();expect(s.b.money).toMatchObject({total:'20',unit:null,adjusted:true,original:{total:'10',currency:'USDT',unit:'5',quantity:2}});expect(s.login.price!.amount).toBe('10');
    // Currency and rate changed: 500000 VND at 25000 VND/USDT = 20 USDT.
    await edit('500000','VND','25000');s=await agree();expect(s.b.money).toMatchObject({currency:'VND',usdt:'20',adjusted:true});
    // Undo that adjustment: back to 20 USDT, still matching.
    const op=(await listOperations(f.scope,db)).find(o=>o.kind.includes('COST'))!;await undoOperation(f.scope,op.id,'',db);s=await agree();expect(s.c.currency).toBe('USDT');
    // Append adds no cost and changes nothing in the money.
    await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`s3-${u()}@example.invalid|pw`,append:{batchId:r.batch.id},key:randomUUID()},db);
    expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(costs0);s=await agree();
    // Void in Chi phí: the batch shows the void, no paid amount; record again once with the batch's quantity.
    const c=await ledger();await voidUsdtCost(f.scope,{id:c.id,expectedRevision:c.revision,key:randomUUID(),reason:'Sai hoá đơn'},db);s=await agree();
    expect(s.b.money).toMatchObject({original:{total:'10'}});
    const b=(await batchOf()).b;await recordBatchCost(f.scope,{batchId:b.id,expectedRevision:b.revision,priceMode:'UNIT',amount:'6',quantity:2,currency:'USDT',key:randomUUID()},db);
    s=await agree();expect(s.b.money).toMatchObject({total:'12',unit:'6',adjusted:false});
    expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(costs0+1);
    expect((await db.costRecord.findUniqueOrThrow({where:{id:c.id}})).voidedAt).not.toBeNull();
  }finally{await f.cleanup();}
});
async function stock(f:Awaited<ReturnType<typeof setup>>){
  const x=u(),mails=[1,2,3].map(n=>`m${n}-${x}@example.invalid`);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails.map(m=>m+'|pw').join('\n'),batch:{code:'G-'+x,purchasedAt:'2026-10-17',priceMode:'TOTAL',amount:'3',currency:'USDT'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[1,2,3].map(n=>`PP${n}-${x} | p${n}-${x}@example.invalid`).join('\n'),batch:{code:'P-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
  return {x,mails,pp:[1,2,3].map(n=>`PP${n}-${x}`),ppMail:[1,2,3].map(n=>`p${n}-${x}@example.invalid`)};
}
it('paste Server | VM | Tài khoản | Email PP: matched by server + VM, held accounts and PayPal emails refused with their position, rows all-or-nothing',async()=>{
  const f=await setup();try{
    const s=await stock(f),code=f.server.code,before=await costs(f.scope.projectId);
    const preview=await previewLinks(f.scope,{text:[`Server\tVM\tTài khoản\tEmail PP`,`${code}\tVM_002\t${s.mails[1]}\t${s.ppMail[1]}`,`${code}\tVM_001\t${s.mails[0]}\t${s.pp[0]}\t${s.ppMail[0]}`,`${code}\tVM_009\t${s.mails[2]}`].join('\n')},db);
    expect(preview.rows.map(r=>[r.vm,r.outcome])).toEqual([['VM_002','READY'],['VM_001','READY'],['VM_009','ERROR']]);
    const items=preview.rows.filter(r=>r.outcome==='READY').map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,login:r.login,paypalEmail:r.paypalEmail}));
    const applied=await applyLinks(f.scope,{key:randomUUID(),items},db);expect(applied).toMatchObject({applied:2,errors:0});
    const vm2=await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[1].id},include:{login:true,paypal:true}});expect([vm2.login.email,vm2.paypal?.code,vm2.registeredAt]).toEqual([s.mails[1],s.pp[1],null]);
    // Same link again: no change and no extra history.
    const ops=(await listOperations(f.scope,db)).length;
    const again=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[1].id,expectedRevision:await rev(f.vms[1].id),login:vm2.loginId,paypalEmail:vm2.paypalEmailId}]},db);
    expect(again.rows[0]).toMatchObject({outcome:'SKIP',message:'Không thay đổi'});expect((await listOperations(f.scope,db)).length).toBe(ops);
    // Login held on VM_002 → refused with its position. A row with a free login but a held PayPal saves nothing.
    const taken=await previewLinks(f.scope,{text:`${code} | VM_003 | ${s.mails[1]}`},db);expect(taken.rows[0].message).toMatch(new RegExp(`đang giữ cho ${code} / VM_002`));
    const half=await previewLinks(f.scope,{text:`${code} | VM_003 | ${s.mails[2]} | ${s.ppMail[1]}`},db);expect(half.rows[0]).toMatchObject({outcome:'ERROR'});expect(half.rows[0].message).toMatch(/đang nhận cho/);
    const forced=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[2].id,expectedRevision:await rev(f.vms[2].id),login:(await db.gmailAccount.findFirstOrThrow({where:{email:s.mails[2]}})).id,paypalEmail:vm2.paypalEmailId}]},db);
    expect(forced.rows[0].outcome).toBe('ERROR');expect(await db.earnAppAccount.findUnique({where:{vmId:f.vms[2].id}})).toBeNull();
    expect(await db.earnAppAccount.count({where:{login:{email:s.mails[2]}}})).toBe(0);
    // Repeats inside one paste are reported on every line.
    const dup=await previewLinks(f.scope,{text:[`${code}|VM_003|${s.mails[2]}`,`${code}|VM_003|${s.mails[2]}`].join('\n')},db);expect(dup.rows.every(r=>r.outcome==='ERROR')).toBe(true);
    // Unassign: the login stays USED (never NEW again); its PayPal email can never receive for another EarnApp account.
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[1].id,expectedRevision:await rev(f.vms[1].id),login:null}]},db);
    const store=await readAccountStore(f.scope,db);expect(store.logins.find(l=>l.email===s.mails[1])?.state).toBe('USED');expect(store.paypals.find(p=>p.code===s.pp[1])?.state).toBe('USED');
    const reuse=await previewLinks(f.scope,{text:`${code}|VM_002|${s.mails[2]}|${s.ppMail[1]}`},db);expect(reuse.rows[0].message).toMatch(/đang nhận cho|đã dùng cho EarnApp/);
    expect(await costs(f.scope.projectId)).toBe(before); // assignment and unassignment never add a cost
    const vmView=await readVmAccounts(f.scope,db);expect(vmView.find(v=>v.vmId===f.vms[0].id)?.earnApp).toMatchObject({login:{email:s.mails[0],type:'GMAIL'},paypal:{code:s.pp[0]}});
  }finally{await f.cleanup();}
});
it('two people assigning at the same time: one wins, the other is told; undo restores the previous link exactly',async()=>{
  const f=await setup();try{
    const s=await stock(f),[l1,l2]=await Promise.all(s.mails.slice(0,2).map(m=>db.gmailAccount.findFirstOrThrow({where:{email:m}}))),r=await rev(f.vms[0].id);
    const results=await Promise.allSettled([applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[0].id,expectedRevision:r,login:l1.id}]},db),applyLinks(f.worker,{key:randomUUID(),items:[{line:1,vmId:f.vms[1].id,expectedRevision:await rev(f.vms[1].id),login:l1.id}]},db),applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[0].id,expectedRevision:r,login:l2.id}]},db)]);
    const outcomes=results.map(x=>x.status==='fulfilled'?x.value.rows[0].outcome:'REJECTED');
    expect(outcomes.filter(o=>o==='APPLIED').length).toBe(1);expect(await db.earnAppAccount.count({where:{projectId:f.scope.projectId,vmId:{not:null}}})).toBe(1);
    // Change VM_001 to another account, then undo: the first account is back on VM_001.
    const onVm=await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[0].id}}),other=onVm.loginId===l1.id?l2:l1;
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[0].id,expectedRevision:await rev(f.vms[0].id),login:other.id}]},db);
    const op=(await listOperations(f.scope,db)).find(o=>o.kind==='VM_ACCOUNT_LINK')!;await undoOperation(f.scope,op.id,'',db);
    expect((await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[0].id}})).loginId).toBe(onVm.loginId);expect(await db.earnAppAccount.count({where:{loginId:other.id}})).toBe(0);
  }finally{await f.cleanup();}
});
it('registration, status and the old Gmail API follow the new rules; bulk pick takes NEW stock only',async()=>{
  const f=await setup();try{
    const s=await stock(f),plan=await planAutoLinks(f.scope,{vmIds:f.vms.map(v=>v.id),loginType:'GMAIL',withPaypal:true},db);
    expect(plan.ready).toBe(3);const done=await applyLinks(f.scope,{key:randomUUID(),items:plan.rows.map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,login:r.login,paypalEmail:r.paypalEmail}))},db);expect(done.applied).toBe(3);
    expect(await db.earnAppAccount.count({where:{projectId:f.scope.projectId,registeredAt:{not:null}}})).toBe(0); // assignment is not registration
    const e=await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[0].id}});
    expect(await markEarnAppRegistered(f.scope,{vmId:f.vms[0].id,registered:true,expectedRevision:e.revision,key:randomUUID()},db)).toMatchObject({changed:true});
    expect(await markEarnAppRegistered(f.scope,{vmId:f.vms[0].id,registered:true,expectedRevision:e.revision,key:randomUUID()},db)).toMatchObject({changed:false});
    // An error / stopped account keeps its link but cannot be picked for a new VM.
    const login=await db.gmailAccount.findUniqueOrThrow({where:{id:e.loginId}});await setStockStatus(f.scope,{kind:'LOGIN',items:[{id:login.id,expectedRevision:login.revision}],status:'DISABLED',key:randomUUID()},db);
    expect((await readAccountStore(f.scope,db)).logins.find(l=>l.id===login.id)?.state).toBe('BLOCKED');
    // Old "Gmail của VM" API goes through the same checks: a login on another VM is refused.
    await expect(bindVMAccount(f.scope,{vmId:f.vms[1].id,gmailId:(await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[2].id}})).loginId,expectedRevision:await rev(f.vms[1].id),key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(s.mails.length).toBe(3);
  }finally{await f.cleanup();}
});
it('work items: staff tasks and Sheet reconciliation rows are separate kinds; nothing is created by stock or link work',async()=>{
  const f=await setup();try{
    await stock(f);expect(await db.businessWorkItem.count({where:{projectId:f.scope.projectId}})).toBe(0);
    await saveWork(f.scope,{title:'Đăng nhập EarnApp VM_001',key:randomUUID()},db);await saveWork(f.scope,{title:'Chưa rõ nhóm — x / y',kind:'SHEET_REVIEW',key:randomUUID()},db);
    expect((await readWorkWorkspace(f.scope,db)).items.map(i=>i.kind).sort()).toEqual(['SHEET_REVIEW','TASK']);
  }finally{await f.cleanup();}
});
it('Kho tài khoản serves a PayPal-only member its PayPal part (no logins, no login batches) and refuses a member with neither right',async()=>{
  const f=await setup();const pp=randomUUID(),none=randomUUID();try{
    const x=u();await commitStockImport(f.scope,{kind:'PAYPAL',text:`PP-${x}|pp-${x}@example.invalid`,batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
    await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`g-${x}@example.invalid|pw`,batch:{code:'TK-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
    await db.user.createMany({data:[pp,none].map(id=>({id,email:id+'@fixture.invalid'}))});
    await db.projectMember.createMany({data:[{projectId:f.scope.projectId,userId:pp,role:'MODERATOR',allowedModules:['PAYPALS']},{projectId:f.scope.projectId,userId:none,role:'USER',allowedModules:['COSTS']}]});
    const store=await readAccountStore({...f.scope,userId:pp,role:'MODERATOR'},db);
    expect(store.rights).toMatchObject({logins:false,paypals:true,writeLogins:false,writePaypals:true});
    expect(store.logins).toEqual([]);expect(store.paypals.map(p=>p.code)).toContain('PP-'+x);expect(store.batches.map(b=>b.kind)).toEqual(['PAYPAL']);
    // Review items carry their kind: a login without a type is shown on the login side to whoever reads logins, never to PayPal-only.
    const untyped=`untyped-${x}@example.invalid`;await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:untyped,status:'ACTIVE',businessManaged:true}});
    const adminReview=(await readAccountStore(f.scope,db)).review.find(r=>r.subject===untyped);expect(adminReview).toMatchObject({kind:'LOGIN_TYPE_MISSING',group:'LOGIN',open:{type:'account',q:untyped}});
    expect((await readAccountStore({...f.scope,userId:pp,role:'MODERATOR'},db)).review.filter(r=>r.group==='LOGIN')).toEqual([]);
    await expect(readAccountStore({...f.scope,userId:none,role:'USER'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  }finally{await db.projectMember.deleteMany({where:{userId:{in:[pp,none]}}});await db.user.deleteMany({where:{id:{in:[pp,none]}}});await f.cleanup();}
});
