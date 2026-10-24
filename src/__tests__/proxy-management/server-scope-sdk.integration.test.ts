import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {addVmSdk,previewSdkPaste,vmSdkLists} from '@/server/vm-management/sdk-list';
import {readSdkDetail,readSdkStore,previewSdkStore,applySdkStore,saveVmSdk,updateSdkInfo,placeVmSdk,linkVmSdkIn} from '@/server/vm-management/sdk-store';
import {businessCollector} from '@/server/business-management/idempotency';
import {readSdkHistory,previewSdkUpdate,applySdkUpdate} from '@/server/vm-management/sdk';
import {observeVmSdks} from '@/server/vm-management/sdk-observe';

afterAll(()=>db.$disconnect());
async function setup(){
  const f=await businessFixture();
  const other=await db.server.create({data:{projectId:f.scope.projectId,code:'hidden-server',managed:true}});
  const hidden=await db.virtualMachine.create({data:{serverId:other.id,code:'hidden-vm',managed:true}});
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{serverScope:'SELECTED',allowedServerIds:[f.server.id],capabilities:['EARN_BALANCE']}});
  const create=(suffix:string,data:Record<string,unknown>={})=>db.sdkRecord.create({data:{projectId:f.scope.projectId,code:'scope-'+randomUUID()+'-'+suffix,linkState:'UNLINKED',createdById:f.scope.userId,...data}});
  const visible=await create('visible',{holderVmId:f.vm.id,amount:'19',amountVmId:hidden.id,amountCycle:1,amountObservedAt:new Date(),amountSource:'hidden evidence',linkedVmId:hidden.id,linkedAt:new Date(),linkedCycle:1,linkedById:f.scope.userId});
  const secret=await create('secret',{holderVmId:hidden.id});
  const stock=await create('stock');
  const fallback=await create('fallback',{vmId:f.vm.id});
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:f.scope.projectId}});await db.operationJournal.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();};
  return {...f,hidden,other,visible,secret,stock,fallback,create,cleanup};
}

describe('server scope SDK boundaries (real isolated test DB)',()=>{
  it('reloads membership, exposes only holder-bound SDKs and legacy current fallback, and redacts foreign readings and link metadata',async()=>{
    const f=await setup();try{
      // Deliberately forged ALL scope: read must use persisted membership.
      const rows=await readSdkStore({...f.worker,serverIds:null},db);
      expect(rows.map(r=>r.id).sort()).toEqual([f.visible.id,f.fallback.id].sort());
      expect(rows.find(r=>r.id===f.visible.id)).toMatchObject({amount:null,amountAt:null,observedAt:null,failedAt:null,amountSource:null,observedCycle:null,observedVmId:null,linkedLogin:null,linkedAt:null});
      expect(JSON.stringify(rows)).not.toContain(f.hidden.id);
      expect((await readSdkStore(f.scope,db)).find(r=>r.id===f.visible.id)?.amount).toBe('19');
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{allowedServerIds:[]}});
      expect(await readSdkStore({...f.worker,serverIds:[f.server.id]},db)).toEqual([]);
    }finally{await f.cleanup();}
  });
  it('VM list treats holder as authoritative and hides stored money from another VM',async()=>{
    const f=await setup();try{
      // Corrupt/legacy current mirror must not override the actual hidden holder.
      await db.sdkRecord.update({where:{id:f.fallback.id},data:{holderVmId:f.hidden.id}});
      const lists=await vmSdkLists(db,f.scope.projectId,[f.vm.id],true,{...f.worker,serverIds:[f.server.id]});
      expect([...lists.keys()]).toEqual([f.vm.id]);
      expect(lists.get(f.vm.id)?.map(r=>r.recordId)).toEqual([f.visible.id]);
      expect(lists.get(f.vm.id)?.[0].stored).toBeNull();
    }finally{await f.cleanup();}
  });
  it('denies scoped detail, history and global-store preview because free-text history cannot be isolated',async()=>{
    const f=await setup();try{
      await expect(readSdkDetail(f.worker,f.visible.id,db)).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(readSdkDetail(f.worker,f.secret.id,db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(readSdkHistory(f.worker,f.vm.id,db)).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(readSdkHistory(f.worker,f.hidden.id,db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(previewSdkStore(f.worker,{text:f.secret.code},db)).rejects.toMatchObject({code:'FORBIDDEN'});
    }finally{await f.cleanup();}
  });
  it('allows genuinely new codes on assigned VMs, denies hidden holders/stock without identifying them in paste errors',async()=>{
    const f=await setup();try{
      const code='new-'+randomUUID();
      await expect(addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code},db)).resolves.toMatchObject({changed:true});
      for(const rec of [f.secret,f.stock]){
        await expect(addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:rec.code,expectedSdkRevision:rec.revision},db)).rejects.toMatchObject({code:'NOT_FOUND'});
        const p=await previewSdkPaste(f.worker,{mode:'VM',serverId:f.server.id,text:`VM_001 | ${rec.code}`},db);
        expect(p.rows[0]).toMatchObject({outcome:'ERROR',expectedSdkRevision:null,info:null});
        expect(p.rows[0].message).not.toMatch(/hidden-server|hidden-vm/);
        const old=await previewSdkUpdate(f.worker,{serverId:f.server.id,text:`VM_001 | ${rec.code}`},db);
        expect(old.rows[0].outcome).toBe('ERROR');expect(old.rows[0].message).not.toMatch(/hidden-server|hidden-vm/);
      }
      await expect(previewSdkPaste(f.worker,{mode:'VM',serverId:f.other.id,text:'hidden-vm | another-new-sdk'},db)).rejects.toMatchObject({code:'NOT_FOUND'});
    }finally{await f.cleanup();}
  });
  it('direct write services reject hidden destinations, SDK ids, explicit cross-scope sources, and unassigned stock',async()=>{
    const f=await setup();try{
      await expect(addVmSdk(f.worker,{key:randomUUID(),vmId:f.hidden.id,expectedCycle:1,code:'new-'+randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(addVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:f.secret.code,expectedSdkRevision:f.secret.revision,from:{vmId:f.hidden.id,expectedRevision:f.hidden.revision}},db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(updateSdkInfo(f.worker,{key:randomUUID(),sdkId:f.secret.id,expectedRevision:f.secret.revision,note:'forbidden'},db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(saveVmSdk(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,expectedVmRevision:f.vm.revision,code:f.stock.code,expectedSdkRevision:f.stock.revision},db)).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(observeVmSdks(f.worker,{key:randomUUID(),vmId:f.vm.id,expectedCycle:1,expectedVmRevision:f.vm.revision,observedAt:new Date().toISOString(),source:'test',items:[{code:f.stock.code,expectedSdkRevision:f.stock.revision}]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
      expect((await db.sdkRecord.findUniqueOrThrow({where:{id:f.secret.id}})).note).toBeNull();
    }finally{await f.cleanup();}
  });
  it('paste changes and observation responses never disclose a historical foreign amount or replace a newer reading',async()=>{
    const f=await setup();try{
      const p=await previewSdkPaste(f.worker,{mode:'VM',serverId:f.server.id,text:`VM_001 | ${f.visible.code} | 3`},db);
      expect(p.rows[0].info).not.toContain('19');
      const base={vmId:f.vm.id,expectedCycle:1,expectedVmRevision:f.vm.revision,observedAt:new Date(f.visible.amountObservedAt!.getTime()-1000).toISOString(),source:'test'};
      for(const amount of [undefined,null,'2']){
        const r=await db.sdkRecord.findUniqueOrThrow({where:{id:f.visible.id}});
        const result=await observeVmSdks(f.worker,{...base,key:randomUUID(),items:[{code:r.code,expectedSdkRevision:r.revision,amount}]},db);
        expect(result.items[0].amount).toMatchObject({value:null,observedAt:null,source:null});
        expect((await db.sdkRecord.findUniqueOrThrow({where:{id:r.id}})).amount?.toString()).toBe('19');
      }
      const r=await db.sdkRecord.findUniqueOrThrow({where:{id:f.visible.id}});
      await expect(observeVmSdks(f.worker,{...base,key:randomUUID(),observedAt:r.amountObservedAt!.toISOString(),items:[{code:r.code,expectedSdkRevision:r.revision,amount:'2'}]},db)).rejects.toMatchObject({code:'STALE_PREVIEW',message:expect.not.stringContaining('19')});
    }finally{await f.cleanup();}
  });
  it('transaction services enforce refreshed membership; global store retries cannot replay after a scope restriction',async()=>{
    const f=await setup();try{
      await expect(db.$transaction(async tx=>placeVmSdk(tx,await businessCollector(tx,f.worker),{...f.worker,serverIds:null},{vmId:f.hidden.id,expectedCycle:1,expectedVmRevision:f.hidden.revision,code:'new-'+randomUUID()},{}))).rejects.toMatchObject({code:'NOT_FOUND'});
      await expect(db.$transaction(async tx=>linkVmSdkIn(tx,await businessCollector(tx,f.worker),{...f.worker,serverIds:null},{vmId:f.hidden.id,sdkId:f.secret.id,expectedSdkRevision:f.secret.revision,earnAppId:'unknown',expectedCycle:1}))).rejects.toMatchObject({code:'NOT_FOUND'});
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{serverScope:'ALL'}});
      const input={key:randomUUID(),rows:[{line:1,code:'stock-'+randomUUID(),expectedRevision:null}]};
      await applySdkStore(f.worker,input,db);
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{serverScope:'SELECTED'}});
      await expect(applySdkStore(f.worker,input,db)).rejects.toMatchObject({code:'FORBIDDEN'});
    }finally{await f.cleanup();}
  });
  it('code-only command retries cannot reveal an SDK moved to a hidden server after the original command',async()=>{
    const f=await setup();try{
      const input={key:randomUUID(),vmId:f.vm.id,expectedCycle:1,code:'retry-'+randomUUID()};
      await addVmSdk(f.worker,input,db);
      const rec=await db.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:f.scope.projectId,code:input.code}}});
      await db.sdkRecord.update({where:{id:rec.id},data:{holderVmId:f.hidden.id}});
      await expect(addVmSdk(f.worker,input,db)).rejects.toMatchObject({code:'NOT_FOUND'});
    }finally{await f.cleanup();}
  });
  it('an observation replay after scope reduction hides previously returned foreign retained money',async()=>{
    const f=await setup();try{
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{serverScope:'ALL'}});
      const input={key:randomUUID(),vmId:f.vm.id,expectedCycle:1,expectedVmRevision:f.vm.revision,observedAt:new Date().toISOString(),source:'test',items:[{code:f.visible.code,expectedSdkRevision:f.visible.revision}]};
      expect((await observeVmSdks(f.worker,input,db)).items[0].amount.value).toBe('19');
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{serverScope:'SELECTED'}});
      expect((await observeVmSdks(f.worker,input,db)).items[0].amount).toMatchObject({value:null,source:null,observedAt:null});
    }finally{await f.cleanup();}
  });
  it('legacy paste acknowledgements hide previous codes that subsequently left the assigned servers',async()=>{
    const f=await setup();try{
      const vm=await db.virtualMachine.update({where:{id:f.vm.id},data:{sdkId:f.fallback.code}});
      const input={key:randomUUID(),items:[{vmId:f.vm.id,sdk:'replace-'+randomUUID(),expectedRevision:vm.revision}]};
      expect((await applySdkUpdate(f.worker,input,db)).rows[0].previous).toBe(f.fallback.code);
      await db.sdkRecord.update({where:{id:f.fallback.id},data:{holderVmId:f.hidden.id}});
      expect((await applySdkUpdate(f.worker,input,db)).rows[0].previous).toBeNull();
      // A legacy current mirror pointing at a hidden holder is not a visible current SDK.
      await db.virtualMachine.update({where:{id:f.vm.id},data:{sdkId:f.fallback.code}});
      const preview=await previewSdkUpdate(f.worker,{serverId:f.server.id,text:'VM_001 | brand-new-sdk'},db);
      expect(preview.rows[0].current).toBeNull();
    }finally{await f.cleanup();}
  });
});
