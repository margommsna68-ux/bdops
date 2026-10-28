import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {expectConforms} from './openapi-conform';
import {db,api,setup,prepareBody,reqRev} from './ops-fixture';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
// Merged EarnApp payout through the ops API and the web router (27/10/2026). Synthetic data, test database only.
const call=async(method:'GET'|'POST',path:string,o:Parameters<typeof api>[2]={})=>{const r=await api(method,path,o);expectConforms(method,path,r);return r;};
const member=async(f:Awaited<ReturnType<typeof setup>>,i:number)=>{const v=await f.vmNow(i);return {vmId:v.id,expectedCycle:v.cycle,expectedVmRevision:v.revision};};
describe('API rút gộp',()=>{
  it('prepare with members waits for approval, then creates the members once; a retry of the same key replays',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','PAYOUT']),email=(await f.pp('pp-82')).emails[0].id,key=randomUUID();
      const body=await prepareBody(f,0,email,{amount:'20.54',members:[await member(f,2)]});
      const held=await call('POST','withdrawals/prepare',{token:t,key,body,autoApprove:false});expect(held.status).toBe(202);
      expect((await db.opsApproval.findFirstOrThrow({where:{id:held.json.error!.details.approvalId}})).summary).toMatchObject({members:['business-fixture / VM_003']});
      const first=await call('POST','withdrawals/prepare',{token:t,key,body});expect(first.status).toBe(200);
      const w=first.json.data.recorded;expect(w.members).toEqual([f.vms[2].id]);
      expect(first.json.data.current.withdrawal.members).toEqual([{vmId:f.vms[2].id,cycle:1,consumed:false,share:null}]);
      const again=await call('POST','withdrawals/prepare',{token:t,key,body});expect(again.json.data.replay).toBe(true);
      expect(await db.earnPayoutMember.count({where:{requestId:w.withdrawalId}})).toBe(1);
      const vm=await call('GET','vms/'+f.vms[2].id+'?projectId='+f.projectId,{token:t});
      expect(vm.json.data.mergedInto).toEqual({withdrawalId:w.withdrawalId,primaryVmId:f.vms[0].id,consumed:false});
      expect((await call('GET','vms/'+f.vms[1].id+'?projectId='+f.projectId,{token:t})).json.data.mergedInto).toBeNull();
    }finally{await f.cleanup();}
  });
  it('POST withdrawals/{id}/members adds a member and GET withdrawals/{id} lists it; a VM in another open request is refused',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','PAYOUT']),emails=(await f.pp('pp-82')).emails;
      const w=(await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,0,emails[0].id)})).json.data.recorded;
      const add=await call('POST','withdrawals/'+w.withdrawalId+'/members',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w.withdrawalId),members:[await member(f,3)]}});
      expect(add.status).toBe(200);expect(add.json.data.recorded.added).toEqual([f.vms[3].id]);
      const d=await call('GET','withdrawals/'+w.withdrawalId+'?projectId='+f.projectId,{token:t});expect(d.json.data.members.map((m:{vmId:string})=>m.vmId)).toEqual([f.vms[3].id]);
      // VM_002 has its own open request: it cannot be merged in.
      await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,1,emails[1].id)});
      const refused=await call('POST','withdrawals/'+w.withdrawalId+'/members',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w.withdrawalId),members:[await member(f,1)]}});
      expect(refused.status).toBe(409);expect(refused.json.error!.code).toBe('DUPLICATE');
    }finally{await f.cleanup();}
  });
  it('web router: requestPayout with members and addPayoutMembers',async()=>{
    const f=await setup();try{
      const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
      const email=(await f.pp('pp-60')).emails[0].id,v0=await f.vmNow(0);
      const r=await caller.vmOps.requestPayout({projectId:f.projectId,key:randomUUID(),vmId:v0.id,expectedCycle:1,earnAppId:v0.earnAppId,paypalEmailId:email,amount:'9.00',date:f.today,submission:'PREPARING',members:[await member(f,1)]});
      expect(r.members.map(m=>m.vmId)).toEqual([f.vms[1].id]);
      const added=await caller.vmOps.addPayoutMembers({projectId:f.projectId,key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),members:[await member(f,4)]});
      expect(added.added.map(a=>a.vmId)).toEqual([f.vms[4].id]);
      const removed=await caller.vmOps.removePayoutMember({projectId:f.projectId,key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),vmId:f.vms[4].id});expect(removed.removed).toBe(true);
    }finally{await f.cleanup();}
  });
});
