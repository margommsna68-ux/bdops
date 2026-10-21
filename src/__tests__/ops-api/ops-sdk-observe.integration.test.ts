import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db,AI_PIN,api,setup} from './ops-fixture';
import {expectConforms} from './openapi-conform';
import {addManagedVMs} from '@/server/vm-management/metadata';
import {createOpsToken,revokeOpsToken} from '@/server/ops-api/tokens';
import {addVmSdk,markVmSdkUsed} from '@/server/vm-management/sdk-list';
import {saveVmSdk} from '@/server/vm-management/sdk-store';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {runWithOpsAuth} from '@/server/ops-api/context';
import {observeVmSdks} from '@/server/vm-management/sdk-observe';
import {hashToken} from '@/server/ops-api/tokens';
afterAll(()=>db.$disconnect());
// SDK codes seen running on a machine, with the money read there (owner brief 22/10/2026), through the ops API. The machine is simulated:
// these tests check what MoneyToHome records and refuses. Synthetic data, test database only.
async function obs(){
  const f=await setup(),P=f.projectId,tag=randomUUID().slice(0,6).toUpperCase();
  // A VM without an EarnApp account (added on the web, nothing linked).
  await addManagedVMs(f.scope,f.server.id,['OBS_A','OBS_B'],db);
  const [a,b]=await Promise.all(['OBS_A','OBS_B'].map(code=>db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code}})));
  const tok=async(scopes:string[])=>(await createOpsToken(f.scope.userId,{projectId:P,userId:f.ai,name:'Central · AI',scopes:scopes as never,expiresInDays:30,pin:'123456'},db)).token!;
  const vm=async(id:string)=>{const v=await db.virtualMachine.findUniqueOrThrow({where:{id},include:{operation:true}});return {revision:v.revision,cycle:v.operation?.cycle??1};};
  const post=async(t:string,vmId:string,body:Record<string,unknown>,key=randomUUID())=>{const path='vms/'+vmId+'/sdk-observations',r=await api('POST',path,{token:t,body:{projectId:P,...body},key,pin:AI_PIN});expectConforms('POST',path,r);return r;};
  const body=async(vmId:string,sdks:unknown[],at:string,extra:Record<string,unknown>={})=>{const v=await vm(vmId);return {expectedCycle:v.cycle,expectedVmRevision:v.revision,observedAt:at,source:'AE Mini Tool · màn hình EarnApp',sdks,...extra};};
  const rec=(code:string)=>db.sdkRecord.findUnique({where:{projectId_code:{projectId:P,code}}});
  // Every money / account table of the project: an SDK observation must leave all of them as they are.
  const books=async()=>({fund:await db.fundTransaction.count({where:{projectId:P}}),cost:await db.costRecord.count({where:{projectId:P}}),withdrawal:await db.withdrawal.count({where:{projectId:P}}),
    balance:await db.earnBalanceCheck.count({where:{projectId:P}}),payout:await db.earnPayoutRequest.count({where:{projectId:P}}),earnApp:await db.earnAppAccount.count({where:{projectId:P}}),
    ops:JSON.stringify(await db.vmOperation.findMany({where:{projectId:P},select:{vmId:true,status:true},orderBy:{vmId:'asc'}}))});
  const code=(n:string)=>'OBS'+tag+n.padStart(6,'0');
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:P}});await f.cleanup();};
  return {...f,P,a,b,tok,vm,post,body,rec,books,code,cleanup};
}
// Observation times in the past (an observedAt in the future is refused).
const ago=(h:number)=>new Date(Math.floor(Date.now()/3600e3)*3600e3-h*3600e3).toISOString(),T0=ago(4),T1=ago(3),T2=ago(2),T3=ago(1);
describe('POST /vms/{id}/sdk-observations',()=>{
  it('a VM without EarnApp records the running SDK and its money on the code (Chưa xác nhận); a replay answers the first ack; nothing financial',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS','SDK_AMOUNT']),before=await f.books(),c=f.code('1'),key=randomUUID();
      const b=await f.body(f.a.id,[{code:c,amountUsd:'12.345678',amountRead:true,current:true},{code:c}],T1);
      const r=await f.post(t,f.a.id,b,key);
      expect(r.status).toBe(200);
      expect(r.json.data.recorded.sdks).toEqual([expect.objectContaining({code:c,placed:'CREATED',linkState:'UNCONFIRMED',current:true,amount:{outcome:'SAVED',amountUsd:'12.345678',observedAt:T1}})]);
      const row=await f.rec(c);
      expect(row).toMatchObject({holderVmId:f.a.id,vmId:f.a.id,linkState:'UNCONFIRMED'});
      expect(row!.amount!.toString()).toBe('12.345678');expect(row!.amountObservedAt!.toISOString()).toBe(T1);expect(row!.amountAt!.getTime()).toBeGreaterThan(Date.parse(T1));
      expect(row!.amountSource).toContain('AE Mini Tool');expect(row!.amountSource).toContain('Central · AI');
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.a.id}})).sdkId).toBe(c);
      // Same key + same body after a lost answer: the first acknowledgement, nothing written twice.
      const events=await db.sdkEvent.count({where:{sdkId:row!.id}});
      const again=await f.post(t,f.a.id,b,key);
      expect(again.status).toBe(200);expect(again.json.data.replay).toBe(true);expect(again.json.data.recorded).toEqual(r.json.data.recorded);
      expect(await db.sdkEvent.count({where:{sdkId:row!.id}})).toBe(events);expect(await db.sdkRecord.count({where:{projectId:f.P,code:c}})).toBe(1);
      // Same key, other content: refused.
      const other=await f.post(t,f.a.id,{...b,sdks:[{code:c,amountUsd:'13',amountRead:true}]},key);
      expect(other.status).toBe(409);expect(other.json.error!.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await f.books()).toEqual(before);
    }finally{await f.cleanup();}
  });
  it('a late older observation never replaces a newer one; the same reading later only moves the check time; "could not read" is not 0',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS','SDK_AMOUNT']),c=f.code('2');
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'5.5'}],T1))).status).toBe(200);
      const late=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'4'}],T0));
      expect(late.status).toBe(200);expect(late.json.data.recorded.sdks[0].amount).toEqual({outcome:'OLDER',amountUsd:'5.5',observedAt:T1});
      expect((await f.rec(c))!.amount!.toString()).toBe('5.5');
      const same=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'5.50'}],T2));
      expect(same.json.data.recorded.sdks[0].amount).toEqual({outcome:'SAME',amountUsd:'5.5',observedAt:T2});
      expect((await f.rec(c))!.amountObservedAt!.toISOString()).toBe(T2);
      const unread=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountRead:false}],T3));
      expect(unread.json.data.recorded.sdks[0].amount.outcome).toBe('UNREADABLE');expect((await f.rec(c))!.amount!.toString()).toBe('5.5');
      // A new code read as unreadable stays "not recorded" (null), never 0.
      const d=f.code('3');await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountRead:false}],T1));expect((await f.rec(d))!.amount).toBeNull();
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountRead:true}],T1))).status).toBe(422);
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountUsd:'1',amountRead:true},{code:d,amountUsd:'2',amountRead:true}],T1))).status).toBe(422);
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountUsd:'1'}],new Date(Date.now()+3600e3).toISOString()))).status).toBe(422);
    }finally{await f.cleanup();}
  });
  it('wrong round / revision / VM and codes held elsewhere refuse the whole command and write nothing',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS','SDK_AMOUNT']),c=f.code('4'),fresh=f.code('5');
      // c is in the list of VM B (recorded on the web).
      const vb=await f.vm(f.b.id);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:vb.cycle,code:c},db);
      const before=await f.books(),okBody=await f.body(f.a.id,[{code:fresh,amountUsd:'1'},{code:c,amountUsd:'2'}],T1);
      const held=await f.post(t,f.a.id,okBody);
      expect(held.status).toBe(409);expect(held.json.error!.code).toBe('DUPLICATE');
      expect(await f.rec(fresh)).toBeNull();expect((await f.rec(c))!.holderVmId).toBe(f.b.id);expect((await f.rec(c))!.amount).toBeNull();
      expect((await f.post(t,f.a.id,{...okBody,sdks:[{code:fresh}],expectedCycle:okBody.expectedCycle+1})).json.error!.code).toBe('CYCLE_CHANGED');
      const stale=await f.post(t,f.a.id,{...okBody,sdks:[{code:fresh}],expectedVmRevision:okBody.expectedVmRevision+1});
      expect(stale.status).toBe(409);expect(stale.json.error!.code).toBe('REVISION_CONFLICT');expect(stale.json.error!.details.current.vmId).toBe(f.a.id);
      expect((await f.post(t,f.g.vm.id,{...okBody,sdks:[{code:fresh}]})).status).toBe(404);
      expect(await f.rec(fresh)).toBeNull();expect(await f.books()).toEqual(before);
    }finally{await f.cleanup();}
  });
  it('used and unconfirmed codes keep their mark; a different current code is kept and reported',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS','SDK_AMOUNT']),used=f.code('6'),cur=f.code('7'),seen=f.code('8');
      // VM B: current code `cur` (web), `used` in its list and ticked Đã dùng.
      let v=await f.vm(f.b.id);await saveVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedVmRevision:v.revision,expectedCycle:v.cycle,code:cur},db);
      v=await f.vm(f.b.id);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:v.cycle,code:used},db);
      const u=(await f.rec(used))!;await markVmSdkUsed(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:v.cycle,sdkId:u.id,expectedRevision:u.revision},db);
      const r=await f.post(t,f.b.id,await f.body(f.b.id,[{code:used,amountUsd:'7.25'},{code:seen,amountUsd:'0',current:true}],T1));
      expect(r.status).toBe(200);
      const by=(c:string)=>r.json.data.recorded.sdks.find((x:{code:string})=>x.code===c);
      expect(by(used)).toMatchObject({placed:'IN_LIST',linkState:'LINKED',amount:{outcome:'SAVED',amountUsd:'7.25'}});
      expect(by(seen)).toMatchObject({placed:'CREATED',linkState:'UNCONFIRMED',current:false,amount:{outcome:'SAVED',amountUsd:'0'}});
      expect(r.json.data.recorded.currentDiffers).toMatchObject({currentCode:cur});
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.b.id}})).sdkId).toBe(cur);
      expect((await f.rec(used))!.linkState).toBe('LINKED');expect((await f.rec(seen))!.amount!.toString()).toBe('0');
      // `seen` (Chưa xác nhận, in B's list) seen on VM A: refused, never moved.
      const moved=await f.post(t,f.a.id,await f.body(f.a.id,[{code:seen}],T2));
      expect(moved.status).toBe(409);expect((await f.rec(seen))!.holderVmId).toBe(f.b.id);
    }finally{await f.cleanup();}
  });
  it('money needs SDK_AMOUNT (also re-checked in the transaction); codes alone need VM_OPS; a revoked token writes nothing',async()=>{
    const f=await obs();try{
      const codesOnly=await f.tok(['READ','VM_OPS']),readOnly=await f.tok(['READ','SDK_AMOUNT']),c=f.code('9');
      const money=await f.post(codesOnly,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'3'}],T1));
      expect(money.status).toBe(403);expect(await f.rec(c)).toBeNull();
      const noOps=await api('POST','vms/'+f.a.id+'/sdk-observations',{token:readOnly,body:{projectId:f.P,...await f.body(f.a.id,[{code:c}],T1)}});
      expect(noOps.status).toBe(403);
      const plain=await f.post(codesOnly,f.a.id,await f.body(f.a.id,[{code:c}],T1));
      expect(plain.status).toBe(200);expect(plain.json.data.recorded.sdks[0]).toMatchObject({amount:{outcome:'NOT_SENT',amountUsd:null,observedAt:null}});
      // The VM detail lists each code with its own money only for SDK_AMOUNT; never a VM sum.
      const full=await f.tok(['READ','VM_OPS','SDK_AMOUNT']);await f.post(full,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'3'}],T1));
      const detail=(await api('GET','vms/'+f.a.id+'?projectId='+f.P,{token:full}));expectConforms('GET','vms/'+f.a.id,detail);
      expect(detail.json.data.sdk).toMatchObject({amountsVisible:true,items:[expect.objectContaining({code:c,amount:'3',observedAt:T1,current:false})]});
      expect(detail.json.data.sdk.referenceMoney).toBeUndefined();
      expect((await api('GET','vms/'+f.a.id+'?projectId='+f.P,{token:codesOnly})).json.data.sdk.items[0].amount).toBeNull();
      const tokRow=await db.opsToken.findFirstOrThrow({where:{userId:f.ai,scopes:{has:'SDK_AMOUNT'},revokedAt:null},orderBy:{createdAt:'desc'}});
      await revokeOpsToken(f.scope.userId,{projectId:f.P,tokenId:tokRow.id},db);
      expect((await api('POST','vms/'+f.a.id+'/sdk-observations',{token:full,body:{projectId:f.P,...await f.body(f.a.id,[{code:c,amountUsd:'9'}],T2)}})).status).toBe(401);
      expect((await f.rec(c))!.amount!.toString()).toBe('3');
    }finally{await f.cleanup();}
  });
  it('inside the transaction a token without SDK_AMOUNT (removed after the first check) writes no money and no code',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS']),row=await db.opsToken.findUniqueOrThrow({where:{tokenHash:hashToken(t)}}),c=f.code('12'),v=await f.vm(f.a.id);
      await expect(runWithOpsAuth({tokenId:row.id,userId:f.ai,operation:'VM_OPS',also:['SDK_AMOUNT']},()=>observeVmSdks({projectId:f.P,userId:f.ai,role:'USER',capabilities:[]},{key:randomUUID(),vmId:f.a.id,expectedCycle:v.cycle,expectedVmRevision:v.revision,observedAt:T1,source:'thử',items:[{code:c,amount:'1'}]},db))).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(await f.rec(c)).toBeNull();
    }finally{await f.cleanup();}
  });
  it('the Server / VM grid gives every code its own money and check time (no VM sum)',async()=>{
    const f=await obs();try{
      const t=await f.tok(['READ','VM_OPS','SDK_AMOUNT']),c1=f.code('10'),c2=f.code('11');
      await f.post(t,f.a.id,await f.body(f.a.id,[{code:c1,amountUsd:'2.5',current:true},{code:c2,amountUsd:'4'}],T1));
      const ws=await readVMWorkspace(f.scope,db),row=ws.vms.find(v=>v.id===f.a.id)!;
      expect(row.sdks.map(s=>({code:s.code,amount:s.amount,at:s.amountObservedAt,current:s.current})).sort((x,y)=>x.code.localeCompare(y.code))).toEqual([{code:c1,amount:'2.5',at:T1,current:true},{code:c2,amount:'4',at:T1,current:false}]);
    }finally{await f.cleanup();}
  });
});
