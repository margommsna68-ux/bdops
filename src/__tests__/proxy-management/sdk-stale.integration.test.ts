import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveVmSdk,updateSdkInfo,previewSdkStore,applySdkStore} from '@/server/vm-management/sdk-store';
import {previewVmBulk,applyVmBulk} from '@/server/vm-management/bulk';
// Independent review 19/10/2026 (.runtime/review-sdk-stale-20261019.test.ts, both cases failed before the fix): money / note edits
// bump the SDK revision but not the VM revision, so a check that carried only the VM revision let an old paste or a call without
// the SDK revision overwrite a newer value. Every SDK write path now checks the revision of the SDK it touches; "no revision"
// means "I saw no stored code" and is refused when a stored code exists.
afterAll(()=>db.$disconnect());
async function setup(){
  const f=await businessFixture(),code='review-sdk-'+randomUUID();
  // The "other operator" of these tests records SDK money: since 22/10/2026 that needs the EarnApp balance write right (EARN_BALANCE).
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{capabilities:['EARN_BALANCE']}});
  await saveVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedVmRevision:f.vm.revision,expectedCycle:1,code,expectedSdkRevision:null,amount:'12.4'},db);
  const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
  const sdk=await db.sdkRecord.findUniqueOrThrow({where:{vmId:f.vm.id}});
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,code,vm,sdk,cleanup};
}
const money=async(id:string)=>(await db.sdkRecord.findUniqueOrThrow({where:{id}})).amount?.toString();
describe('SDK stale-value protection',()=>{
  it('A: a checked paste cannot overwrite money changed in Kho SDK after the check; the line reports it',async()=>{
    const f=await setup();try{
      const p=await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:`${f.vm.code}\t${f.code}\t15`},db),r=p.rows[0];
      expect(r).toMatchObject({outcome:'READY',expectedSdkRevision:f.sdk.revision});
      await updateSdkInfo(f.worker,{key:randomUUID(),sdkId:f.sdk.id,expectedRevision:f.sdk.revision,amount:'20'},db);
      const result=await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:[{line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,expectedSdkRevision:r.expectedSdkRevision,value:r.value,amount:r.amount,note:r.note}]},db);
      expect(await money(f.sdk.id)).toBe('20');expect(result.rows[0]).toMatchObject({outcome:'ERROR',message:expect.stringMatching(/vừa được người khác thay đổi/)});
      // Without the SDK revision (an old client or a hand-made call) the same item is refused too.
      const bare=await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:[{line:1,vmId:f.vm.id,expectedRevision:f.vm.revision,value:f.code,amount:'15'}]},db);
      expect(bare.rows[0].outcome).toBe('ERROR');expect(await money(f.sdk.id)).toBe('20');
    }finally{await f.cleanup();}
  });
  it('B: sdkSave without (or with an old) SDK revision cannot change money that someone else updated',async()=>{
    const f=await setup();try{
      await updateSdkInfo(f.worker,{key:randomUUID(),sdkId:f.sdk.id,expectedRevision:f.sdk.revision,amount:'20'},db);
      for(const expectedSdkRevision of [undefined,null,f.sdk.revision])
        await expect(saveVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedVmRevision:f.vm.revision,expectedCycle:1,code:f.code,expectedSdkRevision,amount:'15'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect(await money(f.sdk.id)).toBe('20');
      // With the current revision the edit goes through.
      const now=await db.sdkRecord.findUniqueOrThrow({where:{id:f.sdk.id}});
      await saveVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedVmRevision:f.vm.revision,expectedCycle:1,code:f.code,expectedSdkRevision:now.revision,amount:'15'},db);
      expect(await money(f.sdk.id)).toBe('15');
    }finally{await f.cleanup();}
  });
  it('a new code is told apart from a stored one: a revision for a code that is not stored, or none for one that is, is refused',async()=>{
    const f=await setup();try{
      const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_S2',managed:true,proxySlotState:'BLANK'}}),fresh='fresh-sdk-'+randomUUID();
      await expect(saveVmSdk(f.scope,{key:randomUUID(),vmId:vm2.id,expectedVmRevision:vm2.revision,expectedCycle:1,code:fresh,expectedSdkRevision:3},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // Someone stores the code in Kho SDK meanwhile: a save prepared as "new code" is refused instead of taking over its money.
      const store=await previewSdkStore(f.scope,{text:`${fresh}\t7`},db);await applySdkStore(f.scope,{key:randomUUID(),rows:store.rows.map(r=>({line:r.line,code:r.code,expectedRevision:r.expectedRevision,amount:r.amount,note:r.note}))},db);
      await expect(saveVmSdk(f.scope,{key:randomUUID(),vmId:vm2.id,expectedVmRevision:vm2.revision,expectedCycle:1,code:fresh,expectedSdkRevision:null,amount:'1'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect((await db.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:f.scope.projectId,code:fresh}}})).amount?.toString()).toBe('7');
    }finally{await f.cleanup();}
  });
  it('saving the same values writes no history, event or journal',async()=>{
    const f=await setup();try{
      const before=await Promise.all([db.sdkEvent.count({where:{sdkId:f.sdk.id}}),db.operationJournal.count({where:{projectId:f.scope.projectId}})]);
      const r=await saveVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedVmRevision:f.vm.revision,expectedCycle:1,code:f.code,expectedSdkRevision:f.sdk.revision,amount:'12.40'},db);
      expect(r.changed).toBe(false);
      const p=await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:`${f.vm.code}\t${f.code}\t12,4`},db);expect(p.rows[0].outcome).toBe('SKIP');
      expect(await Promise.all([db.sdkEvent.count({where:{sdkId:f.sdk.id}}),db.operationJournal.count({where:{projectId:f.scope.projectId}})])).toEqual(before);
      expect((await db.sdkRecord.findUniqueOrThrow({where:{id:f.sdk.id}})).revision).toBe(f.sdk.revision);
    }finally{await f.cleanup();}
  });
});
