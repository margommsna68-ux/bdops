import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveVmSdk,linkVmSdk,confirmLegacySdk,previewSdkStore,applySdkStore,updateSdkInfo,readSdkStore,readSdkDetail} from '@/server/vm-management/sdk-store';
import {applySdkUpdate} from '@/server/vm-management/sdk';
import {previewVmBulk,applyVmBulk} from '@/server/vm-management/bulk';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {archiveVMs,restoreVMs} from '@/server/vm-management/metadata';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {listOperations,inspectOperation} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
// SDK store (owner brief 19/10/2026). Fixture: business-fixture / VM_001, VM_002 and second-fixture / VM_001 (another server).
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,8);
  const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
  const server2=await db.server.create({data:{projectId:f.scope.projectId,code:'second-fixture',managed:true}});
  const vm3=await db.virtualMachine.create({data:{serverId:server2.id,code:'VM_001',managed:true,proxySlotState:'BLANK'}});
  const A='sdk-A123-'+x,B='sdk-B456-'+x,C='sdk-C789-'+x;
  const row=async(id:string)=>db.virtualMachine.findUniqueOrThrow({where:{id},include:{operation:true}});
  // The revision a client that just read the store sees for this code (null = not stored).
  const seen=async(code:string|null)=>code?(await db.sdkRecord.findUnique({where:{projectId_code:{projectId:f.scope.projectId,code}}}))?.revision??null:null;
  const save=async(vmId:string,code:string|null,extra:{amount?:string|null;note?:string|null;from?:{vmId:string;expectedRevision:number}|null;expectedCycle?:number}={},scope=f.scope)=>{const v=await row(vmId);return saveVmSdk(scope,{key:randomUUID(),vmId,expectedVmRevision:v.revision,expectedCycle:extra.expectedCycle??v.operation?.cycle??1,code,expectedSdkRevision:await seen(code),amount:extra.amount,note:extra.note,from:extra.from},db);};
  const rec=(code:string)=>db.sdkRecord.findFirst({where:{projectId:f.scope.projectId,code}});
  const account=async(vmId:string,n:number)=>{const login=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:`sdk-login-${n}-${x}@example.invalid`,loginType:'GMAIL',businessManaged:true}});return db.earnAppAccount.create({data:{projectId:f.scope.projectId,loginId:login.id,vmId}});};
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,x,vm2,server2,vm3,A,B,C,row,save,rec,account,cleanup};
}
const finance=async(projectId:string)=>Promise.all([db.fundTransaction.count({where:{projectId}}),db.costRecord.count({where:{projectId}}),db.withdrawal.count({where:{projectId}}),db.teamReceipt.count({where:{projectId}}),db.earnPayoutRequest.count({where:{projectId}})]);
describe('Kho SDK: tiền / ghi chú theo mã',()=>{
  it('1–3, 8. A = 12,40 USD with a note; a new code B replaces it without inheriting; A stays in the store and keeps its money on another server; editing the money never touches the books',async()=>{
    const f=await setup();try{
      const before=await finance(f.scope.projectId);
      const r=await f.save(f.vm.id,f.A,{amount:'12,40',note:'máy chạy tốt'},f.worker);expect(r).toMatchObject({changed:true});
      let a=await f.rec(f.A);expect(a).toMatchObject({vmId:f.vm.id,note:'máy chạy tốt',linkState:'UNLINKED',amountById:f.worker.userId});expect(a!.amount!.toString()).toBe('12.4');
      const ws=(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===f.vm.id)!;expect(ws.sdk).toMatchObject({id:f.A,amount:'12.4',note:'máy chạy tốt',state:'UNLINKED'});
      // 2. VM_001 gets a new current code B: A stays in VM_001's SDK list (brief 20/10/2026) with 12,40; B has nothing of A.
      await f.save(f.vm.id,f.B);
      a=await f.rec(f.A);const b=await f.rec(f.B);expect(a).toMatchObject({vmId:null,holderVmId:f.vm.id,note:'máy chạy tốt'});expect(a!.amount!.toString()).toBe('12.4');expect(b).toMatchObject({vmId:f.vm.id,amount:null,note:null});
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBe(f.B);
      // Not recorded ≠ 0.
      await f.save(f.vm2.id,f.C,{amount:'0'});const store=await readSdkStore(f.scope,db);
      expect(store.find(s=>s.code===f.B)).toMatchObject({amount:null,vm:{code:'VM_001',server:'business-fixture'}});expect(store.find(s=>s.code===f.C)?.amount).toBe('0');expect(store.find(s=>s.code===f.A)).toMatchObject({vm:{code:'VM_001'},current:false,amount:'12.4'});
      // 3. A on a VM of another server: money, note and history follow the code.
      // (it sits in VM_001's list, so it moves only explicitly: source VM_001 → target)
      await f.save(f.vm3.id,f.A,{from:{vmId:f.vm.id,expectedRevision:(await f.row(f.vm.id)).revision}});a=await f.rec(f.A);expect(a).toMatchObject({vmId:f.vm3.id,holderVmId:f.vm3.id,note:'máy chạy tốt'});expect(a!.amount!.toString()).toBe('12.4');
      const detail=await readSdkDetail(f.scope,a!.id,db);expect(detail.events.map(e=>e.kind).reverse()).toEqual(['CREATE','PLACE','REMOVE','MOVE']);
      expect(detail.events[0]).toMatchObject({kind:'MOVE',to:'second-fixture / VM_001'});
      // 8. 12,40 → 15: the latest total, not a sum; nothing in the PayPal / cost / income books.
      await f.save(f.vm3.id,f.A,{amount:'15'});a=await f.rec(f.A);expect(a!.amount!.toString()).toBe('15');
      await f.save(f.vm3.id,f.A,{amount:'15'});expect((await readSdkDetail(f.scope,a!.id,db)).events.filter(e=>e.kind==='AMOUNT')).toHaveLength(1);// same value: no new history
      expect(await finance(f.scope.projectId)).toEqual(before);
      // Recording SDKs never changes the EarnApp account or the operating status.
      expect(await db.vmOperation.count({where:{projectId:f.scope.projectId}})).toBe(0);expect(await db.earnAppAccount.count({where:{projectId:f.scope.projectId}})).toBe(0);
    }finally{await f.cleanup();}
  });
});
describe('Chuyển SDK nguồn → đích',()=>{
  it('4. moving an unlinked SDK from VM1 to VM2 updates both in one transaction; the target\'s old code is kept; typing it never takes it; a stale source writes nothing',async()=>{
    const f=await setup();try{
      await f.save(f.vm.id,f.A,{amount:'5'});await f.save(f.vm2.id,f.B,{note:'B cũ'});
      // Typing / pasting A on VM_002 is refused with the source named; nothing changes.
      await expect(f.save(f.vm2.id,f.A)).rejects.toMatchObject({code:'OWNER_CONFLICT',message:expect.stringMatching(/đang ở business-fixture \/ VM_001.*Dùng cho VM này/)});
      const bulk=await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:'VM_002\t'+f.A},db);expect(bulk.rows[0]).toMatchObject({outcome:'ERROR',message:expect.stringMatching(/đang ở business-fixture \/ VM_001/)});
      // Stale source revision: refused, both VMs unchanged.
      const src=await f.row(f.vm.id);
      await expect(f.save(f.vm2.id,f.A,{from:{vmId:f.vm.id,expectedRevision:src.revision+3}})).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect((await f.rec(f.A))!.vmId).toBe(f.vm.id);expect((await f.rec(f.B))!.vmId).toBe(f.vm2.id);
      const moved=await f.save(f.vm2.id,f.A,{from:{vmId:f.vm.id,expectedRevision:src.revision}});expect(moved.message).toMatch(/Đã chuyển .* từ business-fixture \/ VM_001.*vẫn trong danh sách SDK của VM/);
      expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).toMatchObject({sdkId:null});expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm2.id}})).toMatchObject({sdkId:f.A});
      expect(await f.rec(f.B)).toMatchObject({vmId:null,note:'B cũ'});expect((await f.rec(f.A))!.amount!.toString()).toBe('5');
      // Undo of the move (nothing changed since): source, target and both codes go back.
      const op=(await listOperations(f.scope,db)).find(o=>o.kind==='SDK_MOVE')!;expect(op.canUndo).toBe(true);
      await undoOperation(f.scope,op.id,'',db);
      expect((await f.rec(f.A))!.vmId).toBe(f.vm.id);expect((await f.rec(f.B))!.vmId).toBe(f.vm2.id);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBe(f.A);expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm2.id}})).sdkId).toBe(f.B);
    }finally{await f.cleanup();}
  });
  it('6. two people taking the same stored SDK at once: one wins; a failure inside the transaction saves nothing; a command prepared for the old round is refused',async()=>{
    const f=await setup();try{
      await applySdkStore(f.scope,{key:randomUUID(),rows:[{line:1,code:f.A,expectedRevision:null,amount:'3'}]},db);
      const [v1,v2]=await Promise.all([f.row(f.vm.id),f.row(f.vm2.id)]),revA=(await db.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:f.scope.projectId,code:f.A}}})).revision;
      const results=await Promise.allSettled([saveVmSdk(f.scope,{key:randomUUID(),vmId:v1.id,expectedVmRevision:v1.revision,expectedCycle:1,code:f.A,expectedSdkRevision:revA},db),saveVmSdk(f.worker,{key:randomUUID(),vmId:v2.id,expectedVmRevision:v2.revision,expectedCycle:1,code:f.A,expectedSdkRevision:revA},db)]);
      expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(await db.virtualMachine.count({where:{sdkId:f.A}})).toBe(1);expect(await db.sdkRecord.count({where:{code:f.A}})).toBe(1);
      // Second item fails (code on another VM): the first item of the same command is not saved either.
      const holder=(await f.rec(f.A))!.vmId===f.vm.id?f.vm2:f.vm;const v3=await f.row(f.vm3.id),vh=await f.row(holder.id);
      await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm3.id,sdk:f.C,expectedRevision:v3.revision},{vmId:holder.id,sdk:f.A,expectedRevision:vh.revision}]},db)).rejects.toMatchObject({code:'OWNER_CONFLICT'});
      expect(await f.rec(f.C)).toBeNull();expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm3.id}})).sdkId).toBeNull();
      // Old round: VM_003 recreated (SUS) → a command for round 1 is refused.
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm3.id,status:'SUSPENDED',expectedCycle:1}]},db);
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm3.id,expectedCycle:1},db);
      await expect(f.save(f.vm3.id,f.B,{expectedCycle:1})).rejects.toMatchObject({code:'STALE_PREVIEW',message:expect.stringMatching(/lượt 2/)});
      expect(await f.rec(f.B)).toBeNull();
    }finally{await f.cleanup();}
  });
});
describe('Đã nối EarnApp',()=>{
  it('5. linking needs the VM\'s current account; once linked the code is never reused through the cell, paste, store, move, recreation or undo',async()=>{
    const f=await setup();try{
      await f.save(f.vm.id,f.A,{amount:'9'});let a=(await f.rec(f.A))!;
      await expect(linkVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:'none',expectedCycle:1},db)).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/chưa có tài khoản EarnApp/)});
      expect((await f.rec(f.A))!.linkState).toBe('UNLINKED');// an account in the cell later is not a link either
      const ea=await f.account(f.vm.id,1);expect((await f.rec(f.A))!.linkState).toBe('UNLINKED');
      const linked=await linkVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:ea.id,expectedCycle:1},db);expect(linked.changed).toBe(true);
      a=(await f.rec(f.A))!;expect(a).toMatchObject({linkState:'LINKED',linkedEarnAppId:ea.id,linkedVmId:f.vm.id,linkedCycle:1,linkedById:f.worker.userId});expect(a.linkedAt).not.toBeNull();
      const op=(await listOperations(f.scope,db)).find(o=>o.kind==='SDK_LINK')!;expect(op.canUndo).toBe(false);
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT'});expect((await inspectOperation(f.scope,op.id,db)).blockedReason).toMatch(/vĩnh viễn/);
      // Replaced on VM_001 by B: A goes to history, not to the usable store.
      await f.save(f.vm.id,f.B);expect(await f.rec(f.A)).toMatchObject({vmId:null,linkState:'LINKED'});
      await expect(f.save(f.vm2.id,f.A)).rejects.toMatchObject({message:expect.stringMatching(/đã nối EarnApp/)});
      expect((await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:'VM_002\t'+f.A},db)).rows[0]).toMatchObject({outcome:'ERROR',message:expect.stringMatching(/đã nối EarnApp/)});
      const v2=await f.row(f.vm2.id);await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:f.A,expectedRevision:v2.revision}]},db)).rejects.toMatchObject({message:expect.stringMatching(/đã nối EarnApp/)});
      // Undo of B replacing A puts A back on the VM: allowed (A is still linked, nothing becomes unlinked); A stays LINKED.
      const replace=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD')[0]!;await undoOperation(f.scope,replace.id,'',db);
      expect(await f.rec(f.A)).toMatchObject({vmId:f.vm.id,linkState:'LINKED'});expect(await f.rec(f.B)).toBeNull();// B was created by that operation
      // Store paste may update money / note of a linked code (information only); it stays linked.
      const p=await previewSdkStore(f.scope,{text:f.A+'\t11'},db);expect(p.rows[0]).toMatchObject({outcome:'UPDATE',state:'LINKED'});
      await applySdkStore(f.scope,{key:randomUUID(),rows:[{line:1,code:f.A,expectedRevision:p.rows[0].expectedRevision,amount:'11'}]},db);expect(await f.rec(f.A)).toMatchObject({linkState:'LINKED',vmId:f.vm.id});
      // Recreation (SUS): the linked code stops being current but stays in the VM's list, still used (brief 20/10/2026).
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1},db);
      expect(await f.rec(f.A)).toMatchObject({vmId:null,holderVmId:f.vm.id,linkState:'LINKED'});
      const store=await readSdkStore(f.scope,db);expect(store.find(s=>s.code===f.A)).toMatchObject({state:'LINKED',vm:{code:'VM_001'},current:false,linkedLogin:`sdk-login-1-${f.x}@example.invalid`});
    }finally{await f.cleanup();}
  });
  it('5b. the link checks the current SDK, the current account and the round',async()=>{
    const f=await setup();try{
      await f.save(f.vm.id,f.A);const a=(await f.rec(f.A))!,ea=await f.account(f.vm.id,2);
      await expect(linkVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision+1,earnAppId:ea.id,expectedCycle:1},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      await expect(linkVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:'other-account',expectedCycle:1},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      await expect(linkVmSdk(f.scope,{key:randomUUID(),vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:ea.id,expectedCycle:2},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      const key=randomUUID();await linkVmSdk(f.scope,{key,vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:ea.id,expectedCycle:1},db);
      expect(await linkVmSdk(f.scope,{key,vmId:f.vm.id,sdkId:a.id,expectedSdkRevision:a.revision,earnAppId:ea.id,expectedCycle:1},db)).toMatchObject({replay:true});// double click / lost answer
      expect((await listOperations(f.scope,db)).filter(o=>o.kind==='SDK_LINK')).toHaveLength(1);
    }finally{await f.cleanup();}
  });
});
describe('Dán vào Kho SDK',()=>{
  it('7. valid / invalid / repeated lines at their place; blank cells keep; "-" clears; pasting again changes nothing; a retry after a lost answer writes nothing twice',async()=>{
    const f=await setup();try{
      await applySdkStore(f.scope,{key:randomUUID(),rows:[{line:1,code:f.A,expectedRevision:null,amount:'12.4',note:'ghi chú A'}]},db);
      const text=['SDK\tTiền tích luỹ USD\tGhi chú',f.A+'\t15\t',f.B+'\t\tmới B','bad sdk!\t3',f.C+'\tabc',f.C+'\t2','sdk-DUP-'+f.x+'\t1','sdk-DUP-'+f.x+'\t2'].join('\n');
      const p=await previewSdkStore(f.scope,{text},db),at=(n:number)=>p.rows.find(r=>r.line===n)!;
      expect(at(2)).toMatchObject({outcome:'UPDATE',amount:'15',note:undefined,before:{amount:'12.4',note:'ghi chú A'}});// blank note keeps
      expect(at(3)).toMatchObject({outcome:'NEW',amount:undefined,note:'mới B'});expect(at(4).outcome).toBe('ERROR');
      expect(at(5)).toMatchObject({outcome:'ERROR'});expect(at(6).outcome).toBe('ERROR');expect(at(6).message).toMatch(/lặp ở dòng 5/);
      expect(at(7).message).toMatch(/lặp ở dòng 8/);expect(at(8).outcome).toBe('ERROR');expect(p).toMatchObject({ready:2,errors:5});
      const rows=p.rows.filter(r=>r.outcome==='NEW'||r.outcome==='UPDATE').map(r=>({line:r.line,code:r.code,expectedRevision:r.expectedRevision,amount:r.amount,note:r.note})),key=randomUUID();
      const saved=await applySdkStore(f.scope,{key,rows},db);expect(saved).toMatchObject({saved:2,errors:0});
      expect(await f.rec(f.A)).toMatchObject({note:'ghi chú A'});expect((await f.rec(f.A))!.amount!.toString()).toBe('15');expect(await f.rec(f.B)).toMatchObject({amount:null,note:'mới B',vmId:null});
      // Same key again (lost answer): replay; a new key with the same rows: nothing to write; one record per code.
      expect(await applySdkStore(f.scope,{key,rows},db)).toMatchObject({replay:true});
      expect(await applySdkStore(f.scope,{key:randomUUID(),rows},db)).toMatchObject({saved:0,same:2});
      expect(await db.sdkRecord.count({where:{projectId:f.scope.projectId}})).toBe(2);
      const again=await previewSdkStore(f.scope,{text:f.A+'\t15\n'+f.B+'\t\tmới B'},db);expect(again.rows.map(r=>r.outcome)).toEqual(['SAME','SAME']);
      expect((await listOperations(f.scope,db)).filter(o=>o.kind==='SDK_STORE')).toHaveLength(2);
      // "-" clears explicitly.
      const clear=await previewSdkStore(f.scope,{text:f.A+'\t-\t-'},db);expect(clear.rows[0]).toMatchObject({outcome:'UPDATE',amount:null,note:null});
      await applySdkStore(f.scope,{key:randomUUID(),rows:[{line:1,code:f.A,expectedRevision:clear.rows[0].expectedRevision,amount:null,note:null}]},db);expect(await f.rec(f.A)).toMatchObject({amount:null,note:null});
      // Stale preview: refused at that row only.
      const stale=await previewSdkStore(f.scope,{text:f.A+'\t1\n'+f.C+'\t2'},db);await updateSdkInfo(f.scope,{key:randomUUID(),sdkId:(await f.rec(f.A))!.id,expectedRevision:stale.rows[0].expectedRevision!,note:'đổi chen giữa'},db);
      const r=await applySdkStore(f.scope,{key:randomUUID(),rows:stale.rows.map(x=>({line:x.line,code:x.code,expectedRevision:x.expectedRevision,amount:x.amount,note:x.note}))},db);
      expect(r.rows.map(x=>x.outcome)).toEqual(['ERROR','SAVED']);
    }finally{await f.cleanup();}
  });
  it('Dán bảng by VM carries the target code\'s money and note: VM | SDK | tiền | ghi chú; the replaced code keeps its own',async()=>{
    const f=await setup();try{
      await f.save(f.vm.id,f.A,{amount:'4',note:'A'});
      const p=await previewVmBulk(f.scope,{kind:'SDK',text:`business-fixture\tVM_001\t${f.B}\t7,25\tghi B\nsecond-fixture\tVM_001\t${f.C}`},db);
      expect(p.rows[0]).toMatchObject({outcome:'READY',amount:'7.25',note:'ghi B',info:expect.stringMatching(/7,25 USD/)});expect(p.rows[1]).toMatchObject({outcome:'READY'});
      const r=await applyVmBulk(f.scope,{kind:'SDK',key:randomUUID(),items:p.rows.map(x=>({line:x.line,vmId:x.vmId!,expectedRevision:x.expectedRevision!,value:x.value,amount:x.amount,note:x.note}))},db);expect(r.applied).toBe(2);
      expect(await f.rec(f.A)).toMatchObject({vmId:null,holderVmId:f.vm.id,note:'A'});expect((await f.rec(f.A))!.amount!.toString()).toBe('4');
      expect(await f.rec(f.B)).toMatchObject({vmId:f.vm.id,note:'ghi B'});expect((await f.rec(f.B))!.amount!.toString()).toBe('7.25');
      // A is still in VM_001's list, so pasting it on VM_002 is refused with its place (never taken); same values again: nothing to do.
      const back=await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:`VM_002\t${f.A}\nVM_001\t${f.B}\t7.25`},db);expect(back.rows.map(x=>x.outcome)).toEqual(['ERROR','SKIP']);expect(back.rows[0].message).toMatch(/business-fixture \/ VM_001/);
    }finally{await f.cleanup();}
  });
});
describe('Dữ liệu cũ, xoá / khôi phục / tạo lại, hoàn tác',()=>{
  it('9. migrated codes are "Chưa xác nhận": never offered or placed until a person confirms; "đã từng nối" is final',async()=>{
    const f=await setup();try{
      const old=await db.sdkRecord.create({data:{projectId:f.scope.projectId,code:f.A,linkState:'UNCONFIRMED'}}),old2=await db.sdkRecord.create({data:{projectId:f.scope.projectId,code:f.B,linkState:'UNCONFIRMED'}});
      await expect(f.save(f.vm.id,f.A)).rejects.toMatchObject({message:expect.stringMatching(/chưa xác nhận/)});
      expect((await previewVmBulk(f.scope,{kind:'SDK',serverId:f.server.id,text:'VM_001\t'+f.A},db)).rows[0].outcome).toBe('ERROR');
      expect((await readSdkStore(f.scope,db)).find(s=>s.code===f.A)).toMatchObject({state:'UNCONFIRMED',amount:null});
      await confirmLegacySdk(f.worker,{key:randomUUID(),sdkId:old.id,expectedRevision:0,decision:'UNLINKED'},db);await f.save(f.vm.id,f.A);expect((await f.rec(f.A))!.vmId).toBe(f.vm.id);
      await confirmLegacySdk(f.scope,{key:randomUUID(),sdkId:old2.id,expectedRevision:0,decision:'LINKED'},db);expect(await f.rec(f.B)).toMatchObject({linkState:'LINKED',linkedEarnAppId:null});
      const op=(await listOperations(f.scope,db)).find(o=>o.kind==='SDK_CONFIRM'&&!o.canUndo)!;await expect(undoOperation(f.scope,op.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      await expect(f.save(f.vm2.id,f.B)).rejects.toMatchObject({message:expect.stringMatching(/đã nối EarnApp/)});
    }finally{await f.cleanup();}
  });
  it('10. deleting a VM keeps its SDK there; a never-linked code may be moved out of a deleted VM; restoring never takes it back; recreating sends an unlinked code to the store',async()=>{
    const f=await setup();try{
      await f.save(f.vm2.id,f.A,{amount:'2'});await archiveVMs(f.scope,[f.vm2.id],db);
      expect((await readSdkStore(f.scope,db)).find(s=>s.code===f.A)).toMatchObject({vm:{code:'VM_002',deleted:true}});
      await expect(f.save(f.vm2.id,f.B)).rejects.toMatchObject({message:expect.stringMatching(/đã xoá/)});
      const src=await f.row(f.vm2.id);await f.save(f.vm3.id,f.A,{from:{vmId:f.vm2.id,expectedRevision:src.revision}});
      const back=await restoreVMs(f.scope,[f.vm2.id],db);expect(back.restored).toBe(1);
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm2.id}})).sdkId).toBeNull();expect((await f.rec(f.A))!.vmId).toBe(f.vm3.id);
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm3.id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm3.id,expectedCycle:1},db);
      expect(await f.rec(f.A)).toMatchObject({vmId:null,linkState:'UNLINKED'});expect((await f.rec(f.A))!.amount!.toString()).toBe('2');
      expect((await db.vmCycle.findFirstOrThrow({where:{vmId:f.vm3.id}})).sdkId).toBe(f.A);
    }finally{await f.cleanup();}
  });
  it('11. undo of a money / note edit only while nothing changed after it; undo of a new code removes it; undo never reopens the old round',async()=>{
    const f=await setup();try{
      await f.save(f.vm.id,f.A,{amount:'12,40',note:'n1'});await f.save(f.vm.id,f.A,{amount:'15'});
      const edits=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD');
      await undoOperation(f.scope,edits[0].id,'',db);expect((await f.rec(f.A))!.amount!.toString()).toBe('12.4');
      await f.save(f.vm.id,f.A,{note:'n2'});const noteOp=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD'&&!o.undoneById)[0];
      await f.save(f.vm.id,f.A,{note:'n3'});await expect(undoOperation(f.scope,noteOp.id,'',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // The first record of A, undone after the recreation: refused (the round moved on, the code left the VM).
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1},db);
      const first=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD').at(-1)!;await expect(undoOperation(f.scope,first.id,'',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect((await db.vmOperation.findUniqueOrThrow({where:{vmId:f.vm.id}})).cycle).toBe(2);
      // A new code on the new round, undone right away: the code disappears, the VM is empty again.
      await f.save(f.vm.id,f.C);const newOp=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD')[0];await undoOperation(f.scope,newOp.id,'',db);
      expect(await f.rec(f.C)).toBeNull();expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBeNull();
      // Journals that changed VM.sdkId directly (before the store) are view-only.
      const legacy=await db.operationJournal.findFirstOrThrow({where:{id:newOp.id}});
      expect((await import('@/server/operation-history/undo-rules')).undoRefusal('VM_SDK_RECORD',{version:3,resources:[{resource:'VM_SDK',id:f.vm.id,before:{sdkId:null},after:{sdkId:'x'}}],eventIds:[],replacementIds:[]} as never)).toMatch(/trước khi có Kho SDK/);expect(legacy).toBeTruthy();
    }finally{await f.cleanup();}
  });
});
describe('Quyền',()=>{
  it('14. viewer reads but cannot write; people outside the project cannot read or write; a code of another project is refused without naming it; the router uses the same checks',async()=>{
    const f=await setup(),other=await businessFixture();try{
      const foreignVm=await db.virtualMachine.findUniqueOrThrow({where:{id:other.vm.id}});
      await saveVmSdk(other.scope,{key:randomUUID(),vmId:other.vm.id,expectedVmRevision:foreignVm.revision,expectedCycle:1,code:f.C,expectedSdkRevision:null,amount:'99',note:'bí mật'},db);
      await expect(f.save(f.vm.id,f.C)).rejects.toMatchObject({code:'OWNER_CONFLICT',message:expect.not.stringMatching(/business-fixture|VM_001|99|bí mật/)});
      const p=await previewSdkStore(f.scope,{text:f.C+'\t1'},db);expect(p.rows[0]).toMatchObject({outcome:'ERROR',location:null,before:null});
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
      expect(await readSdkStore(f.worker,db)).toEqual([]);
      await expect(f.save(f.vm.id,f.A,{},f.worker)).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(applySdkStore(f.worker,{key:randomUUID(),rows:[{line:1,code:f.A,expectedRevision:null}]},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      const outsider={...other.scope,projectId:f.scope.projectId};
      await expect(readSdkStore(outsider,db)).rejects.toMatchObject({code:'FORBIDDEN'});
      const api=appRouter.createCaller({prisma:db,session:{user:{id:other.scope.userId},expires:'2099-01-01'}} as unknown as Context);
      await expect(api.vmManagement.sdkStore({projectId:f.scope.projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
      const v=await f.row(f.vm.id);
      await expect(api.vmManagement.sdkSave({projectId:f.scope.projectId,key:randomUUID(),vmId:f.vm.id,expectedVmRevision:v.revision,expectedCycle:1,code:f.A,expectedSdkRevision:null})).rejects.toMatchObject({code:'FORBIDDEN'});
      const viewer=appRouter.createCaller({prisma:db,session:{user:{id:f.worker.userId},expires:'2099-01-01'}} as unknown as Context);
      await expect(viewer.vmManagement.sdkSave({projectId:f.scope.projectId,key:randomUUID(),vmId:f.vm.id,expectedVmRevision:v.revision,expectedCycle:1,code:f.A,expectedSdkRevision:null})).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(await f.rec(f.A)).toBeNull();
    }finally{await f.cleanup();await db.vMSdkHistory.deleteMany({where:{projectId:other.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:other.scope.projectId}});await other.cleanup();}
  });
});
