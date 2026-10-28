import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {commitStockImport} from '@/server/account-store/inventory';
import {applyLinks} from '@/server/account-store/links';
import {recordReceipts,recordOpening,readPaypalLedger} from '@/server/business-management/paypal-ledger';
import {recordBalanceChecks,previewBalancePaste,readBalanceHistory} from '@/server/vm-ops/balance';
import {createPayoutRequest,updatePayoutRequest,readVmOps,readPayoutPick} from '@/server/vm-ops/payout';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {balanceState,moneyFlags} from '@/lib/vm-ops';
afterAll(()=>db.$disconnect());
// EarnApp money at the VM (owner brief 20/10/2026). Synthetic data only (example.invalid), test database only.
const today='2026-10-20';
async function setup(){
  const f=await businessFixture(),x=randomUUID().slice(0,6),projectId=f.scope.projectId;
  await db.project.update({where:{id:projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  const vms=[f.vm];for(let i=2;i<=4;i++)vms.push(await db.virtualMachine.create({data:{serverId:f.server.id,code:'VM_00'+i,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}}));
  await commitStockImport(f.scope,{kind:'PAYPAL',text:[`pp-82 ${[1,2].map(n=>`p82-${n}-${x}@example.invalid`).join(' ')}`,`pp-85 ${[1,2].map(n=>`p85-${n}-${x}@example.invalid`).join(' ')}`,`pp-60 p60-1-${x}@example.invalid`].join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  await commitStockImport(f.scope,{kind:'LOGIN',loginType:'GMAIL',text:Array.from({length:6},(_,i)=>`em${i+1}-${x}@example.invalid|pw`).join('\n'),batch:{purchasedAt:today,priceMode:'NONE'},key:randomUUID()},db);
  const pp=async(code:string)=>db.payPalAccount.findFirstOrThrow({where:{projectId,code},include:{emails:{orderBy:{email:'asc'}}}});
  const logins=await db.gmailAccount.findMany({where:{projectId},orderBy:{email:'asc'}});
  for(const [i,vm] of vms.entries()){const v=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v.id,expectedRevision:v.revision,login:logins[i].id}]},db);}
  const ea=async(i:number)=>(await db.earnAppAccount.findUniqueOrThrow({where:{vmId:vms[i].id}})).id;
  const ops=async(i:number,scope=f.scope)=>(await readVmOps(scope,db)).vms.find(v=>v.vmId===vms[i].id)!;
  const check=async(i:number,o:Partial<Parameters<typeof recordBalanceChecks>[1]['items'][number]>,key=randomUUID(),scope=f.scope)=>recordBalanceChecks(scope,{key,source:'CELL',items:[{vmId:vms[i].id,expectedCycle:1,earnAppId:await ea(i),checkedAt:new Date().toISOString(),outcome:'OK',amount:'10.00',...o}]},db);
  const cleanup=async()=>{await db.earnBalanceCheck.deleteMany({where:{projectId}});await db.operationJournal.deleteMany({where:{projectId}});await db.vmOpsEvent.deleteMany({where:{projectId}});await f.cleanup();};
  return {...f,x,vms,pp,logins,ea,ops,check,cleanup};
}
describe('EarnApp balance at the VM',()=>{
  it('$10 without the condition is not "có thể rút"; 0 ≠ never checked; a failed check keeps the last figure; a late older check never replaces a newer one',async()=>{
    const f=await setup();try{
      const before=await f.ops(0);expect(before.balance).toEqual({latest:null,lastOk:null});expect(balanceState(before.balance).kind).toBe('UNCHECKED');
      await f.check(0,{amount:'10.00',checkedAt:'2026-10-20T02:15:00Z'});
      let o=await f.ops(0);expect(o.balance.latest).toMatchObject({outcome:'OK',amount:'10.00',currency:'USD',withdrawable:'UNKNOWN'});
      expect(moneyFlags({hasEarnApp:true,balance:o.balance,request:null},new Date('2026-10-20T03:00:00Z')).WITHDRAWABLE).toBe(false);
      await f.check(1,{amount:'0'});expect((await f.ops(1)).balance.latest).toMatchObject({amount:'0.00'});expect(balanceState((await f.ops(1)).balance).kind).toBe('OK');
      await f.check(0,{outcome:'FAILED',amount:null,failure:'EarnApp không mở được',checkedAt:'2026-10-20T03:00:00Z'});
      o=await f.ops(0);expect(o.balance.latest).toMatchObject({outcome:'FAILED',failure:'EarnApp không mở được'});expect(o.balance.lastOk).toMatchObject({amount:'10.00'});
      await f.check(0,{amount:'12.40',withdrawable:'YES',checkedAt:'2026-10-20T04:00:00Z'});
      await f.check(0,{amount:'7.00',checkedAt:'2026-10-20T01:00:00Z'}); // older reading arriving late
      o=await f.ops(0);expect(o.balance.latest).toMatchObject({amount:'12.40',withdrawable:'YES',checkedAt:'2026-10-20T04:00:00.000Z'});
      expect((await readBalanceHistory(f.scope,{vmId:f.vms[0].id},db)).rows).toHaveLength(4);
      // A retry of the same request writes nothing twice; a new check with the same amount is a new line (fresh time).
      const k=randomUUID(),at=new Date().toISOString();await f.check(2,{amount:'5.00',checkedAt:at},k);expect(await f.check(2,{amount:'5.00',checkedAt:at},k)).toMatchObject({replay:true});
      await f.check(2,{amount:'5.00'});expect(await db.earnBalanceCheck.count({where:{vmId:f.vms[2].id}})).toBe(2);
      // Invalid input stays at its line; nothing written.
      const bad=await f.check(3,{amount:'-1'});expect(bad).toMatchObject({applied:0,errors:1});
      expect((await f.check(3,{checkedAt:'2030-01-01T00:00:00Z'})).rows[0].message).toMatch(/tương lai/);
      expect((await f.check(3,{outcome:'FAILED',amount:null})).rows[0].message).toMatch(/lý do/);
    }finally{await f.cleanup();}
  });
  it('a wrong round or a changed EarnApp is refused at the line; a recreated VM starts without a balance',async()=>{
    const f=await setup();try{
      const r1=await recordBalanceChecks(f.scope,{key:randomUUID(),source:'AI',items:[{vmId:f.vms[0].id,expectedCycle:2,earnAppId:await f.ea(0),checkedAt:new Date().toISOString(),outcome:'OK',amount:'1'},{vmId:f.vms[1].id,expectedCycle:1,earnAppId:await f.ea(0),checkedAt:new Date().toISOString(),outcome:'OK',amount:'1'}]},db);
      expect(r1.rows.map(x=>x.outcome)).toEqual(['ERROR','ERROR']);expect(r1.rows[0].message).toMatch(/lượt/);expect(r1.rows[1].message).toMatch(/đổi tài khoản/);
      await f.check(0,{amount:'9.00'});
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[0].id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const o=await f.ops(0);expect(o.cycle).toBe(2);expect(o.balance).toEqual({latest:null,lastOk:null});
    }finally{await f.cleanup();}
  });
  it('balances are never income: the PayPal book and team totals do not move; SDK money is not read',async()=>{
    const f=await setup();try{
      const before=await readPaypalLedger(f.scope,{},db);
      await db.sdkRecord.create({data:{projectId:f.scope.projectId,code:'sdk-money-'+f.x,holderVmId:f.vms[0].id,heldAt:new Date(),linkState:'UNLINKED',amount:'99.00',createdById:f.scope.userId,createdAt:new Date()}});
      await f.check(0,{amount:'10.00'});
      expect(await readPaypalLedger(f.scope,{},db)).toEqual(before);expect((await f.ops(0)).balance.latest?.amount).toBe('10.00');
      expect(await db.fundTransaction.count({where:{projectId:f.scope.projectId}})).toBe(0);expect(await db.teamReceipt.count({where:{projectId:f.scope.projectId}})).toBe(0);
    }finally{await f.cleanup();}
  });
  it('Dán bảng → Số dư: matched by server + VM code; empty keeps; 0 is a value; no EarnApp / unknown VM / repeats at the line',async()=>{
    const f=await setup();try{
      await db.earnAppAccount.update({where:{vmId:f.vms[3].id},data:{vmId:null}});
      const p=await previewBalancePaste(f.scope,{serverId:f.server.id,text:['VM | Số dư','VM_002 | 0','VM_001\t12,50','VM_003 |','VM_009 | 3','VM_004 | 3','VM_001 | 4'].join('\n')},db);
      expect(p.rows.map(r=>[r.vm,r.outcome,r.amount])).toEqual([['VM_002','READY','0'],['VM_001','READY','12.50'],['VM_003','SKIP',null],['VM_009','ERROR',null],['VM_004','ERROR',null],['VM_001','ERROR',null]]);
      const multi=await previewBalancePaste(f.scope,{text:`${f.server.code} | VM_002 | 1.000,5`},db);expect(multi.rows[0]).toMatchObject({outcome:'READY',amount:'1000.5'});
      const items=p.rows.filter(r=>r.outcome==='READY').map(r=>({vmId:r.vmId!,expectedCycle:r.expectedCycle!,earnAppId:r.earnAppId!,checkedAt:new Date().toISOString(),outcome:'OK' as const,amount:r.amount!,line:r.line}));
      const done=await recordBalanceChecks(f.scope,{key:randomUUID(),source:'PASTE',items},db);expect(done).toMatchObject({applied:2,errors:0});
      expect((await f.ops(1)).balance.latest).toMatchObject({amount:'0.00',withdrawable:'UNKNOWN'});expect((await f.ops(2)).balance.latest).toBeNull();
    }finally{await f.cleanup();}
  });
  it('rights: viewer and plain staff cannot write; the EARN_BALANCE capability can (an AI account); amounts hidden without a read right; other projects refused',async()=>{
    const f=await setup();try{
      await expect(f.check(0,{},randomUUID(),f.worker)).rejects.toMatchObject({code:'FORBIDDEN'});
      await f.check(0,{amount:'10.00'});
      expect((await f.ops(0,f.worker)).balance.latest).toMatchObject({outcome:'OK',amount:null}); // staff without money rights: the milestone, no amount
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.worker.projectId}},data:{capabilities:['EARN_BALANCE']}});
      expect(await f.check(0,{amount:'11.00'},randomUUID(),f.worker)).toMatchObject({applied:1});expect((await f.ops(0,f.worker)).balance.latest?.amount).toBe('11.00');
      await expect(createPayoutRequest(f.worker,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,paypalEmailId:(await f.pp('pp-60')).emails[0].id,amount:'10',date:today},db)).rejects.toMatchObject({code:'FORBIDDEN'}); // no payout right with it
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.worker.projectId}},data:{role:'VIEWER',capabilities:[]}});
      await expect(f.check(0,{},randomUUID(),f.worker)).rejects.toMatchObject({code:'FORBIDDEN'});
      const other=await businessFixture();try{await expect(recordBalanceChecks(other.scope,{key:randomUUID(),source:'CELL',items:[{vmId:f.vms[0].id,expectedCycle:1,earnAppId:await f.ea(0),checkedAt:new Date().toISOString(),outcome:'OK',amount:'1'}]},db)).resolves.toMatchObject({applied:0,errors:1});
        await expect(readBalanceHistory(other.scope,{vmId:f.vms[0].id},db)).rejects.toMatchObject({code:'NOT_FOUND'});}finally{await other.cleanup();}
    }finally{await f.cleanup();}
  });
});
describe('payout: suggested PayPal, held emails, milestones',()=>{
  it('$82 + $18 waiting counts as projected full; the PP closest to $100 without going over is suggested; own email always wins',async()=>{
    const f=await setup();try{
      const p82=await f.pp('pp-82'),p85=await f.pp('pp-85'),p60=await f.pp('pp-60');
      await recordOpening(f.scope,{paypalId:p82.id,date:'2026-10-01',currency:'USD',amount:'82',key:randomUUID()},db);
      await recordOpening(f.scope,{paypalId:p85.id,date:'2026-10-01',currency:'USD',amount:'85',key:randomUUID()},db);
      await recordOpening(f.scope,{paypalId:p60.id,date:'2026-10-01',currency:'USD',amount:'60',key:randomUUID()},db);
      // $18 waiting on pp-82 (a request sent for VM_002)
      await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,paypalEmailId:p82.emails[0].id,amount:'18',date:today},db);
      const pick=await readPayoutPick(f.scope,{vmId:f.vms[0].id,amount:'10'},db);
      expect(pick.suggestion).toMatchObject({paypalId:p85.id});expect(pick.suggestion?.why).toMatch(/pp-85.*\$95,00/);
      expect(pick.paypals.find(p=>p.id===p82.id)).toMatchObject({pendingUsd:'18.00'});
      // VM_002 already has its email on pp-82: its own email wins, never changed silently.
      expect((await readPayoutPick(f.scope,{vmId:f.vms[1].id,amount:'5'},db)).suggestion).toMatchObject({paypalId:p82.id,why:expect.stringMatching(/đã có email nhận/)});
    }finally{await f.cleanup();}
  });
  it('preparing holds an email (two people cannot take it); unknown result stays held; SENT makes it used; a prepared request is not "Chờ về"; lost answers replay',async()=>{
    const f=await setup();try{
      const p60=await f.pp('pp-60'),email=p60.emails[0].id,key=randomUUID();
      const prep=(i:number,k=randomUUID())=>createPayoutRequest(f.scope,{key:k,vmId:f.vms[i].id,expectedCycle:1,paypalEmailId:email,amount:'10',date:today,submission:'PREPARING'},db);
      const r=await prep(0,key);expect(await prep(0,key)).toMatchObject({replay:true,id:r.id}); // lost answer before the EarnApp click: same request
      await expect(prep(1)).rejects.toMatchObject({code:'INVALID_INPUT',message:expect.stringMatching(/đang được giữ/)}); // held for VM_001's EarnApp: refused for another one
      await expect(createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,paypalEmailId:email,amount:'10',date:today},db)).rejects.toMatchObject({message:expect.stringMatching(/đang được giữ/)}); // nor sent directly
      const v3=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[2].id}});expect((await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v3.id,expectedRevision:v3.revision,paypalEmail:email}]},db)).errors).toBe(1); // nor assigned at the cell
      let e=await db.payPalEmail.findUniqueOrThrow({where:{id:email}});expect(e).toMatchObject({holdEarnAppId:await f.ea(0),usedEarnAppId:null});
      let o=await f.ops(0);expect(o.milestone).toBe('PREPARING');expect(moneyFlags({hasEarnApp:true,balance:o.balance,request:o.request!}).WAITING).toBe(false);
      expect((await readPayoutPick(f.scope,{vmId:f.vms[2].id,amount:'10'},db)).paypals.flatMap(p=>p.emails.map(x=>x.id))).not.toContain(email); // a held email is offered to nobody else
      const req=await db.earnPayoutRequest.findUniqueOrThrow({where:{id:r.id}});
      const upd=(action:'UNKNOWN'|'SENT'|'CANCELLED',rev:number,k=randomUUID(),note?:string)=>updatePayoutRequest(f.scope,{key:k,requestId:r.id,expectedRevision:rev,action,note},db);
      await upd('UNKNOWN',req.revision);o=await f.ops(0);expect(o.milestone).toBe('UNKNOWN');expect((await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).holdEarnAppId).toBe(await f.ea(0));
      // A receipt cannot attach to a request that is not confirmed sent.
      await recordReceipts(f.scope,{paypalId:p60.id,date:today,currency:'USD',status:'RECEIVED',text:`${p60.emails[0].email} | 3 | TX-3-${f.x}`,key:randomUUID()},db);
      expect(await db.fundTransaction.count({where:{payoutRequestId:r.id}})).toBe(0);
      const k2=randomUUID(),rev=(await db.earnPayoutRequest.findUniqueOrThrow({where:{id:r.id}})).revision;
      await upd('SENT',rev,k2);expect(await upd('SENT',rev,k2)).toMatchObject({replay:true}); // lost answer after confirming: replay
      e=await db.payPalEmail.findUniqueOrThrow({where:{id:email}});expect(e).toMatchObject({holdEarnAppId:null,usedEarnAppId:await f.ea(0)});
      o=await f.ops(0);expect(o.milestone).toBe('WAITING');expect(o.request).toMatchObject({submission:'SENT'});
      // $6 of $10: still $4 waiting.
      await recordReceipts(f.scope,{paypalId:p60.id,date:today,currency:'USD',status:'RECEIVED',text:`${p60.emails[0].email} | 6 | TX-6-${f.x}`,key:randomUUID()},db);
      o=await f.ops(0);expect(o.request?.money).toMatchObject({received:'6.00',remaining:'4.00'});
    }finally{await f.cleanup();}
  });
  it('cancelling a preparation gives the held email back (never used); a cancelled sent request keeps its email used',async()=>{
    const f=await setup();try{
      const p85=await f.pp('pp-85'),email=p85.emails[0].id;
      const r=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,paypalEmailId:email,amount:'10',date:today,submission:'PREPARING'},db);
      const rev=(await db.earnPayoutRequest.findUniqueOrThrow({where:{id:r.id}})).revision;
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:rev,action:'CANCELLED',note:'Chưa bấm trên EarnApp'},db);
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({holdEarnAppId:null,usedEarnAppId:null});
      // Sent directly (as before): the email is used for good; cancelling keeps that mark.
      const s=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,paypalEmailId:p85.emails[1].id,amount:'10',date:today},db);
      const rev2=(await db.earnPayoutRequest.findUniqueOrThrow({where:{id:s.id}})).revision;
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:s.id,expectedRevision:rev2,action:'CANCELLED',note:'Huỷ'},db);
      expect((await db.payPalEmail.findUniqueOrThrow({where:{id:p85.emails[1].id}})).usedEarnAppId).toBe(await f.ea(1));
    }finally{await f.cleanup();}
  });
});
// Review fixes 20/10/2026: a payout request acts only on its own VM, round and EarnApp; free text never carries money to staff
// without the read right. (Independent repro cases kept here as guards.)
describe('review fixes: request identity, free text',()=>{
  const reqRev=async(id:string)=>(await db.earnPayoutRequest.findUniqueOrThrow({where:{id}})).revision;
  it('SUS → recreate → new EarnApp: SENT of the old preparation never touches the new account; the old account reconciles in history and late money links to it',async()=>{
    const f=await setup();try{
      const p60=await f.pp('pp-60'),email=p60.emails[0].id,oldId=await f.ea(0);
      const r=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1,earnAppId:oldId,paypalEmailId:email,amount:'10',date:today,submission:'PREPARING'},db);
      // SUS recorded before 28/10/2026 (spec addition 1: such a VM is not converted; choosing SUS now closes the payout, see payout-suspend tests).
      await db.vmOperation.upsert({where:{vmId:f.vms[0].id},create:{projectId:f.scope.projectId,vmId:f.vms[0].id,cycle:1,status:'SUSPENDED',statusAt:new Date(),statusById:f.scope.userId},update:{status:'SUSPENDED'}});
      await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[0].id,expectedCycle:1},db);
      const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v.id,expectedRevision:v.revision,login:f.logins[5].id}]},db);
      const newId=await f.ea(0);expect(newId).not.toBe(oldId);
      // The operating command (from the cell, with the identity it saw) is refused, with or without the identity.
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'SENT',vmId:f.vms[0].id,expectedCycle:1,earnAppId:oldId},db)).rejects.toMatchObject({code:'STALE_PREVIEW',message:expect.stringMatching(/tài khoản cũ/)});
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'SENT'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // A command naming the new account / round for the old request is refused too.
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'SENT',vmId:f.vms[0].id,expectedCycle:2,earnAppId:newId,history:true},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // RETRY on an old account is work on a machine it left: refused even in history.
      await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'RETRY',vmId:f.vms[0].id,expectedCycle:1,earnAppId:oldId,history:true},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
      // The new account cannot take the email held by the old preparation.
      expect((await readPayoutPick(f.scope,{vmId:f.vms[0].id,amount:'10'},db)).paypals.flatMap(p=>p.emails.map(x=>x.id))).not.toContain(email);
      // History reconciliation: SENT on the old account only; replay of the same key writes nothing twice.
      const k=randomUUID(),rev=await reqRev(r.id),hist={key:k,requestId:r.id,expectedRevision:rev,action:'SENT' as const,vmId:f.vms[0].id,expectedCycle:1,earnAppId:oldId,history:true};
      await updatePayoutRequest(f.scope,hist,db);expect(await updatePayoutRequest(f.scope,hist,db)).toMatchObject({replay:true});
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({usedEarnAppId:oldId,holdEarnAppId:null});
      expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:oldId}})).toMatchObject({paypalEmailId:email,vmId:null});
      expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:newId}})).toMatchObject({paypalEmailId:null,vmId:f.vms[0].id});
      expect(await db.earnPayoutRequest.findUniqueOrThrow({where:{id:r.id}})).toMatchObject({submission:'SENT',earnAppId:oldId,cycle:1});
      // Late money for the old account links to the old request, snapshot without the new account.
      await recordReceipts(f.scope,{paypalId:p60.id,date:today,currency:'USD',status:'RECEIVED',text:`${p60.emails[0].email} | 10 | TX-L-${f.x}`,key:randomUUID()},db);
      expect(await db.fundTransaction.findFirstOrThrow({where:{transactionId:'TX-L-'+f.x}})).toMatchObject({payoutRequestId:r.id,earnAppId:oldId});
      // The VM board shows the new round without the old request; the old email is never offered again.
      expect((await f.ops(0)).request).toBeNull();
      expect((await readPayoutPick(f.scope,{vmId:f.vms[0].id,amount:'10'},db)).paypals.flatMap(p=>p.emails.map(x=>x.id))).not.toContain(email);
    }finally{await f.cleanup();}
  });
  it('A → B on the same round: SENT / UNKNOWN / RETRY from the cell refused; history UNKNOWN keeps the hold, history FAILED gives it back; B untouched',async()=>{
    const f=await setup();try{
      const p85=await f.pp('pp-85'),email=p85.emails[0].id,a=await f.ea(1);
      const r=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,earnAppId:a,paypalEmailId:email,amount:'10',date:today,submission:'PREPARING'},db);
      const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[1].id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:v.id,expectedRevision:v.revision,login:f.logins[5].id}]},db);
      const b=await f.ea(1);expect(b).not.toBe(a);
      const id={vmId:f.vms[1].id,expectedCycle:1,earnAppId:a};
      for(const action of ['SENT','UNKNOWN','FAILED'] as const)await expect(updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action,note:'x',...id},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      // B's own request form saw A: refused (no hold / link for B from A's draft).
      await expect(createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,earnAppId:a,paypalEmailId:p85.emails[1].id,amount:'10',date:today,submission:'PREPARING'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'UNKNOWN',...id,history:true},db);
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({holdEarnAppId:a,usedEarnAppId:null});
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id,expectedRevision:await reqRev(r.id),action:'FAILED',note:'EarnApp không có lệnh rút',...id,history:true},db);
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({holdEarnAppId:null,usedEarnAppId:null});
      expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:b}})).toMatchObject({paypalEmailId:null});
      expect(await db.earnPayoutRequest.count({where:{earnAppId:b}})).toBe(0);
      // The live request of B works as before.
      const rb=await createPayoutRequest(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1,earnAppId:b,paypalEmailId:email,amount:'10',date:today,submission:'PREPARING'},db);
      await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:rb.id,expectedRevision:await reqRev(rb.id),action:'SENT',vmId:f.vms[1].id,expectedCycle:1,earnAppId:b},db);
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({usedEarnAppId:b});
    }finally{await f.cleanup();}
  });
  it('condition / failure / evidence free text reaches only who may read balances; EARN_BALANCE opens no PayPal money',async()=>{
    const f=await setup();try{
      await f.check(0,{amount:'731.25',condition:'Số dư 731.25 USD, đủ rút',evidence:'ảnh 731.25',checkedAt:new Date(Date.now()-5000).toISOString()});
      await f.check(0,{outcome:'FAILED',amount:null,failure:'Khoản 529.75 USD đang cần đối chiếu'});
      const board=await readVmOps(f.worker,db),hist=await readBalanceHistory(f.worker,{vmId:f.vms[0].id},db);
      expect(JSON.stringify({board,hist})).not.toMatch(/731|529/);
      expect(board.vms.find(v=>v.vmId===f.vms[0].id)!.balance.latest).toMatchObject({outcome:'FAILED',failure:null,noteHidden:true});
      expect(hist.rows[1]).toMatchObject({outcome:'OK',condition:null,evidence:null,noteHidden:true});
      // The owner (money rights) still sees all of it.
      const full=JSON.stringify(await readBalanceHistory(f.scope,{vmId:f.vms[0].id},db));expect(full).toMatch(/731\.25 USD, đủ rút/);expect(full).toMatch(/529\.75/);
      // EARN_BALANCE: balances yes, PayPal amounts no.
      await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.worker.projectId}},data:{capabilities:['EARN_BALANCE']}});
      const w=await readVmOps(f.worker,db);expect(w.rights).toMatchObject({balanceRead:true,money:false,writeMoney:false});
      expect(JSON.stringify(await readBalanceHistory(f.worker,{vmId:f.vms[0].id},db))).toMatch(/529\.75/);
    }finally{await f.cleanup();}
  });
});
