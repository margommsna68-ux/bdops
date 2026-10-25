import {createHash, randomUUID} from 'node:crypto';
import {afterAll, afterEach, describe, expect, it} from 'vitest';
import {businessDB as db, businessFixture} from './business-fixture';
import {freeTestNet} from './db-fixture';
import {encrypt} from '@/lib/encryption';
import {configureWorker, disableWorker, requestCheck, workerAction} from '@/server/apple-check/service';
import {appleWorkerHttp} from '@/server/apple-check/http';

type Claimed = {id:string;leaseToken:string;accountId:string;expiresAt:string;recoveryOnly?:boolean};
type Claim = {job:Claimed|null;completed?:boolean};
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
afterAll(()=>db.$disconnect());

async function setup(proxyCount=7){
 const f=await businessFixture(),ids:string[]=[];
 let token='';
 cleanups.push(async()=>{
  await db.proxyIP.updateMany({where:{projectId:f.scope.projectId},data:{appleCheckLeaseJobId:null}});
  await db.appleCheckRequest.deleteMany({where:{projectId:f.scope.projectId}});
  await db.appleCheckJob.deleteMany({where:{projectId:f.scope.projectId}});
  await db.appleCheckWorker.deleteMany({where:{projectId:f.scope.projectId}});
  await db.proxyIP.deleteMany({where:{projectId:f.scope.projectId}});
  await db.proxyGroup.deleteMany({where:{projectId:f.scope.projectId}});
  await db.proxyIdentity.deleteMany({where:{id:{in:ids}}});
  await db.opsRateBucket.deleteMany({where:{key:'read:apple:'+createHash('sha256').update(token).digest('hex')}});
  await f.cleanup();
 });
 const group=await db.proxyGroup.create({data:{projectId:f.scope.projectId,name:'Synthetic slot proxies',normalizedName:randomUUID()}});
 const net=await freeTestNet(db,'198.18.');
 for(let i=1;i<=proxyCount;i++){
  const identity=await db.proxyIdentity.create({data:{ip:net+i,owner:'SELF',ownerDecidedAt:new Date()}});ids.push(identity.id);
  await db.proxyIP.create({data:{projectId:f.scope.projectId,address:randomUUID(),host:identity.ip,port:18080,
   identityId:identity.id,groupId:group.id,packageCode:'SYNTHETIC-SLOTS',inventoryState:'NEW',inventoryKey:identity.ip,
   credentialCipher:encrypt(JSON.stringify({username:'slot-user',password:'Synthetic-Slot-Proxy'}))}});
 }
 const cfg=await configureWorker(f.scope,{name:'Synthetic five-slot worker',proxyGroupId:group.id},db);token=cfg.token;
 for(let i=0;i<7;i++){
  const a=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@example.invalid',loginType:'APPLE_ID',password:encrypt('Synthetic-Slot-Password')}});
  await requestCheck(f.scope,{accountId:a.id,expectedRevision:a.revision,key:randomUUID()},db);
 }
 const call=(action:string,body:unknown={})=>workerAction(token,action,body,db);
 const claim=async(slot?:number,key:string=randomUUID())=>await call('claim',{key,...(slot===undefined?{}:{slot})}) as Claim;
 const bind=(job:Claimed)=>({jobId:job.id,leaseToken:job.leaseToken});
 const finish=(job:Claimed,cleanup:'OK'|'FAILED'='OK')=>call('result',{...bind(job),result:'UNKNOWN',reasonCode:'UNKNOWN',cleanup,observedAt:new Date().toISOString()});
 const state=async()=>(await db.appleCheckWorker.findUniqueOrThrow({where:{id:cfg.workerId}})).state;
 return {...f,cfg,group,call,claim,bind,finish,state};
}

describe('Apple checker five concurrent claim slots',()=>{
 it('claims five concurrent jobs with five exclusive proxies and rejects a sixth slot',async()=>{
  const f=await setup();
  const claims=await Promise.all([1,2,3,4,5].map(slot=>f.claim(slot)));
  expect(claims.every(c=>c.job!==null)).toBe(true);
  expect(new Set(claims.map(c=>c.job!.id)).size).toBe(5);
  const jobs=await db.appleCheckJob.findMany({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}});
  expect(jobs).toHaveLength(5);
  expect(new Set(jobs.map(j=>j.proxyId)).size).toBe(5);
  expect(jobs.map(j=>j.activeWorkerId).sort()).toEqual([f.cfg.workerId,...[2,3,4,5].map(s=>f.cfg.workerId+':slot:'+s)].sort());
  const proxies=await db.proxyIP.findMany({where:{projectId:f.scope.projectId,appleCheckLeaseJobId:{not:null}}});
  expect(proxies).toHaveLength(5);
  expect(new Set(proxies.map(p=>p.appleCheckLeaseJobId))).toEqual(new Set(jobs.map(j=>j.id)));
  await expect(f.claim(6)).rejects.toThrow();
  for(const slot of [1,2,3,4,5])expect((await f.claim(slot)).job).toBeNull();
  expect(await f.state()).toBe('BUSY');
 });

 it('preserves default slot 1 and refuses a second process in the same slot',async()=>{
  const f=await setup(),first=await f.claim();
  expect(first.job).not.toBeNull();
  expect((await f.claim(1)).job).toBeNull();
  const sameSlot=await Promise.all([f.claim(2),f.claim(2)]);
  expect(sameSlot.filter(c=>c.job)).toHaveLength(1);
  const active=await db.appleCheckJob.findMany({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}});
  expect(active).toHaveLength(2);
  expect(active.find(j=>j.id===first.job!.id)?.activeWorkerId).toBe(f.cfg.workerId);
  expect(new Set(active.map(j=>j.proxyId)).size).toBe(2);
 });

 it('binds replay keys to their original slot even after DONE clears active ownership',async()=>{
  const f=await setup(),key=randomUUID(),first=await f.claim(3,key);
  expect((await f.claim(3,key)).job).toMatchObject(first.job!);
  await expect(f.claim(2,key)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await expect(f.claim(undefined,key)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await f.call('route',f.bind(first.job!));await f.call('submit',f.bind(first.job!));
  expect((await f.claim(3,key)).job).toMatchObject({...first.job!,recoveryOnly:true});
  await f.finish(first.job!);
  expect(await f.claim(3,key)).toEqual({job:null,completed:true});
  await expect(f.claim(4,key)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  expect((await f.claim(3)).job).not.toBeNull();
 });

 it('never leases one proxy to two simultaneously active slots',async()=>{
  const f=await setup(1);
  const claims=await Promise.all([f.claim(2),f.claim(5)]);
  expect(claims.filter(c=>c.job)).toHaveLength(1);
  const winner=claims.find(c=>c.job)!.job!;
  expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}})).toBe(1);
  await f.finish(winner);
  const next=await f.claim(4);
  expect(next.job).not.toBeNull();expect(next.job!.id).not.toBe(winner.id);
 });

 it('keeps BUSY across result, heartbeat, and cleanup recovery until every slot is released',async()=>{
  const f=await setup(),a=(await f.claim(2)).job!,b=(await f.claim(5)).job!;
  await f.finish(a,'FAILED');expect(await f.state()).toBe('CLEANUP_FAILED');
  await f.call('cleanup-recovered',f.bind(a));expect(await f.state()).toBe('BUSY');
  await f.call('heartbeat',{state:'IDLE'});expect(await f.state()).toBe('BUSY');
  await f.finish(b);expect(await f.state()).toBe('IDLE');
 });

 it('keeps cleanup failure global while other slots finish, and recovers only after every failed cleanup',async()=>{
  const f=await setup(),a=(await f.claim(2)).job!,b=(await f.claim(4)).job!,c=(await f.claim(5)).job!;
  await f.finish(a,'FAILED');await f.finish(b,'FAILED');
  await f.finish(c);expect(await f.state()).toBe('CLEANUP_FAILED');
  await expect(f.claim(1)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await f.call('cleanup-recovered',f.bind(a));expect(await f.state()).toBe('CLEANUP_FAILED');
  await expect(f.claim(3)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  const held=await db.appleCheckJob.findUniqueOrThrow({where:{id:b.id}});
  expect(held.activeWorkerId).toBe(f.cfg.workerId+':slot:4');
  expect((await db.proxyIP.findUniqueOrThrow({where:{id:held.proxyId!}})).appleCheckLeaseJobId).toBe(b.id);
  await f.call('cleanup-recovered',f.bind(b));expect(await f.state()).toBe('IDLE');
  expect((await f.claim(3)).job).not.toBeNull();
 });

 it('blocks configuration rotation with only nonlegacy slots held and cancels every slot on disable',async()=>{
  const f=await setup(),a=(await f.claim(2)).job!,b=(await f.claim(5)).job!;
  await expect(configureWorker(f.scope,{name:'Cannot rotate',proxyGroupId:f.group.id},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await disableWorker(f.scope,db);
  const jobs=await db.appleCheckJob.findMany({where:{projectId:f.scope.projectId}});
  expect(jobs.filter(j=>j.phase==='QUEUED')).toHaveLength(0);
  expect(jobs.filter(j=>j.activeWorkerId!==null)).toHaveLength(2);
  expect(jobs.every(j=>j.cancelRequested)).toBe(true);
  for(const j of [a,b]){
   expect(await f.call('heartbeat-job',f.bind(j))).toEqual({cancelRequested:true});
   await expect(f.call('route',f.bind(j))).rejects.toMatchObject({code:'FORBIDDEN'});
   await f.finish(j);
  }
  expect(await f.state()).toBe('IDLE');
  expect(await db.proxyIP.count({where:{projectId:f.scope.projectId,appleCheckLeaseJobId:{not:null}}})).toBe(0);
 });

 it.each([0,6,-1,1.5,'2',null])('rejects invalid HTTP slot %j without allocating a job',async(slot)=>{
  const f=await setup(1);
  const response=await appleWorkerHttp(new Request('http://fixture.invalid/api/apple-check/v1/claim',{
   method:'POST',headers:{authorization:'Bearer '+f.cfg.token,'content-type':'application/json'},body:JSON.stringify({key:randomUUID(),slot}),
  }),'claim',db);
  expect(response.status).toBe(422);
  expect(await db.appleCheckJob.count({where:{projectId:f.scope.projectId,activeWorkerId:{not:null}}})).toBe(0);
 });
});
