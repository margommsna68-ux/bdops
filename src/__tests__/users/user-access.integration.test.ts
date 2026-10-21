import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {db,ADMIN_PIN,AI_PIN,api,setup} from '../ops-api/ops-fixture';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
import {checkWebSession,openWebSession,revokeWebSession,setUserDisabled,unlockWebSession} from '@/server/users/access';
import {loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {createOpsToken,listOpsTokens} from '@/server/ops-api/tokens';
afterAll(()=>db.$disconnect());
// User administration (owner brief 22/10/2026): server-side sessions and PIN unlock, disabling an account, tokens per user.
// Synthetic users / projects, test database only.
type Web={sessionId:string;pinUnlocked:boolean};
const caller=(userId:string,web?:Web)=>appRouter.createCaller({prisma:db,session:{user:{id:userId},expires:'2099-01-01'},...(web?{web}:{})} as unknown as Context);
async function webOf(userId:string){const s=await openWebSession(db,userId),c=await checkWebSession(db,s.id,userId);if(!c.ok)throw new Error('session');return {sessionId:s.id,pinUnlocked:c.pinUnlocked};}
const pinVersionOf=async(id:string)=>(await db.user.findUniqueOrThrow({where:{id},select:{pinVersion:true}})).pinVersion;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function cleanupSessions(ids:string[]){await db.userSession.deleteMany({where:{userId:{in:ids}}});}
// Disabling writes an audit line in every project of the account (the fixture's second project too).
async function cleanupAccess(f:{projectId:string;ai:string;ai2:string}){await db.auditLog.deleteMany({where:{entity:'User',entityId:{in:[f.ai,f.ai2]}}});await db.vmJob.deleteMany({where:{projectId:f.projectId}});await db.userSession.deleteMany({where:{userId:{in:[f.ai,f.ai2]}}});}

describe('web session and PIN unlock are held by the server',()=>{
  it('a session is valid only while open, for its user and epoch; the PIN unlock belongs to it and to the PIN version',async()=>{
    const f=await setup();try{
      const s=await openWebSession(db,f.ai2);
      expect(await checkWebSession(db,s.id,f.ai2)).toMatchObject({ok:true,pinUnlocked:false});
      expect(await checkWebSession(db,s.id,f.plain)).toMatchObject({ok:false,reason:'NO_SESSION'}); // another user's session id
      expect(await checkWebSession(db,null,f.ai2)).toMatchObject({ok:false,reason:'NO_SESSION'});
      // Not unlocked: every call except the PIN ones is refused, whatever the browser says.
      const locked=caller(f.ai2,{sessionId:s.id,pinUnlocked:false});
      await expect(locked.project.list()).rejects.toMatchObject({message:expect.stringMatching(/^PIN_REQUIRED/)});
      expect(await locked.user.hasPin()).toMatchObject({hasPin:true,unlocked:false});
      // Wrong PIN does not unlock; the right one unlocks THIS session only.
      await expect(locked.user.verifyPin({pin:'999999'})).rejects.toBeTruthy();
      expect((await checkWebSession(db,s.id,f.ai2) as Web).pinUnlocked).toBe(false);
      await db.user.update({where:{id:f.ai2},data:{pinFailedCount:0,pinLockedAt:null}});
      await locked.user.verifyPin({pin:AI_PIN});
      expect(await checkWebSession(db,s.id,f.ai2)).toMatchObject({ok:true,pinUnlocked:true});
      const other=await openWebSession(db,f.ai2);expect((await checkWebSession(db,other.id,f.ai2) as Web).pinUnlocked).toBe(false);
      // An admin changes the PIN: the old unlock no longer counts, the old PIN no longer works.
      const admin=caller(f.scope.userId);
      await admin.user.adminResetPin({projectId:f.projectId,userId:f.ai2,newPin:'135791'});
      expect(await checkWebSession(db,s.id,f.ai2)).toMatchObject({ok:true,pinUnlocked:false});
      await expect(caller(f.ai2,{sessionId:s.id,pinUnlocked:false}).user.verifyPin({pin:AI_PIN})).rejects.toBeTruthy();
      await db.user.update({where:{id:f.ai2},data:{pinFailedCount:0,pinLockedAt:null}});
      await unlockWebSession(db,s.id,f.ai2,await pinVersionOf(f.ai2));expect((await checkWebSession(db,s.id,f.ai2) as Web).pinUnlocked).toBe(true);
      // "Xoá PIN" really removes it and ends the unlock.
      await admin.user.resetPin({projectId:f.projectId,userId:f.ai2});
      expect(await checkWebSession(db,s.id,f.ai2)).toMatchObject({ok:true,pinUnlocked:false});
      expect((await db.user.findUniqueOrThrow({where:{id:f.ai2}})).pin).toBeNull();
      // Sign-out ends the session.
      await revokeWebSession(db,s.id,'SIGN_OUT');expect(await checkWebSession(db,s.id,f.ai2)).toMatchObject({ok:false,reason:'REVOKED'});
      await cleanupSessions([f.ai2]);
    }finally{await cleanupAccess(f);await f.cleanup();}
  });
});

describe('disabling an account',()=>{
  it('blocks the web session, the ops token and writes; enabling again never brings them back',async()=>{
    const f=await setup();try{
      const token=await f.token(f.ai,['READ','BALANCE_WRITE']),web=await webOf(f.ai);
      await unlockWebSession(db,web.sessionId,f.ai,await pinVersionOf(f.ai));
      await db.vmJob.create({data:{projectId:f.projectId,vmId:f.vms[0].id,cycle:1,kind:'CHECK',claimedById:f.ai,expiresAt:new Date(Date.now()+3600e3)}});
      expect((await api('GET','me',{token})).status).toBe(200);
      const r=await setUserDisabled(db,f.scope.userId,{projectId:f.projectId,userId:f.ai,disabled:true,reason:'thử'});
      expect(r).toMatchObject({changed:true,disabled:true,revokedTokens:1,revokedSessions:1});
      expect(await checkWebSession(db,web.sessionId,f.ai)).toMatchObject({ok:false});
      expect((await api('GET','me',{token})).status).toBe(401);
      await expect(loadInfrastructureScope(db,f.ai,f.projectId)).rejects.toMatchObject({message:expect.stringMatching(/vô hiệu hoá/)});
      expect(await db.vmJob.findFirst({where:{claimedById:f.ai,state:'ACTIVE'}})).toBeNull();
      // Nothing of the user or the data is deleted.
      expect(await db.user.findUnique({where:{id:f.ai}})).not.toBeNull();expect(await db.projectMember.count({where:{userId:f.ai}})).toBeGreaterThan(0);
      // Enable: a new sign-in works; the old session and the old token stay dead.
      await setUserDisabled(db,f.scope.userId,{projectId:f.projectId,userId:f.ai,disabled:false});
      expect(await checkWebSession(db,web.sessionId,f.ai)).toMatchObject({ok:false});
      expect((await api('GET','me',{token})).status).toBe(401);
      const fresh=await openWebSession(db,f.ai);expect(await checkWebSession(db,fresh.id,f.ai)).toMatchObject({ok:true,pinUnlocked:false});
      expect((await loadInfrastructureScope(db,f.ai,f.projectId)).userId).toBe(f.ai);
      await cleanupSessions([f.ai]);
    }finally{await cleanupAccess(f);await f.cleanup();}
  });
  it('a write that passed its check before the disabling commits; any write after it is refused (no write slips past the cut)',async()=>{
    const f=await setup();try{
      const order:string[]=[];
      const write=db.$transaction(async tx=>{await loadInfrastructureScope(tx,f.ai,f.projectId);order.push('write-checked');await sleep(400);await tx.vmOpsEvent.create({data:{projectId:f.projectId,vmId:f.vms[0].id,cycle:1,kind:'NOTE',note:'trước mốc',actorId:f.ai}});order.push('write-done');});
      await sleep(80);
      const off=setUserDisabled(db,f.scope.userId,{projectId:f.projectId,userId:f.ai,disabled:true}).then(()=>order.push('disabled'));
      await Promise.all([write,off]);
      expect(order).toEqual(['write-checked','write-done','disabled']);
      await expect(db.$transaction(async tx=>{await loadInfrastructureScope(tx,f.ai,f.projectId);await tx.vmOpsEvent.create({data:{projectId:f.projectId,vmId:f.vms[0].id,cycle:1,kind:'NOTE',note:'sau mốc',actorId:f.ai}});})).rejects.toBeTruthy();
      expect(await db.vmOpsEvent.count({where:{vmId:f.vms[0].id,note:'sau mốc'}})).toBe(0);
    }finally{await cleanupAccess(f);await f.cleanup();}
  });
  it('never oneself, never the last ADMIN, never by an ADMIN who does not administer every project of the account, never by a MODERATOR',async()=>{
    const f=await setup();try{
      await expect(setUserDisabled(db,f.scope.userId,{projectId:f.projectId,userId:f.scope.userId,disabled:true})).rejects.toMatchObject({message:expect.stringMatching(/Không tự/)});
      // ai is also a member of project g (where this ADMIN is not ADMIN): the router refuses.
      await expect(caller(f.scope.userId).user.setDisabled({projectId:f.projectId,userId:f.ai,disabled:true})).rejects.toBeTruthy();
      expect((await db.user.findUniqueOrThrow({where:{id:f.ai}})).disabledAt).toBeNull();
      // The only ADMIN of a project cannot be disabled.
      const lone=randomUUID();await db.user.create({data:{id:lone,email:lone+'@fixture.invalid',username:'lone-'+lone.slice(0,6),password:await bcrypt.hash('x',4)}});
      await db.projectMember.update({where:{userId_projectId:{userId:f.g.scope.userId,projectId:f.g.scope.projectId}},data:{role:'USER'}});
      await db.projectMember.create({data:{projectId:f.g.scope.projectId,userId:lone,role:'ADMIN'}});
      await expect(setUserDisabled(db,f.scope.userId,{projectId:f.projectId,userId:lone,disabled:true})).rejects.toMatchObject({message:expect.stringMatching(/cuối cùng/)});
      await db.projectMember.update({where:{userId_projectId:{userId:f.g.scope.userId,projectId:f.g.scope.projectId}},data:{role:'ADMIN'}});
      await db.projectMember.deleteMany({where:{userId:lone}});await db.user.delete({where:{id:lone}});
      // A MODERATOR / USER cannot call it.
      await db.projectMember.update({where:{userId_projectId:{userId:f.plain,projectId:f.projectId}},data:{role:'MODERATOR',canManageUsers:true}});
      await expect(caller(f.plain).user.setDisabled({projectId:f.projectId,userId:f.viewer,disabled:true})).rejects.toBeTruthy();
    }finally{await cleanupAccess(f);await f.cleanup();}
  });
});

describe('tokens of one user',()=>{
  it('the list is filtered on the server; a repeated / concurrent create with the same key makes one token; non-admins cannot create or grant',async()=>{
    const f=await setup();try{
      await f.token(f.ai2,['READ']);
      const key='create-'+randomUUID();
      const input={projectId:f.projectId,userId:f.ai,name:'SERVER-01 · AI',scopes:['READ'] as ('READ')[],expiresInDays:30,pin:ADMIN_PIN,createKey:key};
      const [a,b]=await Promise.all([createOpsToken(f.scope.userId,input,db),createOpsToken(f.scope.userId,input,db)]);
      expect([a.token,b.token].filter(Boolean)).toHaveLength(1);expect(a.id).toBe(b.id);
      const again=await createOpsToken(f.scope.userId,input,db);expect(again).toMatchObject({id:a.id,token:null,already:true});
      expect(await db.opsToken.count({where:{userId:f.ai}})).toBe(1);
      const mine=await listOpsTokens(f.scope.userId,f.projectId,db,{userId:f.ai});
      expect(mine.map(t=>t.id)).toEqual([a.id]);
      expect((await caller(f.scope.userId).opsToken.list({projectId:f.projectId,userId:f.ai2})).every(t=>t.username!==null)).toBe(true);
      // Non-admins: no token, no rights, no role change for themselves.
      await expect(caller(f.plain).opsToken.create({...input,createKey:'x-'+randomUUID(),userId:f.plain})).rejects.toBeTruthy();
      await expect(caller(f.plain).opsToken.list({projectId:f.projectId,userId:f.ai})).rejects.toBeTruthy();
      const member=await db.projectMember.findUniqueOrThrow({where:{userId_projectId:{userId:f.plain,projectId:f.projectId}}});
      await expect(caller(f.plain).proxyManagement.setCapabilities({projectId:f.projectId,memberId:member.id,capabilities:['COPY_CREDENTIALS']})).rejects.toBeTruthy();
      await expect(caller(f.plain).project.updateMember({projectId:f.projectId,memberId:member.id,role:'ADMIN'} as never)).rejects.toBeTruthy();
      expect((await db.projectMember.findUniqueOrThrow({where:{id:member.id}})).role).toBe('USER');
      // The user page summary counts tokens in force in this project.
      expect(await caller(f.scope.userId).user.access({projectId:f.projectId,userId:f.ai})).toMatchObject({activeTokens:1,viewerRole:'ADMIN',hasPin:true,state:'ACTIVE',project:{businessMode:'PROXY_VM'}});
    }finally{await cleanupAccess(f);await f.cleanup();}
  });
});
