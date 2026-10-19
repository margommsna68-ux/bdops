import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {addVmSdk,markVmSdkUsed,removeVmSdk,previewSdkPaste,applySdkPaste,parseSdkPaste,rangeStart,rangeCode} from '@/server/vm-management/sdk-list';
import {updateSdkInfo,readSdkStore} from '@/server/vm-management/sdk-store';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {undoOperation} from '@/server/operation-history/undo';
afterAll(()=>db.$disconnect());
// SDK list of a VM (owner brief 20/10/2026). Fixture: business-fixture with VM_001 … VM_012 (VM_007 deleted, VM_009 missing).
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6);
  const vms:Record<string,{id:string}>={VM_001:f.vm};
  for(const n of [2,3,4,5,6,7,8,10,11,12]){const code='VM_'+String(n).padStart(3,'0');vms[code]=await db.virtualMachine.create({data:{serverId:f.server.id,code,managed:true,proxySlotState:'BLANK',...(n===7?{archivedAt:new Date()}:{})}});}
  const S=(n:number)=>'sdk-'+x+'-'+String(n).padStart(4,'0');
  const cycle=async(vmId:string)=>(await db.virtualMachine.findUniqueOrThrow({where:{id:vmId},include:{operation:true}})).operation?.cycle??1;
  const add=async(vm:string,code:string,extra:{amount?:string|null;note?:string|null;expectedSdkRevision?:number|null;from?:{vmId:string;expectedRevision:number}}={})=>addVmSdk(f.scope,{key:randomUUID(),vmId:vms[vm].id,expectedCycle:await cycle(vms[vm].id),code,expectedSdkRevision:extra.expectedSdkRevision??null,...extra},db);
  const rec=(code:string)=>db.sdkRecord.findFirstOrThrow({where:{projectId:f.scope.projectId,code}});
  const list=async(vm:string)=>(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===vms[vm].id)!.sdks;
  const used=async(vm:string,code:string)=>{const r=await rec(code);return markVmSdkUsed(f.scope,{key:randomUUID(),vmId:vms[vm].id,expectedCycle:await cycle(vms[vm].id),sdkId:r.id,expectedRevision:r.revision},db);};
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,x,vms,S,cycle,add,rec,list,used,cleanup};
}
describe('SDK list of a VM',()=>{
  it('keeps many codes per VM: adding never replaces, never changes the current code, never marks used; "3 SDK · 2 chưa dùng"',async()=>{
    const f=await setup();try{
      expect(await f.add('VM_001',f.S(1),{amount:'12.4',note:'dùng ngay'})).toMatchObject({changed:true});
      await f.add('VM_001',f.S(2));await f.add('VM_001',f.S(3));
      const l=await f.list('VM_001');expect(l.map(s=>s.code).sort()).toEqual([f.S(1),f.S(2),f.S(3)]);expect(l.every(s=>s.state==='UNLINKED'&&!s.current)).toBe(true);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBeNull();
      expect(await f.used('VM_001',f.S(2))).toMatchObject({changed:true});
      const after=await f.list('VM_001');expect(after.length).toBe(3);expect(after.filter(s=>s.state!=='LINKED').length).toBe(2);expect(after[2]).toMatchObject({code:f.S(2),state:'LINKED',usedBy:expect.any(String)});
      const r=await f.rec(f.S(2));expect(r).toMatchObject({linkState:'LINKED',linkedEarnAppId:null,linkedVmId:f.vm.id,linkedCycle:1});
      // Same record everywhere: the store shows the same state, money and VM.
      const store=await readSdkStore(f.scope,db);expect(store.find(s=>s.code===f.S(2))).toMatchObject({state:'LINKED',vm:{code:'VM_001'}});expect(store.find(s=>s.code===f.S(1))).toMatchObject({amount:'12.4',note:'dùng ngay',vm:{code:'VM_001'}});
      // Ticking again writes nothing; a used code can never come back (no untick command, undo refused, never handed out again).
      expect(await f.used('VM_001',f.S(2))).toMatchObject({changed:false});
      await expect(f.add('VM_002',f.S(2))).rejects.toMatchObject({code:'OWNER_CONFLICT'});
      const r2=await f.rec(f.S(2));await expect(removeVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,sdkId:r2.id,expectedRevision:r2.revision},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      // Adding the same code again to the same VM: no copy, no extra history.
      const events=await db.sdkEvent.count({where:{sdkId:(await f.rec(f.S(1))).id}});
      expect(await f.add('VM_001',f.S(1),{expectedSdkRevision:(await f.rec(f.S(1))).revision})).toMatchObject({changed:false});
      expect(await db.sdkEvent.count({where:{sdkId:(await f.rec(f.S(1))).id}})).toBe(events);expect(await db.sdkRecord.count({where:{code:f.S(1)}})).toBe(1);
    }finally{await f.cleanup();}
  });
  it('a code in another VM list moves only explicitly; a store code is taken once even when two people try; stale round refused',async()=>{
    const f=await setup();try{
      await f.add('VM_001',f.S(1));
      await expect(f.add('VM_002',f.S(1))).rejects.toMatchObject({code:'OWNER_CONFLICT',message:expect.stringMatching(/VM_001/)});
      const v1=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}}),r=await f.rec(f.S(1));
      expect(await f.add('VM_002',f.S(1),{expectedSdkRevision:r.revision,from:{vmId:f.vm.id,expectedRevision:v1.revision}})).toMatchObject({changed:true});
      expect((await f.list('VM_001')).length).toBe(0);expect((await f.list('VM_002')).map(s=>s.code)).toEqual([f.S(1)]);
      // Put back in the store, then two people take it at once: exactly one wins.
      const r1=await f.rec(f.S(1));await removeVmSdk(f.scope,{key:randomUUID(),vmId:f.vms.VM_002.id,expectedCycle:1,sdkId:r1.id,expectedRevision:r1.revision},db);
      const stored=await f.rec(f.S(1));expect(stored.holderVmId).toBeNull();
      const results=await Promise.allSettled([f.add('VM_003',f.S(1),{expectedSdkRevision:stored.revision}),f.add('VM_004',f.S(1),{expectedSdkRevision:stored.revision})]);
      expect(results.filter(x=>x.status==='fulfilled').length).toBe(1);expect((await f.rec(f.S(1))).holderVmId).toBeTruthy();
      // A command made for an older round of the VM is refused.
      await expect(addVmSdk(f.scope,{key:randomUUID(),vmId:f.vms.VM_005.id,expectedCycle:2,code:f.S(9),expectedSdkRevision:null},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // Money edit from Kho SDK and from the VM list is one record (same revision check).
      const s1=await f.rec(f.S(1));await updateSdkInfo(f.scope,{key:randomUUID(),sdkId:s1.id,expectedRevision:s1.revision,amount:'3.5'},db);
      await expect(updateSdkInfo(f.scope,{key:randomUUID(),sdkId:s1.id,expectedRevision:s1.revision,amount:'4'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    }finally{await f.cleanup();}
  });
  it('account SUS → VM recreated with the same code: unused codes stay usable, used stay used, nothing marked by the SUS',async()=>{
    const f=await setup();try{
      await f.add('VM_001',f.S(1));await f.add('VM_001',f.S(2));await f.add('VM_001',f.S(3));await f.used('VM_001',f.S(3));
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1},db);
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id},include:{operation:true}});expect(vm.code).toBe('VM_001');expect(vm.operation?.cycle).toBe(2);
      const l=await f.list('VM_001');expect(l.map(s=>[s.code,s.state])).toEqual([[f.S(1),'UNLINKED'],[f.S(2),'UNLINKED'],[f.S(3),'LINKED']]);
      // The new round can tick an unused code from the old round; the used one is still refused anywhere.
      expect(await f.used('VM_001',f.S(1))).toMatchObject({changed:true});expect((await f.rec(f.S(1))).linkedCycle).toBe(2);
      await expect(f.add('VM_002',f.S(3))).rejects.toMatchObject({code:'OWNER_CONFLICT'});
      // A command still carrying round 1 is refused.
      const r2=await f.rec(f.S(2));await expect(markVmSdkUsed(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,sdkId:r2.id,expectedRevision:r2.revision},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    }finally{await f.cleanup();}
  });
  it('undo of an add takes the new code away again; a used mark is final',async()=>{
    const f=await setup();try{
      const key=randomUUID();await addVmSdk(f.scope,{key,vmId:f.vm.id,expectedCycle:1,code:f.S(1),expectedSdkRevision:null},db);
      const j=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,commandKey:key}});
      await undoOperation(f.scope,j.id,'thử',db);expect(await db.sdkRecord.count({where:{code:f.S(1)}})).toBe(0);
      await f.add('VM_001',f.S(2));await f.used('VM_001',f.S(2));
      const u=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'SDK_USED'}});expect(u.reversible).toBe(false);
    }finally{await f.cleanup();}
  });
});
describe('Dán bảng → SDK',()=>{
  it('A. VM codes in any order, several codes per VM, Server column optional; a retry writes nothing twice',async()=>{
    const f=await setup();try{
      const text=[`VM_005\t${f.S(1)}\t1,5\tghi chú a`,`VM_002 | ${f.S(2)}`,`VM_005 | ${f.S(3)} | | ghi chú c`,`${f.server.code} | VM_010 | ${f.S(4)} | 2`,`VM_009 | ${f.S(5)}`,`VM_007 | ${f.S(6)}`,`VM_002 | ${f.S(1)}`].join('\n');
      const p=await previewSdkPaste(f.scope,{mode:'VM',text,serverId:f.server.id},db);
      expect(p.rows.map(r=>[r.line,r.vm,r.outcome])).toEqual([[1,'VM_005','ERROR'],[2,'VM_002','NEW'],[3,'VM_005','NEW'],[4,'VM_010','NEW'],[5,'VM_009','ERROR'],[6,'VM_007','ERROR'],[7,'VM_002','ERROR']]);
      expect(p.rows[0].message).toMatch(/dòng 7/);expect(p.rows[4].message).toMatch(/Không có VM VM_009/);expect(p.rows[5].message).toMatch(/đã xoá/);
      const items=p.rows.filter(r=>r.outcome==='NEW').map(r=>({line:r.line,vmId:r.vmId!,code:r.code!,expectedSdkRevision:r.expectedSdkRevision,amount:r.amount,note:r.note}));
      const key=randomUUID(),done=await applySdkPaste(f.scope,{key,items},db);expect(done).toMatchObject({applied:3,errors:0});
      expect(await applySdkPaste(f.scope,{key,items},db)).toMatchObject({replay:true});
      expect(await applySdkPaste(f.scope,{key:randomUUID(),items},db)).toMatchObject({applied:0,same:3});
      expect((await f.list('VM_005')).map(s=>s.code)).toEqual([f.S(3)]);expect((await f.rec(f.S(3))).note).toBe('ghi chú c');expect((await f.rec(f.S(4))).amount?.toString()).toBe('2');
      // Blank money / note keep the stored values; the same code at the same VM again is "giữ nguyên".
      const again=await previewSdkPaste(f.scope,{mode:'VM',text:`VM_005 | ${f.S(3)}`,serverId:f.server.id},db);expect(again.rows[0]).toMatchObject({outcome:'SAME'});
    }finally{await f.cleanup();}
  });
  it('B. no VM codes: the range from the start VM by number, never by table order; blank lines keep their place; missing VMs reported',async()=>{
    const f=await setup();try{
      expect(rangeCode(rangeStart('VM_011')!,9)).toBe('VM_020');
      const lines=[f.S(1),f.S(2)+' | 7','',f.S(4),f.S(5),f.S(6)+'\t\tghi chú'];
      const p=await previewSdkPaste(f.scope,{mode:'RANGE',text:lines.join('\n'),serverId:f.server.id,startVmId:f.vms.VM_004.id},db);
      expect(p.range).toEqual({from:'VM_004',to:'VM_009',count:6});
      expect(p.rows.map(r=>[r.vm,r.outcome])).toEqual([['VM_004','NEW'],['VM_005','NEW'],['VM_006','SKIP'],['VM_007','ERROR'],['VM_008','NEW'],['VM_009','ERROR']]);
      const items=p.rows.filter(r=>r.outcome==='NEW').map(r=>({line:r.line,vmId:r.vmId!,code:r.code!,expectedSdkRevision:r.expectedSdkRevision,amount:r.amount,note:r.note}));
      await applySdkPaste(f.scope,{key:randomUUID(),items},db);
      expect((await f.list('VM_004')).map(s=>s.code)).toEqual([f.S(1)]);expect((await f.list('VM_005')).map(s=>s.code)).toEqual([f.S(2)]);expect((await f.list('VM_008')).map(s=>s.code)).toEqual([f.S(5)]);
      expect((await f.list('VM_006')).length).toBe(0);expect((await f.rec(f.S(2))).amount?.toString()).toBe('7');
      // Headers do not take a VM; a used code is refused at its line; Server / VM must be chosen.
      expect(parseSdkPaste('RANGE','SDK | Tiền | Ghi chú\n'+f.S(9),null).map(l=>l.code)).toEqual([f.S(9)]);
      await expect(previewSdkPaste(f.scope,{mode:'RANGE',text:f.S(1)},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }finally{await f.cleanup();}
  });
});
