import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,setup} from '../ops-api/ops-fixture';
import {loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {observeVmSdks} from '@/server/vm-management/sdk-observe';
import {applySdkStore,previewSdkStore,readSdkDetail,readSdkStore,saveVmSdk,updateSdkInfo} from '@/server/vm-management/sdk-store';
import {addVmSdk,applySdkPaste,previewSdkPaste} from '@/server/vm-management/sdk-list';
import {applyVmBulk,previewVmBulk} from '@/server/vm-management/bulk';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {inspectOperation} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {restoreSdkImage} from '@/server/vm-management/sdk-undo';
import {SDK_MONEY_WRITE_REFUSAL} from '@/server/vm-management/sdk-money-rights';
afterAll(()=>db.$disconnect());
// Tiền tích luỹ SDK follows ONE rights rule on every path (independent review 22/10/2026): read = the EarnApp balance read right, write =
// the EarnApp balance write right (EARN_BALANCE / ADMIN / MODERATOR), on the web services as on the ops API; undo restores the amount
// together with its observation time and source. Synthetic data, test database only.
const ago=(h:number)=>new Date(Math.floor(Date.now()/60e3)*60e3-h*3600e3).toISOString(),T1=ago(3),T2=ago(2);
async function fx(){
  const f=await setup(),P=f.projectId,tag=randomUUID().slice(0,6).toUpperCase();
  const cur=async()=>{const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id},include:{operation:true}});return {revision:v.revision,cycle:v.operation?.cycle??1};};
  const aiScope={projectId:P,userId:f.ai,role:'USER' as const,capabilities:[] as string[]};
  const rec=(code:string)=>db.sdkRecord.findUniqueOrThrow({where:{projectId_code:{projectId:P,code}}});
  const observe=async(code:string,amount:string,at:string,current=false)=>{const v=await cur(),r=await db.sdkRecord.findUnique({where:{projectId_code:{projectId:P,code}}});
    return observeVmSdks(aiScope,{key:randomUUID(),vmId:f.vm.id,expectedCycle:v.cycle,expectedVmRevision:v.revision,observedAt:at,source:'AE Mini Tool · OCR',evidence:'ảnh #'+amount,items:[{code,expectedSdkRevision:r?.revision??null,amount,current}]},db);};
  const plain=await loadInfrastructureScope(db,f.plain,P);
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:P}});await f.cleanup();};
  return {...f,P,cur,aiScope,observe,plain,rec,cleanup,code:(n:string)=>'MR'+tag+n.padStart(6,'0')};
}
describe('SDK money rights on the web services',()=>{
  it('a reader without the balance right gets no amount, time, source, evidence or history money anywhere; the right shows everything',async()=>{
    const f=await fx();try{
      const c=f.code('1');await f.observe(c,'731.25',T1,true);
      const row=await f.rec(c);
      const store=await readSdkStore(f.plain,db),mine=store.find(r=>r.code===c)!;
      expect(mine).toMatchObject({amount:null,observedAt:null,amountAt:null,amountSource:null,moneyHidden:true});
      const detail=await readSdkDetail(f.plain,row.id,db);
      expect(detail.moneyHidden).toBe(true);expect(detail.events.length).toBeGreaterThan(0);
      for(const e of detail.events)for(const k of ['amount','from','to','source','evidence'])expect(e.detail??{},e.kind).not.toHaveProperty(k);
      const ws=await readVMWorkspace(f.plain,db),v=ws.vms.find(x=>x.id===f.vm.id)!;
      expect(ws.sdkMoney).toEqual({read:false,write:false});expect(v.sdks[0]).toMatchObject({code:c,amount:null,amountObservedAt:null,moneyHidden:true});expect(v.sdk?.amount).toBeNull();
      const journal=await db.operationJournal.findFirstOrThrow({where:{projectId:f.P,kind:'VM_SDK_OBSERVE'},orderBy:{createdAt:'desc'}});
      const hist=await inspectOperation(f.plain,journal.id,db);
      for(const [name,data] of Object.entries({store,detail,ws,hist})){const j=JSON.stringify(data);expect(j,name).not.toContain('731.25');expect(j,name).not.toContain('731,25');expect(j,name).not.toContain('ảnh #');}
      expect(JSON.stringify(hist)).toContain('tiền / ghi chú ẩn');
      // The admin (money rights) and the AI user (EARN_BALANCE) see it all.
      const full=(await readSdkStore(f.scope,db)).find(r=>r.code===c)!;
      expect(full).toMatchObject({amount:'731.25',observedAt:T1,moneyHidden:false});expect(full.amountSource).toContain('AE Mini Tool');
      expect((await readVMWorkspace(f.aiScope,db)).sdkMoney).toEqual({read:true,write:true});
      expect(JSON.stringify(await inspectOperation(f.scope,journal.id,db))).toContain('731,25');
      expect(JSON.stringify(await readSdkDetail(f.scope,row.id,db))).toContain('ảnh #731.25');
    }finally{await f.cleanup();}
  });
  it('money on every web write path needs the balance write right: cell, Kho SDK, Dán bảng, bulk; codes and notes still work without it',async()=>{
    const f=await fx();try{
      const c1=f.code('2'),c2=f.code('3'),c3=f.code('4'),c4=f.code('5'),c5=f.code('6'),c6=f.code('7');
      await f.observe(c1,'731.25',T1,true);const row=await f.rec(c1),v=await f.cur();
      const forbidden=async(p:Promise<unknown>)=>{await expect(p).rejects.toMatchObject({code:'FORBIDDEN'});await expect(p).rejects.toThrow(SDK_MONEY_WRITE_REFUSAL);};
      await forbidden(updateSdkInfo(f.plain,{key:randomUUID(),sdkId:row.id,expectedRevision:row.revision,amount:'999.75'},db));
      await forbidden(updateSdkInfo(f.plain,{key:randomUUID(),sdkId:row.id,expectedRevision:row.revision,amount:null},db));
      expect((await f.rec(c1)).amount!.toString()).toBe('731.25');
      await updateSdkInfo(f.plain,{key:randomUUID(),sdkId:row.id,expectedRevision:row.revision,note:'ghi chú không tiền'},db);
      expect((await f.rec(c1)).note).toBe('ghi chú không tiền');
      await forbidden(addVmSdk(f.plain,{key:randomUUID(),vmId:f.vm.id,expectedCycle:v.cycle,code:c2,amount:'1'},db));
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c2}})).toBe(0);
      await addVmSdk(f.plain,{key:randomUUID(),vmId:f.vm.id,expectedCycle:v.cycle,code:c2},db);expect((await f.rec(c2)).amount).toBeNull();
      await forbidden(applySdkStore(f.plain,{key:randomUUID(),rows:[{line:1,code:c3,expectedRevision:null,amount:'2'}]},db));
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c3}})).toBe(0);
      expect((await previewSdkStore(f.plain,{text:c3+' 2'},db)).rows[0]).toMatchObject({outcome:'ERROR',message:SDK_MONEY_WRITE_REFUSAL});
      expect((await previewSdkStore(f.plain,{text:c3},db)).rows[0].outcome).toBe('NEW');
      await forbidden(applySdkPaste(f.plain,{key:randomUUID(),items:[{line:1,vmId:f.vm.id,expectedCycle:v.cycle,code:c4,expectedSdkRevision:null,amount:'3'}]},db));
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c4}})).toBe(0);
      const paste=await previewSdkPaste(f.plain,{mode:'VM',text:f.vm.code+' | '+c4+' | 3',serverId:f.server.id},db);
      expect(paste.rows[0]).toMatchObject({outcome:'ERROR',message:SDK_MONEY_WRITE_REFUSAL});
      expect((await previewSdkPaste(f.plain,{mode:'VM',text:f.vm.code+' | '+c4,serverId:f.server.id},db)).rows[0].outcome).toBe('NEW');
      const vmRow=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
      const bulk=await previewVmBulk(f.plain,{kind:'SDK',serverId:f.server.id,text:f.vm.code+'\t'+c5+'\t4'},db);
      expect(bulk.rows[0]).toMatchObject({outcome:'ERROR',message:SDK_MONEY_WRITE_REFUSAL});
      await forbidden(applyVmBulk(f.plain,{kind:'SDK',key:randomUUID(),items:[{line:1,vmId:f.vm.id,expectedRevision:vmRow.revision,expectedSdkRevision:null,value:c5,amount:'4'}]},db));
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c5}})).toBe(0);
      await forbidden(saveVmSdk(f.plain,{key:randomUUID(),vmId:f.vm.id,expectedVmRevision:vmRow.revision,expectedCycle:v.cycle,code:c6,amount:'5'},db));
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c6}})).toBe(0);
      // The AI user (EARN_BALANCE) and the admin may write money.
      const r1=await f.rec(c1);await updateSdkInfo(f.aiScope,{key:randomUUID(),sdkId:r1.id,expectedRevision:r1.revision,amount:'800'},db);
      expect((await f.rec(c1)).amount!.toString()).toBe('800');
    }finally{await f.cleanup();}
  });
  it('undoing a web money edit restores the amount with its observation time and source, so a later machine reading is SAVED, not OLDER',async()=>{
    const f=await fx();try{
      const c=f.code('8');await f.observe(c,'10',T1,true);const row=await f.rec(c),key=randomUUID();
      await updateSdkInfo(f.scope,{key,sdkId:row.id,expectedRevision:row.revision,amount:'20'},db);
      const edited=await f.rec(c);expect(edited.amount!.toString()).toBe('20');expect(edited.amountSource).toBe('Web · Kho SDK');expect(edited.amountObservedAt!.getTime()).toBeGreaterThan(Date.parse(T2));
      const journal=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.P,commandKey:key}}});
      await undoOperation(f.scope,journal.id,'kiểm tra',db);
      const back=await f.rec(c);
      expect(back.amount!.toString()).toBe('10');expect(back.amountObservedAt!.toISOString()).toBe(T1);expect(back.amountSource).toBe(row.amountSource);expect(back.amountAt!.getTime()).toBe(row.amountAt!.getTime());expect(back.amountById).toBe(row.amountById);
      const next=await f.observe(c,'15',T2);
      expect(next.items[0].amount.outcome).toBe('SAVED');expect((await f.rec(c)).amount!.toString()).toBe('15');
    }finally{await f.cleanup();}
  });
  it('an image written before the observation fields existed restores the amount with an unknown time and source (never invented)',async()=>{
    const f=await fx();try{
      const c=f.code('9');await f.observe(c,'10',T1,true);const row=await f.rec(c);
      const before:Record<string,unknown>={...row,amount:'7'};delete before.amountObservedAt;delete before.amountSource;
      await db.$transaction(tx=>restoreSdkImage(tx,f.P,{resource:'SDK',id:row.id,before,after:{...row}} as never,f.scope.userId));
      const back=await f.rec(c);
      expect(back.amount!.toString()).toBe('7');expect(back.amountObservedAt).toBeNull();expect(back.amountSource).toBeNull();
      expect((await readSdkStore(f.scope,db)).find(r=>r.code===c)).toMatchObject({amount:'7',observedAt:null});
    }finally{await f.cleanup();}
  });
});
