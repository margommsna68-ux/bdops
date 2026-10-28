import {afterAll,describe,expect,it,vi} from 'vitest';
import {checked,expectConforms} from './openapi-conform';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {encrypt} from '@/lib/encryption';
import {db,AI_PIN,api,setup,balanceBody,prepareBody,statusBody,reqRev} from './ops-fixture';
import {applyLinks} from '@/server/account-store/links';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {recordPayoutReceipt,readVmOps} from '@/server/vm-ops/payout';
import {recordReceipts,recordOpening} from '@/server/business-management/paypal-ledger';
import {handleOpsRequest} from '@/server/ops-api/api';
import {revokeOpsToken} from '@/server/ops-api/tokens';
import {checkPin} from '@/server/business-management/pin';
import {changeVmProxy} from '@/server/vm-management/proxy-command';
import {readVMWorkspace} from '@/server/vm-management/repository';
import {vmView as webState} from '@/server/vm-management/state';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
// Independent review 21/10/2026 of the ops API (commit 1cca9fc): the reproductions in .runtime/review-ops-api-ack-20261021.test.ts kept
// as official tests with the same expectations, plus the cases asked for in the review. Synthetic data, test database only.

// ─── OpenAPI conformance: every answer checked against docs/ops-api/openapi.json (openapi-conform.ts) ─────
const call=async(method:'GET'|'POST',path:string,o:Parameters<typeof api>[2]={})=>{const r=await api(method,path,o);expectConforms(method,path,r);return r;};

describe('1. a replay acknowledges the original command, never the state now',()=>{
  it('balance A, then account B with $99: the retry of A still answers A and $10, B is only under current; no extra row',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),path='vms/'+f.vms[0].id+'/balance-check',key=randomUUID(),original=await balanceBody(f,0,{amount:'10.00'});
      const first=await call('POST',path,{token:t,key,body:original});expect(first.json.data.recorded).toMatchObject({earnAppAccountId:original.earnAppAccountId,amount:'10.00'});
      const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,login:f.logins[7].id}]},db);
      const next=await balanceBody(f,0,{amount:'99.00',checkedAt:new Date(Date.now()+1000).toISOString()});expect(next.earnAppAccountId).not.toBe(original.earnAppAccountId);
      expect((await call('POST',path,{token:t,body:next})).status).toBe(200);
      const replay=await call('POST',path,{token:t,key,body:original});
      expect(replay.json.data.replay).toBe(true);expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(2);
      expect(replay.json.data.vm.earnAppAccountId).toBe(original.earnAppAccountId);expect(replay.json.data.balance.lastOk.amount).toBe('10.00');
      expect(replay.json.data.recorded).toEqual(first.json.data.recorded);
      expect(replay.json.data.current).toMatchObject({vm:{earnAppAccountId:next.earnAppAccountId},balance:{latest:{amount:'99.00'}}});
    }finally{await f.cleanup();}
  });
  it('a newer check of the same account and a recreated VM do not change the acknowledgement either',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),path='vms/'+f.vms[1].id+'/balance-check',key=randomUUID(),original=await balanceBody(f,1,{amount:'5.00'});
      const first=await call('POST',path,{token:t,key,body:original});
      await call('POST',path,{token:t,body:await balanceBody(f,1,{amount:'7.50',checkedAt:new Date(Date.now()+1000).toISOString()})});
      let again=await call('POST',path,{token:t,key,body:original});expect(again.json.data).toMatchObject({replay:true,recorded:first.json.data.recorded,balance:{latest:{amount:'5.00'}},current:{balance:{latest:{amount:'7.50'}}}});
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[1].id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[1].id,expectedCycle:1},db);
      again=await call('POST',path,{token:t,key,body:original});
      expect(again.json.data).toMatchObject({replay:true,recorded:{expectedCycle:1,earnAppAccountId:original.earnAppAccountId,amount:'5.00'},vm:{expectedCycle:1},current:{vm:{expectedCycle:2,earnAppAccountId:null},balance:null}});
      expect(await db.earnBalanceCheck.count({where:{vmId:f.vms[1].id}})).toBe(2);
    }finally{await f.cleanup();}
  });
  it('prepare, status and receipts: recorded = what that command wrote; current = the request now',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','PAYOUT','RECEIPT']),email=(await f.pp('pp-82')).emails[0].id;
      const pk=randomUUID(),pb=await prepareBody(f,0,email),p1=await call('POST','withdrawals/prepare',{token:t,key:pk,body:pb}),w=p1.json.data.recorded;
      expect(w).toMatchObject({submission:'PREPARING',paypalEmailId:email,amount:'10.00'});
      const sk=randomUUID(),sb=await statusBody(f,0,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)}),s1=await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,key:sk,body:sb});
      const rk=randomUUID(),rb={projectId:f.projectId,expectedRequestRevision:await reqRev(w.withdrawalId),amount:'6.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-R-'+f.x},r1=await call('POST','withdrawals/'+w.withdrawalId+'/receipts',{token:t,key:rk,body:rb});
      await call('POST','withdrawals/'+w.withdrawalId+'/receipts',{token:t,body:{...rb,expectedRequestRevision:await reqRev(w.withdrawalId),amount:'4.00',transactionId:'TX-R2-'+f.x}});
      const p2=await call('POST','withdrawals/prepare',{token:t,key:pk,body:pb});expect(p2.json.data).toMatchObject({replay:true,recorded:p1.json.data.recorded,current:{withdrawal:{submission:'SUBMITTED_ON_EARNAPP',phase:'RECEIVED'}}});
      const s2=await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,key:sk,body:sb});expect(s2.json.data).toMatchObject({replay:true,recorded:s1.json.data.recorded});expect(s2.json.data.recorded.revisionAfter).toBe(s1.json.data.recorded.revisionAfter);
      const r2=await call('POST','withdrawals/'+w.withdrawalId+'/receipts',{token:t,key:rk,body:rb});expect(r2.json.data).toMatchObject({replay:true,recorded:{receiptId:r1.json.data.recorded.receiptId,amount:'6.00'},current:{withdrawal:{money:{received:'10.00'}}}});
      expect(await db.fundTransaction.count({where:{payoutRequestId:w.withdrawalId}})).toBe(2);expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(1);
    }finally{await f.cleanup();}
  });
});
// A client whose first business transaction runs a callback first (the reviewer's gate): used to revoke / expire exactly at the edge.
function gate(before:()=>Promise<void>){let done=false;return new Proxy(db,{get(target,prop){
  // The PIN check's short transaction (FOR UPDATE on the user) passes; the callback runs right before the business transaction.
  if(prop==='$transaction')return async(fn:unknown,options:unknown)=>{
    if(!done&&typeof fn==='function'&&!String(fn).includes('FOR UPDATE')){done=true;await before();}
    return (target.$transaction as (a:unknown,b:unknown)=>Promise<unknown>)(fn,options);};
  const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});}
describe('2. a revoked / expired token is refused at the write transaction',()=>{
  it('revoked before the write transaction starts: 401, nothing written (reviewer reproduction)',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),row=await db.opsToken.findFirstOrThrow({where:{userId:f.ai}});let revoked=false;
      const gated=new Proxy(db,{get(target,prop){if(prop==='$transaction')return async(fn:any,options:any)=>{if(!revoked){revoked=true;await revokeOpsToken(f.scope.userId,{projectId:f.projectId,tokenId:row.id},db);}return target.$transaction(fn,options);};const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
      const path='vms/'+f.vms[0].id+'/balance-check',res=await handleOpsRequest(new Request('http://local.invalid/api/ops/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+t,'x-ops-pin':AI_PIN,'idempotency-key':randomUUID(),'content-type':'application/json','x-forwarded-for':'203.0.113.7'},body:JSON.stringify(await balanceBody(f,0))}),path,gated);
      expect(revoked).toBe(true);expect(res.status).toBe(401);expect((await res.json()).error.code).toBe('TOKEN_REVOKED');expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(0);
    }finally{await f.cleanup();}
  });
  it('the same for a retry of a command that already succeeded, and for a token that expires at the edge',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),row=await db.opsToken.findFirstOrThrow({where:{userId:f.ai}}),path='vms/'+f.vms[0].id+'/balance-check',key=randomUUID(),body=await balanceBody(f,0);
      expect((await call('POST',path,{token:t,key,body})).status).toBe(200);
      const send=(client:typeof db,k:string,b:unknown)=>handleOpsRequest(new Request('http://local.invalid/api/ops/v1/'+path,{method:'POST',headers:{authorization:'Bearer '+t,'x-ops-pin':AI_PIN,'idempotency-key':k,'content-type':'application/json','x-forwarded-for':'203.0.113.7'},body:JSON.stringify(b)}),path,client);
      const expiring=await send(gate(async()=>{await db.opsToken.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()-1000)}});}),randomUUID(),await balanceBody(f,0,{amount:'3.00'}));
      expect(expiring.status).toBe(401);expect((await expiring.json()).error.code).toBe('TOKEN_EXPIRED');
      await db.opsToken.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()+86400000)}});
      const retry=await send(gate(async()=>{await revokeOpsToken(f.scope.userId,{projectId:f.projectId,tokenId:row.id},db);}),key,body);
      expect(retry.status).toBe(401);expect((await retry.json()).error.code).toBe('TOKEN_REVOKED');expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(1);
    }finally{await f.cleanup();}
  });
});
describe('3. PIN checks are decided on the user row as it is then',()=>{
  it('a correct PIN compared before three wrong ones locked the user is refused (reviewer reproduction)',async()=>{
    const f=await setup(),gates:Array<(ok:boolean)=>void>=[];
    const spy=vi.spyOn(bcrypt,'compare').mockImplementation((()=>new Promise<boolean>(resolve=>gates.push(resolve))) as never);
    try{
      const jobs=[0,1,2,3].map(i=>checkPin(db,f.ai,i===3?AI_PIN:'000000'));
      for(let i=0;gates.length<4&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,2));
      expect(gates).toHaveLength(4);for(let i=0;i<3;i++){gates[i](false);await jobs[i];}
      expect((await db.user.findUniqueOrThrow({where:{id:f.ai},select:{pinLockedAt:true}})).pinLockedAt).not.toBeNull();
      gates[3](true);expect(await jobs[3]).toBe('LOCKED');
    }finally{spy.mockRestore();await f.cleanup();}
  });
  it('a PIN changed while a check is running: the old PIN is not accepted; wrong PINs are counted even though nothing is written',async()=>{
    const f=await setup(),real=bcrypt.compare.bind(bcrypt);let first=true;
    const spy=vi.spyOn(bcrypt,'compare').mockImplementation((async(a:string,b:string)=>{if(first){first=false;const r=await real(a,b);await db.user.update({where:{id:f.ai},data:{pin:await bcrypt.hash('135790',4)}});return r;}return real(a,b);}) as never);
    try{expect(await checkPin(db,f.ai,AI_PIN)).toBe('INVALID');}finally{spy.mockRestore();}
    try{
      expect(await checkPin(db,f.ai,'135790')).toBe('OK');await db.user.update({where:{id:f.ai},data:{pin:await bcrypt.hash(AI_PIN,4),pinFailedCount:0}});
      // 23/10/2026: the ops API no longer checks a PIN (token + ADMIN approvals instead); a stray header neither counts nor blocks.
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),r=await call('POST','vms/'+f.vms[0].id+'/balance-check',{token:t,pin:'999999',body:await balanceBody(f,0)});
      expect(r.json.ok).toBe(true);expect((await db.user.findUniqueOrThrow({where:{id:f.ai}})).pinFailedCount).toBe(0);expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(1);
    }finally{await f.cleanup();}
  });
});
describe('7. PAYPAL_RECEIPT_RECORD on the web: the same recordPayoutReceipt, nothing more',()=>{
  it('a USER with only the narrow right records parts through the cell route and the API; the general ledger writes stay closed',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','PAYOUT']),email=(await f.pp('pp-82')).emails[1].id;
      const w=(await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,2,email)})).json.data.recorded;
      await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,2,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)})});
      // A member with PAYPAL_RECEIPT_RECORD only (no EARN_PAYOUT, no FUNDS module).
      const id=randomUUID();await db.user.create({data:{id,email:id+'@fixture.invalid',username:'rcv-'+id.slice(0,8),password:'x',pin:await bcrypt.hash(AI_PIN,4)}});
      await db.projectMember.create({data:{projectId:f.projectId,userId:id,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:['PAYPAL_RECEIPT_RECORD']}});
      try{
        const narrow={userId:id,projectId:f.projectId,role:'USER' as const,capabilities:[]};
        expect((await readVmOps(narrow,db)).rights).toMatchObject({receipt:true,payout:false,writeMoney:false});
        const caller=appRouter.createCaller({prisma:db,session:{user:{id},expires:'2099-01-01'}} as unknown as Context);
        const base={projectId:f.projectId,requestId:w.withdrawalId,currency:'USD',receivedAt:new Date().toISOString()};
        await caller.vmOps.payoutReceipt({...base,key:randomUUID(),expectedRequestRevision:await reqRev(w.withdrawalId),amount:'6.00',transactionId:'TX-W6-'+f.x});
        await expect(caller.vmOps.payoutReceipt({...base,key:randomUUID(),expectedRequestRevision:0,amount:'4.00',transactionId:'TX-W4-'+f.x})).rejects.toMatchObject({code:'CONFLICT'}); // stale revision
        await expect(caller.vmOps.payoutReceipt({...base,key:randomUUID(),expectedRequestRevision:await reqRev(w.withdrawalId),amount:'6.00',transactionId:'TX-W6-'+f.x})).rejects.toThrow(/một lần/); // same payment id
        // The same right through the API (token with RECEIPT for this user) completes the request: 6 + 4 = 10 by the book.
        const rt=await f.token(id,['READ','RECEIPT']),done=await call('POST','withdrawals/'+w.withdrawalId+'/receipts',{token:rt,body:{projectId:f.projectId,currency:'USD',receivedAt:base.receivedAt,expectedRequestRevision:await reqRev(w.withdrawalId),amount:'4.00',transactionId:'TX-W4-'+f.x}});
        expect(done.json.error).toBeNull();expect(done.json.data.current.withdrawal).toMatchObject({phase:'RECEIVED',money:{received:'10.00',remaining:'0.00'}});
        // Not opened: general receipt paste, opening balance, payout preparation / status, the cell's managers actions.
        const pp=await f.pp('pp-82');
        await expect(recordReceipts(narrow,{paypalId:pp.id,date:f.today,currency:'USD',status:'RECEIVED',text:pp.emails[2].email+' | 1 | TX-X-'+f.x,key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
        await expect(recordOpening(narrow,{paypalId:pp.id,date:f.today,currency:'USD',amount:'1',key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
        await expect(caller.vmOps.updatePayout({projectId:f.projectId,key:randomUUID(),requestId:w.withdrawalId,expectedRevision:await reqRev(w.withdrawalId),vmId:f.vms[2].id,expectedCycle:1,earnAppId:w.earnAppAccountId,action:'SETTLE',note:'x'})).rejects.toMatchObject({code:'FORBIDDEN'});
        await expect(recordPayoutReceipt({...narrow,userId:f.plain},{key:randomUUID(),requestId:w.withdrawalId,expectedRequestRevision:await reqRev(w.withdrawalId),amount:'1',currency:'USD',receivedAt:new Date().toISOString()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      }finally{await db.opsToken.deleteMany({where:{userId:id}});await db.opsAudit.deleteMany({where:{userId:id}});await db.operationJournal.deleteMany({where:{actorId:id}});await db.auditLog.deleteMany({where:{userId:id}});await db.projectMember.deleteMany({where:{userId:id}});}
      await db.fundTransaction.deleteMany({where:{projectId:f.projectId}});await db.user.delete({where:{id}});
    }finally{await f.cleanup();}
  });
});
describe('6. the current proxy follows the holds in force (same rule as Server / VM)',()=>{
  it('a VM that had an UNCERTAIN hold and then got a clear new proxy: list, resolve and detail say ASSIGNED with the new proxy',async()=>{
    const f=await setup(),projectId=f.projectId,net='100.65.'+(1+Math.floor(Math.random()*250))+'.';let n=0;
    await db.proxyProviderAccount.create({data:{projectId,code:'pkg',label:'pkg',credentialCipher:encrypt(JSON.stringify({username:'u',password:'p'}))}});
    const proxy=async()=>{const ip=net+(++n),identity=await db.proxyIdentity.create({data:{ip,owner:'SELF'}});return db.proxyIP.create({data:{projectId,identityId:identity.id,address:ip+':8080',host:ip,port:8080,credentialCipher:encrypt(JSON.stringify({username:'u',password:'Proxy-secret'})),packageCode:'pkg',inventoryState:'NEW',inventoryKey:identity.id}});};
    const change=async(endpointId:string)=>{const v=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[0].id},include:{operation:true}});return changeVmProxy(f.scope,{key:randomUUID(),vmId:v.id,expectedVmRevision:v.revision,expectedCycle:v.operation?.cycle??1,endpointId},db);};
    try{
      const a=await proxy(),b=await proxy();await change(a.id);
      await db.vMProxyAllocation.updateMany({where:{vmId:f.vms[0].id,releasedAt:null},data:{role:'UNCERTAIN'}});
      const t=await f.token(f.ai,['READ']),detail=()=>call('GET','vms/'+f.vms[0].id+'?projectId='+projectId,{token:t});
      expect((await detail()).json.data).toMatchObject({proxyState:'REVIEW',proxy:null});
      await change(b.id); // resolved at the cell: b is the clear assignment, a's hold released (history kept)
      const web=(await readVMWorkspace(f.scope,db)).vms.find(v=>v.id===f.vms[0].id)!;expect(webState(web as never)).toBe('ASSIGNED');
      expect(await db.vMProxyAllocation.count({where:{vmId:f.vms[0].id,releasedAt:{not:null}}})).toBeGreaterThan(0);
      const d=await detail(),r=await call('GET','vms/resolve?projectId='+projectId+'&server=business-fixture&vm=VM_001',{token:t}),l=await call('GET','vms?projectId='+projectId,{token:t});
      for(const v of [d.json.data,r.json.data,l.json.data.items.find((x:{id:string})=>x.id===f.vms[0].id)])expect(v).toMatchObject({proxyState:'ASSIGNED',proxy:{id:b.id,host:net.replace(/\.\d+\.$/,'.***.')+'2',port:8080,group:'TUT'}});
      expect(d.text).not.toContain('Proxy-secret');
    }finally{
      await db.vMTask.deleteMany({where:{vm:{server:{projectId}}}});await db.vMProxyAllocation.deleteMany({where:{projectId}});await db.virtualMachine.updateMany({where:{server:{projectId}},data:{proxyId:null,desiredConfigurationId:null,installedConfigurationId:null}});
      await db.vMConfiguration.deleteMany({where:{projectId}});await db.proxyStatusEvent.deleteMany({where:{projectId}});
      const ids=(await db.proxyIP.findMany({where:{projectId},select:{identityId:true}})).map(p=>p.identityId!).filter(Boolean);await db.proxyIP.deleteMany({where:{projectId}});await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});await db.proxyProviderAccount.deleteMany({where:{projectId}});
      await f.cleanup();
    }
  });
});
describe('8. the OpenAPI contract matches real answers',()=>{
  it('reads, writes and errors of every endpoint conform to docs/ops-api/openapi.json (envelope included)',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE','PAYOUT','RECEIPT']),P=f.projectId,v0=await f.vmNow(0);
      await call('GET','health');await call('GET','me',{token:t});await call('GET','projects',{token:t});await call('GET','servers?projectId='+P,{token:t});
      await call('GET','vms?projectId='+P+'&limit=2',{token:t});await call('GET','vms/resolve?projectId='+P+'&server=business-fixture&vm=VM_001',{token:t});
      await call('POST','vms/'+v0.id+'/balance-check',{token:t,body:await balanceBody(f,0,{amount:'12.40',withdrawable:true,evidenceNote:'Redeem'})});
      await call('POST','vms/'+v0.id+'/balance-check',{token:t,body:await balanceBody(f,0,{status:'ERROR',amount:null,errorMessage:'EarnApp không mở'})});
      const s=await call('GET','paypal/suggest?projectId='+P+'&earnAppAccountId='+v0.earnAppId+'&amount=10.00&currency=USD',{token:t});
      const w=(await call('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,0,s.json.data.suggestion.paypalEmailId)})).json.data.recorded;
      await call('GET','vms/'+v0.id+'?projectId='+P,{token:t});await call('GET','earnapp-accounts/'+v0.earnAppId+'?projectId='+P,{token:t});
      await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,0,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)},{status:'UNKNOWN_RESULT',evidenceNote:null})});
      await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,0,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)},{status:'UNKNOWN_RESULT',evidenceNote:null})}); // no change
      await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,0,{id:w.withdrawalId,revision:await reqRev(w.withdrawalId)})});
      await call('POST','withdrawals/'+w.withdrawalId+'/receipts',{token:t,body:{projectId:P,expectedRequestRevision:await reqRev(w.withdrawalId),amount:'6.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-C-'+f.x}});
      await call('GET','withdrawals?projectId='+P,{token:t});await call('GET','withdrawals/'+w.withdrawalId+'?projectId='+P,{token:t});
      // Errors: 401, 403, 404, 409, 422.
      await call('GET','me');await call('GET','servers?projectId='+f.g.scope.projectId,{token:t});
      await call('POST','withdrawals/'+w.withdrawalId+'/status',{token:t,body:await statusBody(f,0,{id:w.withdrawalId,revision:0})});
      await call('POST','vms/'+v0.id+'/balance-check',{token:t,body:await balanceBody(f,0,{amount:10})});
      const ro=await f.token(f.ai,['READ']);await call('POST','withdrawals/prepare',{token:ro,body:await prepareBody(f,1,s.json.data.suggestion.paypalEmailId)});
      expect(checked.size).toBeGreaterThanOrEqual(20);
    }finally{await f.cleanup();}
  });
});
