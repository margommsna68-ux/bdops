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
// SDK codes seen running on a machine, with the money read there (owner briefs 22/10/2026), through the ops API. The machine is
// simulated: these tests check what MoneyToHome records and refuses. Synthetic data, test database only.
async function obs(){
  const f=await setup(),P=f.projectId,tag=randomUUID().slice(0,6).toUpperCase();
  // A VM without an EarnApp account (added on the web, nothing linked).
  await addManagedVMs(f.scope,f.server.id,['OBS_A','OBS_B'],db);
  const [a,b]=await Promise.all(['OBS_A','OBS_B'].map(code=>db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code}})));
  const tok=async(scopes:string[],userId=f.ai)=>(await createOpsToken(f.scope.userId,{projectId:P,userId,name:'Central · AI',scopes:scopes as never,expiresInDays:30,pin:'123456'},db)).token!;
  const vm=async(id:string)=>{const v=await db.virtualMachine.findUniqueOrThrow({where:{id},include:{operation:true}});return {revision:v.revision,cycle:v.operation?.cycle??1};};
  const post=async(t:string,vmId:string,body:Record<string,unknown>,key=randomUUID())=>{const path='vms/'+vmId+'/sdk-observations',r=await api('POST',path,{token:t,body:{projectId:P,...body},key,pin:AI_PIN});expectConforms('POST',path,r);return r;};
  const rec=(code:string)=>db.sdkRecord.findUnique({where:{projectId_code:{projectId:P,code}}});
  // The body a careful client sends: VM round / revision and each code's revision as read now (null = code not stored).
  const body=async(vmId:string,sdks:Record<string,unknown>[],at:string,extra:Record<string,unknown>={})=>{const v=await vm(vmId);
    const withRev=await Promise.all(sdks.map(async s=>'expectedSdkRevision' in s?s:{...s,expectedSdkRevision:(await rec(String(s.code)))?.revision??null}));
    return {expectedCycle:v.cycle,expectedVmRevision:v.revision,observedAt:at,source:'AE Mini Tool · màn hình EarnApp',sdks:withRev,...extra};};
  // Every money / account table of the project and every VM's status / account: an SDK observation must leave all of them as they are.
  const books=async()=>({fund:await db.fundTransaction.count({where:{projectId:P}}),cost:await db.costRecord.count({where:{projectId:P}}),withdrawal:await db.withdrawal.count({where:{projectId:P}}),
    balance:await db.earnBalanceCheck.count({where:{projectId:P}}),payout:await db.earnPayoutRequest.count({where:{projectId:P}}),earnApp:JSON.stringify(await db.earnAppAccount.findMany({where:{projectId:P},select:{id:true,vmId:true,closedAt:true},orderBy:{id:'asc'}})),
    ops:JSON.stringify(await db.vmOperation.findMany({where:{projectId:P},select:{vmId:true,status:true,cycle:true},orderBy:{vmId:'asc'}})),
    installed:JSON.stringify(await db.virtualMachine.findMany({where:{serverId:f.server.id},select:{id:true,installedConfigurationId:true},orderBy:{id:'asc'}}))});
  const code=(n:string)=>'OBS'+tag+n.padStart(6,'0');
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId:P}});await f.cleanup();};
  return {...f,P,a,b,tok,vm,post,body,rec,books,code,cleanup};
}
// Observation times in the past (an observedAt in the future is refused).
const ago=(h:number)=>new Date(Math.floor(Date.now()/3600e3)*3600e3-h*3600e3).toISOString(),T0=ago(4),T1=ago(3),T2=ago(2),T3=ago(1);
const FULL=['READ','VM_OPS','BALANCE_WRITE'];
describe('POST /vms/{id}/sdk-observations',()=>{
  it('a VM without EarnApp records the running SDK and $0.21 on the code (Chưa xác nhận, current); two files of one code = one SDK; a replay answers the first ack; nothing financial',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),before=await f.books(),c=f.code('1'),key=randomUUID();
      const b=await f.body(f.a.id,[{code:c,amountUsd:'0.21',amountRead:true,current:true},{code:c,amountUsd:'0.210'}],T1,{evidence:'Ảnh màn hình EarnApp #12'});
      const r=await f.post(t,f.a.id,b,key);
      expect(r.status).toBe(200);
      expect(r.json.data.recorded.sdks).toEqual([expect.objectContaining({code:c,placed:'CREATED',linkState:'UNCONFIRMED',current:true,amount:{outcome:'SAVED',amountUsd:'0.21',observedAt:T1}})]);
      expect(r.json.data.recorded.evidence).toBe('Ảnh màn hình EarnApp #12');
      const row=await f.rec(c);
      expect(row).toMatchObject({holderVmId:f.a.id,vmId:f.a.id,linkState:'UNCONFIRMED'});
      expect(row!.amount!.toString()).toBe('0.21');expect(row!.amountObservedAt!.toISOString()).toBe(T1);expect(row!.amountAt!.getTime()).toBeGreaterThan(Date.parse(T1));
      expect(row!.amountSource).toContain('AE Mini Tool');expect(row!.amountSource).toContain('Central · AI');
      expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.a.id}})).sdkId).toBe(c);
      expect(await db.sdkRecord.count({where:{projectId:f.P,code:c}})).toBe(1);
      // Same key + same body after a lost answer: the first acknowledgement (recorded unchanged), nothing written twice; current apart.
      const events=await db.sdkEvent.count({where:{sdkId:row!.id}}),hist=await db.vMSdkHistory.count({where:{vmId:f.a.id}});
      const again=await f.post(t,f.a.id,b,key);
      expect(again.status).toBe(200);expect(again.json.data.replay).toBe(true);expect(again.json.data.recorded).toEqual(r.json.data.recorded);
      expect(again.json.data.current.id).toBe(f.a.id);
      expect(await db.sdkEvent.count({where:{sdkId:row!.id}})).toBe(events);expect(await db.vMSdkHistory.count({where:{vmId:f.a.id}})).toBe(hist);
      // Same key, other content: refused.
      const other=await f.post(t,f.a.id,{...b,sdks:[{code:c,expectedSdkRevision:null,amountUsd:'13',amountRead:true}]},key);
      expect(other.status).toBe(409);expect(other.json.error!.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await f.books()).toEqual(before);
    }finally{await f.cleanup();}
  });
  it('late older result kept out; same time + other amount is a conflict; a newer same figure moves the check time; $0 is a value; OCR text and "could not read" are not money',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),c=f.code('2');
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'5.5'}],T1))).status).toBe(200);
      const late=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'4'}],T0));
      expect(late.status).toBe(200);expect(late.json.data.recorded.sdks[0].amount).toEqual({outcome:'OLDER',amountUsd:'5.5',observedAt:T1});
      expect((await f.rec(c))!.amount!.toString()).toBe('5.5');
      const clash=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'5.6'}],T1));
      expect(clash.status).toBe(409);expect(clash.json.error!.code).toBe('SDK_CONFLICT');expect(clash.json.error!.details).toMatchObject({kind:'SAME_TIME_OTHER_AMOUNT',storedAmountUsd:'5.5',observedAt:T1});
      expect((await f.rec(c))!.amount!.toString()).toBe('5.5');
      const same=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'5.50'}],T2));
      expect(same.json.data.recorded.sdks[0].amount).toEqual({outcome:'SAME',amountUsd:'5.5',observedAt:T2});
      expect((await f.rec(c))!.amountObservedAt!.toISOString()).toBe(T2);
      const zero=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'0'}],T3));
      expect(zero.json.data.recorded.sdks[0].amount).toMatchObject({outcome:'SAVED',amountUsd:'0'});expect((await f.rec(c))!.amount!.toString()).toBe('0');
      for(const ocr of ['5_17','5,17','5.17.0','-1','$5']){const r=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:ocr}],T3));expect(r.status,ocr).toBe(422);}
      expect((await f.rec(c))!.amount!.toString()).toBe('0');
      const unread=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountRead:false}],T3));
      expect(unread.json.data.recorded.sdks[0].amount.outcome).toBe('UNREADABLE');expect((await f.rec(c))!.amount!.toString()).toBe('0');
      // Tiền VM: the failed reading is remembered apart (Kiểm tra lỗi), the good figure and its own time stay; an older failure never moves it back.
      expect((await f.rec(c))!.amountFailedAt!.toISOString()).toBe(T3);
      await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountRead:false}],T2));expect((await f.rec(c))!.amountFailedAt!.toISOString()).toBe(T3);
      const grid=(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===f.a.id)!.sdks.find(x=>x.code===c)!;
      expect(grid).toMatchObject({amount:'0',amountObservedAt:T3,amountFailedAt:T3});
      // A new code read as unreadable stays "not checked" (null), never 0.
      const d=f.code('3');await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountRead:false}],T1));expect((await f.rec(d))!.amount).toBeNull();
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountRead:true}],T1))).status).toBe(422);
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountUsd:'1',amountRead:true},{code:d,amountUsd:'2',amountRead:true}],T1))).status).toBe(422);
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:d,amountUsd:'1'}],new Date(Date.now()+3600e3).toISOString()))).status).toBe(422);
    }finally{await f.cleanup();}
  });
  it('old money without an observation time reads as time unknown and a new observation may replace it',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),c=f.code('13'),v=await f.vm(f.a.id);
      await addVmSdk(f.scope,{key:randomUUID(),vmId:f.a.id,expectedCycle:v.cycle,code:c,amount:'3'},db);
      await db.sdkRecord.update({where:{projectId_code:{projectId:f.P,code:c}},data:{amountObservedAt:null,amountSource:null}}); // as before the migration
      const d=await api('GET','vms/'+f.a.id+'?projectId='+f.P,{token:t});expectConforms('GET','vms/'+f.a.id,d);
      expect(d.json.data.sdk.items[0]).toMatchObject({code:c,amount:'3',observedAt:null});expect(d.json.data.sdk.items[0].recordedAt).not.toBeNull();
      const ws=await readVMWorkspace(f.scope,db);expect(ws.vms.find(x=>x.id===f.a.id)!.sdks[0].amountObservedAt).toBeNull();
      const r=await f.post(t,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'2.75'}],T0));
      expect(r.json.data.recorded.sdks[0].amount).toEqual({outcome:'SAVED',amountUsd:'2.75',observedAt:T0});
    }finally{await f.cleanup();}
  });
  it('wrong round / VM revision / SDK revision / VM and codes held elsewhere refuse the whole command and write nothing',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),c=f.code('4'),fresh=f.code('5'),mine=f.code('14');
      // c is in the list of VM B (recorded on the web); mine is in the list of VM A.
      const vb=await f.vm(f.b.id);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:vb.cycle,code:c},db);
      const va=await f.vm(f.a.id);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.a.id,expectedCycle:va.cycle,code:mine},db);
      const before=await f.books(),okBody=await f.body(f.a.id,[{code:fresh,amountUsd:'1'},{code:c,amountUsd:'2'}],T1);
      const held=await f.post(t,f.a.id,okBody);
      expect(held.status).toBe(409);expect(held.json.error!.code).toBe('DUPLICATE');
      expect(await f.rec(fresh)).toBeNull();expect((await f.rec(c))!.holderVmId).toBe(f.b.id);expect((await f.rec(c))!.amount).toBeNull();
      const one=[{code:fresh,expectedSdkRevision:null}];
      expect((await f.post(t,f.a.id,{...okBody,sdks:one,expectedCycle:okBody.expectedCycle+1})).json.error!.code).toBe('CYCLE_CHANGED');
      const stale=await f.post(t,f.a.id,{...okBody,sdks:one,expectedVmRevision:okBody.expectedVmRevision+1});
      expect(stale.status).toBe(409);expect(stale.json.error!.code).toBe('REVISION_CONFLICT');expect(stale.json.error!.details.current.vmId).toBe(f.a.id);
      // SDK revision: null when the code is stored ("I saw nothing") or an old revision → refused, the code is untouched.
      const m=(await f.rec(mine))!;
      for(const exp of [null,m.revision+1]){const r=await f.post(t,f.a.id,await f.body(f.a.id,[{code:mine,expectedSdkRevision:exp,amountUsd:'9'}],T1));
        expect(r.status).toBe(409);expect(r.json.error!.code).toBe('REVISION_CONFLICT');expect(r.json.error!.details.sdk).toMatchObject({sdkId:m.id,revision:m.revision});}
      expect((await f.post(t,f.a.id,await f.body(f.a.id,[{code:fresh,expectedSdkRevision:0}],T1))).json.error!.code).toBe('REVISION_CONFLICT');
      expect((await f.rec(mine))!.amount).toBeNull();
      expect((await f.post(t,f.g.vm.id,{...okBody,sdks:one})).status).toBe(404);
      expect(await f.rec(fresh)).toBeNull();expect(await f.books()).toEqual(before);
    }finally{await f.cleanup();}
  });
  it('used and unconfirmed codes keep their mark; a VM with a different current code refuses (SDK_CONFLICT) and keeps it',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),used=f.code('6'),cur=f.code('7'),seen=f.code('8'),old=f.code('15');
      // VM B: current code `cur` (web), `used` in its list and ticked Đã dùng, `old` in its list Chưa xác nhận.
      let v=await f.vm(f.b.id);await saveVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedVmRevision:v.revision,expectedCycle:v.cycle,code:cur},db);
      v=await f.vm(f.b.id);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:v.cycle,code:used},db);await addVmSdk(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:v.cycle,code:old},db);
      const u=(await f.rec(used))!;await markVmSdkUsed(f.scope,{key:randomUUID(),vmId:f.b.id,expectedCycle:v.cycle,sdkId:u.id,expectedRevision:u.revision},db);
      await db.sdkRecord.update({where:{projectId_code:{projectId:f.P,code:old}},data:{linkState:'UNCONFIRMED'}});
      const before=await f.books();
      const swap=await f.post(t,f.b.id,await f.body(f.b.id,[{code:used,amountUsd:'7.25'},{code:seen,amountUsd:'0',current:true}],T1));
      expect(swap.status).toBe(409);expect(swap.json.error!.code).toBe('SDK_CONFLICT');expect(swap.json.error!.details).toMatchObject({kind:'CURRENT_DIFFERS',observedCode:seen,currentCode:cur});
      expect(await f.rec(seen)).toBeNull();expect((await f.rec(used))!.amount).toBeNull();expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.b.id}})).sdkId).toBe(cur);
      const r=await f.post(t,f.b.id,await f.body(f.b.id,[{code:used,amountUsd:'7.25'},{code:old,amountUsd:'1'},{code:cur,amountUsd:'0.5',current:true}],T1));
      expect(r.status).toBe(200);
      const by=(c:string)=>r.json.data.recorded.sdks.find((x:{code:string})=>x.code===c);
      expect(by(used)).toMatchObject({placed:'IN_LIST',linkState:'LINKED',amount:{outcome:'SAVED',amountUsd:'7.25'}});
      expect(by(old)).toMatchObject({placed:'IN_LIST',linkState:'UNCONFIRMED'});expect(by(cur)).toMatchObject({current:true,linkState:'UNLINKED'});
      expect((await f.rec(used))!.linkState).toBe('LINKED');expect((await f.rec(old))!.linkState).toBe('UNCONFIRMED');
      // `old` (Chưa xác nhận, in B's list) seen on VM A: refused, never moved.
      const moved=await f.post(t,f.a.id,await f.body(f.a.id,[{code:old}],T2));
      expect(moved.status).toBe(409);expect((await f.rec(old))!.holderVmId).toBe(f.b.id);
      expect(await f.books()).toEqual(before);
    }finally{await f.cleanup();}
  });
  it('two writers at once on the same code: one lands, the other is refused with nothing half-written',async()=>{
    const f=await obs();try{
      const t1=await f.tok(FULL),t2=await f.tok(FULL),c=f.code('16'),fresh=f.code('17');
      await f.post(t1,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'1'}],T0));
      const [b1,b2]=[await f.body(f.a.id,[{code:c,amountUsd:'2'}],T1),await f.body(f.a.id,[{code:c,amountUsd:'3'}],T2)];
      const rs=await Promise.all([f.post(t1,f.a.id,b1),f.post(t2,f.a.id,b2)]);
      expect(rs.map(r=>r.status).sort()).toEqual([200,409]);expect(rs.find(r=>r.status===409)!.json.error!.code).toBe('REVISION_CONFLICT');
      expect(['2','3']).toContain((await f.rec(c))!.amount!.toString());
      // The same new code from two writers: one creates it, the other is refused (never a second record).
      const [n1,n2]=[await f.body(f.a.id,[{code:fresh}],T1),await f.body(f.a.id,[{code:fresh}],T1)];
      const ns=await Promise.all([f.post(t1,f.a.id,n1),f.post(t2,f.a.id,n2)]);
      expect(ns.map(r=>r.status).sort()).toEqual([200,409]);expect(await db.sdkRecord.count({where:{projectId:f.P,code:fresh}})).toBe(1);
    }finally{await f.cleanup();}
  });
  it('money needs BALANCE_WRITE on the token and EARN_BALANCE on the user; codes alone need VM_OPS; revoked token / disabled user write nothing',async()=>{
    const f=await obs();try{
      const codesOnly=await f.tok(['READ','VM_OPS']),readOnly=await f.tok(['READ','BALANCE_WRITE']),noCap=await f.tok(['READ','VM_OPS'],f.plain),c=f.code('9');
      const money=await f.post(codesOnly,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'3'}],T1));
      expect(money.status).toBe(403);expect(await f.rec(c)).toBeNull();
      const noOps=await api('POST','vms/'+f.a.id+'/sdk-observations',{token:readOnly,body:{projectId:f.P,...await f.body(f.a.id,[{code:c}],T1)}});
      expect(noOps.status).toBe(403);
      // A user without EARN_BALANCE cannot get a BALANCE_WRITE token; with codes only it records the code, not money.
      await expect(f.tok(['READ','VM_OPS','BALANCE_WRITE'],f.plain)).rejects.toBeTruthy();
      expect((await f.post(noCap,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'3'}],T1))).status).toBe(403);
      const plain=await f.post(noCap,f.a.id,await f.body(f.a.id,[{code:c}],T1));
      expect(plain.status).toBe(200);expect(plain.json.data.recorded.sdks[0]).toMatchObject({amount:{outcome:'NOT_SENT',amountUsd:null,observedAt:null}});
      // The VM detail / lookup show each code's own money only with the balance read right; never a VM sum.
      const full=await f.tok(FULL);await f.post(full,f.a.id,await f.body(f.a.id,[{code:c,amountUsd:'3'}],T1));
      const detail=await api('GET','vms/'+f.a.id+'?projectId='+f.P,{token:full});expectConforms('GET','vms/'+f.a.id,detail);
      expect(detail.json.data.sdk).toMatchObject({amountsVisible:true,items:[expect.objectContaining({code:c,amount:'3',observedAt:T1,current:false})]});
      expect(detail.json.data.sdk.referenceMoney).toBeUndefined();
      expect((await api('GET','vms/'+f.a.id+'?projectId='+f.P,{token:noCap})).json.data.sdk.items[0].amount).toBeNull();
      const look=await api('GET','sdks?projectId='+f.P+'&code='+c+'&code='+f.code('99'),{token:full});expectConforms('GET','sdks',look);
      expect(look.json.data.items).toEqual([expect.objectContaining({code:c,found:true,revision:(await f.rec(c))!.revision,linkState:'UNCONFIRMED',inListOf:expect.objectContaining({vmId:f.a.id}),currentOf:null,amount:'3'}),expect.objectContaining({found:false,revision:null})]);
      expect((await api('GET','sdks?projectId='+f.P+'&code='+c,{token:noCap})).json.data.items[0].amount).toBeNull();
      // Revoked token, then disabled user: refused, nothing changes.
      const tokRow=await db.opsToken.findFirstOrThrow({where:{tokenHash:hashToken(full)}});
      await revokeOpsToken(f.scope.userId,{projectId:f.P,tokenId:tokRow.id},db);
      expect((await api('POST','vms/'+f.a.id+'/sdk-observations',{token:full,body:{projectId:f.P,...await f.body(f.a.id,[{code:c,amountUsd:'9'}],T2)}})).status).toBe(401);
      const live=await f.tok(FULL);await db.user.update({where:{id:f.ai},data:{disabledAt:new Date()}});
      try{expect((await api('POST','vms/'+f.a.id+'/sdk-observations',{token:live,body:{projectId:f.P,...await f.body(f.a.id,[{code:c,amountUsd:'9'}],T2)}})).status).toBe(403);}
      finally{await db.user.update({where:{id:f.ai},data:{disabledAt:null}});}
      expect((await f.rec(c))!.amount!.toString()).toBe('3');
    }finally{await f.cleanup();}
  });
  it('inside the transaction: a token that lost BALANCE_WRITE, or a user that lost EARN_BALANCE, writes no money and no code',async()=>{
    const f=await obs();try{
      const c=f.code('12'),v=await f.vm(f.a.id);
      const run=async(t:string)=>{const row=await db.opsToken.findUniqueOrThrow({where:{tokenHash:hashToken(t)}});
        return runWithOpsAuth({tokenId:row.id,userId:f.ai,operation:'VM_OPS',also:['BALANCE_WRITE']},()=>observeVmSdks({projectId:f.P,userId:f.ai,role:'USER',capabilities:[]},{key:randomUUID(),vmId:f.a.id,expectedCycle:v.cycle,expectedVmRevision:v.revision,observedAt:T1,source:'thử',items:[{code:c,expectedSdkRevision:null,amount:'1'}]},db));};
      await expect(run(await f.tok(['READ','VM_OPS']))).rejects.toMatchObject({code:'FORBIDDEN'});
      const both=await f.tok(FULL);
      await db.projectMember.update({where:{userId_projectId:{userId:f.ai,projectId:f.P}},data:{capabilities:[]}});
      await expect(run(both)).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(await f.rec(c)).toBeNull();
    }finally{await f.cleanup();}
  });
  it('the Server / VM grid gives every code its own money and check time (no VM sum)',async()=>{
    const f=await obs();try{
      const t=await f.tok(FULL),c1=f.code('10'),c2=f.code('11');
      await f.post(t,f.a.id,await f.body(f.a.id,[{code:c1,amountUsd:'2.5',current:true},{code:c2,amountUsd:'4'}],T1));
      const ws=await readVMWorkspace(f.scope,db),row=ws.vms.find(v=>v.id===f.a.id)!;
      expect(row.sdks.map(s=>({code:s.code,amount:s.amount,at:s.amountObservedAt,current:s.current})).sort((x,y)=>x.code.localeCompare(y.code))).toEqual([{code:c1,amount:'2.5',at:T1,current:true},{code:c2,amount:'4',at:T1,current:false}]);
    }finally{await f.cleanup();}
  });
});
