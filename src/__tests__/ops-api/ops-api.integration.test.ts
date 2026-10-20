import {afterAll,describe,expect,it} from 'vitest';
import {db,AI_PIN,ADMIN_PIN,api,setup,balanceBody,prepareBody,statusBody,reqRev} from './ops-fixture';
import {randomUUID} from 'node:crypto';
import {testClient} from '../proxy-management/db-fixture';
import {applyLinks} from '@/server/account-store/links';
import {setVmStatus,recordRecreated} from '@/server/vm-ops/ops';
import {createPayoutRequest,updatePayoutRequest,readVmOps} from '@/server/vm-ops/payout';
import {createOpsToken,revokeOpsToken,listOpsTokens} from '@/server/ops-api/tokens';
import {hit,LIMITS} from '@/server/ops-api/limits';
afterAll(()=>db.$disconnect());
// API vận hành AI (owner brief 21/10/2026). Synthetic data only (example.invalid), test database only.

describe('ops API: tokens, authentication, PIN, limits',()=>{
  it('token lifecycle: shown once, stored hashed, revoked / expired / locked user / removed member refused on the next call',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ']);expect(t).toMatch(/^mth_[A-Za-z0-9_-]{43}$/);
      const row=await db.opsToken.findFirstOrThrow({where:{userId:f.ai}});expect(row.tokenHash).not.toContain(t.slice(4));expect(JSON.stringify(row)).not.toContain(t);
      expect(JSON.stringify(await listOpsTokens(f.scope.userId,f.projectId,db))).not.toContain(t);
      expect((await api('GET','me',{token:t})).json).toMatchObject({ok:true,error:null,data:{user:{id:f.ai},projects:[{projectId:f.projectId,effective:{READ:true,BALANCE_WRITE:false}}]}});
      expect((await api('GET','me')).json.error?.code).toBe('UNAUTHORIZED');
      expect((await api('GET','me',{token:'mth_'+'x'.repeat(43)})).status).toBe(401);
      await db.user.update({where:{id:f.ai},data:{loginLockedAt:new Date()}});expect((await api('GET','me',{token:t})).json.error?.code).toBe('FORBIDDEN');await db.user.update({where:{id:f.ai},data:{loginLockedAt:null}});
      // Removed from the project: the project is no longer visible through the token.
      const m=await db.projectMember.findFirstOrThrow({where:{userId:f.ai,projectId:f.projectId}});await db.projectMember.delete({where:{id:m.id}});
      expect((await api('GET','projects',{token:t})).json.data.items).toEqual([]);expect((await api('GET','servers?projectId='+f.projectId,{token:t})).json.error?.code).toBe('NOT_FOUND');
      await db.projectMember.create({data:{projectId:f.projectId,userId:f.ai,role:'USER',allowedModules:['INFRASTRUCTURE'],capabilities:m.capabilities}});
      await db.opsToken.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()-1000)}});expect((await api('GET','me',{token:t})).json.error?.code).toBe('TOKEN_EXPIRED');
      await db.opsToken.update({where:{id:row.id},data:{expiresAt:new Date(Date.now()+86400000)}});
      await revokeOpsToken(f.scope.userId,{projectId:f.projectId,tokenId:row.id},db);expect((await api('GET','me',{token:t})).json.error?.code).toBe('TOKEN_REVOKED');
      // An ADMIN gives only what the user can do now; a VIEWER gets no write; only in projects the ADMIN administers.
      await expect(f.token(f.plain,['BALANCE_WRITE'])).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(f.token(f.viewer,['PAYOUT'])).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(createOpsToken(f.g.scope.userId,{projectId:f.projectId,userId:f.ai,name:'x',scopes:['READ'],expiresInDays:30,pin:ADMIN_PIN},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      await expect(createOpsToken(f.scope.userId,{projectId:f.projectId,userId:f.ai,name:'x',scopes:['READ'],expiresInDays:30,pin:'000000'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      // Out of scope: an operation the token lacks, an unknown path, another project the user belongs to but the token does not name.
      const r=await f.token(f.ai,['READ']);
      expect((await api('POST','vms/'+f.vms[0].id+'/balance-check',{token:r,body:await balanceBody(f,0)})).json.error?.code).toBe('FORBIDDEN');
      expect((await api('GET','trpc/vmOps.board',{token:r})).json.error?.code).toBe('NOT_FOUND');
      expect((await api('GET','servers?projectId='+f.g.scope.projectId,{token:r})).json.error?.code).toBe('NOT_FOUND');
    }finally{await f.cleanup();}
  });
  it('PIN on every write: missing / wrong / locked (3 wrong lock the user for every token); 5 wrong per token lock that token',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),t2=await f.token(f.ai,['READ','BALANCE_WRITE']),path='vms/'+f.vms[0].id+'/balance-check';
      expect((await api('POST',path,{token:t,pin:null,body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_REQUIRED');
      expect((await api('POST',path,{token:t,key:null,body:await balanceBody(f,0)})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST',path,{token:t,pin:'111111',body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_INVALID');
      expect((await api('POST',path,{token:t,pin:'111111',body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_INVALID');
      expect((await api('POST',path,{token:t,pin:'111111',body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_LOCKED');
      // Switching token does not get around the user's lock, even with the right PIN.
      expect((await api('POST',path,{token:t2,body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_LOCKED');
      expect(await db.earnBalanceCheck.count({where:{projectId:f.projectId}})).toBe(0);
      await db.user.update({where:{id:f.ai},data:{pinLockedAt:null,pinFailedCount:0}});
      // Token limit: wrong PINs spread so the user never reaches 3 in a row still lock this token after 5.
      for(let i=0;i<5;i++){expect((await api('POST',path,{token:t2,pin:'999999',body:await balanceBody(f,0)})).json.error?.code).toBe('PIN_INVALID');await db.user.update({where:{id:f.ai},data:{pinFailedCount:0}});}
      const locked=await api('POST',path,{token:t2,body:await balanceBody(f,0)});expect(locked.json.error?.code).toBe('PIN_LOCKED');expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await api('POST',path,{token:t,body:await balanceBody(f,0)})).json.ok).toBe(true); // the other token of the same user is not locked by it
    }finally{await f.cleanup();}
  });
  it('rate limits are counted in the database (shared by instances); 429 with Retry-After; client-claimed IPs are ignored',async()=>{
    const f=await setup(),other=testClient();try{
      const t=await f.token(f.ai,['READ'],{allowedIps:['198.51.100.9']});
      // Only the address added by the trusted proxy (rightmost) counts; a forged left part does not open the token.
      expect((await api('GET','health',{xff:'198.51.100.9, 203.0.113.50'})).json.data.verifiedIp).toBe('203.0.113.50');
      expect((await api('GET','me',{token:t,xff:'198.51.100.9, 203.0.113.50'})).json.error?.code).toBe('FORBIDDEN');
      expect((await api('GET','me',{token:t,xff:'203.0.113.50, 198.51.100.9'})).json.ok).toBe(true);
      const row=await db.opsToken.findFirstOrThrow({where:{userId:f.ai}});
      const s='shared-'+row.id;const a=await hit(db,'read',s),b=await hit(other,'read',s);expect(b.count).toBe(a.count+1);
      const start=new Date(Math.floor(Date.now()/60000)*60000);await db.opsRateBucket.upsert({where:{key:'read:'+row.id},create:{key:'read:'+row.id,windowStart:start,count:LIMITS.read.max},update:{windowStart:start,count:LIMITS.read.max}});
      const r=await api('GET','me',{token:t,xff:'198.51.100.9'});expect(r.status).toBe(429);expect(r.json.error?.code).toBe('RATE_LIMITED');expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      await db.opsRateBucket.deleteMany({where:{key:{contains:row.id}}});
    }finally{await other.$disconnect();await f.cleanup();}
  });
});
describe('ops API: reads',()=>{
  it('/projects gives id, code and name; resolve matches exact server + VM codes only; pages are stable; nothing secret is returned',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ']);
      const p=(await api('GET','projects',{token:t})).json.data.items;expect(p).toEqual([{id:f.projectId,code:f.projectId,name:'Business domain fixture'}]);
      const one=await api('GET','vms/resolve?projectId='+f.projectId+'&server=BUSINESS-FIXTURE&vm=vm_002',{token:t});expect(one.json.data).toMatchObject({id:f.vms[1].id,code:'VM_002',serverCode:'business-fixture',expectedCycle:1,earnAppAccount:{id:(await f.vmNow(1)).earnAppId}});
      expect(one.json.data.earnAppAccount.login).toMatch(/^op\*\*\*@example\.invalid$/);
      expect((await api('GET','vms/resolve?projectId='+f.projectId+'&server=business-fixture&vm=VM_00',{token:t})).json.error?.code).toBe('NOT_FOUND');
      await db.virtualMachine.create({data:{serverId:f.server.id,code:'vm_003',managed:true,proxySlotState:'BLANK'}});
      const amb=await api('GET','vms/resolve?projectId='+f.projectId+'&server=business-fixture&vm=VM_003',{token:t});expect(amb.status).toBe(409);expect(amb.json.error?.code).toBe('AMBIGUOUS');
      const seen:string[]=[];let cursor:string|null=null;do{const r=await api('GET','vms?projectId='+f.projectId+'&limit=2'+(cursor?'&cursor='+cursor:''),{token:t});seen.push(...r.json.data.items.map((v:{id:string})=>v.id));cursor=r.json.data.nextCursor;}while(cursor);
      expect(seen).toHaveLength(6);expect(new Set(seen).size).toBe(6);
      expect((await api('GET','vms?projectId='+f.projectId+'&limit=500',{token:t})).json.error?.code).toBe('VALIDATION');
      const detail=await api('GET','vms/'+f.vms[0].id+'?projectId='+f.projectId,{token:t});expect(detail.json.data).toMatchObject({sdk:{total:0},balance:{latest:null,lastOk:null,amountsVisible:false},withdrawal:null,pastCycles:{items:[]}}); // READ only: the balance right of this user comes with EARN_BALANCE, which this token does not carry
      for(const r of [one,detail])expect(r.text).not.toMatch(new RegExp('Secret-pw-'+f.x+'|'+AI_PIN+'|'+t));
    }finally{await f.cleanup();}
  });
});
describe('ops API: balance checks',()=>{
  it('OK needs a decimal string (0.00 is a value); ERROR takes no amount; stale round / account / revision answer 409 with the current state; same key replays',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE']),path=(i:number)=>'vms/'+f.vms[i].id+'/balance-check';
      const zero=await api('POST',path(0),{token:t,body:await balanceBody(f,0,{amount:'0.00'})});expect(zero.json).toMatchObject({ok:true,data:{replay:false,balance:{latest:{status:'OK',amount:'0.00',currency:'USD',withdrawable:null}}}});
      expect((await api('POST',path(0),{token:t,body:await balanceBody(f,0,{amount:10})})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST',path(0),{token:t,body:await balanceBody(f,0,{status:'ERROR',amount:'1.00',errorMessage:'x'})})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST',path(0),{token:t,body:await balanceBody(f,0,{status:'ERROR',amount:null})})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST',path(0),{token:t,body:await balanceBody(f,0,{withdrawable:true})})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST',path(0),{token:t,body:{...await balanceBody(f,0),pin:AI_PIN}})).json.error?.code).toBe('VALIDATION'); // unknown fields refused
      const err=await api('POST',path(0),{token:t,body:await balanceBody(f,0,{status:'ERROR',amount:null,errorMessage:'EarnApp không mở được; password: abc https://x.invalid/?code=9'})});
      expect(err.json.data.balance).toMatchObject({latest:{status:'ERROR'},lastOk:{amount:'0.00'}});expect(err.text).not.toMatch(/abc|code=9/);
      expect((await db.earnBalanceCheck.findFirstOrThrow({where:{vmId:f.vms[0].id,outcome:'FAILED'}})).failure).not.toMatch(/abc|code=9/);
      const wrongCycle=await api('POST',path(1),{token:t,body:await balanceBody(f,1,{expectedCycle:2})});expect(wrongCycle.status).toBe(409);expect(wrongCycle.json.error).toMatchObject({code:'CYCLE_CHANGED',details:{current:{expectedCycle:1}}});
      const wrongRev=await api('POST',path(1),{token:t,body:await balanceBody(f,1,{expectedVmRevision:999})});expect(wrongRev.json.error?.code).toBe('REVISION_CONFLICT');
      const wrongAcc=await api('POST',path(1),{token:t,body:await balanceBody(f,1,{earnAppAccountId:(await f.vmNow(2)).earnAppId})});expect(wrongAcc.json.error).toMatchObject({code:'ACCOUNT_CHANGED',details:{current:{earnAppAccountId:(await f.vmNow(1)).earnAppId}}});
      expect(await db.earnBalanceCheck.count({where:{vmId:f.vms[1].id}})).toBe(0);
      // Same key + same content → the first result, one row; same key + other content → IDEMPOTENCY_CONFLICT; a late older reading is history only.
      const key=randomUUID(),body=await balanceBody(f,2,{amount:'12.40',withdrawable:true,evidenceNote:'Nút Redeem hiện trên EarnApp'});
      expect((await api('POST',path(2),{token:t,key,body})).json.data.replay).toBe(false);
      const again=await api('POST',path(2),{token:t,key,body});expect(again.json.data.replay).toBe(true);expect(await db.earnBalanceCheck.count({where:{vmId:f.vms[2].id}})).toBe(1);
      expect((await api('POST',path(2),{token:t,key,body:{...body,amount:'13.00'}})).json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
      // A rotated token of the same user keeps the protection (the key belongs to user + project, not to the token).
      const rotated=await f.token(f.ai,['READ','BALANCE_WRITE']);expect((await api('POST',path(2),{token:rotated,key,body})).json.data.replay).toBe(true);
      await api('POST',path(2),{token:t,body:await balanceBody(f,2,{amount:'7.00',checkedAt:new Date(Date.now()-3600e3).toISOString()})});
      expect((await api('GET','vms/'+f.vms[2].id+'?projectId='+f.projectId,{token:t})).json.data.balance.latest).toMatchObject({amount:'12.40',withdrawable:true});
      // Two requests with one key at the same time: one write, the other replays.
      const k2=randomUUID(),b2=await balanceBody(f,3,{amount:'5.00'}),[x,y]=await Promise.all([api('POST',path(3),{token:t,key:k2,body:b2}),api('POST',path(3),{token:t,key:k2,body:b2})]);
      expect([x.json.data.replay,y.json.data.replay].sort()).toEqual([false,true]);expect(await db.earnBalanceCheck.count({where:{vmId:f.vms[3].id}})).toBe(1);
      // A right taken away after the token was made applies to the next call (and to a retry of an earlier success).
      await db.projectMember.updateMany({where:{userId:f.ai,projectId:f.projectId},data:{capabilities:[]}});
      expect((await api('POST',path(2),{token:t,key,body})).json.error?.code).toBe('FORBIDDEN');
      // The audit keeps allowed fields only.
      const audit=await db.opsAudit.findMany({where:{userId:f.ai}});expect(audit.length).toBeGreaterThan(5);expect(audit.some(a=>a.replay&&a.result==='REPLAY')).toBe(true);expect(audit.some(a=>a.result==='FORBIDDEN')).toBe(true);
      expect(JSON.stringify(audit)).not.toMatch(new RegExp(t+'|'+AI_PIN+'|12\\.40|Redeem'));
    }finally{await f.cleanup();}
  });
});
describe('ops API: payout flow',()=>{
  it('suggest → prepare (holds the email) → status → receipts 6 + 4; duplicates, contention, retries and the old account are handled by the shared services',async()=>{
    const f=await setup();try{
      const t=await f.token(f.ai,['READ','BALANCE_WRITE','PAYOUT','RECEIPT']),t2=await f.token(f.ai2,['READ','PAYOUT']);
      const v0=await f.vmNow(0),p60=await f.pp('pp-60'),p82=await f.pp('pp-82');
      const loose=await api('GET','paypal/suggest?projectId='+f.projectId+'&earnAppAccountId='+v0.earnAppId+'&currency=USD',{token:t});expect(loose.json.data).toMatchObject({exact:false,amount:null});
      const s=await api('GET','paypal/suggest?projectId='+f.projectId+'&earnAppAccountId='+v0.earnAppId+'&amount=10.00&currency=USD',{token:t});
      expect(s.json.data).toMatchObject({exact:true,amount:'10.00',currency:'USD',suggestion:{paypalEmailId:expect.any(String)}});expect(s.json.data.candidates[0]).not.toHaveProperty('balanceUsd'); // no book for EARN_PAYOUT only
      const eur=await api('GET','paypal/suggest?projectId='+f.projectId+'&earnAppAccountId='+v0.earnAppId+'&amount=10.00&currency=EUR',{token:t});expect(eur.json.data).toMatchObject({exact:false,suggestion:null});expect(eur.json.data.note).toMatch(/USD/);
      const email=s.json.data.suggestion.paypalEmailId as string;expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({holdEarnAppId:null}); // a suggestion holds nothing
      // Prepare twice at once with one key: one request, the email held for this EarnApp (not used yet).
      const key=randomUUID(),body=await prepareBody(f,0,email),[a,b]=await Promise.all([api('POST','withdrawals/prepare',{token:t,key,body}),api('POST','withdrawals/prepare',{token:t,key,body})]);
      expect([a.json.data.replay,b.json.data.replay].sort()).toEqual([false,true]);const w=a.json.data.current.withdrawal;
      expect(w).toMatchObject({submission:'PREPARING',paypalEmailId:email,money:{requested:'10.00',currency:'USD'}});expect(await db.earnPayoutRequest.count({where:{projectId:f.projectId}})).toBe(1);
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({holdEarnAppId:v0.earnAppId,usedEarnAppId:null});
      // Another token / user cannot take the held email for another EarnApp.
      const taken=await api('POST','withdrawals/prepare',{token:t2,body:await prepareBody(f,1,email)});expect(taken.status).toBe(409);expect(taken.json.error?.code).toBe('REVISION_CONFLICT');
      // A new key for the same EarnApp is not silently accepted: DUPLICATE with the old request.
      const dup=await api('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,0,p82.emails[2].id,{amount:'20.00'})});expect(dup.json.error).toMatchObject({code:'DUPLICATE',details:{withdrawalId:w.id}});
      // A locked PP's email is refused at the line.
      await db.payPalAccount.update({where:{id:p60.id},data:{status:'LIMITED'}});
      expect((await api('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,2,p60.emails.find(e=>e.id!==email)!.id)})).json.error?.code).toBe('VALIDATION');
      await db.payPalAccount.update({where:{id:p60.id},data:{status:'ACTIVE'}});
      // UNKNOWN keeps holding; money cannot be recorded before reconciling.
      const unk=await api('POST','withdrawals/'+w.id+'/status',{token:t,body:await statusBody(f,0,w,{status:'UNKNOWN_RESULT',evidenceNote:null})});expect(unk.json.data.current.withdrawal.submission).toBe('UNKNOWN_RESULT');
      expect((await api('POST','withdrawals/'+w.id+'/receipts',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w.id),amount:'10.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-A-'+f.x}})).json.error?.code).toBe('VALIDATION');
      expect((await api('POST','withdrawals/'+w.id+'/status',{token:t,body:await statusBody(f,0,{id:w.id,revision:await reqRev(w.id)},{evidenceNote:null})})).json.error?.code).toBe('VALIDATION');
      const stale=await api('POST','withdrawals/'+w.id+'/status',{token:t,body:await statusBody(f,0,{id:w.id,revision:0})});expect(stale.json.error).toMatchObject({code:'REVISION_CONFLICT',details:{current:{id:w.id,submission:'UNKNOWN_RESULT'}}});
      const sentKey=randomUUID(),sentBody=await statusBody(f,0,{id:w.id,revision:await reqRev(w.id)});
      const sent=await api('POST','withdrawals/'+w.id+'/status',{token:t,key:sentKey,body:sentBody});expect(sent.json.data).toMatchObject({changed:true,recorded:{status:'SUBMITTED_ON_EARNAPP',withdrawalId:w.id},current:{withdrawal:{submission:'SUBMITTED_ON_EARNAPP'}}});
      expect(await db.payPalEmail.findUniqueOrThrow({where:{id:email}})).toMatchObject({usedEarnAppId:v0.earnAppId,holdEarnAppId:null});
      // Receipts: 6 then 4 (parts, never the requested amount, never over what is open, one payment id once whatever the key).
      const rec=async(amount:string,tx:string|null,o:Record<string,unknown>={},k=randomUUID())=>api('POST','withdrawals/'+w.id+'/receipts',{token:t,key:k,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w.id),amount,currency:'USD',receivedAt:new Date().toISOString(),transactionId:tx,evidenceNote:'PayPal activity',...o}});
      const six=await rec('6.00','TX-6-'+f.x);expect(six.json.data.current.withdrawal.money).toMatchObject({received:'6.00',remaining:'4.00'});expect(six.json.data.current.withdrawal.phase).toBe('WAITING');
      expect((await rec('6.00','TX-6-'+f.x)).json.error?.code).toBe('DUPLICATE');
      expect((await rec('5.00','TX-5-'+f.x)).json.error?.code).toBe('VALIDATION'); // over the 4 still open
      expect((await rec('4.00','TX-4-'+f.x,{currency:'EUR'})).json.error?.code).toBe('VALIDATION');
      const four=await rec('4.00','TX-4-'+f.x);expect(four.json.data.current.withdrawal).toMatchObject({phase:'RECEIVED',money:{received:'10.00',remaining:'0.00'}});
      expect(await db.fundTransaction.findMany({where:{payoutRequestId:w.id},select:{amount:true,confirmed:true,earnAppId:true,paypalEmailId:true}})).toHaveLength(2);
      // A retry of the earlier success replays its result although the request changed since.
      const replay=await api('POST','withdrawals/'+w.id+'/status',{token:t,key:sentKey,body:sentBody});expect(replay.json.data.replay).toBe(true);
      // Without a payment id: a second receipt with the same email / day / amount is a possible duplicate (refused, any key).
      const v3=await f.vmNow(3),e3=p82.emails[1].id;
      const w3=(await api('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,3,e3,{amount:'8.00'})})).json.data.current.withdrawal;
      await api('POST','withdrawals/'+w3.id+'/status',{token:t,body:await statusBody(f,3,{id:w3.id,revision:await reqRev(w3.id)})});
      const r3=async()=>api('POST','withdrawals/'+w3.id+'/receipts',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w3.id),amount:'3.00',currency:'USD',receivedAt:new Date().toISOString()}});
      expect((await r3()).json.ok).toBe(true);expect((await r3()).json.error?.code).toBe('DUPLICATE');
      // Account changed in the same round: the operating command for the old account's request is refused.
      const v4=await f.vmNow(4),w4=(await api('POST','withdrawals/prepare',{token:t,body:await prepareBody(f,4,p82.emails[0].id,{amount:'9.00'})})).json.data.current.withdrawal;
      const vm4=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vms[4].id}});await applyLinks(f.scope,{key:randomUUID(),items:[{line:1,vmId:vm4.id,expectedRevision:vm4.revision,login:f.logins[7].id}]},db);
      const moved=await api('POST','withdrawals/'+w4.id+'/status',{token:t,body:{...await statusBody(f,4,{id:w4.id,revision:await reqRev(w4.id)}),earnAppAccountId:v4.earnAppId}});expect(moved.json.error?.code).toBe('ACCOUNT_CHANGED');
      // Late money for an old, closed account: VM 3 is recreated after SUS; the 5 still open on its old request is received later,
      // stays on the old request / EarnApp / email, and the new round is not touched.
      await setVmStatus(f.scope,{key:randomUUID(),items:[{vmId:f.vms[3].id,status:'SUSPENDED',expectedCycle:1}]},db);await recordRecreated(f.scope,{key:randomUUID(),vmId:f.vms[3].id,expectedCycle:1},db);
      const vm3=await db.virtualMachine.findUniqueOrThrow({where:{id:v3.id}});
      expect((await api('POST','withdrawals/'+w3.id+'/status',{token:t,body:{projectId:f.projectId,vmId:v3.id,expectedVmRevision:vm3.revision,expectedCycle:2,earnAppAccountId:v3.earnAppId,expectedRequestRevision:await reqRev(w3.id),status:'UNKNOWN_RESULT',evidenceNote:null,observedAt:new Date().toISOString()}})).json.error?.code).toBe('CYCLE_CHANGED');
      const late=await api('POST','withdrawals/'+w3.id+'/receipts',{token:t,body:{projectId:f.projectId,expectedRequestRevision:await reqRev(w3.id),amount:'5.00',currency:'USD',receivedAt:new Date().toISOString(),transactionId:'TX-LATE-'+f.x}});
      expect(late.json.data.current.withdrawal).toMatchObject({current:false,phase:'RECEIVED',earnAppAccountId:v3.earnAppId});
      expect(await db.fundTransaction.findFirstOrThrow({where:{transactionId:'TX-LATE-'+f.x}})).toMatchObject({earnAppId:v3.earnAppId,paypalEmailId:e3,vmId:v3.id});
      expect((await db.earnAppAccount.findUniqueOrThrow({where:{id:v3.earnAppId}})).closedAt).not.toBeNull();
      // Detail of a request: history with observed and server times, receipts; no secret anywhere.
      const d=await api('GET','withdrawals/'+w.id+'?projectId='+f.projectId,{token:t});expect(d.json.data.receipts).toHaveLength(2);expect(d.json.data.history.some((h:{observedAt:string|null})=>h.observedAt)).toBe(true);
      const list=await api('GET','withdrawals?projectId='+f.projectId+'&status=SUBMITTED_ON_EARNAPP&limit=1',{token:t});expect(list.json.data.items).toHaveLength(1);expect(list.json.data.nextCursor).not.toBeNull();
      for(const r of [d,list,late,s])expect(r.text).not.toMatch(new RegExp('Secret-pw-'+f.x+'|'+t));
      // A READ-only token of the same user: request money and the full receiving email stay closed (rights ∩ token operations).
      const ro=await f.token(f.ai,['READ']),dr=(await api('GET','withdrawals/'+w.id+'?projectId='+f.projectId,{token:ro})).json.data;
      expect(dr.money).toBeNull();expect(dr.receipts).toBeNull();expect(dr.paypalEmail).toMatch(/\*\*\*@/);
      expect((await api('GET','vms/'+f.vms[0].id+'?projectId='+f.projectId,{token:ro})).json.data.balance.amountsVisible).toBe(false);
    }finally{await f.cleanup();}
  });
  it('the web uses the same rules: EARN_PAYOUT prepares and records sent / unknown only; the managers keep the rest',async()=>{
    const f=await setup();try{
      const ai={userId:f.ai,projectId:f.projectId,role:'USER' as const,capabilities:[]},plain={...ai,userId:f.plain},v=await f.vmNow(0),email=(await f.pp('pp-82')).emails[0].id;
      expect((await readVmOps(ai,db)).rights).toMatchObject({payout:true,receipt:true,writeMoney:false,book:false,money:true});
      expect((await readVmOps(plain,db)).rights).toMatchObject({payout:false,receipt:false,money:false});
      await expect(createPayoutRequest(ai,{key:randomUUID(),vmId:v.id,expectedCycle:1,earnAppId:v.earnAppId,paypalEmailId:email,amount:'10',date:f.today},db)).rejects.toMatchObject({code:'FORBIDDEN'}); // SENT directly: managers
      await expect(createPayoutRequest(plain,{key:randomUUID(),vmId:v.id,expectedCycle:1,earnAppId:v.earnAppId,paypalEmailId:email,amount:'10',date:f.today,submission:'PREPARING'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      const r=await createPayoutRequest(ai,{key:randomUUID(),vmId:v.id,expectedCycle:1,earnAppId:v.earnAppId,paypalEmailId:email,amount:'10',date:f.today,submission:'PREPARING'},db);
      await expect(updatePayoutRequest(ai,{key:randomUUID(),requestId:r.id as string,expectedRevision:0,action:'CANCELLED',note:'x',vmId:v.id,expectedCycle:1,earnAppId:v.earnAppId},db)).rejects.toMatchObject({code:'FORBIDDEN'});
      expect(await updatePayoutRequest(f.scope,{key:randomUUID(),requestId:r.id as string,expectedRevision:0,action:'CANCELLED',note:'Huỷ thử',vmId:v.id,expectedCycle:1,earnAppId:v.earnAppId},db)).toMatchObject({changed:true});
    }finally{await f.cleanup();}
  });
});
