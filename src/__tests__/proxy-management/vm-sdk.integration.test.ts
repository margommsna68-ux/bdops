import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {businessDB as db,businessFixture} from './business-fixture';
import {previewSdkUpdate,applySdkUpdate,readSdkHistory} from '@/server/vm-management/sdk';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {listOperations,inspectOperation} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
const SDK_A='sdk-fixture-aaaa-000000000001',SDK_B='sdk-fixture-bbbb-000000000002',SDK_C='sdk-fixture-cccc-000000000003';
async function sdkFixture(){
  const f=await businessFixture();
  const vm2=await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_002',managed:true,proxySlotState:'BLANK'}});
  const server2=await db.server.create({data:{projectId:f.scope.projectId,code:'second-fixture',managed:true}});
  const vm3=await db.virtualMachine.create({data:{serverId:server2.id,code:'VM_001',managed:true,proxySlotState:'BLANK'}});
  const revision=async(id:string)=>(await db.virtualMachine.findUniqueOrThrow({where:{id}})).revision;
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,vm2,server2,vm3,revision,cleanup};
}
it('operator records one SDK; workspace, per-VM history and journal reflect it; same key replays and same value is a no-op',async()=>{
  const f=await sdkFixture();try{
    const key=randomUUID();
    const first=await applySdkUpdate(f.worker,{key,items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm.id)}]},db);
    expect(first).toMatchObject({updated:1,replay:false});
    const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});expect(vm.sdkId).toBe(SDK_A);expect(vm.sdkRecordedById).toBe(f.worker.userId);expect(vm.sdkRecordedAt).not.toBeNull();
    const workspace=await readVMWorkspace(f.worker,db),row=workspace.vms.find(v=>v.id===f.vm.id)!;expect(row.sdk).toMatchObject({id:SDK_A});expect(row.sdk?.recordedAt).toBeTruthy();
    expect(await readSdkHistory(f.worker,f.vm.id,db)).toMatchObject([{previousSdk:null,newSdk:SDK_A}]);
    const ops=await listOperations(f.scope,db);expect(ops.filter(o=>o.kind==='VM_SDK_RECORD')).toHaveLength(1);
    const detail=await inspectOperation(f.scope,ops[0].id,db);expect(detail.rows[0]).toMatchObject({label:'business-fixture / VM_001',before:'Chưa có SDK',after:SDK_A});
    expect(await applySdkUpdate(f.worker,{key,items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:0}]},db)).toMatchObject({updated:1,replay:true});
    const again=await applySdkUpdate(f.worker,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm.id)}]},db);expect(again.updated).toBe(0);
    expect((await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD')).toHaveLength(1);expect(await db.vMSdkHistory.count({where:{vmId:f.vm.id}})).toBe(1);
  }finally{await f.cleanup();}
});
it('preview maps pasted rows by server+VM identity and reports unknown, blank, duplicate and conflicting SDKs',async()=>{
  const f=await sdkFixture();try{
    await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm.id)}]},db);
    const text=['vm\tsdk','VM_001\t'+SDK_A,'vm_002\t'+SDK_B,'VM_002\t'+SDK_B,'VM_009\t'+SDK_C,'VM_002\t','VM_002\tbad sdk'].join('\n');
    const preview=await previewSdkUpdate(f.worker,{text,serverId:f.server.id},db);
    expect(preview.rows.map(r=>[r.vm,r.outcome])).toEqual([['VM_001','SKIP'],['VM_002','ERROR'],['VM_002','ERROR'],['VM_009','ERROR'],['VM_002','SKIP'],['VM_002','ERROR']]);
    expect(preview.rows[1].message).toMatch(/Trùng trong danh sách/);expect(preview.rows[3].message).toMatch(/Không tìm thấy VM/);expect(preview.rows[4].message).toMatch(/Giữ nguyên/);expect(preview.rows[5].message).toMatch(/không hợp lệ/i);
    const multi=await previewSdkUpdate(f.worker,{text:['Business-Fixture\tVM_002\t'+SDK_B,'second-fixture\tVM_001\t'+SDK_A,'nope\tVM_001\t'+SDK_C,'VM_001\t'+SDK_C].join('\n')},db);
    expect(multi.rows.map(r=>r.outcome)).toEqual(['READY','ERROR','ERROR','ERROR']);
    expect(multi.rows[0]).toMatchObject({vmId:f.vm2.id,current:null,next:SDK_B,server:'business-fixture'});
    expect(multi.rows[1].message).toMatch(/đang thuộc business-fixture \/ VM_001/);expect(multi.rows[2].message).toMatch(/Không tìm thấy server/);expect(multi.rows[3].message).toMatch(/Chọn server/);
    expect(multi).toMatchObject({ready:1,errors:3,skipped:0});
  }finally{await f.cleanup();}
});
it('apply is atomic: conflicts, stale revisions, foreign or archived VMs and viewers never partially write',async()=>{
  const f=await sdkFixture(),other=await businessFixture();try{
    await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm.id)}]},db);
    const rev2=await f.revision(f.vm2.id);
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm3.id,sdk:SDK_C,expectedRevision:await f.revision(f.vm3.id)},{vmId:f.vm2.id,sdk:SDK_A,expectedRevision:rev2}]},db)).rejects.toMatchObject({code:'OWNER_CONFLICT'});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm3.id}})).sdkId).toBeNull();
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:SDK_B,expectedRevision:rev2+5}]},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:other.vm.id,sdk:SDK_B,expectedRevision:0}]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:'bad sdk',expectedRevision:rev2}]},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:null,expectedRevision:rev2}]},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await db.virtualMachine.update({where:{id:f.vm3.id},data:{archivedAt:new Date()}});
    await expect(applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm3.id,sdk:SDK_C,expectedRevision:await f.revision(f.vm3.id)}]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
    await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
    await expect(applySdkUpdate(f.worker,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:SDK_B,expectedRevision:rev2}]},db)).rejects.toMatchObject({code:'FORBIDDEN'});
    const api=appRouter.createCaller({prisma:db,session:{user:{id:f.worker.userId},expires:'2099-01-01'}} as unknown as Context);
    await expect(api.vmManagement.sdkApply({projectId:f.scope.projectId,key:randomUUID(),items:[{vmId:f.vm2.id,sdk:SDK_B,expectedRevision:rev2}]})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(api.vmManagement.sdkPreview({projectId:f.scope.projectId,text:'VM_002\t'+SDK_B,serverId:f.server.id})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm2.id}})).sdkId).toBeNull();
    await expect(db.$executeRaw`UPDATE "VirtualMachine" SET "sdkId"=${SDK_A} WHERE id=${f.vm2.id}`).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  }finally{await f.cleanup();await other.cleanup();}
});
it('explicit clear frees the SDK for another VM and undo restores the previous SDK with history',async()=>{
  const f=await sdkFixture();try{
    await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm.id)}]},db);
    const change=await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:SDK_B,expectedRevision:await f.revision(f.vm.id)}]},db);expect(change.updated).toBe(1);
    expect(await readSdkHistory(f.scope,f.vm.id,db)).toMatchObject([{previousSdk:SDK_A,newSdk:SDK_B},{previousSdk:null,newSdk:SDK_A}]);
    const op=(await listOperations(f.scope,db)).find(o=>o.kind==='VM_SDK_RECORD')!;expect(op.canUndo).toBe(true);
    await undoOperation(f.scope,op.id,'Ghi nhầm máy',db);
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBe(SDK_A);
    expect((await readSdkHistory(f.scope,f.vm.id,db))[0]).toMatchObject({previousSdk:SDK_B,newSdk:SDK_A,note:expect.stringMatching(/Hoàn tác/)});
    await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm.id,sdk:null,clear:true,expectedRevision:await f.revision(f.vm.id)}]},db);
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).sdkId).toBeNull();
    const moved=await applySdkUpdate(f.scope,{key:randomUUID(),items:[{vmId:f.vm2.id,sdk:SDK_A,expectedRevision:await f.revision(f.vm2.id)}]},db);expect(moved.updated).toBe(1);
    const stale=(await listOperations(f.scope,db)).filter(o=>o.kind==='VM_SDK_RECORD').at(-1)!;await expect(undoOperation(f.scope,stale.id,'Quá muộn',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    const missing=(await readVMWorkspace(f.scope,db)).vms.filter(v=>!v.sdk).map(v=>v.code);expect(missing).toEqual(['VM_001','VM_001']);
  }finally{await f.cleanup();}
});
