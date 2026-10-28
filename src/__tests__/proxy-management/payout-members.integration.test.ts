import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks} from '@/server/account-store/links';
import {recordReceipts} from '@/server/business-management/paypal-ledger';
import {saveVmSdk} from '@/server/vm-management/sdk-store';
import {createPayoutRequest,readVmOps,readVmOpsHistory,updatePayoutRequest} from '@/server/vm-ops/payout';
import {readPayoutDashboard,readPayoutReport} from '@/server/vm-ops/payout-report';
import {addPayoutMembers,memberOf,openPayoutOf,removePayoutMember} from '@/server/vm-ops/payout-members';
import {recordRecreated,setVmStatus} from '@/server/vm-ops/ops';
import {undoOperation} from '@/server/operation-history/undo';
afterAll(()=>db.$disconnect());
// Merged EarnApp payout (owner brief 27/10/2026). Synthetic data only (example.invalid), test database only.
const today='2026-10-27';
async function setup(vmCount=4){
  const f=await businessFixture(),x=randomUUID().slice(0,6),projectId=f.scope.projectId;
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=vmCount;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[21,22,23].map((c,i)=>`pp-${c} pp${c}-${2*i+1}-${x}@example.invalid pp${c}-${2*i+2}-${x}@example.invalid`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:6},(_,i)=>`mg${i+1}-${x}@example.invalid|pw`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const pp=await db.payPalAccount.findFirstOrThrow({where:{projectId,code:'pp-21'}});
  // Two receiving emails per PP code: the daily limit (2 emails / PP / day) never interferes with these tests.
  const emails=await db.payPalEmail.findMany({where:{projectId},orderBy:{email:'asc'}}),logins=await db.gmailAccount.findMany({where:{projectId},orderBy:{email:'asc'}});
  const vmNow=(i:number)=>db.virtualMachine.findUniqueOrThrow({where:{id:vms[i].id}});
  const link=async(i:number,login:number,emailId:string|null)=>{const vm=await vmNow(i);const r=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,login:logins[login].id,...(emailId?{paypalEmail:emailId}:{})}]},db);expect(r.errors).toBe(0);};
  // A current SDK with money read on this VM in round 1 (the reference share of a merged payout).
  const sdk=async(i:number,code:string,amount:string)=>{const vm=await vmNow(i);await saveVmSdk(f.scope,{key:randomUUID(),vmId:vm.id,expectedVmRevision:vm.revision,expectedCycle:1,code:code+'-'+x,expectedSdkRevision:null,amount},db);return db.sdkRecord.findFirstOrThrow({where:{projectId,code:code+'-'+x}});};
  const receive=(email:string,amount:string)=>recordReceipts(f.scope,{paypalId:pp.id,date:today,currency:'USD',status:'RECEIVED',text:`${email} | ${amount}`,key:randomUUID()},db);
  // Primary VM 0 (account + email), members VM 1… (no account); like An-01 VM_001 + VM_003 on 27/10.
  const merged=async(o:{submission?:'PREPARING'|'SENT';key?:string;members?:number[]}={})=>{
    const members=await Promise.all((o.members??[1]).map(async i=>({vmId:vms[i].id,expectedCycle:1,expectedVmRevision:(await vmNow(i)).revision})));
    return createPayoutRequest(f.scope,{key:o.key??randomUUID(),vmId:vms[0].id,expectedCycle:1,paypalEmailId:emails[0].id,amount:'20.54',date:today,submission:o.submission??'PREPARING',members},db);
  };
  const req=(id:string)=>db.earnPayoutRequest.findUniqueOrThrow({where:{id},include:{members:true}});
  const own=(i:number,email:number)=>createPayoutRequest(f.scope,{key:randomUUID(),vmId:vms[i].id,expectedCycle:1,paypalEmailId:emails[email].id,amount:'5',date:today,submission:'PREPARING'},db);
  const cleanup=async()=>{await db.vMSdkHistory.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await f.cleanup();};
  return {...f,cleanup,x,vms,pp,emails,logins,link,sdk,receive,vmNow,merged,req,own};
}
describe('Rút gộp nhiều VM',()=>{
  it('stores a payout member row bound to a request',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);
      const r=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,paypalEmailId:f.emails[0].id,amount:'20.54',date:today,submission:'PREPARING'},db);
      await db.earnPayoutMember.create({data:{projectId:f.scope.projectId,requestId:r.id,vmId:f.vms[1].id,cycle:1,createdById:f.scope.userId}});
      expect(await db.earnPayoutMember.findMany({where:{requestId:r.id}})).toHaveLength(1);
    }finally{await f.cleanup();}
  });
  it('create with members: one request, member rows with the reference share, history names the merge',async()=>{
    const f=await setup(3);try{
      await f.link(0,0,f.emails[0].id);await f.sdk(0,'sdk-a','8.71');await f.sdk(1,'sdk-b','11.83');
      const r=await f.merged();expect(r.members).toHaveLength(1);
      const row=await f.req(r.id);expect(await db.earnPayoutRequest.count({where:{projectId:f.scope.projectId}})).toBe(1);
      expect(row.members).toHaveLength(1);expect(row.members[0]).toMatchObject({vmId:f.vms[1].id,cycle:1,removedAt:null,consumedAt:null});
      expect(row.members[0].shareAmount?.toFixed(2)).toBe('11.83');expect(row.members[0].sdkId).not.toBeNull();
      expect(JSON.stringify(row.history)).toMatch(/Gộp thêm .*VM_002/);
    }finally{await f.cleanup();}
  });
  it('refuses a member already in another open request, a member with its own open request, and the primary as member',async()=>{
    const f=await setup(4);try{
      await f.link(0,0,f.emails[0].id);await f.link(2,1,f.emails[1].id);await f.link(3,2,f.emails[2].id);
      await f.merged();// VM_002 is a member of VM_001's request
      await expect(createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[1].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[1].id,expectedCycle:1}]},db)).rejects.toMatchObject({reason:'DUPLICATE'});
      // VM_004 has its own open request: it cannot join another one.
      await f.own(3,2);
      await expect(createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[1].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[3].id,expectedCycle:1}]},db)).rejects.toMatchObject({reason:'DUPLICATE'});
      await expect(createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[1].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[2].id,expectedCycle:1}]},db)).rejects.toThrow(/VM chính/);
      // A member VM of an open request cannot open its own request either (it would be in two at once).
      await f.link(1,3,f.emails[3].id);
      await expect(f.own(1,3)).rejects.toMatchObject({reason:'DUPLICATE'});
    }finally{await f.cleanup();}
  });
  it('attach to an already sent request links the member SDK to the primary account; SENT links primary and member SDKs',async()=>{
    const f=await setup(3);try{
      await f.link(0,0,f.emails[0].id);const a=await f.sdk(0,'sdk-a','8.71'),b=await f.sdk(1,'sdk-b','11.83'),c=await f.sdk(2,'sdk-c','3');
      const r=await f.merged();// PREPARING: nothing used yet
      expect((await db.sdkRecord.findUniqueOrThrow({where:{id:b.id}})).linkState).not.toBe('LINKED');
      const cur=await f.req(r.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);
      const ea=await db.earnAppAccount.findFirstOrThrow({where:{vmId:f.vms[0].id}});
      for(const [s,vm] of [[a,0],[b,1]] as const)expect(await db.sdkRecord.findUniqueOrThrow({where:{id:s.id}})).toMatchObject({linkState:'LINKED',linkedEarnAppId:ea.id,linkedVmId:f.vms[vm].id,linkedCycle:1});
      const sent=await f.req(r.id);
      const added=await addPayoutMembers(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:sent.revision,members:[{vmId:f.vms[2].id,expectedCycle:1}]},db);
      expect(added.added.map(x=>x.vmId)).toEqual([f.vms[2].id]);
      expect(await db.sdkRecord.findUniqueOrThrow({where:{id:c.id}})).toMatchObject({linkState:'LINKED',linkedEarnAppId:ea.id,linkedVmId:f.vms[2].id});
    }finally{await f.cleanup();}
  });
  it('remove only while PREPARING; FAILED frees members; RETRY refused when a member joined another request',async()=>{
    const f=await setup(4);try{
      await f.link(0,0,f.emails[0].id);await f.link(2,1,f.emails[1].id);
      const r=await f.merged({members:[1,3]});
      let cur=await f.req(r.id);
      const rm=await removePayoutMember(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,vmId:f.vms[3].id},db);expect(rm.removed).toBe(true);
      cur=await f.req(r.id);expect(cur.members.find(m=>m.vmId===f.vms[3].id)?.removedAt).not.toBeNull();
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);cur=await f.req(r.id);
      await expect(removePayoutMember(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,vmId:f.vms[1].id},db)).rejects.toThrow(/Chuẩn bị/);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'FAILED',note:'EarnApp từ chối'},db);
      // Failed: VM_002 is free and joins VM_003's request; the failed one may not be retried with VM_002 in it.
      await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[1].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[1].id,expectedCycle:1}]},db);
      cur=await f.req(r.id);
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'RETRY'},db)).rejects.toMatchObject({reason:'DUPLICATE'});
      expect((await f.req(r.id)).state).toBe('FAILED');
    }finally{await f.cleanup();}
  });
  it('replay of the same key attaches once; attaching an existing member again changes nothing',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);const key=randomUUID();
      const a=await f.merged({key}),b=await f.merged({key});expect(b.id).toBe(a.id);
      expect(await db.earnPayoutMember.count({where:{requestId:a.id}})).toBe(1);
      const cur=await f.req(a.id);
      const again=await addPayoutMembers(f.scope,{key:randomUUID(),requestId:a.id,expectedRevision:cur.revision,members:[{vmId:f.vms[1].id,expectedCycle:1}]},db);
      expect(again.added).toEqual([]);expect(await db.earnPayoutMember.count({where:{requestId:a.id,removedAt:null}})).toBe(1);
    }finally{await f.cleanup();}
  });
});

describe('Tạo lại VM đã gộp',()=>{
  const sent=async(f:Awaited<ReturnType<typeof setup>>,members=[1])=>{const r=await f.merged({members});const cur=await f.req(r.id);await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);return r;};
  const recreate=(f:Awaited<ReturnType<typeof setup>>,i:number,cycle=1)=>recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[i].id,expectedCycle:cycle},db);
  it('member recreated after the merged money arrived; once only; the primary still recreates with the same payout',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);const r=await sent(f);await f.receive(f.emails[0].email,'20.54');
      const b=await recreate(f,1);expect(b).toMatchObject({cycle:2,reason:'PAYOUT_RECEIVED'});
      const m=(await f.req(r.id)).members[0];expect(m).toMatchObject({consumedReason:'PAYOUT_RECEIVED'});expect(m.consumedAt).not.toBeNull();
      expect(await db.vmCycle.findFirstOrThrow({where:{vmId:f.vms[1].id,number:1}})).toMatchObject({reason:'PAYOUT_RECEIVED',payoutMemberId:m.id,payoutRequestId:null});
      await expect(recreate(f,1)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect(await recreate(f,0)).toMatchObject({cycle:2,reason:'PAYOUT_RECEIVED'});
      expect((await f.req(r.id)).consumedAt).not.toBeNull();
    }finally{await f.cleanup();}
  });
  it('member refused while the merged money is still waiting',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);await sent(f);
      await expect(recreate(f,1)).rejects.toThrow(/gộp vào lệnh rút của .*Tiền chưa về đủ/);
    }finally{await f.cleanup();}
  });
  it('member keeps its own EarnApp account across recreation; the primary account is closed',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);await f.link(1,1,null);
      await sent(f);await f.receive(f.emails[0].email,'20.54');
      await recreate(f,1);await recreate(f,0);
      expect(await db.earnAppAccount.findFirstOrThrow({where:{loginId:f.logins[1].id}})).toMatchObject({vmId:f.vms[1].id,closedAt:null});
      expect(await db.earnAppAccount.findFirstOrThrow({where:{loginId:f.logins[0].id}})).toMatchObject({vmId:null,closedReason:'RECREATED'});
    }finally{await f.cleanup();}
  });
  it('primary SUS: members recreate as SUSPENDED, the money is never counted as received',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);const r=await sent(f);
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'SUSPENDED',expectedCycle:1}]},db);
      expect(await recreate(f,1)).toMatchObject({cycle:2,reason:'SUSPENDED'});
      expect((await f.req(r.id)).members[0].consumedReason).toBe('SUSPENDED');
      expect(await db.fundTransaction.count({where:{payoutRequestId:r.id}})).toBe(0);
      // The primary follows today's SUS rule; afterwards a member of the same request still finds it SUS through the closed account.
      expect(await recreate(f,0)).toMatchObject({reason:'SUSPENDED'});
    }finally{await f.cleanup();}
  });
  it('a recreated member is history in its new round: free for a new payout',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);await sent(f);await f.receive(f.emails[0].email,'20.54');await recreate(f,1);
      expect(await memberOf(db,f.scope.projectId,f.vms[1].id,2)).toBeNull();
      expect(await openPayoutOf(db,f.scope.projectId,f.vms[1].id,2)).toBeNull();
    }finally{await f.cleanup();}
  });
});

describe('Hiển thị rút gộp',()=>{
  it('VM rows: the member shows the merged request and its milestone, the primary lists its members',async()=>{
    const f=await setup(3);try{
      await f.link(0,0,f.emails[0].id);await f.sdk(1,'sdk-b','11.83');const r=await f.merged();
      let ops=(await readVmOps(f.scope,db)).vms;const p=ops.find(v=>v.vmId===f.vms[0].id)!,b=ops.find(v=>v.vmId===f.vms[1].id)!;
      expect(b).toMatchObject({milestone:'PREPARING',earnAppId:null,merge:{role:'MEMBER',primaryVmId:f.vms[0].id,primaryWhere:'business-fixture / VM_001',consumed:false}});expect(b.request?.id).toBe(r.id);
      expect(p.merge).toMatchObject({role:'PRIMARY',members:[{vmId:f.vms[1].id,where:'business-fixture / VM_002',share:'11.83',consumed:false}]});
      expect(ops.find(v=>v.vmId===f.vms[2].id)!.merge).toBeNull();
      const cur=await f.req(r.id);await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);
      ops=(await readVmOps(f.scope,db)).vms;expect(ops.find(v=>v.vmId===f.vms[1].id)!.milestone).toBe('WAITING');
      await f.receive(f.emails[0].email,'20.54');ops=(await readVmOps(f.scope,db)).vms;expect(ops.find(v=>v.vmId===f.vms[1].id)!.milestone).toBe('RECREATE');
      const h=await readVmOpsHistory(f.scope,{vmId:f.vms[1].id},db);expect(h.requests).toHaveLength(1);expect(h.requests[0]).toMatchObject({id:r.id,memberOf:'business-fixture / VM_001',old:true});
    }finally{await f.cleanup();}
  });
  it('report and dashboard: a merged request is counted once with the VMs of its members; the server filter matches a member',async()=>{
    const f=await setup(2);try{
      const other=await db.server.create({data:{projectId:f.scope.projectId,code:'business-fixture-b',managed:true}});
      await db.virtualMachine.update({where:{id:f.vms[1].id},data:{serverId:other.id}});
      await f.link(0,0,f.emails[0].id);const r=await f.merged();const cur=await f.req(r.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);
      const all=await readPayoutReport(f.scope,{view:'WAITING'},db);
      expect(all.total).toBe(1);expect(all.focus).toMatchObject({requests:1,vms:2,amounts:[{currency:'USD',amount:'20.54'}]});
      expect(all.rows[0].members).toEqual([expect.objectContaining({vmId:f.vms[1].id,server:'business-fixture-b',vm:'VM_002'})]);
      expect((await readPayoutReport(f.scope,{serverId:other.id},db)).total).toBe(1);
      expect((await readPayoutReport(f.scope,{q:'business-fixture-b'},db)).total).toBe(1);
      const d=await readPayoutDashboard(f.scope,{serverId:other.id},db);expect(d.available&&d.cards.waiting).toMatchObject({requests:1,vms:2});
    }finally{await f.cleanup();}
  });
});

describe('Review 27/10/2026: one open request per VM through retry, undo and old requests',()=>{
  const lastOp=(f:Awaited<ReturnType<typeof setup>>,kind:string)=>db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind},orderBy:{createdAt:'desc'}});
  it('RETRY of a VM own failed request is refused while that VM is merged into another open request',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);await f.link(1,1,f.emails[2].id);
      const rb=await f.own(1,2);let cur=await f.req(rb.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:rb.id,expectedRevision:cur.revision,action:'FAILED',note:'dưới mức rút'},db);
      await f.merged();// VM_002 joins VM_001's request
      cur=await f.req(rb.id);
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:rb.id,expectedRevision:cur.revision,action:'RETRY'},db)).rejects.toMatchObject({reason:'DUPLICATE'});
    }finally{await f.cleanup();}
  });
  it('undo of "Bỏ gộp" is refused once the VM joined another open request',async()=>{
    const f=await setup(3);try{
      await f.link(0,0,f.emails[0].id);await f.link(2,1,f.emails[2].id);
      const r=await f.merged();let cur=await f.req(r.id);
      await removePayoutMember(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,vmId:f.vms[1].id},db);
      const op=await lastOp(f,'EARN_PAYOUT_MEMBERS');
      await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[2].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[1].id,expectedCycle:1}]},db);
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toThrow(/lệnh rút khác/);
      cur=await f.req(r.id);expect(cur.members.find(m=>m.vmId===f.vms[1].id)?.removedAt).not.toBeNull();
    }finally{await f.cleanup();}
  });
  it('undo of FAILED on a merged request is refused once a member joined another open request',async()=>{
    const f=await setup(3);try{
      await f.link(0,0,f.emails[0].id);await f.link(2,1,f.emails[2].id);
      const r=await f.merged();const cur=await f.req(r.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'FAILED',note:'EarnApp từ chối'},db);
      const op=await lastOp(f,'EARN_PAYOUT_UPDATE');
      await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[2].id,expectedCycle:1,paypalEmailId:f.emails[2].id,amount:'5',date:today,submission:'PREPARING',members:[{vmId:f.vms[1].id,expectedCycle:1}]},db);
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toThrow(/lệnh rút khác/);
      expect((await f.req(r.id)).state).toBe('FAILED');
    }finally{await f.cleanup();}
  });
  it('undo of a merged preparation removes the request with its members',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);const r=await f.merged();
      const op=await lastOp(f,'EARN_PAYOUT_REQUEST');await undoOperation(f.scope,op.id,'',db);
      expect(await db.earnPayoutRequest.count({where:{id:r.id}})).toBe(0);expect(await db.earnPayoutMember.count({where:{requestId:r.id}})).toBe(0);
    }finally{await f.cleanup();}
  });
  it('a member whose own request failed is recreated with the merged payout',async()=>{
    const f=await setup(2);try{
      await f.link(0,0,f.emails[0].id);await f.link(1,1,f.emails[2].id);
      const rb=await f.own(1,2);let cur=await f.req(rb.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:rb.id,expectedRevision:cur.revision,action:'FAILED',note:'dưới mức rút'},db);
      const r=await f.merged();cur=await f.req(r.id);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:cur.revision,action:'SENT'},db);await f.receive(f.emails[0].email,'20.54');
      expect(await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1},db)).toMatchObject({cycle:2,reason:'PAYOUT_RECEIVED'});
    }finally{await f.cleanup();}
  });
});
