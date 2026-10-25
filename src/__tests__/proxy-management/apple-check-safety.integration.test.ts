import {createHash, randomUUID} from 'node:crypto';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {businessDB as db, businessFixture} from './business-fixture';
import {freeTestNet} from './db-fixture';
import {encrypt} from '@/lib/encryption';
import {appleWorkerHttp} from '@/server/apple-check/http';
import {configureWorker, disableWorker, readChecks, requestCheck, workerAction} from '@/server/apple-check/service';
import {planAutoLinks} from '@/server/account-store/links';
import {listAiAccounts} from '@/server/ops-api/ai-accounts';

const accountPassword = 'Synthetic-Apple-Safety-Password';
const proxyPassword = 'Synthetic-Apple-Safety-Proxy';
type Lease = {jobId:string; leaseToken:string};
type Claim = {job:null|{id:string; leaseToken:string; accountId:string; accountRevision:number; expiresAt:string; recoveryOnly?:boolean}};
type HttpOptions = {token?:string; raw?:string; headers?:Record<string,string>};
const cleanups:Array<()=>Promise<void>> = [];

afterEach(async()=>{
  // Each cleanup is project/token scoped: other test processes may share the test DB.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(()=>db.$disconnect());

async function setup() {
  const f = await businessFixture();
  const identityIds:string[] = [], tokens:string[] = [];
  cleanups.push(async()=>{
    await db.proxyIP.updateMany({where:{projectId:f.scope.projectId},data:{appleCheckLeaseJobId:null}});
    await db.appleCheckRequest.deleteMany({where:{projectId:f.scope.projectId}});
    await db.appleCheckJob.deleteMany({where:{projectId:f.scope.projectId}});
    await db.appleCheckWorker.deleteMany({where:{projectId:f.scope.projectId}});
    await db.virtualMachine.updateMany({where:{server:{projectId:f.scope.projectId}},data:{proxyId:null}});
    await db.vMProxyAllocation.deleteMany({where:{projectId:f.scope.projectId}});
    await db.proxyIP.deleteMany({where:{projectId:f.scope.projectId}});
    await db.proxyGroup.deleteMany({where:{projectId:f.scope.projectId}});
    await db.proxyIdentity.deleteMany({where:{id:{in:identityIds}}});
    await db.opsRateBucket.deleteMany({where:{key:{in:tokens.map(t=>'read:apple:'+createHash('sha256').update(t).digest('hex'))}}});
    await f.cleanup();
  });
  // Dedicated prefix, plus a free /24, avoids identities made by concurrent test files.
  const net = await freeTestNet(db,'198.19.');
  const group = await db.proxyGroup.create({data:{projectId:f.scope.projectId,name:'Apple safety checks',normalizedName:randomUUID()}});
  const identity = await db.proxyIdentity.create({data:{ip:net+'17',owner:'SELF',ownerDecidedAt:new Date()}});
  identityIds.push(identity.id);
  const proxy = await db.proxyIP.create({data:{projectId:f.scope.projectId,address:randomUUID(),host:identity.ip,port:18080,
    identityId:identity.id,groupId:group.id,packageCode:'SYNTHETIC-SAFETY',inventoryState:'NEW',inventoryKey:identity.ip,
    credentialCipher:encrypt(JSON.stringify({username:'synthetic-safety-user',password:proxyPassword}))}});
  const account = await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',
    loginType:'APPLE_ID',password:encrypt(accountPassword)}});
  const cfg = await configureWorker(f.scope,{name:'Synthetic safety worker',proxyGroupId:group.id},db);
  tokens.push(cfg.token);
  const call = (action:string,body:unknown={})=>workerAction(cfg.token,action,body,db);
  const ask = (key:string=randomUUID())=>requestCheck(f.scope,{accountId:account.id,expectedRevision:account.revision,key},db);
  const claim = async(key:string=randomUUID())=>await call('claim',{key}) as Claim;
  const lease = async()=>{
    await ask();
    const {job} = await claim();
    expect(job).not.toBeNull();
    return {jobId:job!.id,leaseToken:job!.leaseToken};
  };
  const http = async(action:string,body:unknown={},options:HttpOptions={})=>{
    const token = options.token??cfg.token;
    if (!tokens.includes(token)) tokens.push(token);
    const response = await appleWorkerHttp(new Request('http://apple-check.fixture.invalid/api/apple-check/v1/'+action,{
      method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...options.headers},
      body:options.raw??JSON.stringify(body),
    }),action,db);
    const text = await response.text();
    return {status:response.status,headers:response.headers,text,json:JSON.parse(text)};
  };
  const noSecrets = (value:unknown)=>{
    const text = typeof value==='string'?value:JSON.stringify(value);
    for (const secret of [accountPassword,proxyPassword,cfg.token,account.email,'synthetic-safety-user']) expect(text).not.toContain(secret);
  };
  const result = (b:Lease,reason:string)=>call('result',{...b,result:reason,reasonCode:reason,cleanup:'OK',observedAt:new Date().toISOString()});
  return {...f,account,proxy,cfg,ask,call,claim,lease,http,noSecrets,result};
}

describe('Apple check backend and HTTP safety',()=>{
  it('removes a Locked login from both auto-link stock and AI candidates without mutating VM bindings',async()=>{
    const f = await setup();
    const input = {vmIds:[f.vm.id],loginType:'APPLE_ID' as const,withPaypal:false};
    expect(await planAutoLinks(f.scope,input,db)).toMatchObject({ready:1,availableLogins:1});
    expect((await listAiAccounts(db,f.scope.projectId,{state:'UNUSED',type:'APPLE'})).items.map(a=>a.id)).toEqual([f.account.id]);
    const before = await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
    const b = await f.lease();
    await f.call('route',b);
    await f.call('submit',b);
    await f.result(b,'APPLE_LOCKED');
    expect(await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}})).toMatchObject({status:'APPLE_LOCKED',revision:f.account.revision+1});
    expect(await planAutoLinks(f.scope,input,db)).toMatchObject({ready:0,availableLogins:0,notPlanned:[{vm:f.vm.code}]});
    expect((await listAiAccounts(db,f.scope.projectId,{state:'UNUSED',type:'APPLE'})).items).toEqual([]);
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).toEqual(before);
    expect(await db.earnAppAccount.count({where:{projectId:f.scope.projectId}})).toBe(0);
  });

  it('keeps an existing EarnApp and legacy VM login binding when Apple reports Locked',async()=>{
    const f = await setup();
    await db.virtualMachine.update({where:{id:f.vm.id},data:{gmailId:f.account.id}});
    const earn = await db.earnAppAccount.create({data:{projectId:f.scope.projectId,loginId:f.account.id,vmId:f.vm.id}});
    const vm = await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
    const b = await f.lease();
    await f.call('route',b); await f.call('submit',b); await f.result(b,'APPLE_LOCKED');
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).toEqual(vm);
    expect(await db.earnAppAccount.findUniqueOrThrow({where:{id:earn.id}})).toEqual(earn);
    expect((await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}})).status).toBe('APPLE_LOCKED');
  });

  it('rejects reuse of a request key for a different account or revision',async()=>{
    const f = await setup(), key = randomUUID();
    const job = await f.ask(key);
    const other = await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID',password:encrypt(accountPassword)}});
    for (const input of [{accountId:other.id,expectedRevision:other.revision},{accountId:f.account.id,expectedRevision:f.account.revision+1}]) {
      await expect(requestCheck(f.scope,{...input,key},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
    }
    expect((await f.ask(key)).id).toBe(job.id);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(1);
    expect(await db.appleCheckRequest.count({where:{projectId:f.scope.projectId}})).toBe(1);
  });

  it.each(['worker disabled','user disabled','admin revoked'] as const)('denies route and submit after %s, and returns no plaintext',async(revoke)=>{
    const f = await setup(), b = await f.lease();
    // A valid route before revocation proves submit is denied by authority, not a missing probe.
    expect((await f.http('route',b)).status).toBe(200);
    if (revoke==='worker disabled') await disableWorker(f.scope,db);
    else if (revoke==='user disabled') await db.user.update({where:{id:f.scope.userId},data:{disabledAt:new Date()}});
    else await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
    for (const action of ['route','submit']) {
      const response = await f.http(action,b);
      expect(response.status).toBe(403);
      expect(response.json).toMatchObject({ok:false,data:null,error:{code:'FORBIDDEN'}});
      expect(response.headers.get('cache-control')).toBe('no-store');
      f.noSecrets(response.text);
    }
    const job = await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}});
    expect(job.submittedAt).toBeNull(); expect(job.phase).toBe('CLAIMED');
    const heartbeat = await f.http('heartbeat-job',b);
    expect(heartbeat.json.data).toEqual({cancelRequested:true}); f.noSecrets(heartbeat.text);
    await f.result(b,'CANCELLED');
    expect(await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}})).toMatchObject({result:'UNKNOWN',cleanup:'OK',activeWorkerId:null,activeAccountId:null});
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).appleCheckLeaseJobId).toBeNull();
    expect((await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}})).status).toBe('ACTIVE');
    f.noSecrets(await db.auditLog.findMany({where:{projectId:f.scope.projectId}}));
  });

  it.each(['expiresAt','hardDeadline'] as const)('fences an expired %s: no submit, extension, or repeat claim',async(field)=>{
    const f = await setup(), b = await f.lease();
    await f.call('route',b);
    const expired = new Date(Date.now()-1000);
    await db.appleCheckJob.update({where:{id:b.jobId},data:{[field]:expired}});
    const before = await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}});
    expect(await f.call('heartbeat-job',b)).toEqual({cancelRequested:true});
    const response = await f.http('submit',b);
    expect(response.status).toBe(409); f.noSecrets(response.text);
    // A lost-response replay may recover cleanup ownership, never permission to log in.
    expect((await f.claim(before.claimKey!)).job).toMatchObject({id:b.jobId,leaseToken:b.leaseToken,recoveryOnly:true});
    expect((await f.claim()).job).toBeNull();
    const after = await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}});
    expect(after.submittedAt).toBeNull(); expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.hardDeadline).toEqual(before.hardDeadline);
    expect(after.activeWorkerId).toBe(f.cfg.workerId);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).appleCheckLeaseJobId).toBe(b.jobId);
  });

  it('allows only one concurrent claim to own the queued job and proxy',async()=>{
    const f = await setup(); await f.ask();
    // Exercise real competing HTTP transactions, without retrying in the test helper.
    const responses = await Promise.all([f.http('claim',{key:randomUUID()}),f.http('claim',{key:randomUUID()})]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const jobs = responses.flatMap(r=>r.json.data.job?[r.json.data.job]:[]);
    expect(jobs).toHaveLength(1);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,activeWorkerId:f.cfg.workerId}})).toBe(1);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).appleCheckLeaseJobId).toBe(jobs[0].id);
    for (const response of responses) f.noSecrets(response.text);
  });

  it('replays a lost claim response with the same lease and never replays submitted credentials',async()=>{
    const f = await setup(); await f.ask();
    const key = randomUUID(), first = await f.claim(key), replay = await f.claim(key);
    expect(replay.job).toMatchObject(first.job!);
    const b = {jobId:first.job!.id,leaseToken:first.job!.leaseToken};
    await f.call('route',b); await f.call('submit',b);
    expect((await f.claim(key)).job).toMatchObject({...first.job!,recoveryOnly:true});
    for (const action of ['route','submit']) {
      const response = await f.http(action,b);
      expect(response.status).toBe(409); f.noSecrets(response.text);
    }
    expect((await f.claim()).job).toBeNull();
    await f.result(b,'UNKNOWN');
    expect(await f.call('claim',{key})).toEqual({job:null,completed:true});
    expect(await db.auditLog.count({where:{projectId:f.scope.projectId,action:'APPLE_CHECK_LOGIN_READ'}})).toBe(1);
  });

  it.each(['before claim','before route','before submit'] as const)('rejects a proxy assigned to a VM %s',async(timing)=>{
    const f = await setup(); await f.ask();
    const assign = ()=>db.virtualMachine.update({where:{id:f.vm.id},data:{proxyId:f.proxy.id}});
    if (timing==='before claim') {
      await assign(); expect((await f.claim()).job).toBeNull();
      expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).appleCheckLeaseJobId).toBeNull();
    } else {
      const {job} = await f.claim(), b = {jobId:job!.id,leaseToken:job!.leaseToken};
      if (timing==='before submit') expect((await f.http('route',b)).status).toBe(200);
      // No revision bump: eligibility must independently notice the VM relation.
      await assign();
      for (const action of timing==='before route'?['route','submit']:['submit']) {
        const response = await f.http(action,b);
        expect(response.status).toBe(409); f.noSecrets(response.text);
      }
      expect((await db.appleCheckJob.findUniqueOrThrow({where:{id:job!.id}})).submittedAt).toBeNull();
    }
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).proxyId).toBe(f.proxy.id);
  });

  it('rejects unknown actions, oversized bodies, bad tokens, malformed JSON, and invalid shapes without echoing secrets',async()=>{
    const f = await setup();
    const cases:Array<{action:string; status:number; options:HttpOptions}> = [
      {action:'unknown',status:404,options:{raw:accountPassword}},
      {action:'claim',status:413,options:{raw:JSON.stringify({key:accountPassword,pad:'x'.repeat(4097)})}},
      {action:'claim',status:413,options:{raw:'{}',headers:{'content-length':'4097'}}},
      {action:'claim',status:401,options:{token:'bad-'+accountPassword}},
      {action:'claim',status:403,options:{token:'mth_apple_'+randomUUID().replaceAll('-','').padEnd(43,'x')}},
      {action:'claim',status:422,options:{raw:'{"key":"'+accountPassword+'"'}},
      {action:'claim',status:422,options:{raw:JSON.stringify({key:randomUUID(),password:accountPassword})}},
      {action:'claim',status:422,options:{raw:'{}',headers:{'content-type':'text/plain'}}},
    ];
    for (const c of cases) {
      const response = await f.http(c.action,{},c.options);
      expect(response.status).toBe(c.status); expect(response.json).toMatchObject({ok:false,data:null});
      expect(response.headers.get('cache-control')).toBe('no-store'); f.noSecrets(response.text);
      if (c.options.token) expect(response.text).not.toContain(c.options.token);
    }
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(0);
    expect((await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).appleCheckLeaseJobId).toBeNull();
  });

  it('records a 2FA challenge without clearing account health or marking it ACTIVE',async()=>{
    const f = await setup();
    await db.gmailAccount.update({where:{id:f.account.id},data:{status:'NEEDS_2FA_UPDATE',loginIssueNote:'Existing operator health note',loginIssueAt:new Date()}});
    const before = await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}});
    // The database advances the revision when health changes; request the current row.
    await requestCheck(f.scope,{accountId:before.id,expectedRevision:before.revision,key:randomUUID()},db);
    const {job} = await f.claim(), b = {jobId:job!.id,leaseToken:job!.leaseToken};
    await f.call('route',b); await f.call('submit',b);
    expect(await f.result(b,'CHALLENGE_REQUIRED')).toMatchObject({phase:'DONE',result:'CHALLENGE_REQUIRED',cleanup:'OK'});
    expect(await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}})).toEqual(before);
    expect((await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}})).appliedRevision).toBeNull();
    f.noSecrets(await readChecks(f.scope,db));
  });

  it('replays an active request alias after DONE and after cooldown instead of creating a new job',async()=>{
    const f = await setup(), original = await f.ask(), alias = randomUUID();
    expect((await f.ask(alias)).id).toBe(original.id);
    const {job} = await f.claim(), b = {jobId:job!.id,leaseToken:job!.leaseToken};
    await f.call('route',b); await f.call('submit',b); await f.result(b,'UNKNOWN');
    expect(await f.ask(alias)).toMatchObject({id:original.id,phase:'DONE'});
    await db.appleCheckJob.update({where:{id:original.id},data:{submittedAt:new Date(Date.now()-16*60_000)}});
    expect(await f.ask(alias)).toMatchObject({id:original.id,phase:'DONE'});
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(1);
    expect(await db.appleCheckRequest.count({where:{projectId:f.scope.projectId}})).toBe(2);
    // Control: a genuinely new key can now start another job.
    expect((await f.ask()).id).not.toBe(original.id);
  });

  it('finishes queued jobs on disable and releases their active account slot',async()=>{
    const f = await setup(), job = await f.ask();
    await disableWorker(f.scope,db);
    expect(await db.appleCheckJob.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({
      phase:'DONE',result:'CANCELLED',reasonCode:'CANCELLED',cleanup:'OK',cancelRequested:true,
      activeAccountId:null,activeWorkerId:null,submittedAt:null,
    });
    expect((await f.ask((await db.appleCheckJob.findUniqueOrThrow({where:{id:job.id}})).requestKey)).id).toBe(job.id);
    expect((await f.http('claim',{key:randomUUID()})).status).toBe(403);
  });

  it('cancels heartbeat after a separate requester loses stock permissions without extending the lease',async()=>{
    const f = await setup();
    await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR'}});
    const job = await requestCheck(f.worker,{accountId:f.account.id,expectedRevision:f.account.revision,key:randomUUID()},db);
    const claimed = await f.claim(), b = {jobId:claimed.job!.id,leaseToken:claimed.job!.leaseToken};
    const before = await db.appleCheckJob.findUniqueOrThrow({where:{id:job.id}});
    await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
    expect(await f.call('heartbeat-job',b)).toEqual({cancelRequested:true});
    expect((await db.appleCheckJob.findUniqueOrThrow({where:{id:job.id}})).expiresAt).toEqual(before.expiresAt);
    for (const action of ['route','submit']) {
      const response = await f.http(action,b); expect(response.status).toBe(403); f.noSecrets(response.text);
    }
    await f.result(b,'CANCELLED');
    expect((await db.appleCheckJob.findUniqueOrThrow({where:{id:job.id}})).result).toBe('UNKNOWN');
  });
});
