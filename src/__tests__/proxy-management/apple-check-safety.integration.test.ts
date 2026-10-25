import {createHash, randomUUID} from 'node:crypto';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {businessDB as db, businessFixture} from './business-fixture';
import {freeTestNet} from './db-fixture';
import {encrypt} from '@/lib/encryption';
import {appleWorkerHttp} from '@/server/apple-check/http';
import {configureWorker, disableWorker, readChecks, requestCheck, requestCheckBatch, workerAction} from '@/server/apple-check/service';
import {appleCheckRouter} from '@/server/routers/appleCheck';
import {planAutoLinks} from '@/server/account-store/links';
import {listAiAccounts} from '@/server/ops-api/ai-accounts';
import {getEligibleInventory} from '@/server/proxy-management/repository';

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

async function setup(proxyCount=1) {
  const f = await businessFixture();
  const identityIds:string[] = [], tokens:string[] = [];
  cleanups.push(async()=>{
    await db.proxyIP.updateMany({where:{projectId:f.scope.projectId},data:{appleCheckLeaseJobId:null}});
    await db.appleCheckRequest.deleteMany({where:{projectId:f.scope.projectId}});
    await db.appleCheckJob.deleteMany({where:{projectId:f.scope.projectId}});
    await db.appleCheckWorker.deleteMany({where:{projectId:f.scope.projectId}});
    await db.virtualMachine.updateMany({where:{server:{projectId:f.scope.projectId}},data:{proxyId:null}});
    await db.vMProxyAllocation.deleteMany({where:{projectId:f.scope.projectId}});
    await db.vMConfiguration.deleteMany({where:{projectId:f.scope.projectId}});
    await db.proxyStatusEvent.deleteMany({where:{projectId:f.scope.projectId}});
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
  for(let n=1;n<proxyCount;n++){
    const extra=await db.proxyIdentity.create({data:{ip:net+(17+n),owner:'SELF',ownerDecidedAt:new Date()}});identityIds.push(extra.id);
    await db.proxyIP.create({data:{projectId:f.scope.projectId,address:randomUUID(),host:extra.ip,port:18080,identityId:extra.id,groupId:group.id,packageCode:'SYNTHETIC-SAFETY',inventoryState:'NEW',inventoryKey:extra.ip,credentialCipher:encrypt(JSON.stringify({username:'synthetic-safety-user',password:proxyPassword}))}});
  }
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
  it('queues 100 accounts while only five worker slots execute and finished slots take the next accounts',async()=>{
    const f=await setup(5),accounts=[f.account];
    for(let n=1;n<100;n++)accounts.push(await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID',password:encrypt(accountPassword)}}));
    const input={accounts:accounts.map(a=>({accountId:a.id,expectedRevision:a.revision,key:randomUUID()}))};
    const queued=await requestCheckBatch(f.scope,input,db);expect(queued.jobs).toHaveLength(100);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,phase:'QUEUED'}})).toBe(100);
    expect(await requestCheckBatch(f.scope,input,db)).toEqual(queued);
    const first=[];for(let slot=1;slot<=5;slot++)first.push((await f.call('claim',{key:randomUUID(),slot}) as Claim).job!);
    expect(first.every(Boolean)).toBe(true);expect(new Set(first.map(j=>j.id)).size).toBe(5);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}})).toBe(5);
    await expect(f.call('claim',{key:randomUUID(),slot:6})).rejects.toThrow();
    for(let slot=1;slot<=5;slot++)expect((await f.call('claim',{key:randomUUID(),slot}) as Claim).job).toBeNull();
    for(const j of first)await f.result({jobId:j.id,leaseToken:j.leaseToken},'UNKNOWN');
    const second=[];for(let slot=1;slot<=5;slot++)second.push((await f.call('claim',{key:randomUUID(),slot}) as Claim).job!);
    expect(second.every(Boolean)).toBe(true);expect(new Set([...first,...second].map(j=>j.id)).size).toBe(10);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,phase:'QUEUED'}})).toBe(90);
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}})).toBe(5);
  });
  it('keeps the latest result for every account even beyond the recent 1000 checks',async()=>{
    const f=await setup();
    const older=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID'}});
    const oldJob=await db.appleCheckJob.create({data:{projectId:f.scope.projectId,accountId:older.id,accountRevision:older.revision,requestedById:f.scope.userId,requestKey:randomUUID(),phase:'DONE',result:'LIVE_2FA',cleanup:'OK',createdAt:new Date('2026-01-01')}});
    await db.appleCheckJob.createMany({data:Array.from({length:1001},()=>({projectId:f.scope.projectId,accountId:f.account.id,accountRevision:f.account.revision,requestedById:f.scope.userId,requestKey:randomUUID(),phase:'DONE',result:'UNKNOWN',cleanup:'OK'}))});
    const result=await readChecks(f.scope,db);
    expect(result.jobs.find(j=>j.id===oldJob.id)).toMatchObject({result:'LIVE_2FA',stale:false});
    expect(new Set(result.jobs.map(j=>j.id)).size).toBe(result.jobs.length);
  });
  it.each(['legacy','installed'] as const)('checks a LIVE proxy already assigned to a VM via %s without altering its assignment',async(mode)=>{
    const f=await setup();
    await db.proxyIP.update({where:{id:f.proxy.id},data:{inventoryState:'LIVE',status:'IN_USE'}});
    if(mode==='legacy')await db.virtualMachine.update({where:{id:f.vm.id},data:{proxyId:f.proxy.id}});
    else{
      const cfg=await db.vMConfiguration.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,version:1,endpointId:f.proxy.id,status:'CONFIRMED',snapshotCipher:encrypt('{}'),configurationHash:'synthetic',createdById:f.scope.userId}});
      await db.vMProxyAllocation.create({data:{projectId:f.scope.projectId,vmId:f.vm.id,configurationId:cfg.id,endpointId:f.proxy.id,allocationKey:f.proxy.inventoryKey!,role:'INSTALLED',createdById:f.scope.userId}});
      await db.proxyStatusEvent.create({data:{projectId:f.scope.projectId,identityId:f.proxy.identityId!,endpointId:f.proxy.id,ip:f.proxy.host!,kind:'INSTALLED'}});
    }
    const before={vm:await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}}),proxy:await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}}),holds:await db.vMProxyAllocation.findMany({where:{projectId:f.scope.projectId}})};
    expect(await getEligibleInventory(f.scope.projectId,db)).toEqual([]); // VM autofill remains unused-only.
    const b=await f.lease();
    expect((await f.http('route',b)).status).toBe(200);
    expect(await f.call('heartbeat-job',b)).toMatchObject({cancelRequested:false});
    expect((await f.http('submit',b)).status).toBe(200);
    await f.result(b,'UNKNOWN');
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).toEqual(before.vm);
    expect(await db.proxyIP.findUniqueOrThrow({where:{id:f.proxy.id}})).toMatchObject({inventoryState:'LIVE',status:'IN_USE',revision:before.proxy.revision,appleCheckLeaseJobId:null});
    expect(await db.vMProxyAllocation.findMany({where:{projectId:f.scope.projectId}})).toEqual(before.holds);
  });
  it.each(['BLOCKED','DIE','REPLACED','VOID'] as const)('does not check a VM proxy with an unreversed %s event',async(kind)=>{
    const f=await setup();await db.proxyIP.update({where:{id:f.proxy.id},data:{inventoryState:'LIVE',status:'IN_USE'}});
    await db.virtualMachine.update({where:{id:f.vm.id},data:{proxyId:f.proxy.id}});
    await db.proxyStatusEvent.create({data:{projectId:f.scope.projectId,identityId:f.proxy.identityId!,endpointId:f.proxy.id,ip:f.proxy.host!,kind}});
    await f.ask();expect((await f.claim()).job).toBeNull();
  });
  it('stops an assigned LIVE proxy when it becomes BLOCKED during the check',async()=>{
    const f=await setup();await db.proxyIP.update({where:{id:f.proxy.id},data:{inventoryState:'LIVE',status:'IN_USE'}});
    await db.virtualMachine.update({where:{id:f.vm.id},data:{proxyId:f.proxy.id}});
    const b=await f.lease();expect((await f.http('route',b)).status).toBe(200);
    await db.proxyIP.update({where:{id:f.proxy.id},data:{inventoryState:'BLOCKED',status:'BLOCKED'}});
    expect((await f.http('submit',b)).status).toBe(409);
    expect(await f.call('heartbeat-job',b)).toMatchObject({cancelRequested:true});
    expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).proxyId).toBe(f.proxy.id);
  });
  it.each(['ACTIVE','APPLE_LOCKED'] as const)('records submitted LIVE_2FA without changing account health %s or VM data',async(status)=>{
    const f=await setup();Object.assign(f.account,await db.gmailAccount.update({where:{id:f.account.id},data:{status}}));
    const account=await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}}),vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});
    const b=await f.lease();await f.call('route',b);await f.call('submit',b);
    const body={...b,result:'LIVE_2FA',reasonCode:'LIVE_2FA',cleanup:'OK',observedAt:new Date().toISOString()};
    const result=await f.http('result',body);expect(result.status).toBe(200);expect(result.json.data).toMatchObject({result:'LIVE_2FA',reasonCode:'LIVE_2FA',stale:false});f.noSecrets(result.json);
    expect((await f.http('result',body)).json).toEqual(result.json);
    expect(await db.gmailAccount.findUniqueOrThrow({where:{id:f.account.id}})).toEqual(account);
    expect(await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).toEqual(vm);
  });

  it('refuses LIVE_2FA before submittedAt even after route secret delivery',async()=>{
    const f=await setup(),b=await f.lease();
    const body={...b,result:'LIVE_2FA',reasonCode:'LIVE_2FA',cleanup:'OK',observedAt:new Date().toISOString()};
    expect((await f.http('result',body)).status).toBe(422);await f.call('route',b);
    expect((await f.http('result',body)).status).toBe(422);
    expect(await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}})).toMatchObject({phase:'CLAIMED',submittedAt:null,resultHash:null});
    await f.call('submit',b);expect((await f.http('result',body)).status).toBe(200);
  });

  it.each(['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED'])('preserves UNKNOWN diagnostic %s and exact terminal replay',async(reasonCode)=>{
    const f=await setup(),b=await f.lease();await f.call('route',b);await f.call('submit',b);
    const body={...b,result:'UNKNOWN',reasonCode,cleanup:'OK',observedAt:new Date().toISOString()};
    const result=await f.http('result',body);expect(result.status).toBe(200);expect(result.json.data).toMatchObject({result:'UNKNOWN',reasonCode});f.noSecrets(result.json);
    await db.gmailAccount.update({where:{id:f.account.id},data:{revision:{increment:1}}});await disableWorker(f.scope,db);
    expect((await f.http('result',body)).json.data).toMatchObject({id:b.jobId,result:'UNKNOWN',reasonCode,stale:true});
    expect((await f.http('result',{...body,reasonCode:'UNKNOWN'})).status).toBe(409);
  });

  it('refuses diagnostic codes for every non-UNKNOWN outcome and rejects arbitrary reason text',async()=>{
    const f=await setup(),b=await f.lease();await f.call('route',b);await f.call('submit',b);
    for(const result of ['LOGIN_SUCCESS','LIVE_2FA','APPLE_LOCKED','CHALLENGE_REQUIRED','INVALID_CREDENTIALS','PROXY_ERROR','NETWORK_ERROR','TIMEOUT','CANCELLED']){
      for(const reasonCode of ['EMAIL_FORM_MISSING','PASSWORD_FORM_MISSING','SUBMIT_BUTTON_MISSING','RESPONSE_UNRECOGNIZED','BROWSER_INTERRUPTED','CREDENTIAL_DELIVERY_FAILED'])
        expect((await f.http('result',{...b,result,reasonCode,cleanup:'OK',observedAt:new Date().toISOString()})).status).toBe(422);
    }
    const invalid=await f.http('result',{...b,result:'UNKNOWN',reasonCode:'free text '+accountPassword,cleanup:'OK',observedAt:new Date().toISOString()});
    expect(invalid.status).toBe(422);f.noSecrets(invalid.json);
    expect((await db.appleCheckJob.findUniqueOrThrow({where:{id:b.jobId}})).resultHash).toBeNull();
  });

  it('queues five accounts in input order and replays per-account keys without duplicate effects',async()=>{
    const f=await setup();const accounts=[f.account];
    for(let i=1;i<5;i++)accounts.push(await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID',password:encrypt(accountPassword)}}));
    const input={accounts:accounts.map(a=>({accountId:a.id,expectedRevision:a.revision,key:randomUUID()}))};
    const first=await requestCheckBatch(f.scope,input,db);
    expect(first.jobs.map(j=>j.accountId)).toEqual(accounts.map(a=>a.id));expect(first.jobs).toHaveLength(5);
    expect(await requestCheckBatch(f.scope,input,db)).toEqual(first);
    expect((await requestCheckBatch(f.scope,{accounts:input.accounts.map(a=>({...a,key:randomUUID()}))},db)).jobs.map(j=>j.id)).toEqual(first.jobs.map(j=>j.id));
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(5);
    expect(await db.appleCheckRequest.count({where:{projectId:f.scope.projectId}})).toBe(10);
    expect(await db.auditLog.count({where:{projectId:f.scope.projectId,action:'APPLE_CHECK_REQUEST'}})).toBe(5);
    f.noSecrets(first);
  });

  it('enforces 1–100 queued input items at service and protected router before any request effects',async()=>{
    const f=await setup(),item={accountId:f.account.id,expectedRevision:f.account.revision,key:randomUUID()};
    const caller=appleCheckRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'} as any});
    for(const accounts of [[],Array.from({length:101},()=>({...item}))]){
      await expect(requestCheckBatch(f.scope,{accounts},db)).rejects.toThrow();
      await expect(caller.requestBatch({projectId:f.scope.projectId,accounts})).rejects.toMatchObject({code:'BAD_REQUEST'});
    }
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(0);
    const result=await caller.requestBatch({projectId:f.scope.projectId,accounts:[item,item]});
    expect(result.jobs).toHaveLength(2);expect(result.jobs[0].id).toBe(result.jobs[1].id);
    expect(await db.appleCheckRequest.count({where:{projectId:f.scope.projectId}})).toBe(1);
  });

  it('rolls the whole batch back on a stale revision or cross-account key conflict',async()=>{
    const f=await setup();const other=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID',password:encrypt(accountPassword)}});
    for(const conflict of ['revision','key']){
      const key=randomUUID();const accounts=[{accountId:f.account.id,expectedRevision:f.account.revision,key},{accountId:other.id,expectedRevision:other.revision+(conflict==='revision'?1:0),key:conflict==='key'?key:randomUUID()}];
      await expect(requestCheckBatch(f.scope,{accounts},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
      expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(0);
      expect(await db.appleCheckRequest.count({where:{projectId:f.scope.projectId}})).toBe(0);
      expect(await db.auditLog.count({where:{projectId:f.scope.projectId,action:'APPLE_CHECK_REQUEST'}})).toBe(0);
    }
  });

  it('keeps batch permission, project, disabled-worker and cooldown rules identical to single requests',async()=>{
    const f=await setup(),input={accounts:[{accountId:f.account.id,expectedRevision:f.account.revision,key:randomUUID()}]};
    await expect(requestCheckBatch(f.worker,input,db)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(requestCheckBatch(f.scope,{accounts:[input.accounts[0],{accountId:randomUUID(),expectedRevision:0,key:randomUUID()}]},db)).rejects.toMatchObject({code:'NOT_FOUND'});
    expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId}})).toBe(0);
    await disableWorker(f.scope,db);await expect(requestCheckBatch(f.scope,input,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
    await db.appleCheckWorker.update({where:{id:f.cfg.workerId},data:{enabled:true}});
    const b=await f.lease();await f.call('route',b);await f.call('submit',b);await f.result(b,'UNKNOWN');
    await expect(requestCheckBatch(f.scope,input,db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  });

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
