import {saveVmSdk} from '@/server/vm-management/sdk-store';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {encrypt} from '@/lib/encryption';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks,previewLinks} from '@/server/account-store/links';
import {recordReceipts,recordOpening,readPaypalLedger} from '@/server/business-management/paypal-ledger';
import {previewVmBulk,applyVmBulk} from '@/server/vm-management/bulk';
import {startInstall,confirmInstalled} from '@/server/vm-management/installation';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {createPayoutRequest,updatePayoutRequest,readVmOps,readVmOpsHistory,readPaypalGather,readPayoutPick} from '@/server/vm-ops/payout';
import {undoOperation} from '@/server/operation-history/undo';
import {readAccountStore} from '@/server/account-store/read';
afterAll(()=>db.$disconnect());
afterEach(()=>vi.useRealTimers());
// VM operation cycle (owner brief 18/10/2026). Synthetic data only (example.invalid, 203.x test IPs), test database only.
const today='2026-10-18';
async function setup(vmCount=4){
  const f=await businessFixture(),x=randomUUID().slice(0,6),projectId=f.scope.projectId;
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=vmCount;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  const mail=(n:number)=>`pp13-${n}-${x}@example.invalid`;
  await commitStockImport(f.scope,{kind:'PAYPAL',text:`pp-13 ${[1,2,3,4,5].map(mail).join(' ')}\npp-14 pp14-1-${x}@example.invalid`,batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:8},(_,i)=>`ea${i+1}-${x}@example.invalid|pw`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const pp13=await db.payPalAccount.findFirstOrThrow({where:{projectId,code:'pp-13'}}),pp14=await db.payPalAccount.findFirstOrThrow({where:{projectId,code:'pp-14'}});
  const emails=await db.payPalEmail.findMany({where:{paypalId:pp13.id},orderBy:{email:'asc'}}),logins=await db.gmailAccount.findMany({where:{projectId},orderBy:{email:'asc'}});
  const link=async(vmIndex:number,loginIndex:number,emailId:string|null)=>{const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:vms[vmIndex].id}});const r=await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,login:logins[loginIndex].id,...(emailId?{paypalEmail:emailId}:{})}]},db);expect(r.errors).toBe(0);};
  const receive=(paypalId:string,email:string,amount:string,status:'RECEIVED'|'PENDING'='RECEIVED',tx?:string)=>recordReceipts(f.scope,{paypalId,date:today,currency:'USD',status,text:`${email} | ${amount}${tx?' | '+tx:''}`,key:randomUUID()},db);
  const ops=async(vmIndex:number)=>(await readVmOps(f.scope,db)).vms.find(v=>v.vmId===vms[vmIndex].id)!;
  const request=(vmIndex:number,emailId:string,amount:string,cycle=1,key=randomUUID())=>createPayoutRequest(f.scope,{key,vmId:vms[vmIndex].id,expectedCycle:cycle,paypalEmailId:emailId,amount,date:today},db);
  const extra=async()=>{await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});await db.vMConfiguration.deleteMany({where:{projectId}});await db.vMSdkHistory.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.proxyBatch.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});await db.proxySourceSnapshot.deleteMany({where:{projectId}});const ids=(await db.proxyIP.findMany({where:{projectId},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});};
  return {...f,x,vms,mail,pp13,pp14,emails,logins,link,receive,ops,request,cleanup:async()=>{await extra();await f.cleanup();}};
}
// A TUT proxy installed and confirmed on a VM (the old round's evidence).
async function installProxy(f:Awaited<ReturnType<typeof setup>>,vmIndex:number,n:number){
  const ip='203.9.'+(1+Math.floor(Math.random()*250))+'.'+n,identity=await db.proxyIdentity.create({data:{ip,owner:'SELF'}});
  const endpoint=await db.proxyIP.create({data:{projectId:f.scope.projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.id}});
  const snapshot=await db.proxySourceSnapshot.create({data:{projectId:f.scope.projectId,sourceKey:'GENJY',hash:'vm-ops-'+n,scanSucceeded:true}});
  const p=await previewVmBulk(f.scope,{kind:'PROXY',serverId:f.server.id,text:`${f.vms[vmIndex].code} | ${ip}`},db);
  const row=p.rows.find(r=>r.outcome==='READY')!;await applyVmBulk(f.scope,{kind:'PROXY',key:randomUUID(),items:[{line:row.line,vmId:row.vmId!,expectedRevision:row.expectedRevision!,value:row.value}]},db);
  const config=await db.vMConfiguration.findFirstOrThrow({where:{vmId:f.vms[vmIndex].id,endpointId:endpoint.id}});await startInstall(f.scope,config.id,db);
  const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[vmIndex].id}});
  await confirmInstalled(f.scope,{configurationId:config.id,configurationHash:config.configurationHash,expectedVmRevision:vm.revision},db,{refreshSource:async()=>({id:snapshot.id,sourceKey:'GENJY',hash:snapshot.hash,fetchedAt:new Date().toISOString(),scanSucceeded:true})});
  return {endpoint,config};
}
describe('Tình trạng vận hành',()=>{
  it('old data shows Chưa ghi (never inferred); set at the cell and in bulk; same value writes no history; old round commands are refused',async()=>{
    const f=await setup();try{
      await f.link(0,0,f.emails[0].id);await db.virtualMachine.update({where:{id:f.vms[0].id},data:{sdkId:'sdk-'+f.x}});
      expect((await f.ops(0)).status).toBeNull();// SDK + account do not make it LINKED / OK
      const ws=await readVMWorkspace(f.scope,db);expect(ws.vms.find(v=>v.id===f.vms[0].id)).toMatchObject({ops:null,cycle:1});
      const one=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'LINKED',expectedCycle:1}]},db);expect(one.applied).toBe(1);
      const bulk=await setVmStatus(f.scope,{key:randomUUID(),items:f.vms.map(v=>({vmId:v.id,status:'LINKED' as const,expectedCycle:1}))},db);
      expect(bulk).toMatchObject({applied:f.vms.length-1,skipped:1});
      expect(await db.vmOpsEvent.count({where:{projectId:f.scope.projectId,kind:'STATUS'}})).toBe(f.vms.length);
      const again=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'LINKED',expectedCycle:1}]},db);
      expect(again.skipped).toBe(1);expect(await db.vmOpsEvent.count({where:{projectId:f.scope.projectId}})).toBe(f.vms.length);
      const stale=await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OK',expectedCycle:2}]},db);expect(stale.rows[0]).toMatchObject({outcome:'ERROR',message:expect.stringMatching(/lượt/)});
      // Staff with Server / VM rights record status (same endpoint for people and AI); retry with the same key replays.
      const key=randomUUID(),w=await setVmStatus(f.worker,{key,items:[{vmId:f.vms[1].id,status:'OFF',expectedCycle:1}]},db),w2=await setVmStatus(f.worker,{key,items:[{vmId:f.vms[1].id,status:'OFF',expectedCycle:1}]},db);
      expect(w.applied).toBe(1);expect(w2.replay).toBe(true);
      const h=await readVmOpsHistory(f.scope,{vmId:f.vms[0].id},db);expect(h.events.map(e=>[e.kind,e.from,e.to])).toEqual([['STATUS',null,'LINKED']]);
    }finally{await f.cleanup();}
  });
  it('undo of a status change restores the previous one (web record only)',async()=>{
    const f=await setup(1);try{
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OFF',expectedCycle:1}]},db);
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OK',expectedCycle:1}]},db);
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_STATUS'},orderBy:{createdAt:'desc'}});
      await undoOperation(f.scope,op.id,'',db);expect((await f.ops(0)).status).toBe('OFF');
      expect((await db.vmOpsEvent.findFirstOrThrow({where:{vmId:f.vms[0].id},orderBy:{createdAt:'desc'}})).kind).toBe('UNDO');
    }finally{await f.cleanup();}
  });
});
describe('PayPal gom tiền và yêu cầu rút',()=>{
  it('pp-13 receives 24 + 10 + 12 through three emails across two days = 46 USD, keeps gathering with the unused emails',async()=>{
    const f=await setup();try{
      for(const i of [0,1,2])await f.link(i,i,f.emails[i].id);
      await f.request(0,f.emails[0].id,'24');await f.request(1,f.emails[1].id,'10');
      // Owner 26/10: only two distinct receiving emails per PP/day; the third request is on the next day.
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+86400_000));await f.request(2,f.emails[2].id,'12');
      let g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;
      expect(g).toMatchObject({balanceUsd:'0.00',pendingUsd:'46.00'});expect(g.gather!.state).toBe('GATHERING');
      await f.receive(f.pp13.id,f.emails[0].email,'24');await f.receive(f.pp13.id,f.emails[1].email,'10');await f.receive(f.pp13.id,f.emails[2].email,'12');
      const ledger=await readPaypalLedger(f.scope,{},db);expect(ledger.paypals.find(p=>p.paypalId===f.pp13.id)!.currencies[0]).toMatchObject({currency:'USD',balance:'46.00'});
      g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;expect(g).toMatchObject({balanceUsd:'46.00',pendingUsd:'0.00'});expect(g.gather).toMatchObject({state:'GATHERING',missing:'54.00'});
      expect((await f.ops(0)).milestone).toBe('RECREATE');
      const pick=await readPayoutPick(f.scope,{vmId:f.vms[3].id},db);const p13=pick.paypals.find(p=>p.code==='pp-13')!;
      expect(p13).toMatchObject({unused:2,balanceUsd:'46.00'});
    }finally{await f.cleanup();}
  });
  it('82 on the book + 18 still to come: only "Dự kiến đủ"; after the 18 arrive it is 100 for real; withdrawing recomputes',async()=>{
    const f=await setup();try{
      await recordOpening(f.scope,{paypalId:f.pp13.id,date:today,currency:'USD',amount:'82',key:randomUUID()},db);
      await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'18');
      let g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;expect(g.gather).toMatchObject({state:'PROJECTED',label:'Dự kiến đủ $100,00',missing:'18.00'});
      await f.receive(f.pp13.id,f.emails[0].email,'18');
      g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;expect(g).toMatchObject({balanceUsd:'100.00',pendingUsd:'0.00'});expect(g.gather!.state).toBe('REACHED');
      const {recordTransfer}=await import('@/server/business-management/paypal-ledger');
      await recordTransfer(f.scope,{paypalId:f.pp13.id,type:'EXCHANGE',date:today,currency:'USD',debited:'30',key:randomUUID()},db);
      g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;expect(g).toMatchObject({balanceUsd:'70.00'});expect(g.gather!.state).toBe('GATHERING');
    }finally{await f.cleanup();}
  });
  it('partial receipt: 24 asked, 10 received → book +10, still 14 to come, not counted twice, no recreation yet',async()=>{
    const f=await setup();try{
      await f.link(0,0,f.emails[0].id);const req=await f.request(0,f.emails[0].id,'24');
      await f.receive(f.pp13.id,f.emails[0].email,'10');await f.receive(f.pp13.id,f.emails[0].email,'14','PENDING','TX-P-'+f.x);
      const o=await f.ops(0);expect(o.milestone).toBe('WAITING');expect(o.request!.money).toMatchObject({received:'10.00',pendingLinked:'14.00',remaining:'14.00'});
      const g=(await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!;expect(g).toMatchObject({balanceUsd:'10.00',pendingUsd:'14.00'});// 14, not 14 + 14 or 24
      await expect(recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db)).rejects.toThrow(/chưa về đủ/);
      // Settling short needs a stated reason; then the request counts as received with that gap.
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:req.id,expectedRevision:0,action:'SETTLE'},db)).rejects.toThrow(/phí/);
      await db.fundTransaction.updateMany({where:{transactionId:'TX-P-'+f.x},data:{confirmed:true}});
      expect((await f.ops(0)).milestone).toBe('RECREATE');
    }finally{await f.cleanup();}
  });
  it('one EarnApp, one withdrawal: replays and new keys never add a request, receipt or cost; a failed request is retried on the same row',async()=>{
    const f=await setup();try{
      await f.link(0,0,f.emails[0].id);const key=randomUUID(),costs=await db.costRecord.count({where:{projectId:f.scope.projectId}});
      const a=await f.request(0,f.emails[0].id,'24',1,key),b=await f.request(0,f.emails[0].id,'24',1,key);expect(b).toMatchObject({id:a.id,replay:true});
      await expect(f.request(0,f.emails[0].id,'24')).rejects.toThrow(/mỗi EarnApp chỉ một lượt rút/);
      const rk=randomUUID(),input={paypalId:f.pp13.id,date:today,currency:'USD',status:'RECEIVED' as const,text:`${f.emails[0].email} | 24 | TX-1-${f.x}`};
      await recordReceipts(f.scope,{...input,key:rk},db);await recordReceipts(f.scope,{...input,key:rk},db);
      expect(await db.fundTransaction.count({where:{payoutRequestId:a.id}})).toBe(1);
      const r=await db.earnPayoutRequest.findUniqueOrThrow({where:{id:a.id}});
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:a.id,expectedRevision:r.revision,action:'FAILED',note:'EarnApp báo lỗi'},db);
      const r2=await db.earnPayoutRequest.findUniqueOrThrow({where:{id:a.id}});await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:a.id,expectedRevision:r2.revision,action:'RETRY'},db);
      expect(await db.earnPayoutRequest.count({where:{projectId:f.scope.projectId}})).toBe(1);
      const rk2=randomUUID();await recordRecreated(f.scope,{key:rk2,vmId:f.vms[0].id,expectedCycle:1},db);await recordRecreated(f.scope,{key:rk2,vmId:f.vms[0].id,expectedCycle:1},db);
      await expect(recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db)).rejects.toThrow(/lượt 2/);
      expect(await db.vmCycle.count({where:{vmId:f.vms[0].id}})).toBe(1);expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(costs);
    }finally{await f.cleanup();}
  });
  it('a used email is never given to another EarnApp; a new email of the same PP is (no new PP needed); two people at once: one wins',async()=>{
    const f=await setup();try{
      await f.link(0,0,f.emails[0].id);await f.link(1,1,null);
      await expect(f.request(1,f.emails[0].id,'10')).rejects.toThrow(/mỗi email một EarnApp|đã dùng/);
      const ok=await f.request(1,f.emails[1].id,'10');expect((await db.earnAppAccount.findUniqueOrThrow({where:{vmId:f.vms[1].id}})).paypalEmailId).toBe(f.emails[1].id);
      expect((await db.payPalEmail.findUniqueOrThrow({where:{id:f.emails[1].id}})).usedEarnAppId).not.toBeNull();expect(ok.id).toBeTruthy();
      await f.link(2,2,null);await f.link(3,3,null);
      const res=await Promise.allSettled([f.request(2,f.emails[2].id,'5'),f.request(3,f.emails[2].id,'5')]);
      expect(res.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      // Two emails already used today. Keep the original competing-command assertion on the next day's capacity.
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+86400_000));
      const both=await Promise.allSettled([f.request(2,f.emails[3].id,'5'),f.request(2,f.emails[3].id,'5')]);// same EarnApp, two keys
      expect(both.filter(r=>r.status==='fulfilled').length).toBeLessThanOrEqual(1);
      expect(await db.earnPayoutRequest.count({where:{earnApp:{vmId:f.vms[2].id}}})).toBe(1);
    }finally{await f.cleanup();}
  });
  it('people without money rights see no amounts and cannot use the money endpoints',async()=>{
    const f=await setup(1);try{
      await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'24');
      const w=await readVmOps(f.worker,db);expect(w.rights.money).toBe(false);expect(w.vms[0].request?.money).toBeNull();expect(w.vms[0].milestone).toBe('WAITING');
      expect((await readPaypalGather(f.worker,db)).paypals).toEqual([]);
      await expect(createPayoutRequest(f.worker,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,paypalEmailId:f.emails[0].id,amount:'1',date:today},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(readPayoutPick(f.worker,{vmId:f.vms[0].id},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      expect((await readVmOpsHistory(f.worker,{vmId:f.vms[0].id},db)).requests[0].money).toBeNull();
    }finally{await f.cleanup();}
  });
});
describe('Tạo lại VM',()=>{
  it('received in full → recreate keeps id / code, opens round 2 as New VM, keeps the valid proxy (new install needed), closes the old EarnApp, moves the SDK to history',async()=>{
    const f=await setup();try{
      const {endpoint,config}=await installProxy(f,0,11);
      await f.link(0,0,f.emails[0].id);const v0=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});
      await saveVmSdk(f.scope,{key:randomUUID(),vmId:v0.id,expectedVmRevision:v0.revision,expectedCycle:1,code:'sdk-old-'+f.x,expectedSdkRevision:null,amount:'7,5'},db);
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OK',expectedCycle:1}]},db);
      const req=await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      const r=await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);expect(r).toMatchObject({cycle:2,proxyKept:true});
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id},include:{desiredConfiguration:true}});
      expect(vm).toMatchObject({code:'VM_001',serverId:f.server.id,sdkId:null,installedConfigurationId:null});// the old confirmation is history of round 1
      expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:config.id}})).status).toBe('CONFIRMED');
      expect(vm.desiredConfiguration).toMatchObject({endpointId:endpoint.id,status:'PLANNED'});expect(vm.desiredConfigurationId).not.toBe(config.id);
      expect(await db.vMProxyAllocation.count({where:{endpointId:endpoint.id,releasedAt:null}})).toBe(1);// never released to the free stock
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:endpoint.id}})).inventoryState).toBe('LIVE');
      const o=await f.ops(0);expect(o).toMatchObject({cycle:2,status:'NEW_VM',milestone:'',request:null});
      const ea=await db.earnAppAccount.findFirstOrThrow({where:{loginId:f.logins[0].id}});expect(ea).toMatchObject({vmId:null,closedReason:'RECREATED'});
      const store=await readAccountStore(f.scope,db);expect(store.logins.find(l=>l.id===f.logins[0].id)?.state).toBe('USED');
      // The old login is never assigned again; the new round takes a new account and an unused email of the same PP.
      const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});
      expect((await previewLinks(f.scope,{items:[{line:1,vmId:v.id,login:f.logins[0].id}]},db)).rows[0].outcome).toBe('ERROR');
      await f.link(0,4,f.emails[3].id);expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id:req.id}})).consumedAt).not.toBeNull();
      const h=await readVmOpsHistory(f.scope,{vmId:f.vms[0].id},db);expect(h.cycles[0]).toMatchObject({number:1,reason:'PAYOUT_RECEIVED',sdk:'sdk-old-'+f.x,status:'OK',proxyKept:true});
      expect(await db.vMSdkHistory.count({where:{vmId:f.vms[0].id,previousSdk:'sdk-old-'+f.x,newSdk:null}})).toBe(1);
      // SDK store: the real machine got a new SDK; the old never-linked code is back in the store with its money, not on the VM.
      expect(await db.sdkRecord.findFirstOrThrow({where:{projectId:f.scope.projectId,code:'sdk-old-'+f.x}})).toMatchObject({vmId:null,linkState:'UNLINKED'});
      // Late money on the old email belongs to the old request; the new round stays as it is. An old AI command is refused.
      await f.receive(f.pp13.id,f.emails[0].email,'3','RECEIVED','TX-LATE-'+f.x);
      expect(await db.fundTransaction.count({where:{payoutRequestId:req.id}})).toBe(2);expect((await f.ops(0)).milestone).toBe('');
      expect((await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OK',expectedCycle:1}]},db)).rows[0].outcome).toBe('ERROR');
      await expect(f.request(0,f.emails[3].id,'5',1)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // The old request now no longer adds up (more than asked): flagged for reconciliation, the VM is not moved back.
      const hist=await readVmOpsHistory(f.scope,{vmId:f.vms[0].id},db);expect(hist.requests.find(x=>x.id===req.id)).toMatchObject({phase:'REVIEW',consumed:true,reviewAfterRecreate:true});
    }finally{await f.cleanup();}
  });
  it('a BLOCKED proxy is not kept as a good proxy; it stays for the replacement flow',async()=>{
    const f=await setup(1);try{
      const {endpoint,config}=await installProxy(f,0,12);await f.link(0,0,f.emails[0].id);
      await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await db.proxyIP.update({where:{id:endpoint.id},data:{inventoryState:'BLOCKED'}});
      const r=await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      // 19/10/2026: the BLOCKED proxy is not kept as a good proxy, but it stays the VM's position (shown Blocked) so the cell's
      // "Thay proxy" / "Nhận replace" replaces it; no install step for the new round.
      expect(r.proxyKept).toBe(false);expect(r.proxy).toMatch(/BLOCKED/);
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id},include:{desiredConfiguration:true}});expect(vm.desiredConfiguration?.endpointId).toBe(endpoint.id);expect(vm.installedConfigurationId).toBeNull();
      expect(await db.vMProxyAllocation.findFirst({where:{vmId:vm.id,endpointId:endpoint.id,releasedAt:null}})).toMatchObject({role:'DESIRED'});expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:config.id}})).status).toBe('CONFIRMED');
      expect(await db.vMTask.count({where:{vmId:vm.id,status:{in:['PENDING','IN_PROGRESS']}}})).toBe(0);
    }finally{await f.cleanup();}
  });
  it('SUS: recreated without a payout, the PP is not closed, the pending money stays on the old request; late money does not move the new round',async()=>{
    const f=await setup(1);try{
      await f.link(0,0,f.emails[0].id);const req=await f.request(0,f.emails[0].id,'24');
      await expect(recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db)).rejects.toThrow(/SUS/);
      // SUS recorded before 28/10/2026 (spec addition 1: such a VM is not converted; choosing SUS now closes the payout, see payout-suspend tests).
      await db.vmOperation.upsert({where:{vmId:f.vms[0].id},create:{projectId:f.scope.projectId,vmId:f.vms[0].id,cycle:1,status:'SUSPENDED',statusAt:new Date(),statusById:f.scope.userId},update:{status:'SUSPENDED'}});
      const r=await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);expect(r).toMatchObject({reason:'SUSPENDED',cycle:2});
      expect((await db.payPalAccount.findUniqueOrThrow({where:{id:f.pp13.id}})).status).toBe('ACTIVE');
      const old=await db.earnPayoutRequest.findUniqueOrThrow({where:{id:req.id}});expect(old).toMatchObject({state:'REQUESTED',consumedAt:null});
      expect((await readPaypalGather(f.scope,db)).paypals.find(p=>p.paypalId===f.pp13.id)!.pendingUsd).toBe('24.00');
      expect((await db.earnAppAccount.findFirstOrThrow({where:{loginId:f.logins[0].id}})).closedReason).toBe('SUSPENDED');
      await f.receive(f.pp13.id,f.emails[0].email,'24');expect(await db.fundTransaction.count({where:{payoutRequestId:req.id}})).toBe(1);
      expect((await f.ops(0))).toMatchObject({cycle:2,milestone:'',status:'NEW_VM'});
    }finally{await f.cleanup();}
  });
  it('two recreations of the same round at once: only one new round; voiding the receipt afterwards is flagged, the VM stays in its new round; the recreation cannot be undone',async()=>{
    const f=await setup(1);try{
      await f.link(0,0,f.emails[0].id);const req=await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      const res=await Promise.allSettled([recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db),recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db)]);
      expect(res.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await f.ops(0)).cycle).toBe(2);
      await db.fundTransaction.updateMany({where:{payoutRequestId:req.id},data:{voidedAt:new Date()}});
      const h=await readVmOpsHistory(f.scope,{vmId:f.vms[0].id},db);expect(h.requests[0]).toMatchObject({consumed:true,reviewAfterRecreate:true});expect((await f.ops(0)).cycle).toBe(2);
      await db.fundTransaction.updateMany({where:{payoutRequestId:req.id},data:{voidedAt:null}});
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_RECREATE'}});
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      expect((await f.ops(0))).toMatchObject({cycle:2,milestone:''});expect((await db.earnAppAccount.findFirstOrThrow({where:{loginId:f.logins[0].id}})).vmId).toBeNull();
      expect(await db.vmCycle.count({where:{vmId:f.vms[0].id}})).toBe(1);
      expect((await db.payPalEmail.findUniqueOrThrow({where:{id:f.emails[0].id}})).usedEarnAppId).not.toBeNull();// the email stays used
    }finally{await f.cleanup();}
  });
  it('autofill skips a machine recorded as deleted and one waiting to be recreated',async()=>{
    const f=await setup(2);try{
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'DELETED',expectedCycle:1}]},db);
      await f.link(1,1,f.emails[1].id);await f.request(1,f.emails[1].id,'5');await f.receive(f.pp13.id,f.emails[1].email,'5');
      const {createVMService}=await import('@/server/vm-management/allocation');
      const snapshot=await db.proxySourceSnapshot.create({data:{projectId:f.scope.projectId,sourceKey:'GENJY',hash:'af',scanSucceeded:true}});
      const service=createVMService(db,{refreshSource:async()=>({id:snapshot.id,sourceKey:'GENJY',hash:'af',fetchedAt:new Date().toISOString(),scanSucceeded:true})});
      const p=await service.preview(f.scope,{mode:'AUTO',vmIds:f.vms.map(v=>v.id),idempotencyKey:randomUUID()});
      expect(p.rows.find(r=>r.vmId===f.vms[0].id)!.message).toMatch(/VM deleted/);expect(p.rows.find(r=>r.vmId===f.vms[1].id)!.message).toMatch(/tạo lại/);
    }finally{await f.cleanup();}
  });
});
// Independent acceptance review 19/10/2026: four defects reproduced in .runtime/review-vm-ops-20261019.test.ts.
describe('Rà soát nghiệm thu 19/10',()=>{
  const source=(hash:string)=>({refreshSource:async()=>({id:'x',sourceKey:'GENJY',hash,fetchedAt:new Date().toISOString(),scanSucceeded:true})});
  it('1. without money rights the history carries operating milestones only: no amount, correction, shortfall, note or reference',async()=>{
    const f=await setup(1);try{
      await f.link(0,0,f.emails[0].id);
      const req=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,paypalEmailId:f.emails[0].id,amount:'24',reference:'REF-777',date:today},db);
      const fresh=()=>db.earnPayoutRequest.findUniqueOrThrow({where:{id:req.id}});
      let r=await fresh();
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:r.revision,action:'CORRECT',amount:'31',note:'nhập nhầm 31.50 thành 24'},db);
      r=await fresh();await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:r.revision,action:'FAILED',note:'PayPal giữ 31 USD'},db);
      r=await fresh();await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:r.revision,action:'RETRY'},db);
      await f.receive(f.pp13.id,f.emails[0].email,'29');r=await fresh();
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:r.revision,action:'SETTLE',note:'phí 2 USD'},db);
      const w=await readVmOpsHistory(f.worker,{vmId:f.vms[0].id},db),text=JSON.stringify(w,(k,v)=>k==='at'||k==='closedAt'?undefined:v);// times are not money
      expect(w.requests[0].money).toBeNull();
      expect(text).not.toMatch(/24[.,]00|31[.,]\d|29[.,]\d|31 USD|phí 2|REF-777|nhập nhầm|thiếu \d/);
      expect(w.requests[0].history.map(h=>h.what)).toEqual(['Ghi yêu cầu rút','Sửa yêu cầu rút','Đánh dấu thất bại','Gửi lại (cùng lượt rút)','Chốt nhận thiếu']);
      const board=JSON.stringify((await readVmOps(f.worker,db)).vms[0]);expect(board).not.toMatch(/REF-777|phí 2|giữ 31/);
      // With the money rights everything is shown.
      const full=JSON.stringify(await readVmOpsHistory(f.scope,{vmId:f.vms[0].id},db));
      expect(full).toMatch(/Ghi yêu cầu rút 24\.00 USD/);expect(full).toMatch(/24\.00 → 31\.00/);expect(full).toMatch(/PayPal giữ 31 USD/);expect(full).toMatch(/phí 2 USD/);
      // Rows written before the fix (no kind) are reduced to the same neutral words.
      await db.earnPayoutRequest.update({where:{id:req.id},data:{history:[{at:new Date().toISOString(),by:f.scope.userId,what:'Ghi yêu cầu rút 24.00 USD'},{at:new Date().toISOString(),by:f.scope.userId,what:'Chốt nhận 22.00 USD, thiếu 2.00: phí'}]}});
      expect((await readVmOpsHistory(f.worker,{vmId:f.vms[0].id},db)).requests[0].history.map(h=>h.what)).toEqual(['Ghi yêu cầu rút','Chốt nhận thiếu']);
    }finally{await f.cleanup();}
  });
  it('2. a recorded recreation is view-only: undo is refused (also for journals written before the fix); the closed round, closed EarnApp and used receipt stay',async()=>{
    const f=await setup(1);try{
      const {listOperations,inspectOperation}=await import('@/server/operation-history/journal');
      await f.link(0,0,f.emails[0].id);const req=await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_RECREATE'}});
      expect(op.reversible).toBe(false);
      await db.operationJournal.update({where:{id:op.id},data:{reversible:true}});// a journal written before the fix
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/tạo lại VM/)});
      expect((await listOperations(f.scope,db)).find(o=>o.id===op.id)!.canUndo).toBe(false);
      const ins=await inspectOperation(f.scope,op.id,db);expect(ins.canUndo).toBe(false);expect(ins.blockedReason).toMatch(/tạo lại VM/);
      expect((await f.ops(0))).toMatchObject({cycle:2,status:'NEW_VM'});expect(await db.vmCycle.count({where:{vmId:f.vms[0].id}})).toBe(1);
      const ea=await db.earnAppAccount.findUniqueOrThrow({where:{loginId:f.logins[0].id}});expect(ea.vmId).toBeNull();expect(ea.closedAt).not.toBeNull();
      expect((await db.earnPayoutRequest.findUniqueOrThrow({where:{id:req.id}})).consumedAt).not.toBeNull();
      await expect(recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // A normal status change in the new round can still be undone.
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'OK',expectedCycle:2}]},db);
      const st=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_STATUS'},orderBy:{createdAt:'desc'}});
      await undoOperation(f.scope,st.id,'',db);expect((await f.ops(0))).toMatchObject({cycle:2,status:'NEW_VM'});
    }finally{await f.cleanup();}
  });
  it('3. undoing the first grant of a receiving email is refused with a reason; the email stays used, the EarnApp row stays; unassign still works',async()=>{
    const f=await setup(1);try{
      const {inspectOperation}=await import('@/server/operation-history/journal');
      await f.link(0,0,f.emails[0].id);
      const op=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_ACCOUNT_LINK'}});
      await expect(undoOperation(f.scope,op.id,'',db)).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/Bỏ gán/)});
      expect((await inspectOperation(f.scope,op.id,db)).canUndo).toBe(false);
      const ea=await db.earnAppAccount.findUniqueOrThrow({where:{loginId:f.logins[0].id}});
      const e=await db.payPalEmail.findUniqueOrThrow({where:{id:f.emails[0].id}});expect(e.usedEarnAppId).toBe(ea.id);expect(e.usedAt).not.toBeNull();
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});
      expect((await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,login:null}]},db)).errors).toBe(0);
      expect((await db.payPalEmail.findUniqueOrThrow({where:{id:f.emails[0].id}})).usedEarnAppId).toBe(ea.id);
      expect((await readPayoutPick(f.scope,{vmId:f.vms[0].id},db)).paypals.flatMap(p=>p.emails).some(x=>x.id===f.emails[0].id)).toBe(false);
      // A link that grants no new email (login only) can still be undone.
      const v2=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});
      await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v2.id,expectedRevision:v2.revision,login:f.logins[1].id}]},db);
      const op2=await db.operationJournal.findFirstOrThrow({where:{projectId:f.scope.projectId,kind:'VM_ACCOUNT_LINK'},orderBy:{createdAt:'desc'}});
      await undoOperation(f.scope,op2.id,'',db);expect(await db.earnAppAccount.count({where:{vmId:f.vms[0].id}})).toBe(0);
    }finally{await f.cleanup();}
  });
  it('4a. BLOCKED proxy at recreation: the old installation is history; the VM shows the Blocked proxy for the replacement (19/10/2026)',async()=>{
    const f=await setup(1);try{
      const {proxyCellInfo}=await import('@/components/vm-management/vm-grid/ProxyCell');const {vmView}=await import('@/server/vm-management/state');
      const {endpoint,config}=await installProxy(f,0,21);await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await db.proxyIP.update({where:{id:endpoint.id},data:{inventoryState:'BLOCKED'}});
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const vm=(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===f.vms[0].id)!;
      expect(vm.installed).toBeNull();expect(vm.desired?.endpointId).toBe(endpoint.id);
      expect(vm.holds).toEqual([expect.objectContaining({endpointId:endpoint.id,state:'BLOCKED',role:'DESIRED'})]);
      expect(vmView(vm as never)).toBe('BLOCKED');expect(proxyCellInfo(vm as never)).toMatchObject({warning:'Blocked',tone:'blocked'});
      expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:config.id}})).status).toBe('CONFIRMED');// history kept
      expect((await db.vmCycle.findFirstOrThrow({where:{vmId:f.vms[0].id}})).installedConfigurationId).toBe(config.id);
      expect((await db.vmOperation.findUniqueOrThrow({where:{vmId:f.vms[0].id}}))).toMatchObject({status:'NEW_VM',cycle:2,blockedEndpointId:null});
    }finally{await f.cleanup();}
  });
  it('4b. a good proxy is kept for the position in the new round (LIVE, never NEW, no install step); the old confirmation is history',async()=>{
    const f=await setup(1);try{
      const {vmView}=await import('@/server/vm-management/state');
      const {endpoint,config}=await installProxy(f,0,22);await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const vm=(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===f.vms[0].id)!;
      expect(vm.installed).toBeNull();expect(vm.desired).toMatchObject({endpointId:endpoint.id,status:'PLANNED'});expect(vm.desired!.id).not.toBe(config.id);
      expect(vm.holds).toEqual([expect.objectContaining({endpointId:endpoint.id,role:'DESIRED'})]);expect(vmView(vm as never)).toBe('ASSIGNED');expect(await db.vMTask.count({where:{vmId:vm.id,status:{in:['PENDING','IN_PROGRESS']}}})).toBe(0);
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:endpoint.id}})).inventoryState).toBe('LIVE');
    }finally{await f.cleanup();}
  });
  it('4c. an install started in the old round cannot complete the new round: the old plan is cancelled (kept in history) and a fresh plan is made',async()=>{
    const f=await setup(1);try{
      const {endpoint,config}=await installProxy(f,0,23);
      // A second proxy planned and started on the old machine, not confirmed yet.
      const ip='203.8.'+(1+Math.floor(Math.random()*250))+'.23',identity=await db.proxyIdentity.create({data:{ip,owner:'SELF'}});
      const second=await db.proxyIP.create({data:{projectId:f.scope.projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.id}});
      const {createVMService}=await import('@/server/vm-management/allocation');
      const service=createVMService(db,source('vm-ops-23'));
      const key=randomUUID(),p=await service.preview(f.scope,{mode:'MANUAL',vmIds:[f.vms[0].id],endpointId:second.id,idempotencyKey:key});expect(p.ready).toBe(1);
      await service.commit(f.scope,p.token,key);
      const old=await db.vMConfiguration.findFirstOrThrow({where:{vmId:f.vms[0].id,endpointId:second.id}});await startInstall(f.scope,old.id,db);
      await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id},include:{desiredConfiguration:true}});
      expect(vm.installedConfigurationId).toBeNull();expect(vm.desiredConfiguration).toMatchObject({endpointId:second.id,status:'PLANNED',startedAt:null});expect(vm.desiredConfigurationId).not.toBe(old.id);
      expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:old.id}})).status).toBe('CANCELLED');
      expect((await db.vMConfiguration.findUniqueOrThrow({where:{id:config.id}})).status).toBe('CONFIRMED');
      await expect(confirmInstalled(f.scope,{configurationId:old.id,configurationHash:old.configurationHash,expectedVmRevision:vm.revision},db,source('vm-ops-23'))).rejects.toMatchObject({code:'STALE_PREVIEW'});
      await expect(startInstall(f.scope,old.id,db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // The first proxy, installed in the old round, is no longer an installation of this round.
      const holds=await db.vMProxyAllocation.findMany({where:{vmId:f.vms[0].id,releasedAt:null}});
      expect(holds.find(h=>h.endpointId===endpoint.id)?.role).not.toBe('INSTALLED');expect(holds.find(h=>h.endpointId===second.id)?.role).toBe('DESIRED');
    }finally{await f.cleanup();}
  });
});
describe('Rà soát độc lập 19/10: tiền trong nhật ký',()=>{
  it('1b. a recreation journal shows the consumed payout request without its amount to staff without money rights; managers still see it',async()=>{
    const f=await setup(1);try{
      await f.link(0,0,f.emails[0].id);await f.request(0,f.emails[0].id,'24');await f.receive(f.pp13.id,f.emails[0].email,'24');
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const {listOperations,inspectOperation}=await import('@/server/operation-history/journal');
      const op=(await listOperations(f.worker,db)).find(o=>o.kind==='VM_RECREATE')!;
      const staff=await inspectOperation(f.worker,op.id,db);expect(JSON.stringify(staff)).not.toMatch(/24(?:[.,]0+)? ?USD/);
      expect(staff.rows.find(r=>r.resource==='Yêu cầu rút EarnApp')).toMatchObject({after:expect.stringMatching(/Yêu cầu rút · .*đã dùng để tạo lại VM/)});
      expect(JSON.stringify(await inspectOperation(f.scope,op.id,db))).toMatch(/24(?:[.,]00)? USD/);
    }finally{await f.cleanup();}
  });
});
