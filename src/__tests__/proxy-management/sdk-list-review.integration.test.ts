import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {addVmSdk,previewSdkPaste,applySdkPaste,vmSdkLists} from '@/server/vm-management/sdk-list';
import {updateSdkInfo} from '@/server/vm-management/sdk-store';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {sdkSummary,sdkFirst} from '@/components/vm-management/vm-grid/sdk-summary';
afterAll(()=>db.$disconnect());
// Independent review 20/10/2026 (.runtime/review-sdk-list-20261020.test.ts made official): an old paste never writes into a newer VM
// round; a request that did not see a code never overwrites the money / note someone else just saved; "chưa dùng" counts UNLINKED only.
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6);
  // The "other operator" of these tests records SDK money: since 22/10/2026 that needs the EarnApp balance write right (EARN_BALANCE).
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{capabilities:['EARN_BALANCE']}});
  const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
  const S=(n:number)=>'review-'+x+'-'+String(n).padStart(4,'0');
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  const preview=(text:string)=>previewSdkPaste(f.scope,{mode:'VM',serverId:f.server.id,text},db);
  const items=(p:Awaited<ReturnType<typeof preview>>)=>p.rows.filter(r=>r.outcome==='NEW'||r.outcome==='TAKE'||r.outcome==='UPDATE').map(r=>({line:r.line,vmId:r.vmId!,expectedCycle:r.expectedCycle!,code:r.code!,expectedSdkRevision:r.expectedSdkRevision,amount:r.amount,note:r.note}));
  const rec=(code:string)=>db.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:f.scope.projectId,code}}});
  const recreate=async()=>{await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1},db);};
  const events=async(code:string)=>db.sdkEvent.count({where:{sdkId:(await rec(code)).id}});
  return {...f,vm2,S,cleanup,preview,items,rec,recreate,events};
}
describe('Dán bảng → SDK is bound to the VM round seen at the check',()=>{
  it('an old paste is refused at its line after the VM was recreated; other lines still save; saved codes stay across rounds',async()=>{
    const f=await setup();try{
      // Saved before the recreation: stays in the VM list in round 2 (stored data, not an old request).
      await addVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(9),expectedSdkRevision:null},db);
      const p=await f.preview(`VM_001 | ${f.S(1)} | 10 | older draft\nVM_002 | ${f.S(2)} | 3`);expect(p.ready).toBe(2);
      expect(p.rows.map(r=>r.expectedCycle)).toEqual([1,1]);
      await f.recreate();
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id},include:{operation:true}})).operation?.cycle).toBe(2);
      const result=await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(p)},db);
      expect(result).toMatchObject({applied:1,errors:1});
      expect(result.rows.find(r=>r.line===1)).toMatchObject({outcome:'ERROR',message:'VM đã được tạo lại, kiểm tra lại dòng này'});
      expect(await db.sdkRecord.count({where:{projectId:f.scope.projectId,code:f.S(1)}})).toBe(0);
      expect((await f.rec(f.S(2))).holderVmId).toBe(f.vm2.id);
      expect((await vmSdkLists(db,f.scope.projectId,[f.vm.id])).get(f.vm.id)!.map(s=>s.code)).toEqual([f.S(9)]);
      // Checked again now: the line is bound to round 2 and saves.
      const fresh=await f.preview(`VM_001 | ${f.S(1)} | 10`);expect(fresh.rows[0]).toMatchObject({outcome:'NEW',expectedCycle:2});
      expect(await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(fresh)},db)).toMatchObject({applied:1});
    }finally{await f.cleanup();}
  });
  it('the apply endpoint refuses items without the round (never takes the latest one)',async()=>{
    const f=await setup();try{
      await expect(applySdkPaste(f.scope,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,code:f.S(1),expectedSdkRevision:null} as never]},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect(await db.sdkRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
    }finally{await f.cleanup();}
  });
});
describe('a request that did not see a code never overwrites what someone else just saved',()=>{
  it('paste NEW after another operator created the same code on the same VM: refused at the line, newer money / note kept',async()=>{
    const f=await setup();try{
      const p=await f.preview(`VM_001 | ${f.S(1)} | 10 | older draft`);expect(p.rows[0]).toMatchObject({outcome:'NEW',expectedSdkRevision:null});
      await addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'20',note:'newer saved note'},db);
      const result=await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(p)},db);
      expect(result).toMatchObject({applied:0,errors:1});expect(result.rows[0].message).toMatch(/vừa được thêm/);
      const stored=await f.rec(f.S(1));expect({amount:stored.amount?.toString(),note:stored.note}).toEqual({amount:'20',note:'newer saved note'});
    }finally{await f.cleanup();}
  });
  it('single add with null revision after another operator created the code: refused, newer money / note kept',async()=>{
    const f=await setup();try{
      await addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'20',note:'newer saved note'},db);
      await expect(addVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'10',note:'older draft'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      const stored=await f.rec(f.S(1));expect({amount:stored.amount?.toString(),note:stored.note,revision:stored.revision}).toEqual({amount:'20',note:'newer saved note',revision:0});
    }finally{await f.cleanup();}
  });
  it('same code, same VM, nothing to change (same values or blank fields): "giữ nguyên", no extra history',async()=>{
    const f=await setup();try{
      const p=await f.preview(`VM_001 | ${f.S(1)} | 20 | B`);const blank=await f.preview(`VM_001 | ${f.S(1)}`);
      await addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'20',note:'B'},db);
      const before=await f.events(f.S(1));
      expect(await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(p)},db)).toMatchObject({applied:0,same:1,errors:0});
      expect(await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(blank)},db)).toMatchObject({applied:0,same:1,errors:0});
      expect(await addVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null},db)).toMatchObject({changed:false});
      expect(await addVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'20',note:'B'},db)).toMatchObject({changed:false});
      expect(await f.events(f.S(1))).toBe(before);expect((await f.rec(f.S(1))).revision).toBe(0);
    }finally{await f.cleanup();}
  });
  it('an update checked at one revision is refused once the code changed; with the revision read it saves',async()=>{
    const f=await setup();try{
      await addVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null,amount:'5'},db);
      const p=await f.preview(`VM_001 | ${f.S(1)} | 10`);expect(p.rows[0]).toMatchObject({outcome:'UPDATE',expectedSdkRevision:0});
      const r=await f.rec(f.S(1));await updateSdkInfo(f.worker,{key:randomUUID(),sdkId:r.id,expectedRevision:r.revision,note:'B'},db);
      expect(await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(p)},db)).toMatchObject({applied:0,errors:1});
      expect((await f.rec(f.S(1))).amount?.toString()).toBe('5');
      const again=await f.preview(`VM_001 | ${f.S(1)} | 10`);expect(await applySdkPaste(f.scope,{key:randomUUID(),items:f.items(again)},db)).toMatchObject({applied:1});
      expect(await f.rec(f.S(1))).toMatchObject({note:'B'});expect((await f.rec(f.S(1))).amount?.toString()).toBe('10');
    }finally{await f.cleanup();}
  });
  it('a retry with the same key after a lost answer returns the old result and never undoes a later edit',async()=>{
    const f=await setup();try{
      const p=await f.preview(`VM_001 | ${f.S(1)} | 10 | A`),key=randomUUID(),items=f.items(p);
      expect(await applySdkPaste(f.scope,{key,items},db)).toMatchObject({applied:1});
      const r=await f.rec(f.S(1));await updateSdkInfo(f.worker,{key:randomUUID(),sdkId:r.id,expectedRevision:r.revision,amount:'30'},db);
      const replay=await applySdkPaste(f.scope,{key,items},db);expect(replay).toMatchObject({replay:true,applied:1});
      expect((await f.rec(f.S(1))).amount?.toString()).toBe('30');
      const addKey=randomUUID(),add={key:addKey,vmId:f.vm.id,expectedCycle:1,code:f.S(2),expectedSdkRevision:null,amount:'1'};
      await addVmSdk(f.scope,add,db);const r2=await f.rec(f.S(2));await updateSdkInfo(f.worker,{key:randomUUID(),sdkId:r2.id,expectedRevision:r2.revision,amount:'2'},db);
      expect(await addVmSdk(f.scope,add,db)).toMatchObject({replay:true});expect((await f.rec(f.S(2))).amount?.toString()).toBe('2');
    }finally{await f.cleanup();}
  });
});
describe('SDK cell counts',()=>{
  const s=(code:string,state:'UNLINKED'|'LINKED'|'UNCONFIRMED')=>({recordId:code,code,revision:0,amount:null,note:null,state,current:false,usedAt:null,usedBy:null,heldAt:null});
  it('"chưa dùng" counts UNLINKED only; UNCONFIRMED shown apart; the quick copy prefers a truly unused code',()=>{
    const list=[s('old-unconfirmed-1','UNCONFIRMED'),s('free-code-0001','UNLINKED'),s('used-code-0001','LINKED')];
    expect(sdkSummary(list)).toBe('3 SDK · 1 chưa dùng · 1 chưa xác nhận');expect(sdkFirst(list)?.code).toBe('free-code-0001');
    expect(sdkSummary([s('a-code-0001','LINKED'),s('b-code-0001','UNLINKED')])).toBe('2 SDK · 1 chưa dùng');
    expect(sdkSummary([s('a-code-0001','UNCONFIRMED')])).toBe('1 SDK · 0 chưa dùng · 1 chưa xác nhận');expect(sdkFirst([s('u-code-0001','LINKED'),s('a-code-0001','UNCONFIRMED')])?.code).toBe('a-code-0001');
    expect(sdkSummary([])).toBe('Chưa có SDK');expect(sdkFirst([])).toBeUndefined();
  });
});
