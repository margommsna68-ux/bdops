import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {businessDB as db,businessFixture} from '../proxy-management/business-fixture';
import {encrypt} from '@/lib/encryption';
import {checkTotp,totpCodeFor,stepOf,unlockWebSessionTotp} from '@/server/users/totp';
import {openWebSession} from '@/server/users/access';
import {verifyBusinessPin,verifyBusinessWebSession,assertBusinessPinProof} from '@/server/business-management/pin';
import {appRouter} from '@/server/routers/_app';
import {copyProxyRows} from '@/server/proxy-management/history';
import {freeTestNet} from '../proxy-management/db-fixture';
import {copyOperatingCredentials} from '@/server/business-management/accounts';
afterAll(()=>db.$disconnect());
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
async function fixture(){const f=await businessFixture();await db.user.update({where:{id:f.scope.userId},data:{password:await bcrypt.hash('synthetic-login',4)}});const sid=(await openWebSession(db,f.scope.userId)).id;return {...f,sid,cleanup:async()=>{await db.userSession.deleteMany({where:{userId:{in:[f.scope.userId,f.worker.userId]}}});await db.userBackupCode.deleteMany({where:{userId:{in:[f.scope.userId,f.worker.userId]}}});await f.cleanup();}};}
it('reproduces a login-accepted TOTP being refused by a second account-copy check; a validated session proof avoids consuming it twice',async()=>{
 const f=await fixture();try{
  await db.user.update({where:{id:f.scope.userId},data:{totpEnabledAt:new Date(),totpSecretCipher:encrypt(secret),totpVersion:1,totpLastStep:stepOf(Date.now())-1,pin:null}});
  const code=totpCodeFor(secret),checked=await checkTotp(db,f.scope.userId,code);expect(checked.result).toBe('OK');expect(await unlockWebSessionTotp(db,f.sid,f.scope.userId,checked.totpVersion)).toBe(true);
  const login=await db.gmailAccount.create({data:{projectId:f.scope.projectId,email:randomUUID()+'@fixture.invalid',password:encrypt('synthetic-secret'),loginType:'GMAIL'}});
  await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:login.id,pin:code},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  const before=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}});
  const proof=await verifyBusinessWebSession(db,f.scope.userId,f.sid);
  const http=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'},web:{sessionId:f.sid,pinUnlocked:true}} as never);
  expect(await http.businessManagement.copyAccount({projectId:f.scope.projectId,kind:'GMAIL',id:login.id})).toMatchObject({secret:'synthetic-secret'});
  const direct=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as never);
  await expect(direct.businessManagement.copyAccount({projectId:f.scope.projectId,kind:'GMAIL',id:login.id,sessionId:f.sid,pinUnlocked:true,proof} as never)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.scope.userId,proof))).resolves.toBeUndefined();
  const after=await db.user.findUniqueOrThrow({where:{id:f.scope.userId}});expect(after.totpLastStep).toBe(before.totpLastStep);expect(after.totpFailedCount).toBe(before.totpFailedCount);
 }finally{await f.cleanup();}
});
it('session proof must belong to this user, an unlocked live session and current PIN version; stale proof is rejected inside the action',async()=>{
 const f=await fixture();try{
  await expect(verifyBusinessWebSession(db,f.scope.userId,f.sid)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.userSession.update({where:{id:f.sid},data:{pinUnlockedAt:new Date(),pinVersion:0}});
  const proof=await verifyBusinessWebSession(db,f.scope.userId,f.sid);
  await expect(verifyBusinessWebSession(db,f.worker.userId,f.sid)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.scope.userId,{...proof}))).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.user.update({where:{id:f.scope.userId},data:{pinVersion:{increment:1}}});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.scope.userId,proof))).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(verifyBusinessWebSession(db,f.scope.userId,f.sid)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('own explicit PIN yields proof for a non-owner moderator; disabled, revoked, epoch-changed and reset factors fail closed',async()=>{
 const f=await fixture();try{
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR',capabilities:['COPY_CREDENTIALS']}});
  await db.user.update({where:{id:f.worker.userId},data:{pin:await bcrypt.hash('246802',4)}});
  const proof=await verifyBusinessPin(db,f.worker.userId,'246802');await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.worker.userId,proof))).resolves.toBeUndefined();
  await expect(verifyBusinessPin(db,f.worker.userId,'123456')).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.user.update({where:{id:f.worker.userId},data:{authEpoch:{increment:1}}});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.worker.userId,proof))).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.user.update({where:{id:f.worker.userId},data:{disabledAt:new Date()}});
  await expect(verifyBusinessPin(db,f.worker.userId,'246802')).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.userSession.update({where:{id:f.sid},data:{pinUnlockedAt:new Date(),pinVersion:0}});
  const sessionProof=await verifyBusinessWebSession(db,f.scope.userId,f.sid);await db.userSession.update({where:{id:f.sid},data:{revokedAt:new Date()}});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.scope.userId,sessionProof))).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('direct TOTP proof is version-bound and never makes a replayed TOTP acceptable',async()=>{
 const f=await fixture();try{
  await db.user.update({where:{id:f.scope.userId},data:{totpEnabledAt:new Date(),totpSecretCipher:encrypt(secret),totpVersion:1,totpLastStep:stepOf(Date.now())-1,pin:null}});
  const code=totpCodeFor(secret),proof=await verifyBusinessPin(db,f.scope.userId,code);
  await expect(verifyBusinessPin(db,f.scope.userId,code)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.user.update({where:{id:f.scope.userId},data:{totpVersion:{increment:1}}});
  await expect(db.$transaction(tx=>assertBusinessPinProof(tx,f.scope.userId,proof))).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});


it('proxy reveal rechecks proof inside its transaction and never reveals with a reset factor',async()=>{
 const f=await fixture(),net=await freeTestNet(db,'203.7.');let identityId:string|undefined;try{
  const identity=await db.proxyIdentity.create({data:{ip:net+'1',owner:'SELF'}});identityId=identity.id;
  const endpoint=await db.proxyIP.create({data:{projectId:f.scope.projectId,identityId:identity.id,address:identity.ip+':80',host:identity.ip,port:80,credentialCipher:encrypt(JSON.stringify({username:'u',password:'synthetic-proxy-secret'})),inventoryState:'NEW',inventoryKey:identity.id}});
  const proof=await verifyBusinessPin(db,f.scope.userId,'123456');
  expect((await copyProxyRows(f.scope,{endpointIds:[endpoint.id]},db,{proof})).copied).toBe(1);
  await db.user.update({where:{id:f.scope.userId},data:{pinVersion:{increment:1}}});
  await expect(copyProxyRows(f.scope,{endpointIds:[endpoint.id]},db,{proof})).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(await db.auditLog.count({where:{projectId:f.scope.projectId,action:'COPY_PROXY_CREDENTIALS'}})).toBe(1);
 }finally{await db.proxyIP.deleteMany({where:{projectId:f.scope.projectId}});if(identityId)await db.proxyIdentity.deleteMany({where:{id:identityId}});await f.cleanup();}
});
