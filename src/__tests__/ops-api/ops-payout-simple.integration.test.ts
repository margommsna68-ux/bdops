import {afterAll,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {expectConforms} from './openapi-conform';
import {db,api,setup,prepareBody,statusBody,reqRev,type F} from './ops-fixture';
import {payloadHashOf} from '@/server/ops-api/approvals';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
// Payout simplification (owner 28/10/2026, "chỉ cần xin duyệt khi rút tiền"): only withdrawals/prepare waits for an ADMIN; the status,
// receipt and merge commands run directly; the AI may fix a mistaken request (edit / unsend / void) and report an EarnApp SUS.
// Synthetic data, test database only.
const call=async(method:'GET'|'POST',path:string,o:Parameters<typeof api>[2]={})=>{const r=await api(method,path,o);expectConforms(method,path,r);return r;};
const ALL=['READ','PAYOUT','RECEIPT','VM_OPS'] as never;
const cleanupAll=async(f:F)=>{await db.earnPayoutRequestVoid.deleteMany({where:{projectId:f.projectId}});await db.opsApproval.deleteMany({where:{projectId:f.projectId}});await f.cleanup();};
/** A prepared request (approved through the fixture), optionally marked sent on EarnApp. */
async function request(f:F,t:string,i:number,emailId:string,sent:boolean,o:Record<string,unknown>={}){
  const w=(await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,i,emailId,o)})).json.data.recorded;
  if(sent){const s=await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,i,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)})});expect(s.status,JSON.stringify(s.json.error)).toBe(200);}
  return w.withdrawalId as string;
}
const ident=async(f:F,i:number,id:string)=>{const v=await f.vmNow(i);return {projectId:f.projectId,vmId:v.id,expectedCycle:v.cycle,earnAppAccountId:v.earnAppId,expectedRequestRevision:await reqRev(id)};};
describe('ops API: only withdrawal prepare needs approval',()=>{
  it('prepare still answers 202 APPROVAL_REQUIRED; me.approvalRequired lists only WITHDRAWAL_PREPARE',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id;
      const held=await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,0,email),autoApprove:false});
      expect(held.status).toBe(202);expect(held.json.error!.code).toBe('APPROVAL_REQUIRED');
      expect((await call('GET','me',{token:t})).json.data.approvalRequired).toEqual(['WITHDRAWAL_PREPARE']);
    }finally{await cleanupAll(f);}
  });
  it('status and receipt run without approval',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,id=await request(f,t,0,email,false);
      const s=await call('POST','withdrawals/'+id+'/status',{token:t,body:await statusBody(f,0,{id,revision:await reqRev(id)}),autoApprove:false});
      expect(s.status,JSON.stringify(s.json.error)).toBe(200);expect(s.json.data.recorded.status).toBe('SUBMITTED_ON_EARNAPP');
      const r=await call('POST','withdrawals/'+id+'/receipts',{token:t,autoApprove:false,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(id),amount:'4.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-'+randomUUID().slice(0,8)}});
      expect(r.status,JSON.stringify(r.json.error)).toBe(200);expect(r.json.data.recorded.settled).toBe(false);
      expect(await db.opsApproval.count({where:{projectId:f.projectId,action:{in:['WITHDRAWAL_STATUS','WITHDRAWAL_RECEIPT']}}})).toBe(0);
    }finally{await cleanupAll(f);}
  });
  it('an old pending STATUS approval: retry with the same key runs directly',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,id=await request(f,t,0,email,false);
      const key=randomUUID(),body=await statusBody(f,0,{id,revision:await reqRev(id)}),path='withdrawals/'+id+'/status';
      const tok=await db.opsToken.findFirstOrThrow({where:{userId:f.ai},orderBy:{createdAt:'desc'}});
      await db.opsApproval.create({data:{projectId:f.projectId,tokenId:tok.id,userId:f.ai,action:'WITHDRAWAL_STATUS',method:'POST',path,objectId:id,
        requestKey:'ops:'+createHash('sha256').update(f.ai+'\u0000'+f.projectId+'\u0000'+key).digest('hex').slice(0,48),payloadHash:payloadHashOf('POST',path,body),summary:{},expiresAt:new Date(Date.now()+15*60e3)}});
      const r=await call('POST',path,{token:t,key,body,autoApprove:false});
      expect(r.status,JSON.stringify(r.json.error)).toBe(200);expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id}})).submission).toBe('SENT');
    }finally{await cleanupAll(f);}
  });
  it('members run without approval',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,id=await request(f,t,0,email,false),v=await f.vmNow(2);
      const r=await call('POST','withdrawals/'+id+'/members',{token:t,autoApprove:false,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(id),members:[{vmId:v.id,expectedCycle:v.cycle,expectedVmRevision:v.revision}]}});
      expect(r.status,JSON.stringify(r.json.error)).toBe(200);expect(r.json.data.recorded.added).toEqual([v.id]);
    }finally{await cleanupAll(f);}
  });
});
describe('ops API: fix and SUS routes',()=>{
  it('edit / unsend / void / suspended answer 200 with {replay, recorded, current}; the same key replays the recorded answer',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),emails=(await f.pp('pp-82')).emails;
      // edit: another email and amount on a sent request (with a reason).
      const a=await request(f,t,0,emails[0].id,true),ek=randomUUID(),eb={...await ident(f,0,a),paypalEmailId:emails[1].id,amount:'12.50',note:'Ghi nhầm email'};
      const e1=await call('POST','withdrawals/'+a+'/edit',{token:t,key:ek,body:eb,autoApprove:false});
      expect(e1.status,JSON.stringify(e1.json.error)).toBe(200);expect(e1.json.data.replay).toBe(false);
      expect(e1.json.data.recorded).toMatchObject({withdrawalId:a,paypalEmailId:emails[1].id,amount:'12.50'});expect(e1.json.data.current.withdrawal.paypalEmailId).toBe(emails[1].id);
      const e2=await call('POST','withdrawals/'+a+'/edit',{token:t,key:ek,body:eb,autoApprove:false});expect(e2.json.data.replay).toBe(true);expect(e2.json.data.recorded).toEqual(e1.json.data.recorded);
      // unsend: back to preparing.
      const uk=randomUUID(),ub={...await ident(f,0,a),note:'Chưa rút thật'};
      const u1=await call('POST','withdrawals/'+a+'/unsend',{token:t,key:uk,body:ub,autoApprove:false});
      expect(u1.status,JSON.stringify(u1.json.error)).toBe(200);expect(u1.json.data.recorded).toMatchObject({withdrawalId:a,submission:'PREPARING'});expect(u1.json.data.current.withdrawal.submission).toBe('PREPARING');
      const u2=await call('POST','withdrawals/'+a+'/unsend',{token:t,key:uk,body:ub,autoApprove:false});expect(u2.json.data.replay).toBe(true);expect(u2.json.data.recorded).toEqual(u1.json.data.recorded);
      // void: the mistaken request goes away (a snapshot is kept).
      const vk=randomUUID(),vb={...await ident(f,0,a),reason:'Ghi nhầm VM'};
      const v1=await call('POST','withdrawals/'+a+'/void',{token:t,key:vk,body:vb,autoApprove:false});
      expect(v1.status,JSON.stringify(v1.json.error)).toBe(200);expect(v1.json.data.recorded).toMatchObject({withdrawalId:a,vmId:f.vms[0].id});expect(v1.json.data.current.withdrawal).toBeNull();
      expect(await db.earnPayoutRequest.count({where:{id:a}})).toBe(0);
      const v2=await call('POST','withdrawals/'+a+'/void',{token:t,key:vk,body:vb,autoApprove:false});expect(v2.json.data.replay).toBe(true);expect(v2.json.data.recorded).toEqual(v1.json.data.recorded);
      // suspended: a sent request without money becomes LOST_SUS.
      const b=await request(f,t,1,emails[2].id,true,{amount:'7.00'}),vm=await f.vmNow(1),sk=randomUUID(),sb={projectId:f.projectId,expectedCycle:vm.cycle,expectedVmRevision:vm.revision,note:'EarnApp báo suspended'};
      const s1=await call('POST','vms/'+vm.id+'/suspended',{token:t,key:sk,body:sb,autoApprove:false});
      expect(s1.status,JSON.stringify(s1.json.error)).toBe(200);expect(s1.json.data.recorded).toMatchObject({vmId:vm.id,changed:true,withdrawalId:b,outcome:'LOST',lostAmount:'7.00'});
      expect(s1.json.data.current.status).toBe('SUSPENDED');
      const s2=await call('POST','vms/'+vm.id+'/suspended',{token:t,key:sk,body:sb,autoApprove:false});expect(s2.json.data.replay).toBe(true);expect(s2.json.data.recorded).toEqual(s1.json.data.recorded);
      const lost=await call('GET','withdrawals?projectId='+f.projectId+'&status=LOST',{token:t});
      expect(lost.json.data.items.map((x:{id:string})=>x.id)).toEqual([b]);expect(lost.json.data.items[0]).toMatchObject({state:'LOST_SUS',phase:'LOST',money:{lostAmount:'7.00'}});
      expect(await db.opsApproval.count({where:{projectId:f.projectId,action:{not:'WITHDRAWAL_PREPARE'}}})).toBe(0);
    }finally{await cleanupAll(f);}
  });
  it('a request with money cannot be unsent: EMAIL_HAS_MONEY 409',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,id=await request(f,t,0,email,true);
      await call('POST','withdrawals/'+id+'/receipts',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(id),amount:'3.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-'+randomUUID().slice(0,8)}});
      const r=await call('POST','withdrawals/'+id+'/unsend',{token:t,body:{...await ident(f,0,id),note:'x'},autoApprove:false});
      expect(r.status).toBe(409);expect(r.json.error!.code).toBe('EMAIL_HAS_MONEY');
    }finally{await cleanupAll(f);}
  });
  it('GET withdrawals?email= finds the waiting request of that receiving email; a receipt with settleRemainder and a PayPal transactionId closes it; the same transactionId again is refused DUPLICATE',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),emails=(await f.pp('pp-82')).emails;
      const a=await request(f,t,0,emails[0].id,true,{amount:'10.00'});await request(f,t,1,emails[1].id,true);
      const found=await call('GET','withdrawals?projectId='+f.projectId+'&email='+encodeURIComponent(emails[0].email.toUpperCase()),{token:t});
      expect(found.status).toBe(200);expect(found.json.data.items.map((x:{id:string})=>x.id)).toEqual([a]);expect(found.json.data.items[0].money.remaining).toBe('10.00');
      const tx='5AB'+randomUUID().slice(0,8).toUpperCase(),body={projectId:f.projectId,expectedRequestRevision:await reqRev(a),amount:'9.41',currency:'USD',receivedAt:new Date().toISOString(),transactionId:tx,settleRemainder:true};
      const r=await call('POST','withdrawals/'+a+'/receipts',{token:t,body,autoApprove:false});
      expect(r.status,JSON.stringify(r.json.error)).toBe(200);expect(r.json.data.recorded).toMatchObject({settled:true,shortfall:'0.59',transactionId:tx});
      expect(r.json.data.current.withdrawal).toMatchObject({phase:'RECEIVED',settled:true});
      const again=await call('POST','withdrawals/'+a+'/receipts',{token:t,body:{...body,expectedRequestRevision:await reqRev(a)},autoApprove:false});
      expect(again.status).toBe(409);expect(again.json.error!.code).toBe('DUPLICATE');
      expect((await call('GET','withdrawals?projectId='+f.projectId+'&email=nobody@example.invalid',{token:t})).json.data.items).toEqual([]);
    }finally{await cleanupAll(f);}
  });
  it('a receipt above the request (owner 28/10/2026) is recorded exactly and closes it as received with the surplus',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,a=await request(f,t,0,email,true,{amount:'20.04'});
      const r=await call('POST','withdrawals/'+a+'/receipts',{token:t,autoApprove:false,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(a),amount:'20.10',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-'+randomUUID().slice(0,8)}});
      expect(r.status,JSON.stringify(r.json.error)).toBe(200);expect(r.json.data.recorded).toMatchObject({amount:'20.10',settled:true,shortfall:'-0.06'});
      expect(r.json.data.current.withdrawal).toMatchObject({phase:'RECEIVED',settled:true,money:{received:'20.10',remaining:'0.00',shortfall:'-0.06'}});
      expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id:a}})).settleNote).toBe('Nhận dư $0.06');
    }finally{await cleanupAll(f);}
  });
  it('a surplus above max($1, 5%) answers 409 SURPLUS_CONFIRM; the same body with acceptSurplus:true records it (review 29/10/2026)',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,ALL),email=(await f.pp('pp-82')).emails[0].id,a=await request(f,t,0,email,true,{amount:'20.04'});
      const body=async(o:Record<string,unknown>={})=>({projectId:f.projectId,expectedRequestRevision:await reqRev(a),amount:'21.50',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-S-'+a.slice(-6),...o});
      const r=await call('POST','withdrawals/'+a+'/receipts',{token:t,autoApprove:false,body:await body()});
      expect(r.status).toBe(409);expect(r.json.error?.code).toBe('SURPLUS_CONFIRM');expect(r.json.error?.details).toMatchObject({surplus:'1.46',current:{phase:'WAITING'}});
      expect(await db.fundTransaction.count({where:{payoutRequestId:a}})).toBe(0);
      const ok=await call('POST','withdrawals/'+a+'/receipts',{token:t,autoApprove:false,body:await body({acceptSurplus:true})});
      expect(ok.status,JSON.stringify(ok.json.error)).toBe(200);expect(ok.json.data.recorded).toMatchObject({amount:'21.50',settled:true,shortfall:'-1.46'});
      expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id:a}})).settleNote).toBe('Nhận dư $1.46');
    }finally{await cleanupAll(f);}
  });
  it('web router: editPayout, unsendPayout, voidPayout, suspendEarnApp and payoutReceipt settleRemainder',async()=>{
    const f=await setup();try{
      const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
      const emails=(await f.pp('pp-60')).emails,v0=await f.vmNow(0);
      const r=await caller.vmOps.requestPayout({projectId:f.projectId,key:randomUUID(),vmId:v0.id,expectedCycle:1,earnAppId:v0.earnAppId,paypalEmailId:emails[0].id,amount:'9.00',date:f.today,submission:'PREPARING'});
      const idn=async()=>({projectId:f.projectId,key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),vmId:v0.id,expectedCycle:1,earnAppId:v0.earnAppId});
      expect((await caller.vmOps.editPayout({...await idn(),amount:'8.00'})).changed).toBe(true);
      expect((await caller.vmOps.unsendPayout(await idn())).changed).toBe(false);
      expect((await caller.vmOps.voidPayout({...await idn(),reason:'Ghi nhầm'})).requestId).toBe(r.id);
      const v1=await f.vmNow(1);
      expect((await caller.vmOps.suspendEarnApp({projectId:f.projectId,key:randomUUID(),vmId:v1.id,expectedCycle:v1.cycle,note:'SUS'})).changed).toBe(true);
      const v2=await f.vmNow(2);
      const s=await caller.vmOps.requestPayout({projectId:f.projectId,key:randomUUID(),vmId:v2.id,expectedCycle:1,earnAppId:v2.earnAppId,paypalEmailId:emails[1].id,amount:'5.00',date:f.today,submission:'SENT'});
      const rc=await caller.vmOps.payoutReceipt({projectId:f.projectId,key:randomUUID(),requestId:s.id,expectedRequestRevision:await reqRev(s.id),amount:'4.80',currency:'USD',receivedAt:new Date().toISOString(),settleRemainder:true});
      expect(rc.settled).toBe(true);
    }finally{await cleanupAll(f);}
  });
});
