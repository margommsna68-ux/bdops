import {afterAll,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import type {PrismaClient} from '@prisma/client';
import {db,setup,AI_PIN,ADMIN_PIN,api} from '../ops-api/ops-fixture';
import {appRouter} from '@/server/routers/_app';
import {openWebSession,checkWebSession,revokeWebSession} from '@/server/users/access';
import {createOpsToken,revokeOpsToken,hashToken} from '@/server/ops-api/tokens';
import {runWithOpsAuth} from '@/server/ops-api/context';
import {addManagedVMs} from '@/server/vm-management/metadata';
import {claimVmJob,recordJobSdk,releaseVmJob} from '@/server/vm-ops/jobs';
// Independent review 22/10/2026 (PIN version / lock, AI SDK command): the reviewer's four reproductions
// (.runtime/review-user-ai-20261022.test.ts) with unchanged expectations, plus the crossing points asked for. Synthetic data, test DB only.
vi.mock('@/lib/audit',()=>({createAuditLog:vi.fn(async()=>undefined)}));
afterAll(()=>db.$disconnect());
const caller=(userId:string,sid:string,client:PrismaClient=db)=>appRouter.createCaller({prisma:client,session:{user:{id:userId},expires:'2099-01-01'},web:{sessionId:sid,pinUnlocked:false}} as never);
const admin=(f:F)=>appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as never);
type F=Awaited<ReturnType<typeof setup>>;
async function clean(f:F){
  await db.userSession.deleteMany({where:{userId:{in:[f.ai,f.ai2,f.plain,f.scope.userId]}}});await db.vmJob.deleteMany({where:{projectId:f.projectId}});
  await db.vMSdkHistory.deleteMany({where:{projectId:f.projectId}});await db.auditLog.deleteMany({where:{entity:'User',entityId:{in:[f.ai,f.ai2]}}});await f.cleanup();
}
/** A client whose FIRST transaction is followed (after it commits) by a competing action: the moment between two steps of one call. */
function afterFirstTransaction(action:()=>Promise<unknown>){
  let hit=false;
  return new Proxy(db,{get(target,prop){
    if(prop==='$transaction')return async(...args:unknown[])=>{const result=await (target.$transaction as (...a:unknown[])=>Promise<unknown>)(...args);if(!hit){hit=true;await action();}return result;};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
  }}) as PrismaClient;
}
const unlocked=async(f:F,sid:string)=>{const c=await checkWebSession(db,sid,f.ai2);return c.ok&&c.pinUnlocked;};

describe('reviewer reproductions (unchanged expectations)',()=>{
  it('an old PIN verified just before an admin change must not unlock the NEW PIN version',async()=>{
    const f=await setup();try{
      const session=await openWebSession(db,f.ai2),newHash=await bcrypt.hash('135791',4);
      const raced=afterFirstTransaction(()=>db.user.update({where:{id:f.ai2},data:{pin:newHash,pinVersion:{increment:1}}}));
      await caller(f.ai2,session.id,raced).user.verifyPin({pin:AI_PIN}).catch(()=>undefined);
      expect(await checkWebSession(db,session.id,f.ai2)).toMatchObject({ok:true,pinUnlocked:false});
    }finally{await clean(f);}
  });
  it('a PIN-locked user cannot bypass the lock using setPin with the old PIN',async()=>{
    const f=await setup();try{
      const session=await openWebSession(db,f.ai2),c=caller(f.ai2,session.id);
      for(let i=0;i<3;i++)await c.user.verifyPin({pin:'999999'}).catch(()=>undefined);
      let accepted=false;try{await c.user.setPin({currentPin:AI_PIN,pin:'135791'});accepted=true;}catch{/* refused */}
      const user=await db.user.findUniqueOrThrow({where:{id:f.ai2}});
      expect({accepted,stillLocked:!!user.pinLockedAt,unlocked:await unlocked(f,session.id)}).toEqual({accepted:false,stillLocked:true,unlocked:false});
    }finally{await clean(f);}
  });
});

describe('PIN unlock is tied to the PIN version and the state it was checked on',()=>{
  for(const [what,between] of [
    ['PIN removed',(f:F)=>db.user.update({where:{id:f.ai2},data:{pin:null,pinVersion:{increment:1}}})],
    ['account disabled',(f:F)=>db.user.update({where:{id:f.ai2},data:{disabledAt:new Date(),authEpoch:{increment:1}}})],
    ['PIN locked by other wrong PINs',(f:F)=>db.user.update({where:{id:f.ai2},data:{pinLockedAt:new Date(),pinFailedCount:3}})],
  ] as const)it(what+' between the check and the unlock → no unlock, refused',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai2);let refused=false;
      await caller(f.ai2,s.id,afterFirstTransaction(()=>between(f))).user.verifyPin({pin:AI_PIN}).catch(()=>{refused=true;});
      expect(refused).toBe(true);expect((await db.userSession.findUniqueOrThrow({where:{id:s.id}})).pinUnlockedAt).toBeNull();
    }finally{await db.user.update({where:{id:f.ai2},data:{disabledAt:null}});await clean(f);}
  });
  it('a session revoked between the check and the unlock is never unlocked',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai2);let refused=false;
      await caller(f.ai2,s.id,afterFirstTransaction(()=>revokeWebSession(db,s.id,'SIGN_OUT'))).user.verifyPin({pin:AI_PIN}).catch(()=>{refused=true;});
      expect(refused).toBe(true);expect((await db.userSession.findUniqueOrThrow({where:{id:s.id}})).pinUnlockedAt).toBeNull();
    }finally{await clean(f);}
  });
  it('changing an own PIN: first PIN needs none; a change needs the current PIN, counted by the shared rule; the admin unlock still works',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai2),c=caller(f.ai2,s.id);
      await expect(c.user.setPin({pin:'246802'})).rejects.toBeTruthy(); // a PIN exists: the current one is required
      for(let i=0;i<3;i++)await c.user.setPin({currentPin:'000000',pin:'246802'}).catch(()=>undefined); // wrong current PIN counts…
      const locked=await db.user.findUniqueOrThrow({where:{id:f.ai2}});expect(locked.pinLockedAt).not.toBeNull(); // …and locks: no unlimited tries
      expect(await bcrypt.compare(AI_PIN,locked.pin!)).toBe(true);
      await admin(f).user.adminUnlockAccount({projectId:f.projectId,userId:f.ai2,type:'PIN'});
      const v0=(await db.user.findUniqueOrThrow({where:{id:f.ai2}})).pinVersion;
      await c.user.setPin({currentPin:AI_PIN,pin:'246802'});
      const after=await db.user.findUniqueOrThrow({where:{id:f.ai2}});
      expect(after.pinVersion).toBe(v0+1);expect(await bcrypt.compare('246802',after.pin!)).toBe(true);expect(await unlocked(f,s.id)).toBe(true);
      // First PIN (none set): no current PIN needed.
      await db.user.update({where:{id:f.ai2},data:{pin:null}});await c.user.setPin({pin:'135799'});
      expect(await bcrypt.compare('135799',(await db.user.findUniqueOrThrow({where:{id:f.ai2}})).pin!)).toBe(true);
    }finally{await clean(f);}
  });
  it('admin set / change / remove change hash and version together; older unlocks stop',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai2);await caller(f.ai2,s.id).user.verifyPin({pin:AI_PIN});expect(await unlocked(f,s.id)).toBe(true);
      const v=(await db.user.findUniqueOrThrow({where:{id:f.ai2}})).pinVersion;
      await admin(f).user.adminResetPin({projectId:f.projectId,userId:f.ai2,newPin:'112233'});
      expect((await db.user.findUniqueOrThrow({where:{id:f.ai2}})).pinVersion).toBe(v+1);expect(await unlocked(f,s.id)).toBe(false);
      await admin(f).user.resetPin({projectId:f.projectId,userId:f.ai2});
      expect(await db.user.findUniqueOrThrow({where:{id:f.ai2}})).toMatchObject({pin:null,pinVersion:v+2});
    }finally{await clean(f);}
  });
});

describe('AI SDK: one command, one transaction',()=>{
  async function vmFor(f:F,code:string){await addManagedVMs(f.scope,f.server.id,[code],db);return db.virtualMachine.findFirstOrThrow({where:{serverId:f.server.id,code}});}
  const tokenFor=async(f:F)=>(await createOpsToken(f.scope.userId,{projectId:f.projectId,userId:f.ai,name:'review-sdk',scopes:['READ','VM_OPS'],expiresInDays:1,pin:ADMIN_PIN},db)).token!;
  const counts=async(f:F,vmId:string,code:string)=>({records:await db.sdkRecord.count({where:{projectId:f.projectId,code}}),history:await db.vMSdkHistory.count({where:{vmId}}),events:await db.sdkEvent.count({where:{projectId:f.projectId}}),vmSdk:(await db.virtualMachine.findUniqueOrThrow({where:{id:vmId}})).sdkId});
  it('identical HTTP SDK retry returns the original acknowledgement (reviewer reproduction)',async()=>{
    const f=await setup();try{
      const t=await tokenFor(f),vm=await vmFor(f,'REVIEW_001');
      const job=await api('POST','vms/'+vm.id+'/claim',{token:t,body:{projectId:f.projectId,expectedCycle:1,kind:'PREPARE'}});expect(job.status).toBe(200);
      const body={projectId:f.projectId,jobId:job.json.data.recorded.job.id,expectedCycle:1,expectedVmRevision:vm.revision,code:'REVIEW-SDK-'+randomUUID()},key=randomUUID();
      const first=await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body});expect(first.status).toBe(200);
      const retry=await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body});
      expect({status:retry.status,error:retry.json.error?.code??null,replay:retry.json.data?.replay}).toEqual({status:200,error:null,replay:true});
      expect(retry.json.data.recorded).toEqual(first.json.data.recorded);
    }finally{await clean(f);}
  });
  it('replay after the job was released, after it expired and after the VM changed: same recorded, nothing written; another body is refused; a revoked token gets no replay',async()=>{
    const f=await setup();try{
      const t=await tokenFor(f),vm=await vmFor(f,'REVIEW_003');
      const job=(await api('POST','vms/'+vm.id+'/claim',{token:t,body:{projectId:f.projectId,expectedCycle:1,kind:'PREPARE'}})).json.data.recorded.job;
      const code='REVIEW-RPL-'+randomUUID(),body={projectId:f.projectId,jobId:job.id,expectedCycle:1,expectedVmRevision:vm.revision,code},key=randomUUID();
      const first=await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body});expect(first.status).toBe(200);
      const base=await counts(f,vm.id,code);expect(base).toMatchObject({records:1,vmSdk:code});
      await api('POST','jobs/'+job.id+'/release',{token:t,body:{projectId:f.projectId}});
      await db.virtualMachine.update({where:{id:vm.id},data:{notes:'đổi sau lần ghi',revision:{increment:1}}});
      for(const r of [await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body})]){expect(r.status).toBe(200);expect(r.json.data.replay).toBe(true);expect(r.json.data.recorded).toEqual(first.json.data.recorded);}
      await db.vmJob.update({where:{id:job.id},data:{expiresAt:new Date(Date.now()-1000)}});
      const again=await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body});expect(again.json.data.recorded).toEqual(first.json.data.recorded);
      expect(await counts(f,vm.id,code)).toEqual(base);
      const other=await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body:{...body,code:'REVIEW-OTHER-'+randomUUID()}});expect(other.json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
      const row=await db.opsToken.findFirstOrThrow({where:{tokenHash:hashToken(t)}});await revokeOpsToken(f.scope.userId,{projectId:f.projectId,tokenId:row.id},db);
      expect((await api('POST','vms/'+vm.id+'/sdk',{token:t,key,body})).status).toBe(401);
      expect(await counts(f,vm.id,code)).toEqual(base);
    }finally{await clean(f);}
  });
  for(const [what,race] of [
    ['the job released',(f:F,jobId:string)=>releaseVmJob(f.scope,{key:randomUUID(),jobId},db)],
    ['the job expired',(_f:F,jobId:string)=>db.vmJob.update({where:{id:jobId},data:{expiresAt:new Date(Date.now()-1000)}})],
    ['the job taken over by another user',(f:F,jobId:string)=>db.vmJob.update({where:{id:jobId},data:{claimedById:f.ai2}})],
    ['the VM moved to a new round',(_f:F,_jobId:string,vmId:string)=>db.vmOperation.update({where:{vmId},data:{cycle:2}})],
    ['the user\'s right removed',(f:F)=>db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.projectId}},data:{role:'VIEWER'}})],
  ] as const)it('refused with nothing written when '+what+' after the pre-check',async()=>{
    const f=await setup();try{
      const vm=await vmFor(f,'REVIEW_R'+Math.floor(Math.random()*1e6));
      const job=await claimVmJob(f.scope,{key:randomUUID(),vmId:vm.id,expectedCycle:1,kind:'PREPARE'},db);
      const code='REVIEW-RACE-'+randomUUID();let rejected=false;
      try{await recordJobSdk(f.scope,{key:randomUUID(),vmId:vm.id,jobId:job.job.id,expectedCycle:1,expectedVmRevision:vm.revision,code},afterFirstTransaction(()=>race(f,job.job.id,vm.id)));}catch{rejected=true;}
      expect({rejected,...await counts(f,vm.id,code)}).toMatchObject({rejected:true,records:0,history:0,vmSdk:null});
      expect((await db.vmJob.findUniqueOrThrow({where:{id:job.job.id}})).sdkId).toBeNull();
    }finally{await db.projectMember.update({where:{userId_projectId:{userId:f.scope.userId,projectId:f.projectId}},data:{role:'ADMIN'}});await clean(f);}
  });
  it('refused with nothing written when the token is revoked after the pre-check',async()=>{
    const f=await setup();try{
      const t=await tokenFor(f),row=await db.opsToken.findFirstOrThrow({where:{tokenHash:hashToken(t)}}),vm=await vmFor(f,'REVIEW_T1');
      const caller={tokenId:row.id,tokenLabel:'review-sdk'},scope={...f.scope,userId:f.ai,role:'USER' as const,capabilities:[]};
      const job=await runWithOpsAuth({tokenId:row.id,userId:f.ai,operation:'VM_OPS'},()=>claimVmJob(scope,{key:randomUUID(),vmId:vm.id,expectedCycle:1,kind:'PREPARE'},db,caller));
      const code='REVIEW-TOK-'+randomUUID();let rejected=false;
      try{await runWithOpsAuth({tokenId:row.id,userId:f.ai,operation:'VM_OPS'},()=>recordJobSdk(scope,{key:randomUUID(),vmId:vm.id,jobId:job.job.id,expectedCycle:1,expectedVmRevision:vm.revision,code},afterFirstTransaction(()=>revokeOpsToken(f.scope.userId,{projectId:f.projectId,tokenId:row.id},db)),caller));}catch{rejected=true;}
      expect({rejected,...await counts(f,vm.id,code)}).toMatchObject({rejected:true,records:0,history:0,vmSdk:null});
    }finally{await clean(f);}
  });
  it('releasing a job after the pre-check must refuse without writing an SDK (reviewer reproduction)',async()=>{
    const f=await setup();try{
      const vm=await vmFor(f,'REVIEW_002'),job=await claimVmJob(f.scope,{key:randomUUID(),vmId:vm.id,expectedCycle:1,kind:'PREPARE'},db),code='REVIEW-RACE-'+randomUUID();
      const raced=afterFirstTransaction(()=>releaseVmJob(f.scope,{key:randomUUID(),jobId:job.job.id},db));let rejected=false;
      try{await recordJobSdk(f.scope,{key:randomUUID(),vmId:vm.id,jobId:job.job.id,expectedCycle:1,expectedVmRevision:vm.revision,code},raced);}catch{rejected=true;}
      const row=await db.virtualMachine.findUniqueOrThrow({where:{id:vm.id}});
      expect({rejected,sdkCount:await db.sdkRecord.count({where:{projectId:f.projectId,code}}),vmSdk:row.sdkId}).toEqual({rejected:true,sdkCount:0,vmSdk:null});
    }finally{await clean(f);}
  });
});
