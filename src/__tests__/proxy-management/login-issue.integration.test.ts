import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {applyLoginIssue,setStockStatus} from '@/server/account-store/inventory';
import {readAccountStore,readVmAccounts} from '@/server/account-store/read';
import {readBusinessImage} from '@/server/business-management/operation-images';
import {undoOperation} from '@/server/operation-history/undo';
import {previewLinks} from '@/server/account-store/links';
afterAll(()=>db.$disconnect());
const email=()=>randomUUID()+'@fixture.invalid';
it('bulk login issues validate providers per row, persist defaults, replay once, skip repeats and undo ACTIVE metadata clearing',async()=>{
 const f=await businessFixture();try{
  const gmail=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:email(),loginType:'GMAIL'}}),apple=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:email(),loginType:'APPLE_ID'}});
  const key=randomUUID(),input={kind:'LOGIN' as const,items:[{id:gmail.id,expectedRevision:0},{id:apple.id,expectedRevision:0}],status:'APPLE_LOCKED',key};
  const result=await setStockStatus(f.scope,input,db);expect(result.applied).toBe(1);expect(result.rows.map(r=>r.outcome)).toEqual(['ERROR','APPLIED']);
  const issue=await db.gmailAccount.findUniqueOrThrow({where:{id:apple.id}});expect(issue).toMatchObject({status:'APPLE_LOCKED',loginIssueNote:'Apple Locked',revision:1});expect(issue.loginIssueAt).toBeInstanceOf(Date);
  expect(await setStockStatus(f.scope,input,db)).toMatchObject({replay:true,applied:1});expect((await db.gmailAccount.findUniqueOrThrow({where:{id:apple.id}})).revision).toBe(1);
  const items=[{id:apple.id,expectedRevision:1}],status='APPLE_LOCKED';expect((await setStockStatus(f.scope,{kind:'LOGIN',items,status,key:randomUUID()},db)).rows[0].outcome).toBe('SKIP');
  expect((await setStockStatus(f.scope,{kind:'LOGIN',items,status,issueNote:'new detail',key:randomUUID()},db)).applied).toBe(1);
  const changed=await db.gmailAccount.findUniqueOrThrow({where:{id:apple.id}}),clearKey=randomUUID();
  await setStockStatus(f.scope,{kind:'LOGIN',items:[{id:apple.id,expectedRevision:changed.revision}],status:'ACTIVE',key:clearKey},db);
  expect(await db.gmailAccount.findUniqueOrThrow({where:{id:apple.id}})).toMatchObject({status:'ACTIVE',loginIssueNote:null,loginIssueAt:null});
  const journal=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,commandKey:clearKey}});await undoOperation(f.scope,journal.id,'restore issue',db);
  expect(await db.gmailAccount.findUniqueOrThrow({where:{id:apple.id}})).toMatchObject({status:'APPLE_LOCKED',loginIssueNote:'new detail',loginIssueAt:changed.loginIssueAt});
  const store=(await readAccountStore(f.scope,db)).logins.find(g=>g.id===apple.id);expect(store).toMatchObject({state:'BLOCKED',status:'APPLE_LOCKED',loginIssueNote:'new detail',loginIssueAt:changed.loginIssueAt!.toISOString()});
 }finally{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
it('core recording preserves current VM/EarnApp, LINKED SDK, PayPal and payout until parent replacement workflow acts',async()=>{
 const f=await businessFixture();try{
  const p=f.scope.projectId,login=await db.gmailAccount.create({data:{projectId:p,email:email(),loginType:'GMAIL'}}),pp=await db.payPalAccount.create({data:{projectId:p,code:randomUUID(),primaryEmail:email()}}),pe=await db.payPalEmail.create({data:{projectId:p,paypalId:pp.id,email:pp.primaryEmail}});
  const earn=await db.earnAppAccount.create({data:{projectId:p,loginId:login.id,vmId:f.vm.id,paypalId:pp.id,paypalEmailId:pe.id,registeredAt:new Date()}});
  await db.payPalEmail.update({where:{id:pe.id},data:{usedEarnAppId:earn.id,usedAt:new Date()}});
  await db.virtualMachine.update({where:{id:f.vm.id},data:{gmailId:login.id}});
  const sdk=await db.sdkRecord.create({data:{projectId:p,code:'linked-'+randomUUID(),vmId:f.vm.id,holderVmId:f.vm.id,linkState:'LINKED',linkedEarnAppId:earn.id,linkedVmId:f.vm.id,linkedCycle:1}});
  const request=await db.earnPayoutRequest.create({data:{projectId:p,earnAppId:earn.id,vmId:f.vm.id,cycle:1,paypalId:pp.id,paypalEmailId:pe.id,amount:'12.34',requestedAt:new Date(),requestedById:f.scope.userId}});
  const snapshot=()=>Promise.all([db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}}),db.earnAppAccount.findUniqueOrThrow({where:{id:earn.id}}),db.sdkRecord.findUniqueOrThrow({where:{id:sdk.id}}),db.payPalAccount.findUniqueOrThrow({where:{id:pp.id}}),db.payPalEmail.findUniqueOrThrow({where:{id:pe.id}}),db.earnPayoutRequest.findUniqueOrThrow({where:{id:request.id}})]);
  const before=await snapshot();
  const updated=await db.$transaction(tx=>applyLoginIssue(tx,{projectId:p,id:login.id,expectedRevision:0,status:'GOOGLE_DISABLED',note:'  provider disabled  '}));expect(updated).toMatchObject({revision:1,loginIssueNote:'provider disabled',status:'GOOGLE_DISABLED'});expect(await snapshot()).toEqual(before);
  const vmAccount=(await readVmAccounts(f.scope,db)).find(v=>v.vmId===f.vm.id);expect(vmAccount?.earnApp?.login).toMatchObject({revision:1,status:'GOOGLE_DISABLED',loginIssueNote:'provider disabled',loginIssueAt:updated.loginIssueAt!.toISOString()});
  expect(await readBusinessImage(db,p,'GMAIL',login.id)).toMatchObject({loginIssueNote:'provider disabled',loginIssueAt:updated.loginIssueAt!.toISOString()});
 }finally{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
it('wrong provider, archived account and stale revisions cannot overwrite issue state; non-ACTIVE stock cannot be assigned',async()=>{
 const f=await businessFixture();try{
  const p=f.scope.projectId,login=await db.gmailAccount.create({data:{projectId:p,email:email(),loginType:'GMAIL'}});
  await expect(db.$transaction(tx=>applyLoginIssue(tx,{projectId:p,id:login.id,expectedRevision:0,status:'APPLE_LOCKED'}))).rejects.toMatchObject({code:'INVALID_INPUT'});
  await db.$transaction(tx=>applyLoginIssue(tx,{projectId:p,id:login.id,expectedRevision:0,status:'GOOGLE_VERIFY'}));
  await expect(db.$transaction(tx=>applyLoginIssue(tx,{projectId:p,id:login.id,expectedRevision:0,status:'GOOGLE_DISABLED'}))).rejects.toMatchObject({code:'STALE_PREVIEW'});
  const checked=await previewLinks(f.scope,{items:[{line:1,vmId:f.vm.id,login:login.id}]},db);expect(checked.rows[0].outcome).toBe('ERROR');
  const archived=await db.gmailAccount.update({where:{id:login.id},data:{archivedAt:new Date()}});
  await expect(db.$transaction(tx=>applyLoginIssue(tx,{projectId:p,id:login.id,expectedRevision:1,status:'GOOGLE_DISABLED'}))).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await db.gmailAccount.findUniqueOrThrow({where:{id:login.id}})).toMatchObject({status:'GOOGLE_VERIFY',loginIssueNote:'Google Verify',revision:archived.revision});
 }finally{await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
