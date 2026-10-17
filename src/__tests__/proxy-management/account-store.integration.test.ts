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
    const batch={code:'LOT-'+u(),source:'Shop A',purchasedAt:'2026-10-17',priceMode:'UNIT' as const,amount:'25000',currency:'VND',rate:'25000'};
    const preview=await previewStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch},db);
    expect(preview.rows.map(r=>r.outcome)).toEqual(['READY','ERROR','ERROR','ERROR','READY']);expect(preview.rows[1].message).toMatch(/dòng 4/);expect(preview.rows[3].message).toMatch(/dòng 2/);
    expect(preview.batch).toMatchObject({existing:false,cost:'WILL_RECORD',total:{amount:'125000.00000000',currency:'VND',usdt:'5.000000',lines:5}});
    expect(JSON.stringify(preview)).not.toMatch(/pw-|TOTP/);
    const key=randomUUID(),done=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db);
    expect(done).toMatchObject({applied:2,errors:3});expect(await costs(f.scope.projectId)).toBe(1);
    const saved=await db.gmailAccount.findFirstOrThrow({where:{email:a}});expect(saved.loginType).toBe('APPLE_ID');expect(saved.password).not.toContain('pw-secret');expect(saved.recoveryEmail).toBe('rec-'+a);
    expect(JSON.stringify(await db.operationJournal.findMany({where:{projectId:f.scope.projectId}}))).not.toMatch(/pw-secret|TOTP/);
    expect(JSON.stringify(await db.auditLog.findMany({where:{projectId:f.scope.projectId}}))).not.toMatch(/pw-secret|TOTP/);
    // Same key again = replay; same list again in the same batch = nothing new, no second cost; fixing error lines in the batch adds no cost.
    expect(await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key},db)).toMatchObject({replay:true,applied:2});
    const again=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text,batch,key:randomUUID()},db);expect(again).toMatchObject({applied:0,exists:2});
    const fix=await commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${b}|pw-b`,batch:{...batch,amount:'99999'},key:randomUUID()},db);expect(fix).toMatchObject({applied:1});
    expect(await costs(f.scope.projectId)).toBe(1);
    const cost=await db.costRecord.findFirstOrThrow({where:{projectId:f.scope.projectId}});expect(cost).toMatchObject({currency:'VND',category:'GMAIL'});expect(cost.amount.toString()).toBe('125000');expect(cost.usdtAmount?.toString()).toBe('5');
    // A new batch code with nothing new is refused (would duplicate the purchase); an existing password is never overwritten.
    await expect(commitStockImport(f.scope,{kind:'LOGIN',loginType:'APPLE_ID',text:`${a}|other-password`,batch:{...batch,code:'LOT-'+u()},key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect((await db.gmailAccount.findFirstOrThrow({where:{email:a}})).password).toBe(saved.password);expect(await costs(f.scope.projectId)).toBe(1);
    // Wrong type for an existing batch is refused; the type is never inferred from the email.
    await expect(previewStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:`new-${u()}@gmail.com|x`,batch},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    const store=await readAccountStore(f.scope,db);expect(store.logins.filter(l=>l.batch===batch.code).map(l=>l.state)).toEqual(['NEW','NEW','NEW']);
    expect(store.batches[0]).toMatchObject({code:batch.code,lineCount:5,received:3,cost:'RECORDED'});expect(JSON.stringify(store)).not.toMatch(/pw-|TOTP/);
  }finally{await f.cleanup();}
});
it('PayPal stock: Mã PP | Email per line, duplicates and conflicts reported per line, no password needed, price missing = no cost',async()=>{
  const f=await setup();try{
    const x=u(),text=[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | pp${x}2@example.invalid`,`tut-${x}1 | pp${x}9@example.invalid`,`tut-${x}3`,`tut-${x}4 | pp${x}2@example.invalid`].join('\n');
    const p=await previewStockImport(f.scope,{kind:'PAYPAL',text,batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'}},db);
    expect(p.rows.map(r=>r.outcome)).toEqual(['ERROR','ERROR','ERROR','ERROR','ERROR']);
    const ok=[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | pp${x}2@example.invalid`].join('\n');
    expect(await commitStockImport(f.scope,{kind:'PAYPAL',text:ok,batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db)).toMatchObject({applied:2});
    const next=await previewStockImport(f.scope,{kind:'PAYPAL',text:[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}2 | other${x}@example.invalid`,`tut-${x}5 | pp${x}1@example.invalid`].join('\n'),batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'}},db);
    expect(next.rows.map(r=>[r.outcome,r.message])).toEqual([['ERROR',expect.stringMatching(/Trùng email/)],['ERROR',expect.stringMatching(/email khác/)],['ERROR',expect.stringMatching(/Trùng email/)]]);
    const known=await previewStockImport(f.scope,{kind:'PAYPAL',text:[`tut-${x}1 | pp${x}1@example.invalid`,`tut-${x}6 | pp${x}2@example.invalid`].join('\n'),batch:{code:'PP-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'}},db);
    expect(known.rows.map(r=>[r.outcome,r.message])).toEqual([['EXISTS',expect.stringMatching(/Đã có/)],['ERROR',expect.stringMatching(/Email đã thuộc/)]]);
    expect(await costs(f.scope.projectId)).toBe(0);
    const store=await readAccountStore(f.scope,db),batch=store.batches.find(b=>b.code==='PP-'+x)!;expect(batch.cost).toBe('NONE');
    // The payment recorded later, once.
    await recordBatchCost(f.scope,{batchId:batch.id,expectedRevision:batch.revision,priceMode:'TOTAL',amount:'12',currency:'USDT',key:randomUUID()},db);
    await expect(recordBatchCost(f.scope,{batchId:batch.id,expectedRevision:batch.revision+1,priceMode:'TOTAL',amount:'12',currency:'USDT',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(await costs(f.scope.projectId)).toBe(1);
  }finally{await f.cleanup();}
});
async function stock(f:Awaited<ReturnType<typeof setup>>){
  const x=u(),mails=[1,2,3].map(n=>`m${n}-${x}@example.invalid`);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:mails.map(m=>m+'|pw').join('\n'),batch:{code:'G-'+x,purchasedAt:'2026-10-17',priceMode:'TOTAL',amount:'3',currency:'USDT'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[1,2,3].map(n=>`PP${n}-${x} | p${n}-${x}@example.invalid`).join('\n'),batch:{code:'P-'+x,purchasedAt:'2026-10-17',priceMode:'NONE'},key:randomUUID()},db);
  return {x,mails,pp:[1,2,3].map(n=>`PP${n}-${x}`)};
}
it('paste Server | VM | Tài khoản | Mã PP: matched by server + VM, held accounts and PayPals refused with their position, rows all-or-nothing',async()=>{
  const f=await setup();try{
    const s=await stock(f),code=f.server.code,before=await costs(f.scope.projectId);
    const preview=await previewLinks(f.scope,{text:[`Server\tVM\tTài khoản\tMã PP`,`${code}\tVM_002\t${s.mails[1]}\t${s.pp[1]}`,`${code}\tVM_001\t${s.mails[0]}\t${s.pp[0]}`,`${code}\tVM_009\t${s.mails[2]}`].join('\n')},db);
    expect(preview.rows.map(r=>[r.vm,r.outcome])).toEqual([['VM_002','READY'],['VM_001','READY'],['VM_009','ERROR']]);
    const items=preview.rows.filter(r=>r.outcome==='READY').map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,login:r.login,paypal:r.paypal}));
    const applied=await applyLinks(f.scope,{key:randomUUID(),items},db);expect(applied).toMatchObject({applied:2,errors:0});
    const vm2=await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[1].id},include:{login:true,paypal:true}});expect([vm2.login.email,vm2.paypal?.code,vm2.registeredAt]).toEqual([s.mails[1],s.pp[1],null]);
    // Same link again: no change and no extra history.
    const ops=(await listOperations(f.scope,db)).length;
    const again=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[1].id,expectedRevision:await rev(f.vms[1].id),login:vm2.loginId,paypal:vm2.paypalId}]},db);
    expect(again.rows[0]).toMatchObject({outcome:'SKIP',message:'Không thay đổi'});expect((await listOperations(f.scope,db)).length).toBe(ops);
    // Login held on VM_002 → refused with its position. A row with a free login but a held PayPal saves nothing.
    const taken=await previewLinks(f.scope,{text:`${code} | VM_003 | ${s.mails[1]}`},db);expect(taken.rows[0].message).toMatch(new RegExp(`đang giữ cho ${code} / VM_002`));
    const half=await previewLinks(f.scope,{text:`${code} | VM_003 | ${s.mails[2]} | ${s.pp[1]}`},db);expect(half.rows[0]).toMatchObject({outcome:'ERROR'});expect(half.rows[0].message).toMatch(/đang nhận cho/);
    const forced=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[2].id,expectedRevision:await rev(f.vms[2].id),login:(await db.gmailAccount.findFirstOrThrow({where:{email:s.mails[2]}})).id,paypal:vm2.paypalId}]},db);
    expect(forced.rows[0].outcome).toBe('ERROR');expect(await db.earnAppAccount.findUnique({where:{vmId:f.vms[2].id}})).toBeNull();
    expect(await db.earnAppAccount.count({where:{login:{email:s.mails[2]}}})).toBe(0);
    // Repeats inside one paste are reported on every line.
    const dup=await previewLinks(f.scope,{text:[`${code}|VM_003|${s.mails[2]}`,`${code}|VM_003|${s.mails[2]}`].join('\n')},db);expect(dup.rows.every(r=>r.outcome==='ERROR')).toBe(true);
    // Unassign: the login stays USED (never NEW again); its PayPal can never receive for another EarnApp account.
    await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vms[1].id,expectedRevision:await rev(f.vms[1].id),login:null}]},db);
    const store=await readAccountStore(f.scope,db);expect(store.logins.find(l=>l.email===s.mails[1])?.state).toBe('USED');expect(store.paypals.find(p=>p.code===s.pp[1])?.state).toBe('USED');
    const reuse=await previewLinks(f.scope,{text:`${code}|VM_002|${s.mails[2]}|${s.pp[1]}`},db);expect(reuse.rows[0].message).toMatch(/đang nhận cho|đã từng nhận/);
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
    expect(plan.ready).toBe(3);const done=await applyLinks(f.scope,{key:randomUUID(),items:plan.rows.map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,login:r.login,paypal:r.paypal}))},db);expect(done.applied).toBe(3);
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
